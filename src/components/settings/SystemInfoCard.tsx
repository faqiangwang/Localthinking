import { SystemInfo, VirtualMemoryInfo } from '../../types';

interface SystemInfoCardProps {
  loading: boolean;
  systemInfo: SystemInfo | null;
  vmInfo: VirtualMemoryInfo | null;
}

export function SystemInfoCard({ loading, systemInfo, vmInfo }: SystemInfoCardProps) {
  return (
    <div className="settings-card">
      <h3>🖥️ 系统信息</h3>
      {loading ? (
        <div className="loading-placeholder">
          <span className="loading-spinner"></span>
          加载中...
        </div>
      ) : systemInfo ? (
        <div className="info-grid">
          <div className="info-box">
            <span className="info-label">CPU 线程</span>
            <span className="info-value">{systemInfo.n_threads}</span>
          </div>
          <div className="info-box">
            <span className="info-label">物理核心</span>
            <span className="info-value">{systemInfo.physical_cores}</span>
          </div>
          <div className="info-box">
            <span className="info-label">逻辑核心</span>
            <span className="info-value">{systemInfo.logical_cores}</span>
          </div>
          <div className="info-box">
            <span className="info-label">运行模式</span>
            <span className="info-value">{systemInfo.gpu_acceleration ? 'GPU' : 'CPU'}</span>
          </div>
        </div>
      ) : null}

      {vmInfo && (
        <div className="info-grid" style={{ marginTop: '12px' }}>
          <div className="info-box">
            <span className="info-label">物理内存</span>
            <span className="info-value">{(vmInfo.total_physical_mb / 1024).toFixed(1)} GB</span>
          </div>
          <div className="info-box">
            <span className="info-label">可用内存</span>
            <span className="info-value">
              {(vmInfo.available_physical_mb / 1024).toFixed(1)} GB
            </span>
          </div>
          <div className="info-box">
            <span className="info-label">页面文件</span>
            <span className="info-value">{vmInfo.paging_enabled ? '自动' : '手动'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
