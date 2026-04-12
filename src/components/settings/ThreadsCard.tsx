interface ThreadsCardProps {
  threads: number;
  physicalCores: number;
  logicalCores: number;
  maxThreads: number;
  onThreadsChange: (value: number) => void;
  onApply: () => void;
}

export function ThreadsCard({
  threads,
  physicalCores,
  logicalCores,
  maxThreads,
  onThreadsChange,
  onApply,
}: ThreadsCardProps) {
  return (
    <div className="settings-card">
      <h3>🔧 推理线程数</h3>
      <p className="hint">
        建议先设为物理核心数 {physicalCores}，如果机器有空闲再上探到逻辑核心数 {logicalCores}
      </p>
      <div className="slider-control">
        <input
          type="range"
          min={1}
          max={maxThreads}
          value={threads}
          onChange={e => onThreadsChange(parseInt(e.target.value, 10))}
        />
        <span className="slider-badge">{threads} 核</span>
      </div>
      <button onClick={onApply} className="btn-primary">
        应用设置
      </button>
    </div>
  );
}
