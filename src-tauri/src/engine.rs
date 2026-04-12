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
            max_tokens: 512,
            repeat_penalty: 1.1,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FlashAttentionMode {
    Auto,
    On,
    Off,
}

impl Default for FlashAttentionMode {
    fn default() -> Self {
        Self::Auto
    }
}

impl FlashAttentionMode {
    pub fn from_str(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "auto" => Some(Self::Auto),
            "on" => Some(Self::On),
            "off" => Some(Self::Off),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::On => "on",
            Self::Off => "off",
        }
    }
}

#[cfg(feature = "llama-cpp-2")]
mod imp {
    use super::*;
    use encoding_rs::UTF_8;
    use llama_cpp_2::context::params::LlamaContextParams;
    use llama_cpp_2::gguf::GgufContext;
    use llama_cpp_2::llama_backend::LlamaBackend;
    use llama_cpp_2::llama_batch::LlamaBatch;
    use llama_cpp_2::model::params::LlamaModelParams;
    use llama_cpp_2::model::{AddBos, LlamaModel};
    use llama_cpp_2::openai::OpenAIChatTemplateParams;
    use llama_cpp_2::sampling::LlamaSampler;
    use llama_cpp_2::DecodeError;
    use llama_cpp_sys_2::{
        llama_flash_attn_type, LLAMA_FLASH_ATTN_TYPE_AUTO, LLAMA_FLASH_ATTN_TYPE_DISABLED,
        LLAMA_FLASH_ATTN_TYPE_ENABLED,
    };
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
        pub flash_attention: FlashAttentionMode,
        pub abort_flag: Arc<AtomicBool>,
        pub model_loaded: Arc<Mutex<bool>>,
        pub backend: LlamaBackend,
        pub model: Arc<Mutex<Option<LlamaModel>>>,
    }

    unsafe impl Send for LlamaCppEngine {}
    unsafe impl Sync for LlamaCppEngine {}

    #[derive(Debug, Clone, Default)]
    struct GgufModelMetadata {
        architecture: Option<String>,
        expert_count: Option<u32>,
        expert_used_count: Option<u32>,
        moe_every_n_layers: Option<u32>,
    }

    #[derive(Debug, Clone)]
    struct MoeCompatibilityDecision {
        enable_cpu_override: bool,
        source: &'static str,
        metadata: GgufModelMetadata,
    }

    fn filename_suggests_moe(path: &str) -> bool {
        let file_name = Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(path)
            .to_lowercase();

        file_name.contains("mixtral")
            || file_name.contains("-moe")
            || file_name.contains("_moe")
            || file_name.contains(" moe ")
            || file_name.contains("deepseek-v2")
            || file_name.contains("deepseek-v3")
            || (file_name.contains("deepseek-r1") && !file_name.contains("distill"))
            || file_name
                .split(|character: char| !character.is_ascii_alphanumeric())
                .any(|segment| {
                    segment.starts_with('a')
                        && segment.ends_with('b')
                        && segment.len() > 2
                        && segment[1..segment.len() - 1]
                            .chars()
                            .all(|character| character.is_ascii_digit())
                })
    }

    fn gguf_u32_value(context: &GgufContext, key: &str) -> Option<u32> {
        let idx = context.find_key(key);
        if idx < 0 {
            return None;
        }

        Some(context.val_u32(idx))
    }

    fn gguf_string_value(context: &GgufContext, key: &str) -> Option<String> {
        let idx = context.find_key(key);
        if idx < 0 {
            return None;
        }

        context.val_str(idx).map(str::to_owned)
    }

    fn read_gguf_model_metadata(path: &str) -> Option<GgufModelMetadata> {
        let context = GgufContext::from_file(Path::new(path))?;
        let architecture = gguf_string_value(&context, "general.architecture");
        let expert_count_key = architecture
            .as_deref()
            .map(|arch| format!("{arch}.expert_count"));
        let expert_used_count_key = architecture
            .as_deref()
            .map(|arch| format!("{arch}.expert_used_count"));
        let moe_every_n_layers_key = architecture
            .as_deref()
            .map(|arch| format!("{arch}.moe_every_n_layers"));

        Some(GgufModelMetadata {
            architecture,
            expert_count: expert_count_key
                .as_deref()
                .and_then(|key| gguf_u32_value(&context, key)),
            expert_used_count: expert_used_count_key
                .as_deref()
                .and_then(|key| gguf_u32_value(&context, key)),
            moe_every_n_layers: moe_every_n_layers_key
                .as_deref()
                .and_then(|key| gguf_u32_value(&context, key)),
        })
    }

    fn resolve_moe_compatibility(path: &str) -> MoeCompatibilityDecision {
        let metadata = read_gguf_model_metadata(path).unwrap_or_default();
        let metadata_detected = metadata.expert_count.unwrap_or(0) > 1
            || metadata.expert_used_count.unwrap_or(0) > 1
            || metadata.moe_every_n_layers.unwrap_or(0) > 0;

        if metadata_detected {
            return MoeCompatibilityDecision {
                enable_cpu_override: true,
                source: "gguf",
                metadata,
            };
        }

        if filename_suggests_moe(path) {
            return MoeCompatibilityDecision {
                enable_cpu_override: true,
                source: "filename",
                metadata,
            };
        }

        MoeCompatibilityDecision {
            enable_cpu_override: false,
            source: "none",
            metadata,
        }
    }

    fn configured_n_gpu_layers() -> Option<u32> {
        std::env::var("LOCALTHINKING_N_GPU_LAYERS")
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
    }

    fn gpu_acceleration_enabled() -> bool {
        cfg!(feature = "native-metal")
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(crate) struct ContextTuningProfile {
        pub decode_threads: i32,
        pub batch_threads: i32,
        pub n_batch: u32,
        pub n_ubatch: u32,
        pub offload_kqv: bool,
        pub op_offload: bool,
        pub no_perf: bool,
    }

    fn parse_env_u32(name: &str) -> Option<u32> {
        std::env::var(name)
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
    }

    fn parse_env_flag(name: &str) -> bool {
        std::env::var(name)
            .ok()
            .map(|value| {
                matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                )
            })
            .unwrap_or(false)
    }

    fn resolve_flash_attention_mode(configured: FlashAttentionMode) -> FlashAttentionMode {
        std::env::var("LOCALTHINKING_FLASH_ATTN")
            .ok()
            .and_then(|value| FlashAttentionMode::from_str(&value))
            .unwrap_or(configured)
    }

    fn flash_attention_policy(mode: FlashAttentionMode) -> llama_flash_attn_type {
        match mode {
            FlashAttentionMode::Auto => LLAMA_FLASH_ATTN_TYPE_AUTO,
            FlashAttentionMode::On => LLAMA_FLASH_ATTN_TYPE_ENABLED,
            FlashAttentionMode::Off => LLAMA_FLASH_ATTN_TYPE_DISABLED,
        }
    }

    fn clamp_thread_count(value: u32, limit: u32) -> i32 {
        value.max(1).min(limit.max(1)) as i32
    }

    fn detect_available_ram_gb() -> Option<f32> {
        let available_ram_gb = crate::sysinfo::detect_hardware().available_ram_gb;
        if available_ram_gb.is_finite() && available_ram_gb > 0.0 {
            Some(available_ram_gb)
        } else {
            None
        }
    }

    fn resolve_batch_caps(available_ram_gb: Option<f32>, gpu_enabled: bool) -> Option<(u32, u32)> {
        let available_ram_gb = available_ram_gb?;

        if available_ram_gb <= 4.0 {
            Some(if gpu_enabled { (256, 128) } else { (128, 64) })
        } else if available_ram_gb <= 8.0 {
            Some(if gpu_enabled { (512, 256) } else { (256, 128) })
        } else if available_ram_gb <= 12.0 {
            Some(if gpu_enabled { (768, 384) } else { (384, 192) })
        } else {
            None
        }
    }

    fn resolve_ctx_cap(available_ram_gb: Option<f32>, gpu_enabled: bool) -> Option<u32> {
        let available_ram_gb = available_ram_gb?;

        if available_ram_gb <= 4.0 {
            Some(if gpu_enabled { 1024 } else { 1024 })
        } else if available_ram_gb <= 8.0 {
            Some(if gpu_enabled { 2048 } else { 1536 })
        } else if available_ram_gb <= 12.0 {
            Some(if gpu_enabled { 3072 } else { 2048 })
        } else {
            None
        }
    }

    pub(crate) fn resolve_effective_ctx_size_with_memory(
        requested_ctx_size: u32,
        prompt_tokens: usize,
        gpu_enabled: bool,
        available_ram_gb: Option<f32>,
    ) -> u32 {
        let minimum_ctx_size = (prompt_tokens.max(64)) as u32;
        let requested_ctx_size = requested_ctx_size.max(minimum_ctx_size);

        match resolve_ctx_cap(available_ram_gb, gpu_enabled) {
            Some(cap) => requested_ctx_size.min(cap.max(minimum_ctx_size)),
            None => requested_ctx_size,
        }
    }

    pub(crate) fn resolve_context_tuning_with_memory(
        requested_threads: u32,
        ctx_size: u32,
        gpu_enabled: bool,
        available_ram_gb: Option<f32>,
    ) -> ContextTuningProfile {
        let physical = num_cpus::get_physical().max(1) as u32;
        let logical = num_cpus::get().max(1) as u32;
        let ctx_size = ctx_size.max(64);
        let requested_threads = requested_threads.max(1).min(logical);

        let default_decode_threads = if gpu_enabled {
            requested_threads.min(match physical {
                1..=2 => 2,
                3..=4 => 4,
                5..=8 => 6,
                _ => 8,
            })
        } else {
            requested_threads.min(physical)
        };

        let default_batch_threads = if gpu_enabled {
            logical.min(requested_threads.max(default_decode_threads))
        } else {
            requested_threads
        };

        let default_n_batch = if gpu_enabled {
            ctx_size.min(1024)
        } else {
            ctx_size.min(512)
        }
        .max(64);

        let default_n_ubatch = if gpu_enabled {
            default_n_batch.min(512)
        } else {
            default_n_batch.min(256)
        }
        .max(64);

        let (n_batch_cap, n_ubatch_cap) = resolve_batch_caps(available_ram_gb, gpu_enabled)
            .unwrap_or((ctx_size, default_n_batch));
        let resolved_n_batch = parse_env_u32("LOCALTHINKING_N_BATCH")
            .unwrap_or(default_n_batch)
            .max(64)
            .min(ctx_size)
            .min(n_batch_cap.max(64));
        let resolved_n_ubatch = parse_env_u32("LOCALTHINKING_N_UBATCH")
            .unwrap_or(default_n_ubatch)
            .max(64)
            .min(resolved_n_batch)
            .min(n_ubatch_cap.max(64));

        ContextTuningProfile {
            decode_threads: clamp_thread_count(
                parse_env_u32("LOCALTHINKING_DECODE_THREADS").unwrap_or(default_decode_threads),
                logical,
            ),
            batch_threads: clamp_thread_count(
                parse_env_u32("LOCALTHINKING_BATCH_THREADS").unwrap_or(default_batch_threads),
                logical,
            ),
            n_batch: resolved_n_batch,
            n_ubatch: resolved_n_ubatch,
            offload_kqv: gpu_enabled,
            op_offload: gpu_enabled,
            no_perf: true,
        }
    }

    pub(crate) fn resolve_context_tuning(
        requested_threads: u32,
        ctx_size: u32,
        gpu_enabled: bool,
    ) -> ContextTuningProfile {
        resolve_context_tuning_with_memory(
            requested_threads,
            ctx_size,
            gpu_enabled,
            detect_available_ram_gb(),
        )
    }

    fn log_moe_compatibility(decision: &MoeCompatibilityDecision, source: &str) {
        let architecture = decision
            .metadata
            .architecture
            .as_deref()
            .unwrap_or("unknown");
        eprintln!(
            "[模型] {} \
             (source={}, arch={}, expert_count={:?}, expert_used_count={:?}, moe_every_n_layers={:?})",
            source,
            decision.source,
            architecture,
            decision.metadata.expert_count,
            decision.metadata.expert_used_count,
            decision.metadata.moe_every_n_layers,
        );
    }

    pub(crate) fn resolve_generation_capacity(ctx_size: u32, prompt_token_count: usize) -> usize {
        ctx_size.saturating_sub(prompt_token_count as u32) as usize
    }

    fn build_model_params(
        configured_gpu_layers: Option<u32>,
        use_cpu_moe_override: bool,
    ) -> std::pin::Pin<Box<LlamaModelParams>> {
        let base_model_params = match configured_gpu_layers {
            Some(n_gpu_layers) => LlamaModelParams::default().with_n_gpu_layers(n_gpu_layers),
            None => LlamaModelParams::default(),
        };
        let mut model_params = Box::pin(base_model_params);

        if use_cpu_moe_override {
            model_params.as_mut().add_cpu_moe_override();
        }

        model_params
    }

    impl LlamaCppEngine {
        pub fn new() -> anyhow::Result<Self> {
            Self::with_config(1024, PromptFormat::ChatML)
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
                flash_attention: FlashAttentionMode::default(),
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

        pub fn resolve_runtime_ctx_size(
            &self,
            requested_ctx_size: u32,
            prompt_tokens: usize,
        ) -> u32 {
            let gpu_enabled = gpu_acceleration_enabled();
            let available_ram_gb = detect_available_ram_gb();
            let effective_ctx_size = resolve_effective_ctx_size_with_memory(
                requested_ctx_size,
                prompt_tokens,
                gpu_enabled,
                available_ram_gb,
            );

            if effective_ctx_size < requested_ctx_size {
                eprintln!(
                    "[调优] 内存感知策略生效: available_ram_gb={:?}, requested_ctx={}, effective_ctx={}, prompt_tokens={}",
                    available_ram_gb,
                    requested_ctx_size,
                    effective_ctx_size,
                    prompt_tokens
                );
            }

            effective_ctx_size
        }

        pub fn set_flash_attention(&mut self, mode: FlashAttentionMode) {
            self.flash_attention = mode;
        }

        pub fn get_flash_attention(&self) -> FlashAttentionMode {
            self.flash_attention
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
            configured_n_gpu_layers().unwrap_or(0)
        }

        pub fn gpu_acceleration_enabled(&self) -> bool {
            gpu_acceleration_enabled()
        }

        pub fn count_prompt_tokens(&self, messages: &[Message]) -> anyhow::Result<usize> {
            if !self.is_model_loaded() {
                return Err(anyhow::anyhow!("模型未加载"));
            }

            let model_guard = self
                .model
                .lock()
                .map_err(|e| anyhow::anyhow!("模型锁获取失败: {}", e))?;
            let model = model_guard
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("模型未初始化"))?;
            let prompt = self.render_prompt_with_model(model, messages);
            let tokens = model
                .str_to_token(&prompt, AddBos::Always)
                .map_err(|e| anyhow::anyhow!("分词失败: {}", e))?;
            Ok(tokens.len())
        }

        pub fn render_prompt(&self, messages: &[Message]) -> anyhow::Result<String> {
            if !self.is_model_loaded() {
                return Err(anyhow::anyhow!("模型未加载"));
            }

            let model_guard = self
                .model
                .lock()
                .map_err(|e| anyhow::anyhow!("模型锁获取失败: {}", e))?;
            let model = model_guard
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("模型未初始化"))?;

            Ok(self.render_prompt_with_model(model, messages))
        }

        fn render_prompt_with_model(&self, model: &LlamaModel, messages: &[Message]) -> String {
            let fallback_prompt = crate::chat::build_prompt(&self.fmt, messages);

            let template = match model.chat_template(None) {
                Ok(template) => template,
                Err(error) => {
                    eprintln!("[推理] 模型未提供 chat template，回退手写模板: {}", error);
                    return fallback_prompt;
                }
            };

            let messages_json = match serde_json::to_string(messages) {
                Ok(json) => json,
                Err(error) => {
                    eprintln!("[推理] 消息序列化失败，回退手写模板: {}", error);
                    return fallback_prompt;
                }
            };

            let params = OpenAIChatTemplateParams {
                messages_json: &messages_json,
                tools_json: None,
                tool_choice: None,
                json_schema: None,
                grammar: None,
                reasoning_format: Some("none"),
                chat_template_kwargs: None,
                add_generation_prompt: true,
                use_jinja: true,
                parallel_tool_calls: false,
                enable_thinking: false,
                add_bos: false,
                add_eos: false,
                parse_tool_calls: false,
            };

            match model.apply_chat_template_oaicompat(&template, &params) {
                Ok(result) if !result.prompt.is_empty() => {
                    eprintln!("[推理] 使用模型内置 chat template 渲染提示词");
                    result.prompt
                }
                Ok(_) => {
                    eprintln!("[推理] 模型 chat template 返回空提示词，回退手写模板");
                    fallback_prompt
                }
                Err(error) => {
                    eprintln!(
                        "[推理] 应用模型 chat template 失败，回退手写模板: {}",
                        error
                    );
                    fallback_prompt
                }
            }
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

            let prompt = self.render_prompt_with_model(model, &messages);
            eprintln!("[推理] 提示词:\n{}", prompt);

            let tokens = model
                .str_to_token(&prompt, AddBos::Always)
                .map_err(|e| anyhow::anyhow!("分词失败: {}", e))?;

            if tokens.is_empty() {
                eprintln!("[推理] 错误: 分词结果为空");
                return Err(anyhow::anyhow!("分词结果为空"));
            }

            eprintln!("[推理] 提示词长度: {} tokens", tokens.len());
            let runtime_ctx_size = self.resolve_runtime_ctx_size(
                self.ctx_size.max(tokens.len().max(64) as u32),
                tokens.len(),
            );
            let tuning = resolve_context_tuning(
                self.n_threads,
                runtime_ctx_size,
                gpu_acceleration_enabled(),
            );
            let flash_attention = resolve_flash_attention_mode(self.flash_attention);
            eprintln!(
                "[推理] 上下文调优: ctx={}, decode_threads={}, batch_threads={}, n_batch={}, n_ubatch={}, flash_attn={}, gpu={}",
                runtime_ctx_size,
                tuning.decode_threads,
                tuning.batch_threads,
                tuning.n_batch,
                tuning.n_ubatch,
                flash_attention.as_str(),
                gpu_acceleration_enabled(),
            );

            let ctx_params = LlamaContextParams::default()
                .with_n_ctx(NonZeroU32::new(runtime_ctx_size))
                .with_n_threads(tuning.decode_threads)
                .with_n_threads_batch(tuning.batch_threads)
                .with_n_batch(tuning.n_batch)
                .with_n_ubatch(tuning.n_ubatch)
                .with_offload_kqv(tuning.offload_kqv)
                .with_op_offload(tuning.op_offload)
                .with_flash_attention_policy(flash_attention_policy(flash_attention))
                .with_no_perf(tuning.no_perf);

            let mut ctx = model
                .new_context(&self.backend, ctx_params)
                .map_err(|e| anyhow::anyhow!("上下文创建失败: {}", e))?;

            let mut sampler = build_sampler(&params);
            let abort = self.abort_flag.clone();
            let requested_max_tokens = params.max_tokens.max(1) as usize;
            let max_generation_tokens = resolve_generation_capacity(runtime_ctx_size, tokens.len());
            if max_generation_tokens == 0 {
                return Err(anyhow::anyhow!(
                    "上下文空间不足，当前提示词已占满上下文，无法继续生成回复。"
                ));
            }
            let max_tokens = requested_max_tokens.min(max_generation_tokens);

            if max_tokens < requested_max_tokens {
                eprintln!(
                    "[推理] 根据 KV 容量收缩生成上限: requested_max_tokens={}, effective_max_tokens={}, prompt_tokens={}, ctx={}",
                    requested_max_tokens, max_tokens, tokens.len(), runtime_ctx_size
                );
            }

            {
                eprintln!("[推理] 开始分块解码提示词...");
                for (chunk_idx, chunk) in tokens.chunks(tuning.n_batch as usize).enumerate() {
                    let start = chunk_idx * tuning.n_batch as usize;
                    let mut batch = LlamaBatch::new(chunk.len(), 1);
                    for (offset, token) in chunk.iter().enumerate() {
                        let position = start + offset;
                        let is_last = position == tokens.len() - 1;
                        if let Err(e) = batch.add(*token, position as i32, &[0], is_last) {
                            eprintln!("[推理] Batch 添加 token {} 失败: {}", position, e);
                            return Err(anyhow::anyhow!("Batch 添加失败: {}", e));
                        }
                    }

                    if let Err(e) = ctx.decode(&mut batch) {
                        eprintln!("[推理] 提示词解码失败: {}", e);
                        return Err(anyhow::anyhow!("提示词解码失败: {}", e));
                    }
                }
                eprintln!("[推理] 提示词分块解码成功");
            }

            for token in &tokens {
                sampler.accept(*token);
            }

            const MAX_CONSECUTIVE_EMPTY_PIECES: usize = 16;

            let mut n_cur = 0usize;
            let mut last_position = (tokens.len() - 1) as i32;
            let mut logits_idx = resolve_prefill_logits_index(tokens.len(), tuning.n_batch);
            let mut consecutive_empty_pieces = 0usize;

            loop {
                if n_cur >= max_tokens {
                    eprintln!("[推理] 达到最大 tokens 数 {}", max_tokens);
                    break;
                }
                if abort.load(Ordering::SeqCst) {
                    eprintln!("[推理] 被中止");
                    break;
                }

                let token_to_generate = sampler.sample(&ctx, logits_idx);
                eprintln!(
                    "[推理] Loop {}: 采样 token ID: {} at pos {} (logits idx {})",
                    n_cur, token_to_generate, last_position, logits_idx
                );

                if model.is_eog_token(token_to_generate) {
                    eprintln!("[推理] 遇到 EOS token");
                    break;
                }

                let mut decoder = UTF_8.new_decoder();
                match model.token_to_piece(token_to_generate, &mut decoder, false, None) {
                    Ok(token_str) => {
                        if token_str.is_empty() {
                            consecutive_empty_pieces += 1;
                            eprintln!(
                                "[推理] 收到空字符串 token，跳过并继续生成 (count={}, token_id={})",
                                consecutive_empty_pieces, token_to_generate
                            );
                            if consecutive_empty_pieces >= MAX_CONSECUTIVE_EMPTY_PIECES {
                                eprintln!(
                                    "[推理] 连续收到过多空字符串 token，结束生成以避免死循环"
                                );
                                break;
                            }
                        } else {
                            consecutive_empty_pieces = 0;
                            eprintln!("[推理] 发送 token: {:?}", token_str);
                            on_token(token_str);
                        }
                    }
                    Err(e) => {
                        eprintln!("[推理] token_to_piece 失败: {}", e);
                        return Err(anyhow::anyhow!("token_to_piece 失败: {}", e));
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
                    match e {
                        DecodeError::NoKvCacheSlot => {
                            return Err(anyhow::anyhow!(
                                "上下文空间不足，回复已被截断。请缩短历史消息、增大上下文，或新建对话后重试。"
                            ));
                        }
                        other => {
                            return Err(anyhow::anyhow!("生成解码失败: {}", other));
                        }
                    }
                }

                last_position = batch_pos;
                logits_idx = 0;
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

            let configured_gpu_layers = configured_n_gpu_layers();
            if let Some(n_gpu_layers) = configured_gpu_layers {
                eprintln!(
                    "[模型] 使用 LOCALTHINKING_N_GPU_LAYERS={} 覆盖 GPU 层数",
                    n_gpu_layers
                );
            }

            let moe_compatibility = resolve_moe_compatibility(path);
            let force_cpu_moe = parse_env_flag("LOCALTHINKING_FORCE_CPU_MOE");
            let disable_cpu_moe_fallback = parse_env_flag("LOCALTHINKING_DISABLE_CPU_MOE_FALLBACK");

            let load_with_params = |use_cpu_moe_override: bool| {
                let model_params = build_model_params(configured_gpu_layers, use_cpu_moe_override);
                LlamaModel::load_from_file(&self.backend, path, model_params.as_ref().get_ref())
            };

            let model = if moe_compatibility.enable_cpu_override && force_cpu_moe {
                log_moe_compatibility(
                    &moe_compatibility,
                    "检测到 MoE 模型，按 LOCALTHINKING_FORCE_CPU_MOE 强制启用 CPU MoE 兼容模式",
                );
                load_with_params(true).map_err(|e| anyhow::anyhow!("模型加载失败: {}", e))?
            } else {
                match load_with_params(false) {
                    Ok(model) => {
                        if moe_compatibility.enable_cpu_override {
                            log_moe_compatibility(
                                &moe_compatibility,
                                "检测到 MoE 模型，原生加载成功，保留 GPU/Metal 执行路径",
                            );
                        }
                        model
                    }
                    Err(error)
                        if moe_compatibility.enable_cpu_override && !disable_cpu_moe_fallback =>
                    {
                        log_moe_compatibility(
                            &moe_compatibility,
                            "检测到 MoE 模型，原生加载失败，回退到 CPU MoE 兼容模式",
                        );
                        eprintln!("[模型] 原生 MoE 加载失败: {}", error);
                        load_with_params(true).map_err(|fallback_error| {
                            anyhow::anyhow!("模型加载失败: {}", fallback_error)
                        })?
                    }
                    Err(error) => return Err(anyhow::anyhow!("模型加载失败: {}", error)),
                }
            };

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
                "gpu_acceleration": gpu_acceleration_enabled(),
                "flash_attention": self.flash_attention.as_str(),
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

    pub(crate) fn resolve_prefill_logits_index(prompt_token_count: usize, batch_size: u32) -> i32 {
        let prompt_token_count = prompt_token_count.max(1);
        let batch_size = batch_size.max(1) as usize;
        ((prompt_token_count - 1) % batch_size) as i32
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
        pub flash_attention: FlashAttentionMode,
        pub abort_flag: Arc<AtomicBool>,
        pub model_loaded: Arc<Mutex<bool>>,
        kv_cache_enabled: bool,
        kv_cache_size: u32,
    }

    impl LlamaCppEngine {
        pub fn new() -> anyhow::Result<Self> {
            Self::with_config(1024, PromptFormat::ChatML)
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
                flash_attention: FlashAttentionMode::default(),
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

        pub fn resolve_runtime_ctx_size(
            &self,
            requested_ctx_size: u32,
            prompt_tokens: usize,
        ) -> u32 {
            requested_ctx_size.max(prompt_tokens.max(64) as u32)
        }

        pub fn set_flash_attention(&mut self, mode: FlashAttentionMode) {
            self.flash_attention = mode;
        }

        pub fn get_flash_attention(&self) -> FlashAttentionMode {
            self.flash_attention
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

        pub fn gpu_acceleration_enabled(&self) -> bool {
            false
        }

        pub fn count_prompt_tokens(&self, messages: &[Message]) -> anyhow::Result<usize> {
            Ok(crate::chat::estimate_tokens(&self.render_prompt(messages)?))
        }

        pub fn render_prompt(&self, messages: &[Message]) -> anyhow::Result<String> {
            Ok(crate::chat::build_prompt(&self.fmt, messages))
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
                "flash_attention": self.flash_attention.as_str(),
                "llama_version": "disabled",
                "native_backend_available": false,
                "native_backend_feature": "llama-cpp-2",
                "build_features": {
                    "llama-cpp-2": cfg!(feature = "llama-cpp-2"),
                    "native-metal": cfg!(feature = "native-metal"),
                    "no_llama": cfg!(feature = "no_llama"),
                }
            })
        }
    }
}

pub use imp::LlamaCppEngine;

#[cfg(all(test, feature = "llama-cpp-2"))]
mod tuning_tests {
    use super::imp::{
        resolve_context_tuning_with_memory, resolve_effective_ctx_size_with_memory,
        resolve_generation_capacity, resolve_prefill_logits_index,
    };

    #[test]
    fn resolve_context_tuning_prefers_smaller_decode_pool_on_gpu() {
        let tuning = resolve_context_tuning_with_memory(8, 4096, true, None);

        assert_eq!(tuning.decode_threads, 6);
        assert_eq!(tuning.batch_threads, 8);
        assert_eq!(tuning.n_batch, 1024);
        assert_eq!(tuning.n_ubatch, 512);
        assert!(tuning.op_offload);
        assert!(tuning.offload_kqv);
        assert!(tuning.no_perf);
    }

    #[test]
    fn resolve_context_tuning_uses_requested_threads_on_cpu() {
        let tuning = resolve_context_tuning_with_memory(6, 2048, false, None);

        assert_eq!(tuning.decode_threads, 6);
        assert_eq!(tuning.batch_threads, 6);
        assert_eq!(tuning.n_batch, 512);
        assert_eq!(tuning.n_ubatch, 256);
        assert!(!tuning.op_offload);
        assert!(!tuning.offload_kqv);
        assert!(tuning.no_perf);
    }

    #[test]
    fn resolve_context_tuning_shrinks_batches_under_memory_pressure() {
        let tuning = resolve_context_tuning_with_memory(8, 4096, true, Some(3.5));

        assert_eq!(tuning.n_batch, 256);
        assert_eq!(tuning.n_ubatch, 128);
    }

    #[test]
    fn resolve_effective_ctx_size_caps_to_available_memory_budget() {
        let effective_ctx = resolve_effective_ctx_size_with_memory(4096, 256, true, Some(3.5));

        assert_eq!(effective_ctx, 1024);
    }

    #[test]
    fn resolve_prefill_logits_index_uses_single_output_slot() {
        assert_eq!(resolve_prefill_logits_index(1, 256), 0);
        assert_eq!(resolve_prefill_logits_index(256, 256), 255);
        assert_eq!(resolve_prefill_logits_index(257, 256), 0);
        assert_eq!(resolve_prefill_logits_index(917, 256), 148);
    }

    #[test]
    fn resolve_generation_capacity_matches_remaining_kv_space() {
        assert_eq!(resolve_generation_capacity(1024, 922), 102);
        assert_eq!(resolve_generation_capacity(2048, 0), 2048);
        assert_eq!(resolve_generation_capacity(512, 800), 0);
    }
}

#[cfg(all(test, feature = "llama-cpp-2"))]
mod tests {
    use super::*;
    use crate::backend::Message;

    #[test]
    #[ignore = "requires LOCALTHINKING_MOE_MODEL_PATH to point at a local MoE GGUF"]
    fn moe_model_loads_and_generates() -> anyhow::Result<()> {
        let model_path = std::env::var("LOCALTHINKING_MOE_MODEL_PATH")
            .map_err(|_| anyhow::anyhow!("缺少环境变量 LOCALTHINKING_MOE_MODEL_PATH"))?;

        std::env::set_var("LOCALTHINKING_N_GPU_LAYERS", "0");

        let mut engine = LlamaCppEngine::new()?;
        engine.set_ctx_size(1024);
        engine.set_threads(4);
        engine.set_model_path(&model_path);
        engine.load_model(&model_path)?;

        let tokens = Arc::new(Mutex::new(String::new()));
        let output = Arc::clone(&tokens);

        engine.generate_stream_with_params(
            vec![Message {
                role: "user".to_string(),
                content: "Reply with exactly one short sentence about mixture of experts."
                    .to_string(),
            }],
            InferenceParams {
                temperature: 0.0,
                top_p: 1.0,
                top_k: 40,
                max_tokens: 48,
                repeat_penalty: 1.0,
            },
            move |chunk| {
                output.lock().unwrap().push_str(&chunk);
            },
        )?;

        let generated = tokens.lock().unwrap().trim().to_string();
        assert!(
            !generated.is_empty(),
            "MoE smoke test did not generate any text"
        );

        Ok(())
    }
}
