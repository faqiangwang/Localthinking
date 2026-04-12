// src-tauri/src/commands.rs
use crate::api::ApiServerManager;
use crate::backend::{InferenceBackend, Message};
use crate::cache::{build_generation_cache_params_key, InferenceCache};
use crate::chat::truncate_messages;
use crate::engine::{FlashAttentionMode, InferenceParams, LlamaCppEngine};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{Emitter, State, Window};
use tokio::sync::mpsc;

pub type EngineState = Arc<Mutex<LlamaCppEngine>>;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ChatGenerationParams {
    temperature: f32,
    top_p: f32,
    max_tokens: u32,
    ctx_size: u32,
    repeat_penalty: f32,
}

#[derive(serde::Serialize)]
struct ChatStartEvent {
    request_id: String,
    prompt_tokens: usize,
}

#[derive(serde::Serialize)]
struct ChatTokenEvent {
    request_id: String,
    content: String,
    n_tokens: usize,
    tok_per_sec: f64,
    prompt_tokens: usize,
    prompt_tok_per_sec: f64,
    first_token_latency_ms: f64,
}

#[derive(serde::Serialize)]
struct ChatDoneEvent {
    request_id: String,
    n_tokens: usize,
    tok_per_sec: f64,
    prompt_tokens: usize,
    prompt_tok_per_sec: f64,
    first_token_latency_ms: f64,
}

#[derive(serde::Serialize)]
struct ChatErrorEvent {
    request_id: String,
    error: String,
    n_tokens: usize,
    tok_per_sec: f64,
    prompt_tokens: usize,
    prompt_tok_per_sec: f64,
    first_token_latency_ms: f64,
}

const CONTEXT_MARGIN_TOKENS: usize = 32;
const TARGET_GENERATION_HEADROOM_TOKENS: usize = 256;
const MIN_GENERATION_HEADROOM_TOKENS: usize = 64;
const MAX_HISTORY_TRUNCATION_PASSES: usize = 6;

#[derive(Clone)]
struct PreparedChatRequest {
    messages: Vec<Message>,
    prompt_tokens: usize,
    prompt: String,
    effective_ctx_size: u32,
    inference_params: InferenceParams,
}

fn calculate_tok_per_sec(started_at: Instant, n_tokens: usize) -> f64 {
    let elapsed = started_at.elapsed().as_secs_f64();
    if elapsed > f64::EPSILON {
        n_tokens as f64 / elapsed
    } else {
        0.0
    }
}

fn sanitize_chat_generation_params(params: ChatGenerationParams) -> (InferenceParams, u32) {
    let temperature = params.temperature.clamp(0.0, 2.0);
    let top_p = if params.top_p <= 0.0 {
        InferenceParams::default().top_p
    } else {
        params.top_p.clamp(0.0, 1.0)
    };
    let max_tokens = params.max_tokens.max(1).min(i32::MAX as u32) as i32;
    let ctx_size = params.ctx_size.max(64);
    let repeat_penalty = params.repeat_penalty.clamp(1.0, 2.0);

    (
        InferenceParams {
            temperature,
            top_p,
            top_k: InferenceParams::default().top_k,
            max_tokens,
            repeat_penalty,
        },
        ctx_size,
    )
}

fn resolve_target_generation_headroom(max_tokens: i32) -> usize {
    (max_tokens.max(1) as usize)
        .min(TARGET_GENERATION_HEADROOM_TOKENS)
        .max(MIN_GENERATION_HEADROOM_TOKENS)
}

fn resolve_min_generation_headroom(max_tokens: i32) -> usize {
    (max_tokens.max(1) as usize)
        .min(MIN_GENERATION_HEADROOM_TOKENS)
        .max(16)
}

