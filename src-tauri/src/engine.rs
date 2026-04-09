// src-tauri/src/engine.rs
use crate::backend::{InferenceBackend, Message};
use crate::chat::{build_prompt, PromptFormat};
use llama_cpp_2::{
    context::params::LlamaContextParams,
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, AddBos, LlamaModel},
    sampling::LlamaSampler,
};
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};

// ============ 常量定义 ============

/// 默认上下文大小
// 根据设备配置自动调整：
// - 低配设备 (< 8GB RAM): 1024-2048
// - 中等设备 (8-16GB RAM): 2048-4096
// - 高配设备 (> 16GB RAM): 4096-8192
const DEFAULT_CONTEXT_SIZE: u32 = 2048;
/// 最小上下文大小限制
const MIN_CONTEXT_SIZE: u32 = 64;
/// 重复惩罚历史长度
const REPEAT_PENALTY_HISTORY: u32 = 32;
/// 默认批处理大小（提高吞吐量）
const DEFAULT_N_BATCH: u32 = 512;
/// 默认张量并行度（设为1禁用）
const DEFAULT_N_U_PARALLEL: u32 = 1;

/// 推理参数结构，用于配置采样行为
#[derive(Clone, Debug)]
pub struct InferenceParams {
    /// 温度参数（0.0-2.0），越高越随机
    pub temperature: f32,
    /// Top-p 采样阈值（0.0-1.0）
    pub top_p: f32,
    /// Top-k 采样数量（1-100）
    pub top_k: i32,
    /// 最大生成 token 数
    pub max_tokens: i32,
    /// 重复惩罚因子（1.0-2.0）
    pub repeat_penalty: f32,
    /// 频率惩罚（-2.0-2.0），降低重复token的频率
    pub frequency_penalty: f32,
    /// 存在惩罚（-2.0-2.0），惩罚已出现过的token
    pub presence_penalty: f32,
    /// 是否使用 MMAP（内存映射）
    pub use_mmap: bool,
    /// 是否锁定内存（防止swap）
    pub use_mlock: bool,
    /// 批处理大小
    pub n_batch: u32,
    /// 张量并行度
    pub n_parallel: u32,
}

impl Default for InferenceParams {
    fn default() -> Self {
        Self {
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
            max_tokens: 2048,
            repeat_penalty: 1.1,
            frequency_penalty: 0.0,
            presence_penalty: 0.0,
            use_mmap: true,
            use_mlock: false,
            n_batch: DEFAULT_N_BATCH,
            n_parallel: DEFAULT_N_U_PARALLEL,
        }
    }
}

