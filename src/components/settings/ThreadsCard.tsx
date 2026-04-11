interface ThreadsCardProps {
  threads: number;
  maxThreads: number;
  onThreadsChange: (value: number) => void;
  onApply: () => void;
}

export function ThreadsCard({ threads, maxThreads, onThreadsChange, onApply }: ThreadsCardProps) {
  return (
    <div className="settings-card">
      <h3>🔧 推理线程数</h3>
      <p className="hint">建议 2-4 核，线程越多速度越快但占用内存越高</p>
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