fn prepare_chat_request(
    engine: &LlamaCppEngine,
    messages: &[Message],
    requested_ctx_size: u32,
    inference_params: &InferenceParams,
) -> anyhow::Result<PreparedChatRequest> {
    let mut prepared_messages = messages.to_vec();
    let target_headroom = resolve_target_generation_headroom(inference_params.max_tokens);
    let min_headroom = resolve_min_generation_headroom(inference_params.max_tokens);
    let mut history_trimmed = false;

    for _ in 0..MAX_HISTORY_TRUNCATION_PASSES {
        let prompt_tokens = engine.count_prompt_tokens(&prepared_messages)?;
        let prompt = engine.render_prompt(&prepared_messages)?;
        let requested_with_headroom = requested_ctx_size.max(
            (prompt_tokens + target_headroom + CONTEXT_MARGIN_TOKENS).min(u32::MAX as usize) as u32,
        );
        let effective_ctx_size =
            engine.resolve_runtime_ctx_size(requested_with_headroom, prompt_tokens);
        let available_generation_tokens = effective_ctx_size
            .saturating_sub(prompt_tokens as u32)
            .saturating_sub(CONTEXT_MARGIN_TOKENS as u32) as usize;

        if available_generation_tokens >= min_headroom {
            let mut adjusted_params = inference_params.clone();
            adjusted_params.max_tokens =
                adjusted_params.max_tokens.min(available_generation_tokens as i32).max(1);

            if history_trimmed {
                eprintln!(
                    "[上下文] 已自动截断历史消息: prompt_tokens={}, ctx={}, generation_budget={}",
                    prompt_tokens, effective_ctx_size, available_generation_tokens
                );
            }

            return Ok(PreparedChatRequest {
                messages: prepared_messages,
                prompt_tokens,
                prompt,
                effective_ctx_size,
                inference_params: adjusted_params,
            });
        }

        let history_budget = effective_ctx_size
            .saturating_sub((target_headroom + CONTEXT_MARGIN_TOKENS) as u32)
            as usize;
        let next_messages = truncate_messages(&prepared_messages, history_budget.max(1));

        if next_messages.len() >= prepared_messages.len() {
            anyhow::bail!(
                "上下文空间不足，无法为回复预留足够空间。请缩短当前消息、减少历史消息，或增大上下文大小。"
            );
        }

        prepared_messages = next_messages;
        history_trimmed = true;
    }

    anyhow::bail!("上下文空间不足，自动裁剪历史消息后仍无法生成完整回复。")
}

// 日志宏，避免生产环境中大量调试输出
#[cfg(feature = "debug")]
macro_rules! log_debug {
    ($($arg:tt)*) => { eprintln!($($arg)*) };
}

#[cfg(not(feature = "debug"))]
macro_rules! log_debug {
    ($($arg:tt)*) => {
        ()
    };
}

