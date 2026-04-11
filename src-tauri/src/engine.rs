use crate::backend::{InferenceBackend, Message, ModelInfo};
use crate::chat::PromptFormat;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

/// 推理参数
#[derive(Clone, Debug)]
pub struct InferenceParams {
    pub temperature: f32,
    pub top_p: f32,
    pub top_k: i32,
    pub max_tokens: i32,
    pub repeat_penalty: f32,
}

impl Default for InferenceParams {
    fn default() -> Self {
        Self {
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
            max_tokens: 2048,
            repeat_penalty: 1.1,
        }
    }
}

#[cfg(feature = "llama-cpp-2")]
mod imp {
    use super::*;
    use encoding_rs::UTF_8;
    use llama_cpp_2::context::params::LlamaContextParams;
    use llama_cpp_2::llama_backend::LlamaBackend;
    use llama_cpp_2::llama_batch::LlamaBatch;
    use llama_cpp_2::model::params::LlamaModelParams;
    use llama_cpp_2::model::{AddBos, LlamaModel};
    use llama_cpp_2::sampling::LlamaSampler;
    use std::num::NonZeroU32;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// LlamaCppEngine - 使用 llama-cpp-2 进行真实推理
    pub struct LlamaCppEngine {
        pub n_threads: u32,
        pub ctx_size: u32,
        pub fmt: PromptFormat,
        pub api_port: u16,
        pub model_name: String,
        pub model_path: Option<String>,
        pub abort_flag: Arc<AtomicBool>,
        pub model_loaded: Arc<Mutex<bool>>,
        pub backend: LlamaBackend,
        pub model: Arc<Mutex<Option<LlamaModel>>>,
    }

    unsafe impl Send for LlamaCppEngine {}
    unsafe impl Sync for LlamaCppEngine {}

    impl LlamaCppEngine {
        pub fn new() -> anyhow::Result<Self> {
            Self::with_config(2048, PromptFormat::ChatML)
        }

        pub fn with_config(ctx_size: u32, fmt: PromptFormat) -> anyhow::Result<Self> {
            let backend = LlamaBackend::init()
                .map_err(|e| anyhow::anyhow!("Failed to initialize llama backend: {}", e))?;

            Ok(Self {
                n_threads: num_cpus::get_physical() as u32,
                ctx_size: ctx_size.max(64),
                fmt,
                api_port: 8080,
                model_name: String::new(),
                model_path: None,
                abort_flag: Arc::new(AtomicBool::new(false)),
                model_loaded: Arc::new(Mutex::new(false)),
                backend,
                model: Arc::new(Mutex::new(None)),
            })
        }

        pub fn set_threads(&mut self, n: u32) {
            self.n_threads = n;
        }

        pub fn get_threads(&self) -> u32 {
            self.n_threads
        }

        pub fn set_ctx_size(&mut self, s: u32) {
            self.ctx_size = s.max(64);
        }

        pub fn get_ctx_size(&self) -> u32 {
            self.ctx_size
        }

        pub fn set_model_name(&mut self, n: String) {
            self.model_name = n;
        }

        pub fn set_model_name_from_path(&mut self, path: &str) {
            if let Some(name) = Path::new(path).file_name().and_then(|n| n.to_str()) {
                self.model_name = name.to_string();
                self.fmt = crate::chat::detect_format(&self.model_name);
            }
        }

        pub fn set_model_path(&mut self, path: &str) {
            self.model_path = Some(path.to_string());
            self.set_model_name_from_path(path);
        }

        pub fn is_model_loaded(&self) -> bool {
            *self.model_loaded.lock().unwrap_or_else(|p| p.into_inner())
        }

        pub fn stop(&self) {
            self.abort_flag.store(true, Ordering::SeqCst);
        }

        pub fn reset_abort(&self) {
            self.abort_flag.store(false, Ordering::SeqCst);
        }

        pub fn is_abort_requested(&self) -> bool {
            self.abort_flag.load(Ordering::SeqCst)
        }

        pub fn get_gpu_layers(&self) -> u32 {
            0
        }

