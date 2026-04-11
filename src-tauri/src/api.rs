// src-tauri/src/api.rs
// OpenAI / Anthropic / Gemini 兼容的 API 接口

use crate::backend::Message;
use crate::cache::{build_generation_cache_params_key, InferenceCache};
use crate::chat::build_prompt;
use crate::engine::{InferenceParams, LlamaCppEngine};
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::method_routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicU16, Ordering},
    Arc, Mutex,
};
use tokio::sync::oneshot;
use tower_http::cors::{AllowHeaders, Any, CorsLayer};

// ============ API 配置 ============

/// API 最大生成长度限制
const MAX_TOKENS_LIMIT: u32 = 256;

#[derive(Clone)]
pub struct ApiState {
    pub engine: Arc<Mutex<LlamaCppEngine>>,
    pub cache: InferenceCache,
}

impl ApiState {
    pub fn new(engine: Arc<Mutex<LlamaCppEngine>>, cache: InferenceCache) -> Self {
        Self { engine, cache }
    }
}

#[derive(Clone)]
pub struct ApiServerManager {
    inner: Arc<ApiServerManagerInner>,
}

struct ApiServerManagerInner {
    enabled: AtomicBool,
    port: AtomicU16,
    running: AtomicBool,
    cache: InferenceCache,
    lifecycle_lock: Mutex<()>,
    shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    thread_handle: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl ApiServerManager {
    pub fn new(cache: InferenceCache) -> Self {
        Self {
            inner: Arc::new(ApiServerManagerInner {
                enabled: AtomicBool::new(true),
                port: AtomicU16::new(8080),
                running: AtomicBool::new(false),
                cache,
                lifecycle_lock: Mutex::new(()),
                shutdown_tx: Mutex::new(None),
                thread_handle: Mutex::new(None),
            }),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.inner.enabled.load(Ordering::SeqCst)
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.inner.enabled.store(enabled, Ordering::SeqCst);
    }

    pub fn port(&self) -> u16 {
        self.inner.port.load(Ordering::SeqCst)
    }

    pub fn set_port(&self, port: u16) {
        self.inner.port.store(port, Ordering::SeqCst);
    }

    pub fn is_running(&self) -> bool {
        self.inner.running.load(Ordering::SeqCst)
    }

    pub fn start(&self, engine: Arc<Mutex<LlamaCppEngine>>) -> Result<(), String> {
        let _guard = self
            .inner
            .lifecycle_lock
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        self.start_inner(engine)
    }

    pub fn stop(&self) -> Result<(), String> {
        let _guard = self
            .inner
            .lifecycle_lock
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        self.stop_inner()
    }

    pub fn restart(&self, engine: Arc<Mutex<LlamaCppEngine>>) -> Result<(), String> {
        let _guard = self
            .inner
            .lifecycle_lock
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        self.stop_inner()?;
        self.start_inner(engine)
    }

    fn start_inner(&self, engine: Arc<Mutex<LlamaCppEngine>>) -> Result<(), String> {
        if self.is_running() {
            return Ok(());
        }

        self.stop_inner()?;

        if !self.is_enabled() {
            return Ok(());
        }

        let port = self.port();
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let (startup_tx, startup_rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let manager = self.clone();

        let handle = std::thread::spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    let _ = startup_tx.send(Err(format!("无法创建 tokio runtime: {}", error)));
                    manager.inner.running.store(false, Ordering::SeqCst);
                    return;
                }
            };

            runtime.block_on(async move {
                let app = build_router(ApiState::new(engine, manager.inner.cache.clone()));
                let addr = format!("127.0.0.1:{}", port);

                match tokio::net::TcpListener::bind(&addr).await {
                    Ok(listener) => {
                        manager.inner.running.store(true, Ordering::SeqCst);
                        let _ = startup_tx.send(Ok(()));
                        eprintln!("[INFO] API 服务器已启动: http://{}", addr);

                        let server = axum::serve(listener, app).with_graceful_shutdown(async {
                            let _ = shutdown_rx.await;
                        });

                        if let Err(error) = server.await {
                            eprintln!("[ERROR] API 服务器错误: {}", error);
                        }
                    }
                    Err(error) => {
                        manager.inner.running.store(false, Ordering::SeqCst);
                        let _ = startup_tx.send(Err(format!("无法绑定端口 {}: {}", addr, error)));
                        return;
                    }
                }

                manager.inner.running.store(false, Ordering::SeqCst);
            });
        });