#[tauri::command]
pub async fn load_model(path: String, state: State<'_, EngineState>) -> Result<(), String> {
    log_debug!("[DEBUG] 开始加载模型: {}", path);

    // 检查文件是否存在
    if !std::path::Path::new(&path).exists() {
        return Err(format!(
            "模型文件不存在: {}\n\n请检查:\n1. 文件是否被删除\n2. 文件路径是否正确\n3. 是否需要重新下载模型",
            path
        ));
    }

    // 处理可能的 poisoned lock（由之前的 panic 导致）
    let mut engine = state.lock().unwrap_or_else(|poisoned| {
        eprintln!("[WARN] 检测到之前的任务失败，正在恢复状态...");
        poisoned.into_inner()
    });

    engine.set_model_name_from_path(&path);

    // 尝试加载模型
    let result = engine.load_model(&path).map_err(|e| {
        let err_str = e.to_string();
        // 提供更友好的错误消息
        if err_str.contains("Failed to load model") || err_str.contains("failed to load") {
            // 检测到模型文件损坏，自动删除
            eprintln!("[清理] 检测到模型文件损坏，自动删除: {}", path);
            match std::fs::remove_file(&path) {
                Ok(_) => {
                    eprintln!("[清理] 已删除损坏的模型文件: {}", path);
                    format!(
                        "模型加载失败: 文件可能损坏或格式不兼容\n\n错误详情: {}\n\n已自动删除损坏的文件。\n\n建议:\n1. 重新下载模型文件\n2. 确认模型是 GGUF 格式\n3. 尝试其他量化版本（如 Q4_K_M）",
                        err_str
                    )
                }
                Err(delete_err) => {
                    eprintln!("[错误] 删除损坏文件失败: {}", delete_err);
                    format!(
                        "模型加载失败: 文件可能损坏或格式不兼容\n\n错误详情: {}\n\n尝试删除文件失败: {}\n\n请手动删除该文件后重新下载:\n{}",
                        err_str, delete_err, path
                    )
                }
            }
        } else if err_str.contains("out of memory") || err_str.contains("OOM") {
            format!(
                "内存不足，无法加载模型\n\n错误详情: {}\n\n建议:\n1. 关闭其他程序释放内存\n2. 在设置中减少推理线程数\n3. 选择更小的模型（如 0.5B 或 1.5B）",
                err_str
            )
        } else {
            format!("模型加载失败: {}", err_str)
        }
    });

    if result.is_ok() {
        engine.set_model_path(&path);
    }

    match &result {
        Ok(_) => log_debug!("[DEBUG] 模型加载成功"),
        Err(e) => eprintln!("[ERROR] 模型加载失败: {}", e),
    }
    result
}