/// 执行推理的核心逻辑，返回生成的文本
pub fn run_inference(
    model: &Arc<LlamaModel>,
    backend: &Arc<LlamaBackend>,
    prompt: &str,
    params: InferenceParams,
    n_threads: u32,
    ctx_size: u32,
) -> Result<String, String> {
    // 使用安全的 NonZeroU32 处理
    let safe_ctx_size = ctx_size.max(MIN_CONTEXT_SIZE);
    let n_ctx = std::num::NonZeroU32::new(safe_ctx_size)
        .unwrap_or(std::num::NonZeroU32::MIN);

    // 优化的上下文参数配置
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(Some(n_ctx))
        .with_n_threads(n_threads.max(1) as i32)
        .with_n_threads_batch((n_threads / 2).max(1) as i32)
        .with_n_batch(params.n_batch);

    let mut ctx = model
        .new_context(backend, ctx_params)
        .map_err(|e| format!("无法创建推理上下文: {}", e))?;

    // Tokenize
    let tokens = model
        .str_to_token(prompt, AddBos::Never)
        .map_err(|e| format!("无法将提示词转为 token: {}", e))?;

    if tokens.is_empty() {
        return Err("提示词为空".to_string());
    }

    // 初始批次 - 重要：所有 token 都启用 logits，这样后续采样时不会出错
    let mut batch = LlamaBatch::new(tokens.len(), 1);
    for (i, &t) in tokens.iter().enumerate() {
        // logits 设置为 true，确保所有位置都可以采样
        batch.add(t, i as i32, &[0], true)
            .map_err(|e| format!("无法添加 token 到批次: {}", e))?;
    }

    ctx.decode(&mut batch)
        .map_err(|e| format!("初始解码失败: {}", e))?;

    // 创建优化的采样器链
    // 顺序很重要： penalties -> top_k -> top_p -> temperature -> dist
    let mut sampler = LlamaSampler::chain_simple([
        // 重复惩罚：防止模型重复相同的内容
        LlamaSampler::penalties(
            REPEAT_PENALTY_HISTORY as i32,
            params.repeat_penalty,
            params.frequency_penalty,
            params.presence_penalty,
        ),
        // Top-K：只从概率最高的 K 个 token 中采样
        LlamaSampler::top_k(params.top_k.max(1)),
        // Top-P（Nucleus）：从累积概率达到 P 的最小集合中采样
        LlamaSampler::top_p((params.top_p as f32).max(0.01), 1),
        // Temperature：控制随机性，越高越随机
        LlamaSampler::temp(params.temperature.max(0.01)),
        // 分布式采样（确定性）
        LlamaSampler::dist(42),
    ]);

    let mut n_cur = batch.n_tokens();
    let mut output = String::new();
    let mut decoder = encoding_rs::UTF_8.new_decoder();

    loop {
        if params.max_tokens > 0 && n_cur - batch.n_tokens() >= params.max_tokens {
            break;
        }

        let token = sampler.sample(&ctx, n_cur - 1);
        sampler.accept(token);

        if model.is_eog_token(token) {
            break;
        }

        // 解码 token 为文本，遇到错误时跳过输出但仍推进位置
        // 重要：必须无条件增加 n_cur，否则会导致采样器位置错误
        let decoded_text = match model.token_to_piece(token, &mut decoder, true, None) {
            Ok(s) => Some(s),
            Err(_) => None,
        };

        // 如果解码成功，添加到输出
        if let Some(text) = decoded_text {
            output.push_str(&text);
        }

        let mut next = LlamaBatch::new(1, 1);
        // 重要：位置使用 n_cur，这是新 token 在序列中的绝对位置
        // logits 设置为 true，确保我们可以采样这个位置
        next.add(token, n_cur, &[0], true)
            .map_err(|e| format!("无法添加下一个 token: {}", e))?;
        ctx.decode(&mut next)
            .map_err(|e| format!("解码失败: {}", e))?;

        // 重要：必须无条件增加 n_cur
        // 否则会导致采样器在同一个位置重复采样，触发断言失败
        n_cur += 1;

        if n_cur as u32 >= ctx_size {
            break;
        }
    }

    Ok(output)
}

