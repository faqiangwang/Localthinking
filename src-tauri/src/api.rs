// src-tauri/src/api.rs
// OpenAI / Anthropic / Gemini 兼容的 API 接口

use crate::backend::Message;
use crate::chat::build_prompt;
use crate::engine::{run_inference, InferenceParams, LlamaCppEngine};
use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::method_routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tower_http::cors::{AllowHeaders, Any, CorsLayer};

// ============ API 配置 ============

/// API 最大生成长度限制
const MAX_TOKENS_LIMIT: u32 = 256;

#[derive(Clone)]
pub struct ApiState {
    pub engine: Arc<Mutex<LlamaCppEngine>>,
}

impl ApiState {
    pub fn new(engine: Arc<Mutex<LlamaCppEngine>>) -> Self {
        Self { engine }
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
    pub stream: Option<bool>,
    pub stop: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
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

// ============ API 路由处理 ============

/// POST /v1/chat/completions - OpenAI 兼容的聊天完成接口
#[axum::debug_handler]
pub async fn chat_completions(
    State(state): State<ApiState>,
    Json(req): Json<ChatCompletionRequest>,
) -> impl IntoResponse {
    // 获取引擎状态并克隆必要数据
    let (model, backend, n_threads, ctx_size, fmt, model_name) = {
        let engine_guard = match state.engine.lock() {
            Ok(g) => g,
            Err(e) => {
                let err = ErrorResponse {
                    error: ErrorDetail {
                        message: format!("获取引擎锁失败: {}", e),
                        r#type: "internal_error".to_string(),
                        code: None,
                    },
                };
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(err)).into_response();
            }
        };

        // 检查模型是否已加载
        if !engine_guard.is_model_loaded() {
            let err = ErrorResponse {
                error: ErrorDetail {
                    message: "模型未加载，请先在应用中选择并加载模型".to_string(),
                    r#type: "invalid_request_error".to_string(),
                    code: None,
                },
            };
            return (StatusCode::BAD_REQUEST, Json(err)).into_response();
        }

        // 克隆必要的数据
        (
            engine_guard.model.clone(),
            engine_guard.backend.clone(),
            engine_guard.n_threads,
            engine_guard.ctx_size,
            engine_guard.fmt.clone(),
            engine_guard.model_name.clone(),
        )
    };

    // 将 messages 转换为 backend::Message
    let messages: Vec<Message> = req.messages
        .into_iter()
        .map(|m| Message {
            role: m.role,
            content: m.content,
        })
        .collect();

    // 构建提示词
    let prompt = build_prompt(&fmt, &messages);

    // 使用用户指定的参数或默认值
    let temperature = req.temperature.unwrap_or(0.7);
    let top_p = req.top_p.unwrap_or(0.9);
    let max_tokens = req.max_tokens.unwrap_or(2048).min(MAX_TOKENS_LIMIT) as i32;

    // TODO: 实现流式响应支持 SSE
    // 当 stream == Some(true) 时，应返回 Server-Sent Events 流
    if req.stream == Some(true) {
        let err = ErrorResponse {
            error: ErrorDetail {
                message: "流式响应尚未实现，请使用 stream=false".to_string(),
                r#type: "invalid_request_error".to_string(),
                code: None,
            },
        };
        return (StatusCode::BAD_REQUEST, Json(err)).into_response();
    }

    // 在阻塞任务中执行推理
    let result = tokio::task::spawn_blocking(move || {
        run_inference_api(
            &model,
            &backend,
            n_threads,
            ctx_size,
            &prompt,
            temperature,
            top_p,
            max_tokens,
        )
    })
    .await;

    match result {
        Ok(Ok((content, prompt_tokens, completion_tokens))) => {
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
                    finish_reason: "stop".to_string(),
                }],
                usage: Usage {
                    prompt_tokens,
                    completion_tokens,
                    total_tokens: prompt_tokens + completion_tokens,
                },
            };
            (StatusCode::OK, Json(response)).into_response()
        }
        Ok(Err(e)) => {
            let err = ErrorResponse {
                error: ErrorDetail {
                    message: e,
                    r#type: "internal_error".to_string(),
                    code: None,
                },
            };
            (StatusCode::INTERNAL_SERVER_ERROR, Json(err)).into_response()
        }
        Err(e) => {
            let err = ErrorResponse {
                error: ErrorDetail {
                    message: format!("推理任务失败: {}", e),
                    r#type: "internal_error".to_string(),
                    code: None,
                },
            };
            (StatusCode::INTERNAL_SERVER_ERROR, Json(err)).into_response()
        }
    }
}

/// API 推理核心函数 - 使用共享的推理逻辑
fn run_inference_api(
    model: &Arc<Mutex<Option<Arc<llama_cpp_2::model::LlamaModel>>>>,
    backend: &Arc<llama_cpp_2::llama_backend::LlamaBackend>,
    n_threads: u32,
    ctx_size: u32,
    prompt: &str,
    temperature: f32,
    top_p: f32,
    max_tokens: i32,
) -> Result<(String, u32, u32), String> {
    // 获取模型
    let model_guard = model.lock().map_err(|e| e.to_string())?;
    let model = model_guard.as_ref().ok_or("模型未加载")?.clone();
    drop(model_guard);

    // 估算 prompt tokens（中文约 1 token/字符，英文约 1 token/4 字符）
    // 注意：这是估算值，不够精确。如需准确计数，需使用模型对应的 tokenizer
    let prompt_tokens = (prompt.len() as f32 / 4.0).ceil() as u32;

    // 使用共享的推理函数
    let params = InferenceParams {
        temperature,
        top_p,
        top_k: 40,
        max_tokens,
        repeat_penalty: 1.1,
        frequency_penalty: 0.0,
        presence_penalty: 0.0,
        use_mmap: true,
        use_mlock: false,
        n_batch: 512,
        n_parallel: 1,
    };

    let output = run_inference(&model, backend, prompt, params, n_threads, ctx_size)?;

    // 估算 completion tokens
    let completion_tokens = (output.len() as f32 / 4.0).ceil() as u32;

    Ok((output, prompt_tokens, completion_tokens))
}

/// GET /v1/models - 列出可用模型
pub async fn list_models(State(state): State<ApiState>) -> Result<Json<ModelsResponse>, StatusCode> {
    let (model_loaded, model_name) = match state.engine.lock() {
        Ok(guard) => {
            let loaded = guard.model.lock().map(|m| m.is_some()).unwrap_or(false);
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
                    <li><code>max_tokens</code>: 最大生成 tokens（默认 2048，最大 256）</li>
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
pub async fn model_info(State(state): State<ApiState>) -> Result<Json<serde_json::Value>, StatusCode> {
    let (model_loaded, n_threads, ctx_size, model_name) = match state.engine.lock() {
        Ok(guard) => {
            let loaded = guard.model.lock().map(|m| m.is_some()).unwrap_or(false);
            (loaded, guard.n_threads, guard.ctx_size, guard.model_name.clone())
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
    let state = ApiState::new(engine);

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