        *self
            .inner
            .shutdown_tx
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = Some(shutdown_tx);
        *self
            .inner
            .thread_handle
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = Some(handle);

        match startup_rx.recv() {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => {
                let _ = self.stop_inner();
                Err(error)
            }
            Err(error) => {
                let _ = self.stop_inner();
                Err(format!("API 启动状态通道失败: {}", error))
            }
        }
    }

    fn stop_inner(&self) -> Result<(), String> {
        if let Some(shutdown_tx) = self
            .inner
            .shutdown_tx
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        {
            let _ = shutdown_tx.send(());
        }

        if let Some(handle) = self
            .inner
            .thread_handle
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        {
            handle
                .join()
                .map_err(|_| "API 服务线程异常退出".to_string())?;
        }

        self.inner.running.store(false, Ordering::SeqCst);
        Ok(())
    }
}

// ============ OpenAI 兼容的请求/响应结构 ============

#[derive(Debug, Deserialize)]
pub struct ChatCompletionRequest {
    pub model: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<u32>,
    pub repeat_penalty: Option<f32>,
    pub stream: Option<bool>,
    pub stop: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct ChatChoice {
    pub index: usize,
    pub message: ResponseMessage,
    pub finish_reason: String,
}

#[derive(Debug, Serialize)]
pub struct ResponseMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Serialize)]
pub struct ChatCompletionResponse {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub model: String,
    pub choices: Vec<ChatChoice>,
    pub usage: Usage,
}

#[derive(Debug, Serialize)]
pub struct ModelsResponse {
    pub object: String,
    pub data: Vec<ModelData>,
}

#[derive(Debug, Serialize)]
pub struct ModelData {
    pub id: String,
    pub object: String,
    pub created: u32,
    pub owned_by: String,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: ErrorDetail,
}

#[derive(Debug, Serialize)]
pub struct ErrorDetail {
    pub message: String,
    pub r#type: String,
    pub code: Option<String>,
}

// ============ 辅助函数 ============

fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn generate_id() -> String {
    format!("chatcmpl-{}", uuid_simple())
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(std::time::Duration::from_secs(0));
    format!("{:x}{:x}", now.as_secs(), now.subsec_nanos())
}

fn error_response(status: StatusCode, kind: &str, message: impl Into<String>) -> Response {
    (
        status,
        Json(ErrorResponse {
            error: ErrorDetail {
                message: message.into(),
                r#type: kind.to_string(),
                code: None,
            },
        }),
    )
        .into_response()
}

fn invalid_request(message: impl Into<String>) -> Response {
    error_response(StatusCode::BAD_REQUEST, "invalid_request_error", message)
}

fn validate_chat_request(
    req: &ChatCompletionRequest,
    loaded_model_name: &str,
) -> Result<(), Response> {
    if req.stream == Some(true) {
        return Err(invalid_request("流式响应尚未实现，请使用 stream=false"));
    }

    if req.messages.is_empty() {
        return Err(invalid_request("messages 不能为空"));
    }

    if let Some(model) = req.model.as_deref() {
        if !model.is_empty() && model != loaded_model_name {
            return Err(invalid_request(format!(
                "当前仅支持已加载模型 `{}`，收到 `{}`",
                loaded_model_name, model
            )));
        }
    }

    Ok(())
}