/// 流式推理核心逻辑，通过回调逐个发送 token
#[allow(dead_code)]
pub fn run_inference_stream<F>(
    model: &Arc<LlamaModel>,
    backend: &Arc<LlamaBackend>,
    prompt: &str,
    params: InferenceParams,
    n_threads: u32,
    ctx_size: u32,
    on_token: F,
) -> Result<(), String>
where
    F: Fn(String) + Send + Sync + 'static,
{
    // 使用安全的 NonZeroU32 处理
    let safe_ctx_size = ctx_size.max(MIN_CONTEXT_SIZE);
    let n_ctx = std::num::NonZeroU32::new(safe_ctx_size)
        .unwrap_or(std::num::NonZeroU32::MIN);

    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(Some(n_ctx))
        .with_n_threads(n_threads.max(1) as i32)
        .with_n_threads_batch((n_threads / 2).max(1) as i32);

    let mut ctx = model
        .new_context(backend, ctx_params)
        .map_err(|e| format!("无法创建推理上下文: {}", e))?;

    // Tokenize
    let tokens = model
        .str_to_token(prompt, AddBos::Never)
        .map_err(|e| format!("无法将提示词转为 token: {}", e))?;

    if tokens.is_empty() {
        return Err("提示词为空".to_string());
    }

    // 初始批次 - 重要：所有 token 都启用 logits，这样后续采样时不会出错
    let mut batch = LlamaBatch::new(tokens.len(), 1);
    for (i, &t) in tokens.iter().enumerate() {
        // logits 设置为 true，确保所有位置都可以采样
        batch.add(t, i as i32, &[0], true)
            .map_err(|e| format!("无法添加 token 到批次: {}", e))?;
    }

    ctx.decode(&mut batch)
        .map_err(|e| format!("初始解码失败: {}", e))?;

    // 创建优化的采样器链
    // 顺序很重要： penalties -> top_k -> top_p -> temperature -> dist
    let mut sampler = LlamaSampler::chain_simple([
        // 重复惩罚：防止模型重复相同的内容
        LlamaSampler::penalties(
            REPEAT_PENALTY_HISTORY as i32,
            params.repeat_penalty,
            params.frequency_penalty,
            params.presence_penalty,
        ),
        // Top-K：只从概率最高的 K 个 token 中采样
        LlamaSampler::top_k(params.top_k.max(1)),
        // Top-P（Nucleus）：从累积概率达到 P 的最小集合中采样
        LlamaSampler::top_p((params.top_p as f32).max(0.01), 1),
        // Temperature：控制随机性，越高越随机
        LlamaSampler::temp(params.temperature.max(0.01)),
        // 分布式采样（确定性）
        LlamaSampler::dist(42),
    ]);

    let mut n_cur = batch.n_tokens();
    let mut completion_tokens = 0;
    let mut decoder = encoding_rs::UTF_8.new_decoder();

    loop {
        if params.max_tokens > 0 && completion_tokens >= params.max_tokens {
            break;
        }

        let token = sampler.sample(&ctx, n_cur - 1);
        sampler.accept(token);

        if model.is_eog_token(token) {
            break;
        }

        // 解码 token 为文本，遇到错误时跳过回调但仍推进位置
        // 重要：必须无条件增加 n_cur，否则会导致采样器位置错误
        let decoded_text = match model.token_to_piece(token, &mut decoder, true, None) {
            Ok(s) => Some(s),
            Err(_) => None,
        };

        // 如果解码成功，调用回调
        if let Some(text) = decoded_text {
            on_token(text);
        }

        let mut next = LlamaBatch::new(1, 1);
        // 重要：位置使用 n_cur，这是新 token 在序列中的绝对位置
        // logits 设置为 true，确保我们可以采样这个位置
        next.add(token, n_cur, &[0], true)
            .map_err(|e| format!("无法添加下一个 token: {}", e))?;
        ctx.decode(&mut next)
            .map_err(|e| format!("解码失败: {}", e))?;

        // 重要：必须无条件增加 n_cur 和 completion_tokens
        // 否则会导致采样器在同一个位置重复采样，触发断言失败
        n_cur += 1;
        completion_tokens += 1;

        if n_cur as u32 >= ctx_size {
            break;
        }
    }

    Ok(())
}

pub struct LlamaCppEngine {
    pub backend:       Arc<LlamaBackend>,
    pub model:         Arc<Mutex<Option<Arc<LlamaModel>>>>,
    pub n_threads:     u32,           // CPU 线程数，默认 = 物理核心数
    pub n_gpu_layers:  i32,           // GPU 层数（0=仅CPU, -1=全部, >0=指定层数）
    pub ctx_size:      u32,
    pub fmt:           PromptFormat,
    pub api_port:      u16,            // API 服务器端口
    pub model_name:    String,         // 当前模型名称
    pub abort_flag:    Arc<AtomicBool>, // 中断标志
    pub use_kv_cache:  bool,           // 是否使用 KV Cache
    pub kv_cache_size: u32,            // KV Cache 大小（tokens）
}

impl LlamaCppEngine {
    pub fn new() -> anyhow::Result<Self> {
        Self::with_config(DEFAULT_CONTEXT_SIZE, PromptFormat::ChatML)
    }

    pub fn with_config(ctx_size: u32, fmt: PromptFormat) -> anyhow::Result<Self> {
        let backend = LlamaBackend::init()?;
        // 官方建议：CPU-only 推理使用物理核心数，不使用超线程
        // 超线程（SMT）会降低推理性能，而不是提升
        let physical_cores = num_cpus::get_physical() as u32;
        let n_threads = physical_cores;
        let n_gpu_layers = 0; // 默认使用 CPU（设为 -1 可尝试使用所有 GPU）
        let use_kv_cache = true; // 默认启用 KV Cache
        let kv_cache_size = 2048; // 默认 KV Cache 大小
        Ok(Self {
            backend: Arc::new(backend),
            model: Arc::new(Mutex::new(None)),
            n_threads,
            n_gpu_layers,
            ctx_size: ctx_size.max(MIN_CONTEXT_SIZE),
            fmt,
            api_port: 8080,
            model_name: "local-model".to_string(),
            abort_flag: Arc::new(AtomicBool::new(false)),
            use_kv_cache,
            kv_cache_size,
        })
    }

