// src/components/Chat/DebugPanel/DebugPanel.tsx
// 调试面板组件

import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { ModelParams, Message } from '../../../types';
import { useChatStore } from '../../../store';
import styles from './DebugPanel.module.css';

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
  flash_attention: 'auto' | 'on' | 'off';
  estimated_memory_mb: number;
  cache: CacheStats;
}

interface DebugPanelProps {
  activeSessionId: string | null;
  modelLoaded: boolean;
  modelLoading: boolean;
  modelPath: string | null;
  modelParams: ModelParams;
  streaming: boolean;
  messages: Message[];
  tokPerSec: number;
  promptTokPerSec: number;
  firstTokenLatencyMs: number;
  promptTokenCount: number;
  tokenCount: number;
  modelError: string | null;
  chatError: string | null;
  onClose: () => void;
}

export function DebugPanel({
  activeSessionId,
  modelLoaded,
  modelLoading,
  modelPath,
  modelParams,
  streaming,
  messages,
  tokPerSec,
  promptTokPerSec,
  firstTokenLatencyMs,
  promptTokenCount,
  tokenCount,
  modelError,
  chatError,
  onClose,
}: DebugPanelProps) {
  const activeRequestId = useChatStore(state => state.activeRequestId);
  const [stats, setStats] = useState<PerformanceStats | null>(null);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const nextStats = await invoke<PerformanceStats>('get_performance_stats');
        setStats(nextStats);
      } catch {
        setStats(null);
      }
    };

    void loadStats();
    const interval = window.setInterval(() => {
      void loadStats();
    }, 5000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className={styles.debugPanel}>
      <div className={styles.debugHeader}>
        <h3>🐛 调试面板</h3>
        <button onClick={onClose} className={styles.closeBtn} title="关闭调试面板">
          ✕
        </button>
      </div>
      <div className={styles.debugSection}>
        <h4>状态信息</h4>
        <div className={styles.debugInfo}>
          <span>
            当前会话: <strong>{activeSessionId ?? '无'}</strong>
          </span>
          <span>
            请求 ID: <strong>{activeRequestId ?? '无'}</strong>
          </span>
          <span>
            模型已加载: <strong>{modelLoaded ? '✅' : '❌'}</strong>
          </span>
          <span>
            模型加载中: <strong>{modelLoading ? '⏳' : '否'}</strong>
          </span>
          <span>
            流式生成中: <strong>{streaming ? '✅' : '否'}</strong>
          </span>
          <span>
            消息数: <strong>{messages.length}</strong>
          </span>
          <span>
            TG速度: <strong>{tokPerSec.toFixed(1)} tok/s</strong>
          </span>
          <span>
            PP速度: <strong>{promptTokPerSec.toFixed(1)} tok/s</strong>
          </span>
          <span>
            首Token: <strong>{firstTokenLatencyMs.toFixed(0)} ms</strong>
          </span>
          <span>
            Prompt Tokens: <strong>{promptTokenCount}</strong>
          </span>
          <span>
            Token数: <strong>{tokenCount}</strong>
          </span>
        </div>
      </div>

      <div className={styles.debugSection}>
        <h4>运行参数</h4>
        <div className={styles.debugInfo}>
          <span>
            模型路径: <strong>{modelPath ?? '未加载'}</strong>
          </span>
          <span>
            Temperature: <strong>{modelParams.temperature.toFixed(2)}</strong>
          </span>
          <span>
            Top-P: <strong>{modelParams.top_p.toFixed(2)}</strong>
          </span>
          <span>
            Max Tokens: <strong>{modelParams.max_tokens}</strong>
          </span>
          <span>
            Context: <strong>{modelParams.ctx_size}</strong>
          </span>
          <span>
            Repeat: <strong>{modelParams.repeat_penalty.toFixed(2)}</strong>
          </span>
          <span>
            Flash Attention: <strong>{stats?.flash_attention ?? '未知'}</strong>
          </span>
        </div>
      </div>

      {stats && (
        <div className={styles.debugSection}>
          <h4>缓存与性能</h4>
          <div className={styles.debugInfo}>
            <span>
              线程: <strong>{stats.threads}</strong>
            </span>
            <span>
              上下文: <strong>{stats.context_size}</strong>
            </span>
            <span>
              缓存条目: <strong>{stats.cache.entries}</strong>
            </span>
            <span>
              缓存命中: <strong>{stats.cache.total_hits}</strong>
            </span>
            <span>
              平均命中: <strong>{stats.cache.avg_hits.toFixed(1)}</strong>
            </span>
          </div>
        </div>
      )}

      {/* 显示最后一条消息的内容 */}
      {messages.length > 0 && (
        <div className={styles.debugSection}>
          <h4>最后一条消息</h4>
          <div className={styles.debugMessagePreview}>
            <p>
              <strong>角色:</strong> {messages[messages.length - 1].role}
            </p>
            <p>
              <strong>内容:</strong> {messages[messages.length - 1].content.slice(0, 100)}
              {messages[messages.length - 1].content.length > 100 ? '...' : ''}
            </p>
            <p>
              <strong>长度:</strong> {messages[messages.length - 1].content.length} 字符
            </p>
          </div>
        </div>
      )}

      {modelError && (
        <div className={styles.debugSection}>
          <h4>模型错误</h4>
          <div className={styles.debugError}>{modelError}</div>
        </div>
      )}

      {chatError && (
        <div className={styles.debugSection}>
          <h4>聊天错误</h4>
          <div className={styles.debugError}>{chatError}</div>
        </div>
      )}

      <div className={styles.debugSection}>
        <h4>提示</h4>
        <div className={styles.debugHint}>
          <p>💡 按 F12 可以打开浏览器开发者工具查看详细日志</p>
          <p>💡 如果模型未加载，请前往「模型」页面加载模型</p>
          <p>💡 查看控制台是否有 "🔍 Token event received" 日志</p>
        </div>
      </div>
    </div>
  );
}
