// src-tauri/src/backend.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,    // "system" | "user" | "assistant"
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ModelInfo {
    pub name: String,
    pub path: String,
    pub size_gb: f32,
    pub parameters: String,
}

#[allow(dead_code)]
pub trait InferenceBackend: Send + Sync {
    fn load_model(&self, path: &str) -> anyhow::Result<()>;
    fn generate_stream<F>(&self, messages: Vec<Message>, on_token: F) -> anyhow::Result<()>
    where
        F: Fn(String) + Send + Sync + 'static;
    fn list_models(&self) -> anyhow::Result<Vec<ModelInfo>>;
    fn system_info(&self) -> serde_json::Value;
}