fn build_inference_params(req: &ChatCompletionRequest) -> Result<InferenceParams, Response> {
    let temperature = req.temperature.unwrap_or(0.7);
    if !(0.0..=2.0).contains(&temperature) {
        return Err(invalid_request("temperature 必须在 0.0 到 2.0 之间"));
    }

    let top_p = req.top_p.unwrap_or(0.9);
    if !(0.0 < top_p && top_p <= 1.0) {
        return Err(invalid_request("top_p 必须在 0.0 到 1.0 之间，且不能为 0"));
    }

    let max_tokens = req.max_tokens.unwrap_or(MAX_TOKENS_LIMIT);
    if max_tokens == 0 {
        return Err(invalid_request("max_tokens 必须大于 0"));
    }
    if max_tokens > MAX_TOKENS_LIMIT {
        return Err(invalid_request(format!(
            "max_tokens 不能超过 {}",
            MAX_TOKENS_LIMIT
        )));
    }

    let repeat_penalty = req
        .repeat_penalty
        .unwrap_or(InferenceParams::default().repeat_penalty);
    if !(1.0..=2.0).contains(&repeat_penalty) {
        return Err(invalid_request("repeat_penalty 必须在 1.0 到 2.0 之间"));
    }

    Ok(InferenceParams {
        temperature,
        top_p,
        top_k: InferenceParams::default().top_k,
        max_tokens: max_tokens as i32,
        repeat_penalty,
    })
}

fn normalize_stop_sequences(stop: Option<&[String]>) -> Vec<String> {
    stop.unwrap_or(&[])
        .iter()
        .filter_map(|sequence| {
            if sequence.trim().is_empty() {
                None
            } else {
                Some(sequence.clone())
            }
        })
        .collect()
}

fn finalize_completion(
    mut content: String,
    stop_sequences: &[String],
    generated_tokens: usize,
    max_tokens: i32,
) -> (String, String) {
    let mut finish_reason = if generated_tokens >= max_tokens.max(1) as usize {
        "length".to_string()
    } else {
        "stop".to_string()
    };

    let stop_index = stop_sequences
        .iter()
        .filter_map(|sequence| content.find(sequence))
        .min();

    if let Some(index) = stop_index {
        content.truncate(index);
        finish_reason = "stop".to_string();
    }

    (content, finish_reason)
}

pub fn build_router(state: ApiState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost".parse().unwrap(),
            "http://127.0.0.1".parse().unwrap(),
        ])
        .allow_methods(Any)
        .allow_headers(AllowHeaders::any());

    Router::new()
        .route("/", get(index))
        .route("/health", get(health))
        .route("/v1/models", get(list_models))
        .route("/v1/chat/completions", post(chat_completions))
        .layer(cors)
        .with_state(state)
}

// ============ API 路由处理 ============

