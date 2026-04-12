// src/components/Chat/ChatMain/StatusBar.tsx
// 状态栏组件

import styles from './StatusBar.module.css';

interface StatusBarProps {
  streaming: boolean;
  tokPerSec: number;
  promptTokPerSec: number;
  firstTokenLatencyMs: number;
  promptTokenCount: number;
  tokenCount: number;
  onStop: () => void;
}

export function StatusBar({
  streaming,
  tokPerSec,
  promptTokPerSec,
  firstTokenLatencyMs,
  promptTokenCount,
  tokenCount,
  onStop,
}: StatusBarProps) {
  if (!streaming) return null;

  return (
    <div className={styles.statusBar}>
      <span>
        {tokPerSec > 0
          ? `TG ${tokPerSec.toFixed(1)} tok/s`
          : promptTokenCount > 0
            ? `PP处理中...`
            : '思考中...'}
      </span>
      {promptTokPerSec > 0 && <span>{`PP ${promptTokPerSec.toFixed(1)} tok/s`}</span>}
      {firstTokenLatencyMs > 0 && <span>{`首 token ${firstTokenLatencyMs.toFixed(0)} ms`}</span>}
      {promptTokenCount > 0 && <span>{`Prompt ${promptTokenCount} tokens`}</span>}
      {tokenCount > 0 && <span>{tokenCount} tokens</span>}
      <button type="button" onClick={onStop} className={styles.stopBtn}>
        停止
      </button>
    </div>
  );
}
