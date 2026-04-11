// src-tauri/src/cache.rs
use crate::engine::InferenceParams;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CachedInference {
    pub content: String,
    pub token_count: usize,
}

/// 缓存条目
#[allow(dead_code)]
#[derive(Clone)]
struct CacheEntry {
    result: CachedInference,
    timestamp: u64,
    hit_count: u32,
}

/// 智能缓存系统
/// 用于缓存推理结果，避免重复计算
#[allow(dead_code)]
#[derive(Clone)]
pub struct InferenceCache {
    cache: Arc<Mutex<HashMap<String, CacheEntry>>>,
    max_size: usize,
    ttl_seconds: u64,
}

pub fn build_generation_cache_params_key(
    model_identity: &str,
    ctx_size: u32,
    params: &InferenceParams,
) -> String {
    format!(
        "model={model_identity};ctx={ctx_size};temp={:.4};top_p={:.4};top_k={};max={};repeat={:.4}",
        params.temperature, params.top_p, params.top_k, params.max_tokens, params.repeat_penalty
    )
}

#[allow(dead_code)]
impl InferenceCache {
    /// 创建新的缓存实例
    /// max_size: 最大缓存条目数
    /// ttl_seconds: 缓存过期时间（秒）
    pub fn new(max_size: usize, ttl_seconds: u64) -> Self {
        Self {
            cache: Arc::new(Mutex::new(HashMap::new())),
            max_size,
            ttl_seconds,
        }
    }

    /// 生成缓存键
    fn generate_key(&self, prompt: &str, params: &str) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        prompt.hash(&mut hasher);
        params.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }

    /// 获取缓存结果
    pub fn get(&self, prompt: &str, params: &str) -> Option<CachedInference> {
        let key = self.generate_key(prompt, params);
        let mut cache = self.cache.lock().ok()?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();

        if let Some(entry) = cache.get_mut(&key) {
            // 检查是否过期
            if now - entry.timestamp > self.ttl_seconds {
                cache.remove(&key);
                return None;
            }

            // 更新命中次数
            entry.hit_count += 1;
            eprintln!("[缓存] 命中: key={}, hits={}", key, entry.hit_count);
            return Some(entry.result.clone());
        }

        None
    }

    /// 设置缓存
    pub fn set(&self, prompt: &str, params: &str, content: &str, token_count: usize) {
        let key = self.generate_key(prompt, params);
        let mut cache = self.cache.lock().unwrap();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // 如果缓存已满，删除最旧的条目
        if cache.len() >= self.max_size {
            let mut oldest_key = None;
            let mut oldest_time = u64::MAX;

            for (k, v) in cache.iter() {
                if v.timestamp < oldest_time {
                    oldest_time = v.timestamp;
                    oldest_key = Some(k.clone());
                }
            }

            if let Some(k) = oldest_key {
                cache.remove(&k);
                eprintln!("[缓存] 清理旧条目: {}", k);
            }
        }

        let entry = CacheEntry {
            result: CachedInference {
                content: content.to_string(),
                token_count,
            },
            timestamp: now,
            hit_count: 0,
        };

        // 在插入之前打印日志（避免移动 key 后无法使用）
        eprintln!(
            "[缓存] 存储: key={}, size={}, tokens={}",
            key,
            content.len(),
            token_count
        );
        cache.insert(key, entry);
    }

    /// 清空缓存
    pub fn clear(&self) {
        let mut cache = self.cache.lock().unwrap();
        cache.clear();
        eprintln!("[缓存] 已清空");
    }

    /// 获取缓存统计信息
    pub fn stats(&self) -> CacheStats {
        let cache = self.cache.lock().unwrap();
        let total_hits: u32 = cache.values().map(|e| e.hit_count).sum();

        CacheStats {
            entries: cache.len(),
            total_hits,
            max_size: self.max_size,
            avg_hits: if cache.is_empty() {
                0.0
            } else {
                total_hits as f64 / cache.len() as f64
            },
            ttl_seconds: self.ttl_seconds,
        }
    }
}

/// 缓存统计信息
#[allow(dead_code)]
#[derive(Debug, Clone, serde::Serialize)]
pub struct CacheStats {
    pub entries: usize,
    pub total_hits: u32,
    pub max_size: usize,
    pub avg_hits: f64,
    pub ttl_seconds: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_basic() {
        let cache = InferenceCache::new(10, 60);

        // 测试存储和获取
        cache.set("test prompt", "temp:0.7", "test result", 3);
        let result = cache.get("test prompt", "temp:0.7");

        assert_eq!(
            result,
            Some(CachedInference {
                content: "test result".to_string(),
                token_count: 3,
            })
        );
    }

    #[test]
    fn test_cache_miss() {
        let cache = InferenceCache::new(10, 60);

        let result = cache.get("nonexistent", "temp:0.7");
        assert_eq!(result, None);
    }

    #[test]
    fn test_cache_eviction() {
        let cache = InferenceCache::new(2, 60);

        cache.set("prompt1", "temp:0.7", "result1", 1);
        cache.set("prompt2", "temp:0.7", "result2", 1);
        cache.set("prompt3", "temp:0.7", "result3", 1); // 应该清除 prompt1

        assert_eq!(cache.get("prompt1", "temp:0.7"), None);
        assert_eq!(
            cache.get("prompt2", "temp:0.7"),
            Some(CachedInference {
                content: "result2".to_string(),
                token_count: 1,
            })
        );
        assert_eq!(
            cache.get("prompt3", "temp:0.7"),
            Some(CachedInference {
                content: "result3".to_string(),
                token_count: 1,
            })
        );
    }

    #[test]
    fn test_token_estimation() {
        use crate::chat::estimate_tokens;

        // 中文：约 1 token/字符
        let chinese = "你好世界";
        assert!(estimate_tokens(chinese) <= 5); // 应该接近 4

        // 英文：约 1 token/4 字符
        let english = "Hello world";
        assert!(estimate_tokens(english) <= 4); // 应该接近 3
    }

    #[test]
    fn test_truncate_messages() {
        use crate::backend::Message;
        use crate::chat::truncate_messages;

        let messages = vec![
            Message {
                role: "user".to_string(),
                content: "A".repeat(100),
            },
            Message {
                role: "assistant".to_string(),
                content: "B".repeat(100),
            },
            Message {
                role: "user".to_string(),
                content: "C".repeat(100),
            },
        ];

        let truncated = truncate_messages(&messages, 50); // 只能容纳约 1.5 条消息

        // 应该保留最新的 1-2 条消息
        assert!(truncated.len() <= 2);
        // 最后一条消息应该是用户
        assert_eq!(truncated.last().unwrap().role, "user");
    }
}
