// src-tauri/src/commands.rs
use tauri::{Emitter, State, Window};
use crate::backend::{InferenceBackend, Message};
use crate::engine::LlamaCppEngine;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

pub type EngineState = Arc<Mutex<LlamaCppEngine>>;

// 推理参数常量
const DEFAULT_TEMPERATURE: f32 = 0.7;
const DEFAULT_TOP_P: f32 = 0.9;
const DEFAULT_REPEAT_PENALTY: f32 = 1.1;
const REPEAT_PENALTY_HISTORY: u32 = 32;
const MAX_TOKENS_MIN: i32 = 32;
const MAX_TOKENS_CHAT_LIMIT: i32 = 512;

// 日志宏，避免生产环境中大量调试输出
#[cfg(feature = "debug")]
macro_rules! log_debug {
    ($($arg:tt)*) => { eprintln!($($arg)*) };
}

#[cfg(not(feature = "debug"))]
macro_rules! log_debug {
    ($($arg:tt)*) => { () };
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
    let mut engine = state.lock()
        .unwrap_or_else(|poisoned| {
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

    match &result {
        Ok(_) => log_debug!("[DEBUG] 模型加载成功"),
        Err(e) => eprintln!("[ERROR] 模型加载失败: {}", e),
    }
    result
}

#[tauri::command]
pub async fn chat_stream(
    messages: Vec<Message>,
    window: Window,
    state: State<'_, EngineState>,
) -> Result<(), String> {
    eprintln!("[INFO] chat_stream 开始，收到 {} 条消息", messages.len());

    // 首先检查模型是否已加载（处理可能的 poisoned lock）
    let (model_loaded, model_name) = {
        let engine = state.lock()
            .unwrap_or_else(|poisoned| {
                eprintln!("[WARN] 检测到之前的任务失败，正在恢复...");
                poisoned.into_inner()
            });
        let loaded = engine.is_model_loaded();
        let name = engine.model_name.clone();
        (loaded, name)
    };

    eprintln!("[INFO] 模型状态: loaded={}, name={}", model_loaded, model_name);

    if !model_loaded {
        let msg = "模型未加载，请先选择并加载模型".to_string();
        eprintln!("[WARN] {}", msg);
        let _ = window.emit("chat://error", &msg);
        return Err(msg);
    }

    let (model, backend, n_threads, ctx_size, fmt, abort_flag) = {
        let engine = state.lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let model = engine.model.clone();
        let backend = engine.backend.clone();
        let n_threads = engine.n_threads;
        let ctx_size = engine.ctx_size;
        let fmt = engine.fmt.clone();
        let abort_flag = engine.abort_flag.clone();
        (model, backend, n_threads, ctx_size, fmt, abort_flag)
    };

    let prompt = crate::chat::build_prompt(&fmt, &messages);
    eprintln!("[INFO] prompt 长度: {}", prompt.len());

    // 恢复原始配置：使用完整的上下文范围
    // 平衡性能和上下文长度：2048-4096 可以获得最佳性能
    let final_ctx_size = ctx_size.clamp(2048, 4096);
    let final_n_threads = n_threads.clamp(2, 16);
    eprintln!("[INFO] 最终 ctx_size: {}, n_threads: {}", final_ctx_size, final_n_threads);

    // 创建通道用于传递 token，使用较小的缓冲
    let (tx, mut rx) = mpsc::channel::<Result<String, String>>(10);
    let tx_clone = tx.clone();

    eprintln!("[INFO] 启动推理任务...");

    // Run in blocking task with panic protection
    let mut handle = tokio::task::spawn_blocking(move || {
        eprintln!("[INFO] spawn_blocking 开始");

        // 使用 catch_unwind 捕获任何 panic
        let result = catch_unwind(AssertUnwindSafe(|| {
            run_inference(&model, &backend, final_n_threads, final_ctx_size, &prompt, &tx_clone, &abort_flag)
        }));

        match result {
            Ok(Ok(())) => {
                eprintln!("[INFO] 推理正常完成");
            }
            Ok(Err(e)) => {
                eprintln!("[ERROR] 推理出错: {}", e);
                let _ = tx_clone.blocking_send(Err(e));
            }
            Err(panic_info) => {
                let msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                    format!("推理panic: {}", s)
                } else if let Some(s) = panic_info.downcast_ref::<String>() {
                    format!("推理panic: {}", s)
                } else {
                    "推理发生未知panic".to_string()
                };
                eprintln!("[ERROR] {}", msg);
                let _ = tx_clone.blocking_send(Err(msg));
            }
        }
    });

    // 在异步上下文中接收 token 并发送给前端
    eprintln!("[INFO] 开始接收 token...");
    let mut _token_count = 0;

    // 使用 select! 处理任务完成和接收
    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Some(Ok(s)) if s.is_empty() => {
                        eprintln!("[INFO] 完成信号，发送 done");
                        let _ = window.emit("chat://done", ());
                        break;
                    }
                    Some(Ok(s)) => {
                        _token_count += 1;
                        eprintln!("[INFO] 发送 token #{}: {}", _token_count, s.trim());
                        let _ = window.emit("chat://token", &s);
                    }
                    Some(Err(e)) => {
                        eprintln!("[ERROR] 推理错误: {}", e);
                        let _ = window.emit("chat://error", &e);
                        break;
                    }
                    None => {
                        eprintln!("[INFO] 通道已关闭");
                        break;
                    }
                }
            }
            result = &mut handle => {
                match result {
                    Ok(()) => {
                        eprintln!("[INFO] 任务正常完成");
                    }
                    Err(e) => {
                        eprintln!("[ERROR] 任务panic或被取消: {:?}", e);
                        let _ = window.emit("chat://error", "推理任务异常终止");
                    }
                }
                // 任务完成，退出循环（不需要重复处理token，上面的rx.recv()已经处理了）
                break;
            }
        }
    }
    eprintln!("[INFO] chat_stream 完成，共发送 {} tokens", _token_count);

    Ok(())
}

