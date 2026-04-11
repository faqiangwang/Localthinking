import { PerformanceMonitor } from '../PerformanceMonitor';

export function PerformanceCard() {
  return (
    <div className="settings-card">
      <h3>⚡ 性能监控</h3>
      <PerformanceMonitor />
    </div>
  );
}