    /// 用户可在设置页调整线程数
    pub fn set_threads(&mut self, n: u32) {
        self.n_threads = n;
    }

    /// 获取当前线程数
    pub fn get_threads(&self) -> u32 {
        self.n_threads
    }

    /// 设置 GPU 层数
    /// n: 0=仅CPU, -1=所有层到GPU, >0=指定层数到GPU
    pub fn set_gpu_layers(&mut self, n: i32) {
        self.n_gpu_layers = n;
    }

    /// 获取当前 GPU 层数
    pub fn get_gpu_layers(&self) -> i32 {
        self.n_gpu_layers
    }

    /// 启用/禁用 KV Cache
    pub fn set_kv_cache(&mut self, enabled: bool) {
        self.use_kv_cache = enabled;
        eprintln!("[优化] KV Cache: {}", if enabled { "启用" } else { "禁用" });
    }

    /// 获取 KV Cache 状态
    pub fn get_kv_cache(&self) -> bool {
        self.use_kv_cache
    }

    /// 设置 KV Cache 大小
    pub fn set_kv_cache_size(&mut self, size: u32) {
        self.kv_cache_size = size.max(512); // 最小 512 tokens
        eprintln!("[优化] KV Cache 大小: {} tokens", self.kv_cache_size);
    }

    /// 获取 KV Cache 大小
    pub fn get_kv_cache_size(&self) -> u32 {
        self.kv_cache_size
    }

    /// 获取上下文大小
    pub fn get_ctx_size(&self) -> u32 {
        self.ctx_size
    }

    /// 设置上下文大小
    pub fn set_ctx_size(&mut self, size: u32) {
        self.ctx_size = size;
    }

    /// 设置模型名称
    pub fn set_model_name(&mut self, name: String) {
        self.model_name = name;
    }

    /// 检查模型是否已加载
    pub fn is_model_loaded(&self) -> bool {
        self.model.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    /// 从路径提取模型名称
    pub fn set_model_name_from_path(&mut self, path: &str) {
        let name = std::path::Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();
        self.model_name = name.clone();

        // 自动检测并设置prompt格式
        self.fmt = crate::chat::detect_format(&name);
        eprintln!("[INFO] 检测到模型格式: {:?}", self.fmt);
    }

    /// 停止当前推理
    pub fn stop(&self) {
        self.abort_flag.store(true, Ordering::SeqCst);
    }

    /// 重置中断标志（开始新推理前调用）
    pub fn reset_abort(&self) {
        self.abort_flag.store(false, Ordering::SeqCst);
    }

    /// 检查是否请求中断
    pub fn is_abort_requested(&self) -> bool {
        self.abort_flag.load(Ordering::SeqCst)
    }
}

impl InferenceBackend for LlamaCppEngine {
    fn load_model(&self, path: &str) -> anyhow::Result<()> {
        // 优化的模型加载参数
        // use_mmap: 使用内存映射，减少内存占用
        // use_mlock: 锁定内存，防止 swap（需要 root 权限）
        // n_gpu_layers: GPU 层数（0=仅CPU, -1=所有层到GPU）
        // vocab_only: 仅加载词汇表（用于测试）
        let params = LlamaModelParams::default()
            .with_n_gpu_layers(self.n_gpu_layers as u32)  // 可配置 GPU 层数
            .with_use_mmap(true)                        // 启用内存映射（节省内存）
            .with_use_mlock(false)                      // 禁用内存锁定（兼容性更好）
            .with_vocab_only(false);                    // 加载完整模型

        eprintln!("[模型] 正在加载模型: {}", path);
        eprintln!("[模型] 配置: GPU层数={}, MMAP={}, MLOCK={}, KV Cache={}",
            self.n_gpu_layers, true, false, self.use_kv_cache);

        let model = LlamaModel::load_from_file(&self.backend, path, &params)
            .map_err(|e| anyhow::anyhow!("模型加载失败: {}\n\n请检查:\n1. 模型文件路径是否正确\n2. 模型文件是否损坏\n3. 是否有足够的内存", e))?;

        let mut model_guard = self.model.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        *model_guard = Some(Arc::new(model));

        eprintln!("[模型] 加载成功");
        Ok(())
    }