        pub fn generate_stream_with_params<F>(
            &self,
            messages: Vec<Message>,
            params: InferenceParams,
            on_token: F,
        ) -> anyhow::Result<()>
        where
            F: Fn(String) + Send + Sync + 'static,
        {
            eprintln!("[推理] generate_stream 开始");
            self.reset_abort();

            if !self.is_model_loaded() {
                eprintln!("[推理] 错误: 模型未加载");
                return Err(anyhow::anyhow!("模型未加载"));
            }

            let model_guard = self
                .model
                .lock()
                .map_err(|e| anyhow::anyhow!("模型锁获取失败: {}", e))?;
            let model = model_guard
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("模型未初始化"))?;

            let prompt = crate::chat::build_prompt(&self.fmt, &messages);
            eprintln!("[推理] 提示词:\n{}", prompt);

            let tokens = model
                .str_to_token(&prompt, AddBos::Always)
                .map_err(|e| anyhow::anyhow!("分词失败: {}", e))?;

            if tokens.is_empty() {
                eprintln!("[推理] 错误: 分词结果为空");
                return Err(anyhow::anyhow!("分词结果为空"));
            }

            eprintln!("[推理] 提示词长度: {} tokens", tokens.len());

            let ctx_params = LlamaContextParams::default()
                .with_n_ctx(NonZeroU32::new(self.ctx_size))
                .with_n_threads(self.n_threads as i32)
                .with_n_threads_batch(self.n_threads as i32);

            let mut ctx = model
                .new_context(&self.backend, ctx_params)
                .map_err(|e| anyhow::anyhow!("上下文创建失败: {}", e))?;

            let mut sampler = build_sampler(&params);
            let abort = self.abort_flag.clone();
            let max_tokens = params.max_tokens.max(1) as usize;

            {
                let mut batch = LlamaBatch::new(tokens.len(), 1);
                for (i, token) in tokens.iter().enumerate() {
                    let is_last = i == tokens.len() - 1;
                    if let Err(e) = batch.add(*token, i as i32, &[0], is_last) {
                        eprintln!("[推理] Batch 添加 token {} 失败: {}", i, e);
                        return Err(anyhow::anyhow!("Batch 添加失败: {}", e));
                    }
                }
                eprintln!("[推理] 开始解码提示词...");
                if let Err(e) = ctx.decode(&mut batch) {
                    eprintln!("[推理] 提示词解码失败: {}", e);
                    return Err(anyhow::anyhow!("提示词解码失败: {}", e));
                }
                eprintln!("[推理] 提示词解码成功");
            }

            for token in &tokens {
                sampler.accept(*token);
            }

            let mut n_cur = 0usize;
            let mut last_position = (tokens.len() - 1) as i32;

            loop {
                if n_cur >= max_tokens {
                    eprintln!("[推理] 达到最大 tokens 数 {}", max_tokens);
                    break;
                }
                if abort.load(Ordering::SeqCst) {
                    eprintln!("[推理] 被中止");
                    break;
                }

                let token_to_generate = sampler.sample(&ctx, last_position);
                eprintln!(
                    "[推理] Loop {}: 采样 token ID: {} at pos {}",
                    n_cur, token_to_generate, last_position
                );

                if model.is_eog_token(token_to_generate) {
                    eprintln!("[推理] 遇到 EOS token");
                    break;
                }

                let mut decoder = UTF_8.new_decoder();
                match model.token_to_piece(token_to_generate, &mut decoder, false, None) {
                    Ok(token_str) => {
                        if token_str.is_empty() {
                            eprintln!("[推理] 收到空字符串，结束");
                            break;
                        }
                        eprintln!("[推理] 发送 token: {:?}", token_str);
                        on_token(token_str);
                    }
                    Err(e) => {
                        eprintln!("[推理] token_to_piece 失败: {}", e);
                        break;
                    }
                }

                sampler.accept(token_to_generate);
                n_cur += 1;

                let batch_pos = last_position + 1;
                let mut batch = LlamaBatch::new(1, 1);
                if let Err(e) = batch.add(token_to_generate, batch_pos, &[0], true) {
                    eprintln!("[推理] Batch 添加失败: {}", e);
                    return Err(anyhow::anyhow!("Batch 添加失败: {}", e));
                }

                if let Err(e) = ctx.decode(&mut batch) {
                    eprintln!("[推理] decode 返回错误: {:?}", e);
                    break;
                }

                last_position = batch_pos;
            }