#[tauri::command]
pub async fn chat_stream(
    messages: Vec<Message>,
    request_id: String,
    params: ChatGenerationParams,
    window: Window,
    state: State<'_, EngineState>,
    cache: State<'_, InferenceCache>,
) -> Result<(), String> {
    eprintln!("[INFO] chat_stream 开始，收到 {} 条消息", messages.len());
    let (inference_params, requested_ctx_size) = sanitize_chat_generation_params(params);

    // 检查模型是否已加载
    let (loaded, model_identity, prepared_request) = {
        let engine = state.lock().unwrap_or_else(|p| p.into_inner());
        let prepared_request = if engine.is_model_loaded() {
            Some(
                prepare_chat_request(&engine, &messages, requested_ctx_size, &inference_params)
                    .map_err(|error| error.to_string()),
            )
        } else {
            None
        };
        (
            engine.is_model_loaded(),
            engine
                .model_path
                .clone()
                .unwrap_or_else(|| engine.model_name.clone()),
            prepared_request,
        )
    };

    if !loaded {
        let msg = "模型未加载，请先选择并加载模型".to_string();
        let _ = window.emit(
            "chat://error",
            &ChatErrorEvent {
                request_id,
                error: msg.clone(),
                n_tokens: 0,
                tok_per_sec: 0.0,
                prompt_tokens: 0,
                prompt_tok_per_sec: 0.0,
                first_token_latency_ms: 0.0,
            },
        );
        return Err(msg);
    }

    let prepared_request = match prepared_request {
        Some(Ok(prepared_request)) => prepared_request,
        Some(Err(message)) => {
            let _ = window.emit(
                "chat://error",
                &ChatErrorEvent {
                    request_id,
                    error: message.clone(),
                    n_tokens: 0,
                    tok_per_sec: 0.0,
                    prompt_tokens: 0,
                    prompt_tok_per_sec: 0.0,
                    first_token_latency_ms: 0.0,
                },
            );
            return Err(message);
        }
        None => return Err("生成请求准备失败".to_string()),
    };
    let prompt_tokens = prepared_request.prompt_tokens;
    let prompt = prepared_request.prompt.clone();

    let started_at = Instant::now();
    let (tx, mut rx) = mpsc::channel::<String>(32);
    let tx_clone = tx.clone();

    let engine_for_task = state.inner().clone();
    let msgs = prepared_request.messages.clone();
    let inference_params = prepared_request.inference_params.clone();
    let effective_ctx_size = prepared_request.effective_ctx_size;
    let cache_params =
        build_generation_cache_params_key(&model_identity, effective_ctx_size, &inference_params);

    let _ = window.emit(
        "chat://start",
        &ChatStartEvent {
            request_id: request_id.clone(),
            prompt_tokens,
        },
    );

    if let Some(cached) = cache.get(&prompt, &cache_params) {
        if !cached.content.is_empty() {
            let _ = window.emit(
                "chat://token",
                &ChatTokenEvent {
                    request_id: request_id.clone(),
                    content: cached.content,
                    n_tokens: cached.token_count,
                    tok_per_sec: 0.0,
                    prompt_tokens,
                    prompt_tok_per_sec: 0.0,
                    first_token_latency_ms: 0.0,
                },
            );
        }

        let _ = window.emit(
            "chat://done",
            &ChatDoneEvent {
                request_id,
                n_tokens: cached.token_count,
                tok_per_sec: 0.0,
                prompt_tokens,
                prompt_tok_per_sec: 0.0,
                first_token_latency_ms: 0.0,
            },
        );
        return Ok(());
    }

    let handle = tokio::task::spawn_blocking(move || {
        let mut engine = engine_for_task.lock().unwrap_or_else(|p| p.into_inner());
        engine.set_ctx_size(effective_ctx_size);
        engine.generate_stream_with_params(msgs, inference_params, move |token: String| {
            let _ = tx_clone.blocking_send(token);
        })
    });
    drop(tx);

    let mut token_count = 0;
    let mut content = String::new();
    let mut decode_started_at: Option<Instant> = None;
    let mut first_token_latency_ms = 0.0;
    let mut prompt_tok_per_sec = 0.0;

    while let Some(token) = rx.recv().await {
        if token.is_empty() {
            continue;
        }

        if decode_started_at.is_none() {
            let first_decode_at = Instant::now();
            first_token_latency_ms = started_at.elapsed().as_secs_f64() * 1000.0;
            prompt_tok_per_sec = calculate_tok_per_sec(started_at, prompt_tokens);
            decode_started_at = Some(first_decode_at);
        }

        token_count += 1;
        content.push_str(&token);
        let throughput_started_at = decode_started_at.unwrap_or(started_at);
        let _ = window.emit(
            "chat://token",
            &ChatTokenEvent {
                request_id: request_id.clone(),
                content: token,
                n_tokens: token_count,
                tok_per_sec: calculate_tok_per_sec(throughput_started_at, token_count),
                prompt_tokens,
                prompt_tok_per_sec,
                first_token_latency_ms,
            },
        );
    }

    match handle.await {
        Ok(Ok(())) => {
            if !content.is_empty() {
                cache.set(&prompt, &cache_params, &content, token_count);
            }
            let _ = window.emit(
                "chat://done",
                &ChatDoneEvent {
                    request_id,
                    n_tokens: token_count,
                    tok_per_sec: calculate_tok_per_sec(
                        decode_started_at.unwrap_or(started_at),
                        token_count,
                    ),
                    prompt_tokens,
                    prompt_tok_per_sec,
                    first_token_latency_ms,
                },
            );
            eprintln!("[INFO] chat_stream 完成，共发送 {} tokens", token_count);
            Ok(())
        }
        Ok(Err(error)) => {
            let message = error.to_string();
            let _ = window.emit(
                "chat://error",
                &ChatErrorEvent {
                    request_id,
                    error: message.clone(),
                    n_tokens: token_count,
                    tok_per_sec: calculate_tok_per_sec(
                        decode_started_at.unwrap_or(started_at),
                        token_count,
                    ),
                    prompt_tokens,
                    prompt_tok_per_sec,
                    first_token_latency_ms,
                },
            );
            Err(message)
        }
        Err(error) => {
            let message = format!("生成任务失败: {}", error);
            let _ = window.emit(
                "chat://error",
                &ChatErrorEvent {
                    request_id,
                    error: message.clone(),
                    n_tokens: token_count,
                    tok_per_sec: calculate_tok_per_sec(
                        decode_started_at.unwrap_or(started_at),
                        token_count,
                    ),
                    prompt_tokens,
                    prompt_tok_per_sec,
                    first_token_latency_ms,
                },
            );
            Err(message)
        }
    }
}