/// POST /v1/chat/completions - OpenAI 兼容的聊天完成接口
#[axum::debug_handler]
pub async fn chat_completions(
    State(state): State<ApiState>,
    Json(req): Json<ChatCompletionRequest>,
) -> impl IntoResponse {
    let (fmt, model_name, ctx_size, model_identity, engine_arc, cache) = {
        let engine_guard = match state.engine.lock() {
            Ok(g) => g,
            Err(e) => {
                return error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    format!("获取引擎锁失败: {}", e),
                );
            }
        };

        if !engine_guard.is_model_loaded() {
            return invalid_request("模型未加载，请先在应用中选择并加载模型");
        }

        (
            engine_guard.fmt.clone(),
            engine_guard.model_name.clone(),
            engine_guard.get_ctx_size(),
            engine_guard
                .model_path
                .clone()
                .unwrap_or_else(|| engine_guard.model_name.clone()),
            state.engine.clone(),
            state.cache.clone(),
        )
    };

    if let Err(response) = validate_chat_request(&req, &model_name) {
        return response;
    }

    let inference_params = match build_inference_params(&req) {
        Ok(params) => params,
        Err(response) => return response,
    };

    let stop_sequences = normalize_stop_sequences(req.stop.as_deref());
    let messages: Vec<Message> = req
        .messages
        .into_iter()
        .map(|m| Message {
            role: m.role,
            content: m.content,
        })
        .collect();

    let prompt = build_prompt(&fmt, &messages);
    let cache_params =
        build_generation_cache_params_key(&model_identity, ctx_size, &inference_params);

    if let Some(cached) = cache.get(&prompt, &cache_params) {
        let (content, finish_reason) = finalize_completion(
            cached.content,
            &stop_sequences,
            cached.token_count,
            inference_params.max_tokens,
        );
        let prompt_tokens_calc = (prompt.len() as f32 / 4.0).ceil() as u32;
        let completion_tokens_calc = cached.token_count as u32;

        let response = ChatCompletionResponse {
            id: generate_id(),
            object: "chat.completion".to_string(),
            created: current_timestamp(),
            model: model_name,
            choices: vec![ChatChoice {
                index: 0,
                message: ResponseMessage {
                    role: "assistant".to_string(),
                    content,
                },
                finish_reason,
            }],
            usage: Usage {
                prompt_tokens: prompt_tokens_calc,
                completion_tokens: completion_tokens_calc,
                total_tokens: prompt_tokens_calc + completion_tokens_calc,
            },
        };
        return (StatusCode::OK, Json(response)).into_response();
    }

    use std::sync::Arc as StdArc;
    use std::sync::Mutex as StdMutex;

    let shared_output: StdArc<StdMutex<(String, usize)>> =
        StdArc::new(StdMutex::new((String::new(), 0)));
    let output_for_closure = shared_output.clone();

    let result = tokio::task::spawn_blocking(move || {
        let res = {
            let engine = engine_arc.lock().unwrap_or_else(|p| p.into_inner());
            engine.generate_stream_with_params(
                messages,
                inference_params.clone(),
                move |token: String| {
                    if token.is_empty() {
                        return;
                    }

                    let mut output = output_for_closure
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    output.0.push_str(&token);
                    output.1 += 1;
                },
            )
        };

        match res {
            Ok(()) => {
                let (content, generated_tokens) = {
                    let output = shared_output
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    (output.0.clone(), output.1)
                };

                let (content, finish_reason) = finalize_completion(
                    content,
                    &stop_sequences,
                    generated_tokens,
                    inference_params.max_tokens,
                );
                let prompt_tokens_calc = (prompt.len() as f32 / 4.0).ceil() as u32;
                let completion_tokens_calc = generated_tokens as u32;
                cache.set(&prompt, &cache_params, &content, generated_tokens);
                Ok((
                    content,
                    finish_reason,
                    prompt_tokens_calc,
                    completion_tokens_calc,
                ))
            }
            Err(e) => Err(format!("{}", e)),
        }
    })
    .await;

    match result {
        Ok(Ok((content, finish_reason, prompt_tokens, completion_tokens))) => {
            let response = ChatCompletionResponse {
                id: generate_id(),
                object: "chat.completion".to_string(),
                created: current_timestamp(),
                model: model_name,
                choices: vec![ChatChoice {
                    index: 0,
                    message: ResponseMessage {
                        role: "assistant".to_string(),
                        content,
                    },
                    finish_reason,
                }],
                usage: Usage {
                    prompt_tokens,
                    completion_tokens,
                    total_tokens: prompt_tokens + completion_tokens,
                },
            };
            (StatusCode::OK, Json(response)).into_response()
        }
        Ok(Err(e)) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", e),
        Err(e) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            format!("推理任务失败: {}", e),
        ),
    }
}

// The real `run_inference_api` used llama types and required native toolchain.
// We use `generate_stream` above to collect output from the engine (stub or native).

/// GET /v1/models - 列出可用模型
pub async fn list_models(
    State(state): State<ApiState>,
) -> Result<Json<ModelsResponse>, StatusCode> {
    let (model_loaded, model_name) = match state.engine.lock() {
        Ok(guard) => {
            let loaded = guard.is_model_loaded();
            let name = guard.model_name.clone();
            (loaded, name)
        }
        Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
    };

    let data = if model_loaded {
        vec![ModelData {
            id: model_name,
            object: "model".to_string(),
            created: current_timestamp() as u32,
            owned_by: "local".to_string(),
        }]
    } else {
        vec![]
    };

    Ok(Json(ModelsResponse {
        object: "list".to_string(),
        data,
    }))
}