            eprintln!("[推理] 生成完成，共 {} tokens", n_cur);
            on_token(String::new());
            Ok(())
        }
    }

    impl Drop for LlamaCppEngine {
        fn drop(&mut self) {
            if let Ok(mut model_guard) = self.model.lock() {
                model_guard.take();
            }
        }
    }

    impl InferenceBackend for LlamaCppEngine {
        fn load_model(&self, path: &str) -> anyhow::Result<()> {
            if !Path::new(path).exists() {
                return Err(anyhow::anyhow!("模型文件不存在: {}", path));
            }

            let model_params = LlamaModelParams::default();
            let model = LlamaModel::load_from_file(&self.backend, path, &model_params)
                .map_err(|e| anyhow::anyhow!("模型加载失败: {}", e))?;

            if let Ok(mut model_guard) = self.model.lock() {
                *model_guard = Some(model);
            }

            if let Ok(mut loaded) = self.model_loaded.lock() {
                *loaded = true;
            }

            Ok(())
        }

        fn generate_stream<F>(&self, messages: Vec<Message>, on_token: F) -> anyhow::Result<()>
        where
            F: Fn(String) + Send + Sync + 'static,
        {
            self.generate_stream_with_params(messages, InferenceParams::default(), on_token)
        }

        fn list_models(&self) -> anyhow::Result<Vec<ModelInfo>> {
            if self.is_model_loaded() {
                let path = self
                    .model_path
                    .clone()
                    .unwrap_or_else(|| self.model_name.clone());
                let size_gb = Path::new(&path)
                    .metadata()
                    .map(|m| m.len() as f32 / 1024.0 / 1024.0 / 1024.0)
                    .unwrap_or(0.0);

                Ok(vec![ModelInfo {
                    name: self.model_name.clone(),
                    path,
                    size_gb,
                    parameters: "unknown".to_string(),
                }])
            } else {
                Ok(vec![])
            }
        }

        fn system_info(&self) -> serde_json::Value {
            serde_json::json!({
                "n_threads": self.n_threads,
                "physical_cores": num_cpus::get_physical(),
                "logical_cores": num_cpus::get(),
                "ctx_size": self.ctx_size,
                "gpu_acceleration": false,
                "llama_version": "llama-cpp-2",
                "native_backend_available": true,
            })
        }
    }

    impl LlamaCppEngine {
        pub fn set_kv_cache(&mut self, _enabled: bool) {}

        pub fn get_kv_cache(&self) -> bool {
            true
        }

        pub fn set_kv_cache_size(&mut self, _size: u32) {}

        pub fn get_kv_cache_size(&self) -> u32 {
            self.ctx_size
        }
    }

    fn build_sampler(params: &InferenceParams) -> LlamaSampler {
        let temperature = params.temperature.clamp(0.0, 2.0);
        let top_k = params.top_k.max(1);
        let top_p = params.top_p.clamp(0.0, 1.0);
        let mut samplers = Vec::new();

        if params.repeat_penalty > 1.0 {
            samplers.push(LlamaSampler::penalties(-1, params.repeat_penalty, 0.0, 0.0));
        }

        if temperature <= f32::EPSILON {
            samplers.push(LlamaSampler::greedy());
            return LlamaSampler::chain_simple(samplers);
        }

        samplers.push(LlamaSampler::temp(temperature));

        samplers.push(LlamaSampler::top_k(top_k));

        if top_p < 1.0 {
            samplers.push(LlamaSampler::top_p(top_p, 1));
        }

        samplers.push(LlamaSampler::dist(random_seed()));
        LlamaSampler::chain_simple(samplers)
    }

    fn random_seed() -> u32 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.subsec_nanos())
            .unwrap_or(0)
    }
}

#[cfg(not(feature = "llama-cpp-2"))]
mod imp {
    use super::*;

    /// 无原生 llama 支持时的占位实现，用于让桌面壳和前端流程可编译。
    pub struct LlamaCppEngine {
        pub n_threads: u32,
        pub ctx_size: u32,
        pub fmt: PromptFormat,
        pub api_port: u16,
        pub model_name: String,
        pub model_path: Option<String>,
        pub abort_flag: Arc<AtomicBool>,
        pub model_loaded: Arc<Mutex<bool>>,
        kv_cache_enabled: bool,
        kv_cache_size: u32,
    }

    impl LlamaCppEngine {
        pub fn new() -> anyhow::Result<Self> {
            Self::with_config(2048, PromptFormat::ChatML)
        }

