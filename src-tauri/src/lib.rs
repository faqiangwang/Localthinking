// src-tauri/src/lib.rs
mod backend;
mod cache;
mod chat;
mod commands;
mod engine;
mod models;
mod monitoring;
pub mod api;
mod virtual_memory;
mod sysinfo;
mod recommender;

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

    // 启动 API 服务器
    let api_engine = state.clone();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("无法创建 tokio runtime");
        rt.block_on(async {
            start_api_server(api_engine).await;
        });
    });

    // 运行 Tauri 应用，使用 match 处理可能的错误
    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::load_model,
            commands::chat_stream,
            commands::stop_generation,
            commands::set_threads,
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
        .run(tauri::generate_context!())
    {
        eprintln!("错误: Tauri 应用运行失败: {}", e);
        std::process::exit(1);
    }
}

// API 服务器异步启动函数
async fn start_api_server(engine: Arc<Mutex<LlamaCppEngine>>) {
    use axum::{
        Router,
        routing::get,
        extract::State,
        response::IntoResponse,
        Json,
        http::StatusCode,
    };
    use tower_http::cors::{AllowHeaders, Any, CorsLayer};

    #[derive(Clone)]
    struct AppState {
        engine: Arc<Mutex<LlamaCppEngine>>,
    }

    async fn index() -> &'static str {
        "LocalMind API Running"
    }

    async fn health() -> &'static str {
        "OK"
    }

    async fn list_models(State(state): State<AppState>) -> impl IntoResponse {
        let response = match state.engine.lock() {
            Ok(engine) => {
                let loaded = engine.is_model_loaded();
                serde_json::json!({
                    "object": "list",
                    "data": if loaded {
                        vec![serde_json::json!({
                            "id": engine.model_name.clone(),
                            "object": "model",
                            "created": 0,
                            "owned_by": "local"
                        })]
                    } else {
                        vec![]
                    }
                })
            }
            Err(_) => serde_json::json!({
                "object": "list",
                "data": []
            })
        };
        (StatusCode::OK, Json(response)).into_response()
    }

    let state = AppState { engine };

    // CORS 配置
    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost".parse().unwrap(),
            "http://127.0.0.1".parse().unwrap(),
        ])
        .allow_methods(Any)
        .allow_headers(AllowHeaders::any());

    let app = Router::new()
        .route("/", get(index))
        .route("/health", get(health))
        .route("/v1/models", get(list_models))
        .layer(cors)
        .with_state(state);

    let port = commands::get_api_port();
    let addr = format!("127.0.0.1:{}", port);

    match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => {
            eprintln!("[INFO] API 服务器已启动: http://{}", addr);
            if let Err(e) = axum::serve(listener, app).await {
                eprintln!("[ERROR] API 服务器错误: {}", e);
            }
        }
        Err(e) => {
            eprintln!("[WARN] 无法绑定端口 {}: {}", addr, e);
            eprintln!("[WARN] API 服务启动失败，但应用将继续运行");
        }
    }
}
