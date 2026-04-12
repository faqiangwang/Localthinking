// src-tauri/src/lib.rs
pub mod api;
mod backend;
mod cache;
mod chat;
mod commands;
mod engine;
mod models;
mod monitoring;
mod recommender;
mod sysinfo;
mod virtual_memory;

use api::ApiServerManager;
use cache::InferenceCache;
use commands::EngineState;
use engine::LlamaCppEngine;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化推理引擎，使用 match 进行适当的错误处理
    let engine = match LlamaCppEngine::new() {
        Ok(e) => e,
        Err(e) => {
            eprintln!("错误: 推理引擎初始化失败: {}", e);
            eprintln!("程序无法继续运行，请检查系统配置。");
            std::process::exit(1);
        }
    };
    let state: EngineState = Arc::new(Mutex::new(engine));
    let inference_cache = InferenceCache::new(128, 3600);
    let api_manager = ApiServerManager::new(inference_cache.clone());
    if let Err(error) = api_manager.start(state.clone()) {
        eprintln!("[WARN] API 服务启动失败，但应用将继续运行: {}", error);
    }

    // 运行 Tauri 应用，使用 match 处理可能的错误
    let run_result = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .manage(inference_cache)
        .manage(api_manager.clone())
        .invoke_handler(tauri::generate_handler![
            commands::load_model,
            commands::chat_stream,
            commands::stop_generation,
            commands::set_threads,
            commands::set_context_size,
            commands::set_flash_attention_policy,
            commands::system_info,
            commands::download_model,
            commands::resolve_model_url,
            commands::delete_model_file,
            commands::get_api_status,
            commands::set_api_enabled,
            commands::set_api_port,
            // 硬件检测与模型推荐
            commands::get_hardware_info,
            commands::get_model_recommendations,
            commands::scan_models,
            // 虚拟内存管理
            virtual_memory::get_virtual_memory_info,
            virtual_memory::set_virtual_memory,
            virtual_memory::enable_auto_virtual_memory,
            // 性能监控
            commands::get_performance_stats,
            commands::clear_inference_cache,
            commands::get_recommended_context_size,
            commands::get_optimization_suggestions,
            // KV Cache 管理
            commands::set_kv_cache,
            commands::get_kv_cache,
            commands::set_kv_cache_size,
            commands::get_kv_cache_size,
        ])
        .run(tauri::generate_context!());

    if let Err(error) = api_manager.stop() {
        eprintln!("[WARN] API 服务关闭失败: {}", error);
    }

    if let Err(e) = run_result {
        eprintln!("错误: Tauri 应用运行失败: {}", e);
        std::process::exit(1);
    }
}
