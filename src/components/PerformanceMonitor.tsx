// src/components/PerformanceMonitor.tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import styles from "./PerformanceMonitor.module.css";

interface PerformanceStats {
  threads: number;
  context_size: number;
  gpu_layers: number;
  gpu_enabled: boolean;
  estimated_memory_mb: number;
}

interface OptimizationSuggestions {
  suggestions: string[];
  current_config: {
    threads: number;
    context_size: number;
    gpu_layers: number;
    physical_cores: number;
  };
}

export function PerformanceMonitor() {
  const [stats, setStats] = useState<PerformanceStats | null>(null);
  const [suggestions, setSuggestions] = useState<OptimizationSuggestions | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPerformanceData();
    // 每 5 秒更新一次
    const interval = setInterval(loadPerformanceData, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadPerformanceData = async () => {
    try {
      const [statsData, suggestionsData] = await Promise.all([
        invoke<PerformanceStats>("get_performance_stats"),
        invoke<OptimizationSuggestions>("get_optimization_suggestions"),
      ]);
      setStats(statsData);
      setSuggestions(suggestionsData);
    } catch (error) {
      console.error("加载性能数据失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (mb: number): string => {
    if (mb < 1024) return `${mb.toFixed(0)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  };

  if (loading) {
    return (
      <div className={styles.performanceMonitor}>
        <h3>性能监控</h3>
        <div className={styles.loading}>加载中...</div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className={styles.performanceMonitor}>
        <h3>性能监控</h3>
        <div className={styles.error}>无法加载性能数据</div>
      </div>
    );
  }

  return (
    <div className={styles.performanceMonitor}>
      <h3>⚡ 性能监控</h3>

      {/* 当前配置 */}
      <div className={styles.section}>
        <h4>当前配置</h4>
        <div className={styles.grid}>
          <div className={styles.metric}>
            <span className={styles.label}>线程数</span>
            <span className={styles.value}>{stats.threads}</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.label}>上下文大小</span>
            <span className={styles.value}>{stats.context_size}</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.label}>GPU 层数</span>
            <span className={styles.value}>{stats.gpu_layers}</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.label}>GPU 状态</span>
            <span className={styles.value}>
              {stats.gpu_enabled ? "✅ 已启用" : "❌ 未启用"}
            </span>
          </div>
        </div>
      </div>

      {/* 资源使用 */}
      <div className={styles.section}>
        <h4>资源使用</h4>
        <div className={styles.resourceBar}>
          <span className={styles.label}>内存占用</span>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${(stats.estimated_memory_mb / 16384) * 100}%` }}
            />
          </div>
          <span className={styles.value}>{formatBytes(stats.estimated_memory_mb)}</span>
        </div>
      </div>

      {/* 优化建议 */}
      {suggestions && suggestions.suggestions.length > 0 && (
        <div className={styles.section}>
          <h4>💡 优化建议</h4>
          <ul className={styles.suggestionsList}>
            {suggestions.suggestions.map((suggestion, index) => (
              <li key={index} className={styles.suggestionItem}>
                {suggestion}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
