// src/components/PerformanceMonitor.tsx
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import styles from './PerformanceMonitor.module.css';

interface CacheStats {
  entries: number;
  total_hits: number;
  max_size: number;
  avg_hits: number;
  ttl_seconds: number;
}

interface PerformanceStats {
  threads: number;
  context_size: number;
  gpu_layers: number;
  gpu_enabled: boolean;
  estimated_memory_mb: number;
  cache: CacheStats;
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
  const [clearingCache, setClearingCache] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    loadPerformanceData();
    // 每 5 秒更新一次
    const interval = setInterval(loadPerformanceData, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadPerformanceData = async () => {
    try {
      const [statsData, suggestionsData] = await Promise.all([
        invoke<PerformanceStats>('get_performance_stats'),
        invoke<OptimizationSuggestions>('get_optimization_suggestions'),
      ]);
      setStats(statsData);
      setSuggestions(suggestionsData);
    } catch (error) {
      console.error('加载性能数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (mb: number): string => {
    if (mb < 1024) return `${mb.toFixed(0)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  };

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${remainingSeconds} 秒`;
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    setActionMessage(null);

    try {
      await invoke('clear_inference_cache');
      setActionMessage('推理缓存已清空');
      await loadPerformanceData();
    } catch (error) {
      setActionMessage(String(error));
    } finally {
      setClearingCache(false);
    }
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
            <span className={styles.value}>{stats.gpu_enabled ? '✅ 已启用' : '❌ 未启用'}</span>
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

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h4>缓存状态</h4>
          <button
            type="button"
            className={styles.clearButton}
            onClick={handleClearCache}
            disabled={clearingCache || stats.cache.entries === 0}
          >
            {clearingCache ? '清理中...' : '清理缓存'}
          </button>
        </div>
        <div className={styles.grid}>
          <div className={styles.metric}>
            <span className={styles.label}>缓存条目</span>
            <span className={styles.value}>{stats.cache.entries}</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.label}>累计命中</span>
            <span className={styles.value}>{stats.cache.total_hits}</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.label}>平均命中</span>
            <span className={styles.value}>{stats.cache.avg_hits.toFixed(1)}</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.label}>缓存时长</span>
            <span className={styles.value}>{formatDuration(stats.cache.ttl_seconds)}</span>
          </div>
        </div>
        {actionMessage && <div className={styles.actionMessage}>{actionMessage}</div>}
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
