// src/components/Chat/DebugPanel/DebugPanel.tsx
// 调试面板组件

import { Message } from '../../../types';
import styles from './DebugPanel.module.css';

interface DebugPanelProps {
  modelLoaded: boolean;
  modelLoading: boolean;
  streaming: boolean;
  messages: Message[];
  tokPerSec: number;
  tokenCount: number;
  modelError: string | null;
  chatError: string | null;
  onClose: () => void;
}

export function DebugPanel({
  modelLoaded,
  modelLoading,
  streaming,
  messages,
  tokPerSec,
  tokenCount,
  modelError,
  chatError,
  onClose,
}: DebugPanelProps) {
  return (
    <div className={styles.debugPanel}>
      <div className={styles.debugHeader}>
        <h3>🐛 调试面板</h3>
        <button
          onClick={onClose}
          className={styles.closeBtn}
          title="关闭调试面板"
        >
          ✕
        </button>
      </div>
      <div className={styles.debugSection}>
        <h4>状态信息</h4>
        <div className={styles.debugInfo}>
          <span>模型已加载: <strong>{modelLoaded ? '✅' : '❌'}</strong></span>
          <span>模型加载中: <strong>{modelLoading ? '⏳' : '否'}</strong></span>
          <span>流式生成中: <strong>{streaming ? '✅' : '否'}</strong></span>
          <span>消息数: <strong>{messages.length}</strong></span>
          <span>速度: <strong>{tokPerSec.toFixed(1)} tok/s</strong></span>
          <span>Token数: <strong>{tokenCount}</strong></span>
        </div>
      </div>

      {/* 显示最后一条消息的内容 */}
      {messages.length > 0 && (
        <div className={styles.debugSection}>
          <h4>最后一条消息</h4>
          <div className={styles.debugMessagePreview}>
            <p><strong>角色:</strong> {messages[messages.length - 1].role}</p>
            <p>
              <strong>内容:</strong> {messages[messages.length - 1].content.slice(0, 100)}
              {messages[messages.length - 1].content.length > 100 ? '...' : ''}
            </p>
            <p><strong>长度:</strong> {messages[messages.length - 1].content.length} 字符</p>
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
