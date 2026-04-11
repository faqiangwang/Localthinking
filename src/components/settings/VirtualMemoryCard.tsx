interface VirtualMemoryCardProps {
  vmLoading: boolean;
  vmMessage: string | null;
  onEnableAuto: () => void;
  onSetRecommended: () => void;
}

export function VirtualMemoryCard({
  vmLoading,
  vmMessage,
  onEnableAuto,
  onSetRecommended,
}: VirtualMemoryCardProps) {
  return (
    <div className="settings-card">
      <h3>💾 虚拟内存</h3>
      <p className="hint">建议启用自动管理或设置为物理内存的 1-2 倍大小</p>
      <div className="vm-buttons">
        <button onClick={onEnableAuto} className="btn-secondary" disabled={vmLoading}>
          {vmLoading ? '处理中...' : '启用自动管理'}
        </button>
        <button onClick={onSetRecommended} className="btn-secondary" disabled={vmLoading}>
          {vmLoading ? '处理中...' : '推荐 8GB-16GB'}
        </button>
      </div>
      {vmMessage && <div className="vm-message">{vmMessage}</div>}
    </div>
  );
}