#[cfg(test)]
mod planning_tests {
    use super::{
        resolve_min_generation_headroom, resolve_target_generation_headroom,
        CONTEXT_MARGIN_TOKENS,
    };

    #[test]
    fn generation_headroom_reserves_meaningful_budget() {
        assert_eq!(resolve_target_generation_headroom(16), 64);
        assert_eq!(resolve_target_generation_headroom(128), 128);
        assert_eq!(resolve_target_generation_headroom(2048), 256);
    }

    #[test]
    fn min_generation_headroom_stays_bounded() {
        assert_eq!(resolve_min_generation_headroom(1), 16);
        assert_eq!(resolve_min_generation_headroom(32), 32);
        assert_eq!(resolve_min_generation_headroom(512), 64);
        assert_eq!(CONTEXT_MARGIN_TOKENS, 32);
    }
}

/// 用户在设置页调整 CPU 线程数
#[tauri::command]
pub fn set_threads(n: u32, state: State<'_, EngineState>) -> Result<(), String> {
    let mut engine = state.lock().unwrap_or_else(|poisoned| {
        eprintln!("[WARN] set_threads: 检测到 poisoned lock，正在恢复...");
        poisoned.into_inner()
    });
    engine.set_threads(n);
    Ok(())
}

/// 更新上下文大小
#[tauri::command]
pub fn set_context_size(size: u32, state: State<'_, EngineState>) -> Result<(), String> {
    let mut engine = state.lock().unwrap_or_else(|poisoned| {
        eprintln!("[WARN] set_context_size: 检测到 poisoned lock，正在恢复...");
        poisoned.into_inner()
    });
    engine.set_ctx_size(size);
    Ok(())
}

#[tauri::command]
pub fn set_flash_attention_policy(
    mode: String,
    state: State<'_, EngineState>,
) -> Result<(), String> {
    let mut engine = state.lock().unwrap_or_else(|poisoned| {
        eprintln!("[WARN] set_flash_attention_policy: 检测到 poisoned lock，正在恢复...");
        poisoned.into_inner()
    });
    let mode = FlashAttentionMode::from_str(&mode)
        .ok_or_else(|| "flash_attention 必须为 auto/on/off".to_string())?;
    engine.set_flash_attention(mode);
    Ok(())
}

/// 获取系统信息
#[tauri::command]
pub fn system_info(state: State<'_, EngineState>) -> Result<serde_json::Value, String> {
    let engine = state.lock().unwrap_or_else(|poisoned| {
        eprintln!("[WARN] system_info: 检测到 poisoned lock，正在恢复...");
        poisoned.into_inner()
    });
    Ok(engine.system_info())
}

/// 下载模型，返回下载完成的文件路径
#[tauri::command]
pub async fn download_model(
    url: String,
    filename: String,
    app: tauri::AppHandle,
    window: Window,
) -> Result<String, String> {
    crate::models::download_model(url, filename, app, window)
        .await
        .map_err(|e| e.to_string())
}

/// 停止当前推理
#[tauri::command]
pub fn stop_generation(state: State<'_, EngineState>) -> Result<(), String> {
    let engine = state.lock().unwrap_or_else(|poisoned| {
        eprintln!("[WARN] stop_generation: 检测到 poisoned lock，正在恢复...");
        poisoned.into_inner()
    });
    engine.stop();
    Ok(())
}

/// 获取模型下载 URL
#[tauri::command]
pub fn resolve_model_url(repo_id: String, filename: String) -> String {
    crate::models::resolve_url(&repo_id, &filename)
}