/// 执行推理的核心函数
fn run_inference(
    model: &Arc<Mutex<Option<Arc<llama_cpp_2::model::LlamaModel>>>>,
    backend: &Arc<llama_cpp_2::llama_backend::LlamaBackend>,
    n_threads: u32,
    ctx_size: u32,
    prompt: &str,
    tx: &mpsc::Sender<Result<String, String>>,
    abort_flag: &Arc<std::sync::atomic::AtomicBool>,
) -> Result<(), String> {
    // 重置中断标志
    abort_flag.store(false, std::sync::atomic::Ordering::SeqCst);

    // 获取模型
    let model_guard = model.lock().map_err(|e| e.to_string())?;
    let model = model_guard.as_ref().ok_or("模型未加载")?;
    let model = model.clone();
    drop(model_guard);

    eprintln!("[INFO] 正在创建上下文...");

    // 创建上下文，使用安全的 NonZeroU32 处理
    let n_ctx = std::num::NonZeroU32::new(ctx_size.max(64)).unwrap_or(std::num::NonZeroU32::MIN);

    // 性能优化配置
    // n_batch: 必须足够大以处理整个 prompt，设置为与 n_ctx 相同
    // n_threads_batch: CPU-only 推理可以使用与主线程数相同的批处理线程
    let ctx_params = llama_cpp_2::context::params::LlamaContextParams::default()
        .with_n_ctx(Some(n_ctx))
        .with_n_batch(n_ctx.get())  // 设置 n_batch 等于上下文大小
        .with_n_threads(n_threads.max(1) as i32)
        .with_n_threads_batch(n_threads.max(1) as i32);  // 使用全部线程进行批处理

    let mut ctx = model.new_context(backend, ctx_params)
        .map_err(|e| format!("无法创建推理上下文: {}", e))?;

    log_debug!("[DEBUG] 上下文创建成功");

    // Tokenize
    let mut tokens = model.str_to_token(prompt, llama_cpp_2::model::AddBos::Never)
        .map_err(|e| format!("无法将提示词转为 token: {}", e))?;

    if tokens.is_empty() {
        return Err("提示词为空".to_string());
    }

    log_debug!("[DEBUG] tokens 数量: {}", tokens.len());

    // 智能截断：如果 tokens 超过上下文大小的 90%，保留最近的 tokens
    // 为新生成的 token 预留至少 10% 的空间
    let max_prompt_tokens = (ctx_size as f32 * 0.9) as usize;
    if tokens.len() > max_prompt_tokens {
        let truncated_count = tokens.len() - max_prompt_tokens;
        eprintln!("[WARN] Prompt 过长 ({} tokens)，截断最早的 {} 个 tokens", tokens.len(), truncated_count);
        tokens = tokens.into_iter().rev().take(max_prompt_tokens).collect::<Vec<_>>().into_iter().rev().collect();
        eprintln!("[INFO] 截断后 tokens 数量: {}", tokens.len());
    }

    // 初始批次 - 使用简化的方式，让所有位置都能正确处理
    let n_tokens = tokens.len();
    let mut batch = llama_cpp_2::llama_batch::LlamaBatch::new(n_tokens, 1);

    // 添加所有 tokens 到批次
    for (i, &t) in tokens.iter().enumerate() {
        // 只在最后一个位置设置 logits=true
        let is_last = i == n_tokens - 1;
        batch.add(t, i as i32, &[0], is_last)
            .map_err(|e| format!("无法添加 token 到批次: {}", e))?;
    }

    log_debug!("[DEBUG] 初始批次创建完成，准备解码");
    ctx.decode(&mut batch)
        .map_err(|e| format!("初始解码失败: {}", e))?;

    log_debug!("[DEBUG] 初始 decode 成功");

    let mut sampler = llama_cpp_2::sampling::LlamaSampler::chain_simple([
        llama_cpp_2::sampling::LlamaSampler::penalties(REPEAT_PENALTY_HISTORY as i32, DEFAULT_REPEAT_PENALTY, 0.0, 0.0),
        llama_cpp_2::sampling::LlamaSampler::top_k(40),
        llama_cpp_2::sampling::LlamaSampler::top_p(DEFAULT_TOP_P, 1),
        llama_cpp_2::sampling::LlamaSampler::temp(DEFAULT_TEMPERATURE),
        llama_cpp_2::sampling::LlamaSampler::dist(42),
    ]);

    let mut n_cur: i32 = n_tokens as i32;  // 当前序列长度（下一个要添加的位置），使用 i32 类型
    let mut token_count = 0;
    let mut decoder = encoding_rs::UTF_8.new_decoder();
    let max_tokens = (ctx_size as i32).min(MAX_TOKENS_CHAT_LIMIT).max(MAX_TOKENS_MIN);
    let start_time = std::time::Instant::now(); // 记录开始时间
    let is_first_iteration = std::sync::atomic::AtomicBool::new(true);

    log_debug!("[DEBUG] 开始生成循环, max_tokens: {}, n_cur初始值: {}", max_tokens, n_cur);

    loop {
        // 检查是否请求中断
        if abort_flag.load(std::sync::atomic::Ordering::SeqCst) {
            log_debug!("[DEBUG] 用户中断推理");
            break;
        }

        if token_count >= max_tokens {
            log_debug!("[DEBUG] 达到最大 token 数: {}", max_tokens);
            break;
        }

        // 确定采样位置
        // 第一次迭代：从初始 batch 的最后一个位置采样（n_cur - 1）
        // 后续迭代：从新 batch 的位置 0 采样（因为新 batch 只有一个 token）
        let sample_pos = if is_first_iteration.load(std::sync::atomic::Ordering::SeqCst) {
            (n_cur - 1).max(0)
        } else {
            0  // 新 batch 只有一个 token，索引为 0
        };

        log_debug!("[DEBUG] 从位置 {} 采样，当前序列长度 {}, 第一次迭代: {}",
                   sample_pos, n_cur, is_first_iteration.load(std::sync::atomic::Ordering::SeqCst));

        let token = sampler.sample(&ctx, sample_pos);
        sampler.accept(token);

        // 标记第一次迭代已完成
        is_first_iteration.store(false, std::sync::atomic::Ordering::SeqCst);

        if model.is_eog_token(token) {
            log_debug!("[DEBUG] 检测到结束 token");
            break;
        }

        let decoded_text = match model.token_to_piece(token, &mut decoder, true, None) {
            Ok(s) => Some(s),
            Err(_) => None,
        };

        // 无论解码是否成功，都增加 token 计数
        token_count += 1;

        if let Some(text) = decoded_text {
            // 计算速度
            let elapsed = start_time.elapsed().as_secs_f32().max(0.001);
            let tok_per_sec = (token_count as f32 / elapsed * 10.0).round() / 10.0;

            // 发送包含速度信息的 JSON 数据
            let token_data = serde_json::json!({
                "text": text,
                "tok_per_sec": tok_per_sec,
                "n_tokens": token_count,
            });

            if tx.blocking_send(Ok(token_data.to_string())).is_err() {
                break;
            }
        }

        // 创建新批次并添加 token 到位置 n_cur
        let mut next = llama_cpp_2::llama_batch::LlamaBatch::new(1, 1);
        next.add(token, n_cur, &[0], true)
            .map_err(|e| format!("无法添加下一个 token: {}", e))?;

        log_debug!("[DEBUG] 解码新 token，位置 {}", n_cur);
        ctx.decode(&mut next)
            .map_err(|e| format!("解码失败: {}", e))?;

        // 移动到下一个位置
        n_cur += 1;

        if n_cur as u32 >= ctx_size {
            log_debug!("[DEBUG] 达到上下文限制");
            break;
        }
    }
    log_debug!("[DEBUG] 生成循环结束，共生成 {} tokens", token_count);

    // 发送完成信号
    tx.blocking_send(Ok(String::new())).ok();

    Ok(())
}