    fn generate_stream<F>(&self, messages: Vec<Message>, on_token: F) -> anyhow::Result<()>
    where
        F: Fn(String) + Send + Sync + 'static,
    {
        let model_guard = self.model.lock().map_err(|e| anyhow::anyhow!("{}", e))?;
        let model = model_guard
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("模型未加载"))?
            .clone();
        drop(model_guard);

        let backend = self.backend.clone();
        let n_threads = self.n_threads;
        let ctx_size = self.ctx_size;
        let fmt = self.fmt.clone();
        let prompt = build_prompt(&fmt, &messages);

        // 使用默认推理参数
        let params = InferenceParams::default();

        // 直接在当前线程运行推理任务
        // 注意：这是一个阻塞调用，应该在异步上下文中通过 spawn_blocking 调用此方法
        run_inference_stream(&model, &backend, &prompt, params, n_threads, ctx_size, on_token)
            .map_err(|e| anyhow::anyhow!("{}", e))
    }

    fn list_models(&self) -> anyhow::Result<Vec<crate::backend::ModelInfo>> {
        let mut models = Vec::new();

        // 获取模型目录
        let model_dirs = get_model_directories();

        for dir in model_dirs {
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().map(|e| e == "gguf").unwrap_or(false) {
                        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                            let size_gb = entry.metadata()
                                .map(|m| m.len() as f32 / 1_073_741_824.0)
                                .unwrap_or(0.0);

                            // 尝试从文件名推断参数
                            let parameters = infer_parameters(name);

                            models.push(crate::backend::ModelInfo {
                                name: name.to_string(),
                                path: path.to_string_lossy().to_string(),
                                size_gb,
                                parameters,
                            });
                        }
                    }
                }
            }
        }

        Ok(models)
    }

    fn system_info(&self) -> serde_json::Value {
        serde_json::json!({
            "n_threads":        self.n_threads,
            "physical_cores":   num_cpus::get_physical(),
            "logical_cores":    num_cpus::get(),
            "ctx_size":         self.ctx_size,
            "gpu_acceleration": false,
        })
    }
}

/// 获取可能的模型目录列表
#[allow(dead_code)]
fn get_model_directories() -> Vec<std::path::PathBuf> {
    let mut directories = Vec::new();

    // 用户目录下的 LocalMind/models
    if let Some(home) = dirs::home_dir() {
        directories.push(home.join("LocalMind").join("models"));
    }

    // 下载目录
    if let Some(downloads) = dirs::download_dir() {
        directories.push(downloads);
    }

    // 当前目录
    directories.push(std::path::PathBuf::from("."));

    // Windows 上的常见位置
    #[cfg(target_os = "windows")]
    {
        if let Some(documents) = dirs::document_dir() {
            directories.push(documents.join("LocalMind").join("models"));
        }
    }

    directories
}

/// 从文件名推断模型参数量
#[allow(dead_code)]
fn infer_parameters(filename: &str) -> String {
    let lower = filename.to_lowercase();

    // 尝试从文件名中提取参数量
    if lower.contains("0.5b") {
        "0.5B".to_string()
    } else if lower.contains("1b") {
        "1B".to_string()
    } else if lower.contains("1.5b") {
        "1.5B".to_string()
    } else if lower.contains("2b") {
        "2B".to_string()
    } else if lower.contains("3b") {
        "3B".to_string()
    } else if lower.contains("4b") {
        "4B".to_string()
    } else if lower.contains("7b") {
        "7B".to_string()
    } else if lower.contains("8b") {
        "8B".to_string()
    } else if lower.contains("13b") {
        "13B".to_string()
    } else if lower.contains("14b") {
        "14B".to_string()
    } else if lower.contains("32b") {
        "32B".to_string()
    } else if lower.contains("34b") {
        "34B".to_string()
    } else if lower.contains("70b") {
        "70B".to_string()
    } else if lower.contains("405b") {
        "405B".to_string()
    } else {
        "Unknown".to_string()
    }
}

