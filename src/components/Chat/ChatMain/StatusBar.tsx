// src/components/Chat/ChatMain/StatusBar.tsx
// 状态栏组件

import styles from './StatusBar.module.css';

interface StatusBarProps {
  streaming: boolean;
  tokPerSec: number;
  tokenCount: number;
  onStop: () => void;
}

export function StatusBar({ streaming, tokPerSec, tokenCount, onStop }: StatusBarProps) {
  if (!streaming) return null;

  return (
    <div className={styles.statusBar}>
      <span>{tokPerSec > 0 ? `${tokPerSec.toFixed(1)} tok/s` : '思考中...'}</span>
      {tokenCount > 0 && <span>{tokenCount} tokens</span>}
      <button type="button" onClick={onStop} className={styles.stopBtn}>
        停止
      </button>
    </div>
  );
}