/// Health check endpoint
pub async fn health() -> &'static str {
    "OK"
}

/// API 首页/文档
pub async fn index() -> impl IntoResponse {
    use axum::response::Html;

    let html = r#"
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LocalMind API</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #fafafa;
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            border: 1px solid #ddd;
            padding: 40px;
        }
        h1 {
            color: #333;
            font-size: 28px;
            margin-bottom: 10px;
            font-weight: 500;
        }
        .subtitle {
            color: #666;
            font-size: 14px;
            margin-bottom: 30px;
        }
        .section {
            margin-bottom: 30px;
        }
        .section h2 {
            color: #333;
            font-size: 20px;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #ddd;
            font-weight: 500;
        }
        .endpoint {
            background: #f8f9fa;
            border-left: 2px solid #444;
            padding: 15px;
            margin-bottom: 15px;
        }
        .endpoint h3 {
            color: #333;
            font-size: 16px;
            margin-bottom: 8px;
            font-weight: 500;
        }
        .method {
            display: inline-block;
            padding: 2px 8px;
            font-size: 11px;
            font-weight: 500;
            margin-right: 8px;
        }
        .get { background: #555; color: white; }
        .post { background: #555; color: white; }
        .url {
            font-family: monospace;
            background: #f1f3f4;
            padding: 2px 6px;
            font-size: 13px;
        }
        .description {
            color: #666;
            margin: 8px 0;
            line-height: 1.5;
            font-size: 14px;
        }
        .example {
            background: #fff;
            border: 1px solid #ddd;
            padding: 12px;
            margin-top: 10px;
        }
        .example-title {
            font-weight: 500;
            color: #333;
            margin-bottom: 6px;
            font-size: 13px;
        }
        .example code {
            display: block;
            background: #f8f9fa;
            padding: 10px;
            font-family: monospace;
            font-size: 12px;
            overflow-x: auto;
            white-space: pre-wrap;
        }
        .note {
            background: #f8f9fa;
            border: 1px solid #ddd;
            padding: 15px;
            margin: 20px 0;
        }
        .note-title {
            font-weight: 500;
            color: #333;
            margin-bottom: 8px;
            font-size: 14px;
        }
        .note ul {
            margin-left: 20px;
        }
        .note li {
            color: #666;
            margin: 4px 0;
            font-size: 14px;
        }
        a {
            color: #444;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>LocalMind API</h1>
        <p class="subtitle">本地大模型 HTTP API 接口</p>

        <div class="note">
            <div class="note-title">使用说明</div>
            <ul>
                <li>在调用聊天接口前，请先在应用中加载模型</li>
                <li>默认端口：<strong>8080</strong></li>
                <li>基础 URL：<code>http://127.0.0.1:8080</code></li>
            </ul>
        </div>

        <div class="section">
            <h2>快速开始</h2>
            <div class="endpoint">
                <h3>1. 健康检查</h3>
                <span class="method get">GET</span>
                <code class="url">/health</code>
                <p class="description">检查 API 服务器是否正常运行</p>
                <div class="example">
                    <div class="example-title">示例：</div>
                    <code>curl http://127.0.0.1:8080/health</code>
                </div>
            </div>

            <div class="endpoint">
                <h3>2. 查看模型</h3>
                <span class="method get">GET</span>
                <code class="url">/v1/models</code>
                <p class="description">列出当前加载的模型</p>
                <div class="example">
                    <div class="example-title">示例：</div>
                    <code>curl http://127.0.0.1:8080/v1/models</code>
                </div>
            </div>

            <div class="endpoint">
                <h3>3. 聊天完成</h3>
                <span class="method post">POST</span>
                <code class="url">/v1/chat/completions</code>
                <p class="description">OpenAI 兼容的聊天接口</p>
                <div class="example">
                    <div class="example-title">示例：</div>
                    <code>curl -X POST http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"test","messages":[{"role":"user","content":"你好"}],"max_tokens":50}'</code>
                </div>
            </div>
        </div>

        <div class="section">
            <h2>完整 API 文档</h2>
            <div class="endpoint">
                <h3>GET /v1/models</h3>
                <p class="description">列出所有可用模型</p>
                <div class="example">
                    <div class="example-title">响应示例：</div>
                    <code>{
  "object": "list",
  "data": [
    {
      "id": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
      "object": "model",
      "created": 1234567890,
      "owned_by": "local"
    }
  ]
}</code>
                </div>
            </div>

            <div class="endpoint">
                <h3>GET /v1/models/info</h3>
                <p class="description">获取模型详细信息</p>
                <div class="example">
                    <div class="example-title">响应示例：</div>
                    <code>{
  "loaded": true,
  "model": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
  "n_threads": 4,
  "ctx_size": 2048
}</code>
                </div>
            </div>

            <div class="endpoint">
                <h3>POST /v1/chat/completions</h3>
                <p class="description">发送聊天请求（OpenAI 兼容）</p>
                <div class="example">
                    <div class="example-title">请求格式：</div>
                    <code>{
  "model": "qwen2.5-0.5b-instruct",
  "messages": [
    {"role": "user", "content": "你好"},
    {"role": "assistant", "content": "你好！我是..."}
  ],
  "temperature": 0.7,
  "max_tokens": 256
}</code>
                </div>
            </div>
        </div>

        <div class="section">
            <h2>配置选项</h2>
            <div class="endpoint">
                <h3>请求参数</h3>
                <ul style="margin-left: 20px;">
                    <li><code>model</code>: 模型名称（可选）</li>
                    <li><code>messages</code>: 消息数组（必需）</li>
                    <li><code>temperature</code>: 温度（0-2，默认 0.7）</li>
                    <li><code>top_p</code>: Top-P 采样（0-1，默认 0.9）</li>
                    <li><code>max_tokens</code>: 最大生成 tokens（默认 256，最大 256）</li>
                    <li><code>stream</code>: 流式响应（暂不支持）</li>
                </ul>
            </div>
        </div>

        <div class="section">
            <h2>使用提示</h2>
            <ul style="margin-left: 20px;">
                <li>更多详细信息请查看应用内的 API_GUIDE.md 文档</li>
                <li>支持 Python、JavaScript、curl 等多种调用方式</li>
                <li>API 仅允许本地访问（localhost/127.0.0.1）</li>
                <li>请先在应用中加载模型再使用聊天接口</li>
            </ul>
        </div>

        <div style="text-align: center; margin-top: 30px; color: #999; font-size: 13px;">
            <p>LocalMind v1.0.0 | 基于 llama.cpp</p>
        </div>
    </div>
</body>
</html>
    "#;

    Html(html)
}

/// Model info endpoint
pub async fn model_info(
    State(state): State<ApiState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let (model_loaded, n_threads, ctx_size, model_name) = match state.engine.lock() {
        Ok(guard) => {
            let loaded = guard.is_model_loaded();
            (
                loaded,
                guard.n_threads,
                guard.ctx_size,
                guard.model_name.clone(),
            )
        }
        Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
    };

    Ok(Json(serde_json::json!({
        "loaded": model_loaded,
        "model": model_name,
        "n_threads": n_threads,
        "ctx_size": ctx_size,
    })))
}

// ============ 构建路由 ============

pub fn create_api_router(engine: Arc<Mutex<LlamaCppEngine>>) -> Router {
    let state = ApiState::new(engine, InferenceCache::new(128, 3600));

    // CORS 配置：限制为本地来源，增强安全性
    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost".parse().unwrap(),
            "http://127.0.0.1".parse().unwrap(),
        ])
        .allow_methods(Any)
        .allow_headers(AllowHeaders::any())
        .max_age(std::time::Duration::from_secs(86400));

    Router::new()
        .route("/", get(index))
        .route("/v1/chat/completions", post(chat_completions))
        .route("/v1/models", get(list_models))
        .route("/health", get(health))
        .route("/v1/models/info", get(model_info))
        .layer(cors)
        .with_state(state)
}