/// 删除模型文件
#[tauri::command]
pub fn delete_model_file(file_path: String) -> Result<(), String> {
    // 检查文件是否存在
    if !std::path::Path::new(&file_path).exists() {
        return Err("文件不存在".to_string());
    }

    // 删除文件
    std::fs::remove_file(&file_path).map_err(|e| format!("删除文件失败: {}", e))?;

    eprintln!("[删除] 已删除模型文件: {}", file_path);
    Ok(())
}

// ============ API 服务控制命令 ============

#[derive(serde::Serialize)]
pub struct ApiStatusResponse {
    pub enabled: bool,
    pub port: u16,
    pub running: bool,
    pub base_url: String,
}

/// 获取 API 服务状态
#[tauri::command]
pub fn get_api_status(api_server: State<'_, ApiServerManager>) -> ApiStatusResponse {
    let enabled = api_server.is_enabled();
    let port = api_server.port();
    ApiStatusResponse {
        enabled,
        port,
        running: api_server.is_running(),
        base_url: format!("http://127.0.0.1:{}", port),
    }
}

/// 启用/禁用 API 服务
#[tauri::command]
pub fn set_api_enabled(
    enabled: bool,
    api_server: State<'_, ApiServerManager>,
    engine: State<'_, EngineState>,
) -> Result<(), String> {
    api_server.set_enabled(enabled);

    if enabled {
        api_server.restart(engine.inner().clone())
    } else {
        api_server.stop()
    }
}

/// 设置 API 服务端口
#[tauri::command]
pub fn set_api_port(
    port: u16,
    api_server: State<'_, ApiServerManager>,
    engine: State<'_, EngineState>,
) -> Result<(), String> {
    if port < 1024 {
        return Err("端口必须在 1024-65535 之间".to_string());
    }
    api_server.set_port(port);

    if api_server.is_enabled() {
        api_server.restart(engine.inner().clone())
    } else {
        Ok(())
    }
}

// ============ 硬件检测与模型推荐命令 ============

/// 获取硬件信息
#[tauri::command]
pub fn get_hardware_info() -> serde_json::Value {
    let hw = crate::sysinfo::detect_hardware();
    serde_json::to_value(&hw).unwrap_or_default()
}

/// 获取模型推荐（基于当前硬件）
#[tauri::command]
pub fn get_model_recommendations() -> serde_json::Value {
    let hw = crate::sysinfo::detect_hardware();
    let recs = crate::recommender::recommend(&hw);
    serde_json::json!({
        "hardware":        hw,
        "recommendations": recs,
    })
}

/// 扫描本地模型文件
#[tauri::command]
pub fn scan_models(state: State<'_, EngineState>) -> Vec<ScannedModel> {
    let engine = state.lock().unwrap_or_else(|poisoned| {
        eprintln!("[WARN] scan_models: 检测到 poisoned lock，正在恢复...");
        poisoned.into_inner()
    });

    let mut seen_paths = HashSet::new();
    let mut scanned_models = Vec::new();

    if let Ok(models) = engine.list_models() {
        for model in models {
            if seen_paths.insert(model.path.clone()) {
                scanned_models.push(ScannedModel {
                    name: model.name,
                    path: model.path,
                    size_gb: model.size_gb,
                    parameters: model.parameters,
                });
            }
        }
    }

    drop(engine);

    for (directory, depth) in candidate_model_directories() {
        collect_gguf_files(&directory, depth, &mut scanned_models, &mut seen_paths);
    }

    scanned_models.sort_by(|left, right| left.name.cmp(&right.name));
    scanned_models
}

#[derive(serde::Serialize)]
pub struct ScannedModel {
    pub name: String,
    pub path: String,
    pub size_gb: f32,
    pub parameters: String,
}