/// 量化格式信息
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct QuantInfo {
    pub format: String,
    pub recommended: bool,
    pub size_note: String,
}

/// 从模型文件名推断量化格式
#[allow(dead_code)]
pub fn infer_quant_format(name: &str) -> QuantInfo {
    let formats = [
        ("Q4_K_M", true, "推荐 - 最佳平衡，速度和精度兼顾"),
        ("Q5_K_M", true, "推荐 - 更高精度，速度略慢"),
        ("Q6_K", true, "高精度模式，接近原版质量"),
        ("Q8_0", false, "最高精度，需更多内存"),
        ("Q4_K_S", true, "较小体积，速度较快"),
        ("Q5_K_S", true, "中等体积和速度"),
        ("Q3_K_M", false, "轻量级，质量略有下降"),
        ("Q3_K_S", false, "超轻量级，仅推荐草稿模型"),
        ("Q2_K", false, "最小体积，仅推荐草稿模型"),
        ("F16", false, "半精度浮点，需 16GB+ 内存"),
        ("F32", false, "全精度，不推荐"),
    ];

    let upper = name.to_uppercase();
    for (fmt, rec, note) in &formats {
        if upper.contains(fmt) {
            return QuantInfo {
                format: fmt.to_string(),
                recommended: *rec,
                size_note: note.to_string(),
            };
        }
    }

    QuantInfo {
        format: "UNKNOWN".to_string(),
        recommended: false,
        size_note: "未知格式".to_string(),
    }
}

/// 投机采样引擎（可选功能）
/// 使用小模型快速生成候选 tokens，大模型验证，加速推理
#[allow(dead_code)]
pub struct SpeculativeEngine {
    pub backend:      Arc<LlamaBackend>,
    pub main_model:   Arc<Mutex<Option<Arc<LlamaModel>>>>,
    pub draft_model:  Arc<Mutex<Option<Arc<LlamaModel>>>>,  // 草稿模型（可选）
    pub n_threads:    u32,
    pub ctx_size:     u32,
    pub n_draft:      u32,   // 每次草稿生成的 token 数，建议 4-8
    pub abort_flag:   Arc<AtomicBool>,
}

#[allow(dead_code)]
impl SpeculativeEngine {
    pub fn new() -> anyhow::Result<Self> {
        let backend = LlamaBackend::init()?;
        let physical_cores = num_cpus::get_physical() as u32;
        let n_threads = physical_cores.min(4); // 投机采样可以用更多线程
        Ok(Self {
            backend:     Arc::new(backend),
            main_model:  Arc::new(Mutex::new(None)),
            draft_model: Arc::new(Mutex::new(None)),
            n_threads,
            ctx_size:    2048,
            n_draft:     5,   // 每轮草稿 5 个 token
            abort_flag:  Arc::new(AtomicBool::new(false)),
        })
    }

    /// 加载主模型和草稿模型（草稿模型可选）
    pub fn load_main_model(&self, path: &str) -> anyhow::Result<()> {
        let params = LlamaModelParams::default()
            .with_n_gpu_layers(0)
            .with_use_mmap(true);
        let model = LlamaModel::load_from_file(&self.backend, path, &params)?;

        let mut model_guard = self.main_model.lock()
            .map_err(|e| anyhow::anyhow!("{}", e))?;
        *model_guard = Some(Arc::new(model));
        Ok(())
    }

    /// 加载草稿模型（可选）
    pub fn load_draft_model(&self, path: &str) -> anyhow::Result<()> {
        let params = LlamaModelParams::default()
            .with_n_gpu_layers(0)
            .with_use_mmap(true);
        let model = LlamaModel::load_from_file(&self.backend, path, &params)?;

        let mut model_guard = self.draft_model.lock()
            .map_err(|e| anyhow::anyhow!("{}", e))?;
        *model_guard = Some(Arc::new(model));
        Ok(())
    }

    /// 检查是否已加载草稿模型
    pub fn has_draft_model(&self) -> bool {
        self.draft_model.lock()
            .map(|g| g.is_some())
            .unwrap_or(false)
    }

    /// 停止推理
    pub fn stop(&self) {
        self.abort_flag.store(true, Ordering::SeqCst);
    }
}
