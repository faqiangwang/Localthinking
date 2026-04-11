import { API_CONFIG } from '../../types';

interface ApiServiceCardProps {
  apiEnabled: boolean;
  apiPort: number;
  onToggleApi: () => void;
  onApiPortChange: (port: number) => void;
}

export function ApiServiceCard({
  apiEnabled,
  apiPort,
  onToggleApi,
  onApiPortChange,
}: ApiServiceCardProps) {
  return (
    <div className="settings-card">
      <h3>🌐 API 服务</h3>
      <div className="api-toggle">
        <label className="toggle">
          <input type="checkbox" checked={apiEnabled} onChange={onToggleApi} />
          <span className="toggle-slider"></span>
        </label>
        <span>{apiEnabled ? '已启用' : '已禁用'}</span>
      </div>
      <p className="hint">启用后可使用 OpenAI 兼容接口访问本地模型</p>
      <div className="api-port-row">
        <label htmlFor="api-port-input">端口</label>
        <input
          id="api-port-input"
          type="number"
          min={API_CONFIG.MIN_PORT}
          max={API_CONFIG.MAX_PORT}
          value={apiPort}
          onChange={e => {
            const nextPort = parseInt(e.target.value, 10);
            onApiPortChange(Number.isNaN(nextPort) ? API_CONFIG.DEFAULT_PORT : nextPort);
          }}
        />
      </div>
      <div className="api-endpoint">
        <code>POST http://127.0.0.1:{apiPort}/v1/chat/completions</code>
      </div>
    </div>
  );
}