fn candidate_model_directories() -> Vec<(PathBuf, usize)> {
    let mut directories = Vec::new();

    if let Some(home_dir) = dirs::home_dir() {
        directories.push((home_dir.join("LocalMind").join("models"), 4));
    }

    if let Some(download_dir) = dirs::download_dir() {
        directories.push((download_dir, 1));
    }

    if let Some(document_dir) = dirs::document_dir() {
        directories.push((document_dir.join("LocalMind").join("models"), 4));
    }

    directories
}

fn collect_gguf_files(
    directory: &Path,
    remaining_depth: usize,
    scanned_models: &mut Vec<ScannedModel>,
    seen_paths: &mut HashSet<String>,
) {
    let read_dir = match std::fs::read_dir(directory) {
        Ok(read_dir) => read_dir,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        let path = entry.path();

        if path.is_dir() {
            if remaining_depth > 0 && should_descend(&path) {
                collect_gguf_files(&path, remaining_depth - 1, scanned_models, seen_paths);
            }
            continue;
        }

        if !is_gguf_file(&path) {
            continue;
        }

        let canonical_path = path.canonicalize().unwrap_or(path.clone());
        let canonical_string = canonical_path.to_string_lossy().to_string();

        if !seen_paths.insert(canonical_string.clone()) {
            continue;
        }

        let size_gb = canonical_path
            .metadata()
            .map(|metadata| metadata.len() as f32 / 1024.0 / 1024.0 / 1024.0)
            .unwrap_or(0.0);

        let name = canonical_path
            .file_name()
            .and_then(|file_name| file_name.to_str())
            .unwrap_or("unknown.gguf")
            .to_string();

        scanned_models.push(ScannedModel {
            name,
            path: canonical_string,
            size_gb,
            parameters: infer_model_parameters(&canonical_path),
        });
    }
}

fn should_descend(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| !name.starts_with('.'))
        .unwrap_or(false)
}

fn is_gguf_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("gguf"))
        .unwrap_or(false)
}

fn infer_model_parameters(path: &Path) -> String {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return "unknown".to_string();
    };

    let upper = file_name.to_uppercase();
    for candidate in ["0.5B", "1.5B", "2B", "3B", "7B", "8B", "14B", "32B", "70B"] {
        if upper.contains(candidate) {
            return candidate.to_string();
        }
    }

    "unknown".to_string()
}

// ============ 性能监控命令 ============

/// 获取性能统计
#[tauri::command]
pub fn get_performance_stats(
    state: State<EngineState>,
    cache: State<InferenceCache>,
) -> serde_json::Value {
    let engine = state.lock().unwrap();
    let threads = engine.get_threads();
    let ctx_size = engine.get_ctx_size();
    let gpu_layers = engine.get_gpu_layers();
    let gpu_enabled = engine.gpu_acceleration_enabled();
    let flash_attention = engine.get_flash_attention().as_str();
    let cache_stats = cache.stats();

    serde_json::json!({
        "threads": threads,
        "context_size": ctx_size,
        "gpu_layers": gpu_layers,
        "gpu_enabled": gpu_enabled,
        "flash_attention": flash_attention,
        "estimated_memory_mb": estimate_memory_usage(ctx_size, gpu_enabled),
        "cache": cache_stats,
    })
}

/// 估算内存使用量（MB）
fn estimate_memory_usage(ctx_size: u32, gpu_enabled: bool) -> f64 {
    // 上下文内存：每个 token 约 2KB
    let context_memory = ctx_size as f64 * 2.0;
    // 模型内存
    let model_memory = if gpu_enabled { 1000.0 } else { 4500.0 };
    context_memory + model_memory
}

/// 清空推理缓存
#[tauri::command]
pub fn clear_inference_cache(cache: State<'_, InferenceCache>) -> Result<(), String> {
    cache.clear();
    Ok(())
}