/// 用户在设置页调整 CPU 线程数
#[tauri::command]
pub fn set_threads(n: u32, state: State<'_, EngineState>) -> Result<(), String> {
    let mut engine = state.lock()
        .unwrap_or_else(|poisoned| {
            eprintln!("[WARN] set_threads: 检测到 poisoned lock，正在恢复...");
            poisoned.into_inner()
        });
    engine.set_threads(n);
    Ok(())
}

/// 获取系统信息
#[tauri::command]
pub fn system_info(state: State<'_, EngineState>) -> Result<serde_json::Value, String> {
    let engine = state.lock()
        .unwrap_or_else(|poisoned| {
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
    let engine = state.lock()
        .unwrap_or_else(|poisoned| {
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
    std::fs::remove_file(&file_path)
        .map_err(|e| format!("删除文件失败: {}", e))?;

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

use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};

/// 全局 API 服务器状态
static API_ENABLED: AtomicBool = AtomicBool::new(true);
static API_PORT: AtomicU16 = AtomicU16::new(8080);

/// 获取 API 服务状态
#[tauri::command]
pub fn get_api_status() -> ApiStatusResponse {
    let enabled = API_ENABLED.load(Ordering::SeqCst);
    let port = API_PORT.load(Ordering::SeqCst);
    ApiStatusResponse {
        enabled,
        port,
        running: enabled, // 简化：running = enabled
        base_url: format!("http://127.0.0.1:{}", port),
    }
}

/// 启用/禁用 API 服务
#[tauri::command]
pub fn set_api_enabled(enabled: bool) -> Result<(), String> {
    API_ENABLED.store(enabled, Ordering::SeqCst);
    Ok(())
}

/// 设置 API 服务端口
#[tauri::command]
pub fn set_api_port(port: u16) -> Result<(), String> {
    if port < 1024 {
        return Err("端口必须在 1024-65535 之间".to_string());
    }
    API_PORT.store(port, Ordering::SeqCst);
    Ok(())
}

/// 获取 API 服务端口（供 lib.rs 使用）
pub fn get_api_port() -> u16 {
    API_PORT.load(Ordering::SeqCst)
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
    let hw   = crate::sysinfo::detect_hardware();
    let recs = crate::recommender::recommend(&hw);
    serde_json::json!({
        "hardware":        hw,
        "recommendations": recs,
    })
}

/// 扫描本地模型文件
#[tauri::command]
pub fn scan_models(state: State<'_, EngineState>) -> Vec<ScannedModel> {
    let engine = state.lock()
        .unwrap_or_else(|poisoned| {
            eprintln!("[WARN] scan_models: 检测到 poisoned lock，正在恢复...");
            poisoned.into_inner()
        });

    match engine.list_models() {
        Ok(models) => {
            models.into_iter().map(|m| ScannedModel {
                name: m.name,
                path: m.path,
                size_gb: m.size_gb,
                parameters: m.parameters,
            }).collect()
        }
        Err(e) => {
            eprintln!("[ERROR] 扫描模型失败: {}", e);
            Vec::new()
        }
    }
}

#[derive(serde::Serialize)]
pub struct ScannedModel {
    pub name: String,
    pub path: String,
    pub size_gb: f32,
    pub parameters: String,
}

// ============ 性能监控命令 ============

/// 获取性能统计
#[tauri::command]
pub fn get_performance_stats(state: State<EngineState>) -> serde_json::Value {
    let engine = state.lock().unwrap();
    let threads = engine.get_threads();
    let ctx_size = engine.get_ctx_size();
    let gpu_layers = engine.get_gpu_layers();

    serde_json::json!({
        "threads": threads,
        "context_size": ctx_size,
        "gpu_layers": gpu_layers,
        "gpu_enabled": gpu_layers > 0,
        "estimated_memory_mb": estimate_memory_usage(ctx_size, gpu_layers > 0)
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
pub fn clear_inference_cache() -> Result<(), String> {
    // TODO: 实现缓存清理
    eprintln!("[缓存] 清空推理缓存");
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

    let mut suggestions = Vec::new();

    // CPU 线程建议
    let physical_cores = num_cpus::get_physical();
    if threads > physical_cores as u32 {
        suggestions.push("建议：线程数超过物理核心数，可能降低性能。建议设置为物理核心数。".to_string());
    } else if threads < physical_cores as u32 / 2 {
        suggestions.push("建议：可以增加线程数以提高性能。".to_string());
    }

    // 上下文大小建议
    if ctx_size > 4096 {
        suggestions.push("提示：上下文大小较大，会占用更多内存。如不需要超长上下文，建议设置为 2048。".to_string());
    }

    // GPU 建议
    if gpu_layers == 0 {
        suggestions.push("提示：当前使用 CPU 推理。如果有 GPU，可以启用 GPU 加速以获得更好的性能。".to_string());
    }

    serde_json::json!({
        "suggestions": suggestions,
        "current_config": {
            "threads": threads,
            "context_size": ctx_size,
            "gpu_layers": gpu_layers,
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

