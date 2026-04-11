// src-tauri/src/monitoring.rs
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// 性能指标
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct PerformanceMetrics {
    /// 推理开始时间
    pub start_time: Instant,
    /// 推理结束时间
    pub end_time: Option<Instant>,
    /// 生成 token 总数
    pub total_tokens: u32,
    /// 提示词 token 数（估算）
    pub prompt_tokens: u32,
    /// 完成 token 数
    pub completion_tokens: u32,
    /// 使用的线程数
    pub threads: u32,
    /// 上下文大小
    pub context_size: u32,
    /// 是否使用 GPU
    pub gpu_enabled: bool,
}

#[allow(dead_code)]
impl PerformanceMetrics {
    pub fn new(threads: u32, context_size: u32, gpu_enabled: bool) -> Self {
        Self {
            start_time: Instant::now(),
            end_time: None,
            total_tokens: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            threads,
            context_size,
            gpu_enabled,
        }
    }

    /// 完成推理
    pub fn finish(&mut self, prompt_tokens: u32, completion_tokens: u32) {
        self.end_time = Some(Instant::now());
        self.prompt_tokens = prompt_tokens;
        self.completion_tokens = completion_tokens;
        self.total_tokens = prompt_tokens + completion_tokens;
    }

    /// 获取推理耗时（毫秒）
    pub fn duration_ms(&self) -> f64 {
        let end = self.end_time.unwrap_or_else(Instant::now);
        end.duration_since(self.start_time).as_secs_f64() * 1000.0
    }

    /// 计算推理速度（tokens/秒）
    pub fn tokens_per_second(&self) -> f64 {
        let duration_sec = self.duration_ms() / 1000.0;
        if duration_sec > 0.0 {
            self.completion_tokens as f64 / duration_sec
        } else {
            0.0
        }
    }

    /// 获取内存占用估算（MB）
    pub fn estimate_memory_mb(&self) -> f64 {
        // 粗略估算：每个 token 约占用 2KB 内存（上下文 + KV cache）
        let context_memory = self.context_size as f64 * 2.0;
        // 模型参数内存（假设 7B Q4 模型约 4.5GB）
        let model_memory = if self.gpu_enabled { 1000.0 } else { 4500.0 };
        context_memory + model_memory
    }

    /// 获取详细的性能报告
    pub fn report(&self) -> String {
        format!(
            "推理性能报告:\n\
             - 耗时: {:.2} 秒\n\
             - 提示词 tokens: {}\n\
             - 完成 tokens: {}\n\
             - 总 tokens: {}\n\
             - 推理速度: {:.2} tokens/秒\n\
             - 配置: {} 线程, {} 上下文, {}\n\
             - 内存占用: {:.0} MB (估算)",
            self.duration_ms() / 1000.0,
            self.prompt_tokens,
            self.completion_tokens,
            self.total_tokens,
            self.tokens_per_second(),
            self.threads,
            self.context_size,
            if self.gpu_enabled { "GPU" } else { "CPU" },
            self.estimate_memory_mb()
        )
    }
}

/// 性能监控器
#[allow(dead_code)]
pub struct PerformanceMonitor {
    metrics: Arc<Mutex<Vec<PerformanceMetrics>>>,
    max_history: usize,
}

#[allow(dead_code)]
impl PerformanceMonitor {
    pub fn new(max_history: usize) -> Self {
        Self {
            metrics: Arc::new(Mutex::new(Vec::new())),
            max_history,
        }
    }

    /// 开始监控新的推理
    pub fn start_monitoring(&self, threads: u32, context_size: u32, gpu_enabled: bool) -> String {
        let metrics = PerformanceMetrics::new(threads, context_size, gpu_enabled);
        let id = format!("{:?}", metrics.start_time);

        let mut history = self.metrics.lock().unwrap();
        history.push(metrics);

        // 限制历史记录数量
        if history.len() > self.max_history {
            history.remove(0);
        }

        id.clone()
    }

    /// 更新推理指标
    pub fn update_metrics(&self, id: &str, prompt_tokens: u32, completion_tokens: u32) {
        let history = self.metrics.lock().unwrap();

        // 简单的 ID 匹配（实际应该用更好的方式）
        for metrics in history.iter() {
            if format!("{:?}", metrics.start_time) == *id {
                drop(history);
                let mut metrics = self.metrics.lock().unwrap();
                if let Some(m) = metrics
                    .iter_mut()
                    .find(|m| format!("{:?}", m.start_time) == *id)
                {
                    m.finish(prompt_tokens, completion_tokens);
                    eprintln!("[性能] {}", m.report());
                }
                break;
            }
        }
    }

    /// 获取平均推理速度
    pub fn average_speed(&self) -> f64 {
        let history = self.metrics.lock().unwrap();
        if history.is_empty() {
            return 0.0;
        }

        let speeds: Vec<f64> = history
            .iter()
            .filter(|m| m.end_time.is_some())
            .map(|m| m.tokens_per_second())
            .collect();

        if speeds.is_empty() {
            return 0.0;
        }

        speeds.iter().sum::<f64>() / speeds.len() as f64
    }

    /// 获取最近的性能指标
    pub fn get_recent_metrics(&self, count: usize) -> Vec<PerformanceMetrics> {
        let history = self.metrics.lock().unwrap();
        let start = if history.len() > count {
            history.len() - count
        } else {
            0
        };
        history[start..].to_vec()
    }

    /// 清空历史记录
    pub fn clear(&self) {
        let mut history = self.metrics.lock().unwrap();
        history.clear();
    }
}

/// 系统资源监控
#[allow(dead_code)]
pub struct ResourceMonitor {
    last_check: Arc<Mutex<Instant>>,
}

#[allow(dead_code)]
impl ResourceMonitor {
    pub fn new() -> Self {
        Self {
            last_check: Arc::new(Mutex::new(Instant::now())),
        }
    }

    /// 获取当前内存使用情况
    pub fn get_memory_info(&self) -> MemoryInfo {
        // 使用 sysinfo crate 获取内存信息
        // 这里简化为返回估算值
        MemoryInfo {
            total_mb: 16384, // 16GB
            used_mb: 8192,   // 8GB
            available_mb: 8192,
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct MemoryInfo {
    pub total_mb: u64,
    pub used_mb: u64,
    pub available_mb: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_performance_metrics() {
        let mut metrics = PerformanceMetrics::new(8, 2048, false);
        std::thread::sleep(Duration::from_millis(1));
        metrics.finish(100, 200);

        assert_eq!(metrics.total_tokens, 300);
        assert!(metrics.duration_ms() >= 0.0);
        assert!(metrics.tokens_per_second() > 0.0);
    }

    #[test]
    fn test_performance_monitor() {
        let monitor = PerformanceMonitor::new(10);

        monitor.start_monitoring(8, 2048, false);
        monitor.start_monitoring(8, 2048, false);

        let metrics = monitor.get_recent_metrics(2);
        assert_eq!(metrics.len(), 2);
    }

    #[test]
    fn test_average_speed() {
        let monitor = PerformanceMonitor::new(10);

        let id1 = monitor.start_monitoring(8, 2048, false);
        monitor.update_metrics(&id1, 100, 200);

        let id2 = monitor.start_monitoring(8, 2048, false);
        monitor.update_metrics(&id2, 100, 100);

        let avg = monitor.average_speed();
        assert!(avg > 0.0);
    }
}