/// 获取推荐的上下文大小
#[tauri::command]
pub fn get_recommended_context_size(message_count: usize, avg_message_length: usize) -> usize {
    // 根据消息数量和平均长度推荐上下文大小
    let estimated_tokens = message_count * avg_message_length;
    let recommended = estimated_tokens * 2; // 留出 50% 余量

    // 限制在合理范围内
    recommended.min(8192).max(1024)
}

/// 获取性能优化建议
#[tauri::command]
pub fn get_optimization_suggestions(state: State<EngineState>) -> serde_json::Value {
    let engine = state.lock().unwrap();
    let threads = engine.get_threads();
    let ctx_size = engine.get_ctx_size();
    let gpu_layers = engine.get_gpu_layers();
    let gpu_enabled = engine.gpu_acceleration_enabled();
    let flash_attention = engine.get_flash_attention();

    let mut suggestions = Vec::new();

    // CPU 线程建议
    let physical_cores = num_cpus::get_physical();
    if threads > physical_cores as u32 {
        suggestions
            .push("建议：线程数超过物理核心数，可能降低性能。建议设置为物理核心数。".to_string());
    } else if threads < physical_cores as u32 / 2 {
        suggestions.push("建议：可以增加线程数以提高性能。".to_string());
    }

    // 上下文大小建议
    if ctx_size > 4096 {
        suggestions.push(
            "提示：上下文大小较大，会占用更多内存。如不需要超长上下文，建议设置为 2048。"
                .to_string(),
        );
    }

    // GPU 建议
    if !gpu_enabled {
        suggestions.push(
            "提示：当前使用 CPU 推理。如果有 GPU，可以启用 GPU 加速以获得更好的性能。".to_string(),
        );
    }

    if gpu_enabled && flash_attention == FlashAttentionMode::Off {
        suggestions.push(
            "提示：GPU/Metal 已启用，但 Flash Attention 当前关闭，prefill 速度可能受限。"
                .to_string(),
        );
    }

    serde_json::json!({
        "suggestions": suggestions,
        "current_config": {
            "threads": threads,
            "context_size": ctx_size,
            "gpu_layers": gpu_layers,
            "gpu_enabled": gpu_enabled,
            "flash_attention": flash_attention.as_str(),
            "physical_cores": physical_cores
        }
    })
}

// ============ KV Cache 管理命令 ============

/// 启用/禁用 KV Cache
#[tauri::command]
pub fn set_kv_cache(state: State<EngineState>, enabled: bool) -> Result<(), String> {
    let mut engine = state.lock().unwrap();
    engine.set_kv_cache(enabled);
    Ok(())
}

/// 获取 KV Cache 状态
#[tauri::command]
pub fn get_kv_cache(state: State<EngineState>) -> bool {
    let engine = state.lock().unwrap();
    engine.get_kv_cache()
}

/// 设置 KV Cache 大小
#[tauri::command]
pub fn set_kv_cache_size(state: State<EngineState>, size: u32) -> Result<(), String> {
    let mut engine = state.lock().unwrap();
    engine.set_kv_cache_size(size);
    Ok(())
}

/// 获取 KV Cache 大小
#[tauri::command]
pub fn get_kv_cache_size(state: State<EngineState>) -> u32 {
    let engine = state.lock().unwrap();
    engine.get_kv_cache_size()
}

#[cfg(test)]
mod tests {
    use super::{sanitize_chat_generation_params, ChatGenerationParams};

    #[test]
    fn sanitize_chat_generation_params_clamps_supported_values() {
        let (params, ctx_size) = sanitize_chat_generation_params(ChatGenerationParams {
            temperature: 3.0,
            top_p: 0.0,
            max_tokens: 0,
            ctx_size: 32,
            repeat_penalty: 3.0,
        });

        assert_eq!(params.temperature, 2.0);
        assert_eq!(params.top_p, 0.9);
        assert_eq!(params.max_tokens, 1);
        assert_eq!(params.repeat_penalty, 2.0);
        assert_eq!(ctx_size, 64);
    }
}