        pub fn with_config(ctx_size: u32, fmt: PromptFormat) -> anyhow::Result<Self> {
            let ctx_size = ctx_size.max(64);

            Ok(Self {
                n_threads: num_cpus::get_physical() as u32,
                ctx_size,
                fmt,
                api_port: 8080,
                model_name: String::new(),
                model_path: None,
                abort_flag: Arc::new(AtomicBool::new(false)),
                model_loaded: Arc::new(Mutex::new(false)),
                kv_cache_enabled: true,
                kv_cache_size: ctx_size,
            })
        }

        pub fn set_threads(&mut self, n: u32) {
            self.n_threads = n;
        }

        pub fn get_threads(&self) -> u32 {
            self.n_threads
        }

        pub fn set_ctx_size(&mut self, s: u32) {
            let ctx_size = s.max(64);
            self.ctx_size = ctx_size;
            self.kv_cache_size = ctx_size;
        }

        pub fn get_ctx_size(&self) -> u32 {
            self.ctx_size
        }

        pub fn set_model_name(&mut self, n: String) {
            self.model_name = n;
        }

        pub fn set_model_name_from_path(&mut self, path: &str) {
            if let Some(name) = Path::new(path).file_name().and_then(|n| n.to_str()) {
                self.model_name = name.to_string();
                self.fmt = crate::chat::detect_format(&self.model_name);
            }
        }

        pub fn set_model_path(&mut self, path: &str) {
            self.model_path = Some(path.to_string());
            self.set_model_name_from_path(path);
        }

        pub fn is_model_loaded(&self) -> bool {
            *self.model_loaded.lock().unwrap_or_else(|p| p.into_inner())
        }

        pub fn stop(&self) {
            self.abort_flag.store(true, Ordering::SeqCst);
        }

        pub fn reset_abort(&self) {
            self.abort_flag.store(false, Ordering::SeqCst);
        }

        pub fn is_abort_requested(&self) -> bool {
            self.abort_flag.load(Ordering::SeqCst)
        }

        pub fn get_gpu_layers(&self) -> u32 {
            0
        }

        pub fn generate_stream_with_params<F>(
            &self,
            _messages: Vec<Message>,
            _params: InferenceParams,
            _on_token: F,
        ) -> anyhow::Result<()>
        where
            F: Fn(String) + Send + Sync + 'static,
        {
            Err(anyhow::anyhow!(
                "当前构建未启用原生 llama 后端。请使用 `cargo build --no-default-features --features llama-cpp-2` 重新构建，并确保系统已安装 cmake。"
            ))
        }

        pub fn set_kv_cache(&mut self, enabled: bool) {
            self.kv_cache_enabled = enabled;
        }

        pub fn get_kv_cache(&self) -> bool {
            self.kv_cache_enabled
        }

        pub fn set_kv_cache_size(&mut self, size: u32) {
            self.kv_cache_size = size.max(64);
        }

        pub fn get_kv_cache_size(&self) -> u32 {
            self.kv_cache_size
        }
    }

    impl InferenceBackend for LlamaCppEngine {
        fn load_model(&self, path: &str) -> anyhow::Result<()> {
            if !Path::new(path).exists() {
                return Err(anyhow::anyhow!("模型文件不存在: {}", path));
            }

            Err(anyhow::anyhow!(
                "当前构建未启用原生 llama 后端。请使用 `cargo build --no-default-features --features llama-cpp-2` 重新构建，并确保系统已安装 cmake。"
            ))
        }

        fn generate_stream<F>(&self, messages: Vec<Message>, on_token: F) -> anyhow::Result<()>
        where
            F: Fn(String) + Send + Sync + 'static,
        {
            self.generate_stream_with_params(messages, InferenceParams::default(), on_token)
        }

        fn list_models(&self) -> anyhow::Result<Vec<ModelInfo>> {
            Ok(vec![])
        }

        fn system_info(&self) -> serde_json::Value {
            serde_json::json!({
                "n_threads": self.n_threads,
                "physical_cores": num_cpus::get_physical(),
                "logical_cores": num_cpus::get(),
                "ctx_size": self.ctx_size,
                "gpu_acceleration": false,
                "llama_version": "disabled",
                "native_backend_available": false,
                "native_backend_feature": "llama-cpp-2",
                "build_features": {
                    "llama-cpp-2": cfg!(feature = "llama-cpp-2"),
                    "no_llama": cfg!(feature = "no_llama"),
                }
            })
        }
    }
}

pub use imp::LlamaCppEngine;
