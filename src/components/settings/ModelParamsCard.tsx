import { AppSettings, ModelParams } from '../../types';

interface ModelParamsCardProps {
  params: ModelParams;
  flashAttention: AppSettings['flash_attention'];
  onParamChange: <K extends keyof ModelParams>(key: K, value: ModelParams[K]) => void;
  onFlashAttentionChange: (value: AppSettings['flash_attention']) => void;
}

export function ModelParamsCard({
  params,
  flashAttention,
  onParamChange,
  onFlashAttentionChange,
}: ModelParamsCardProps) {
  return (
    <div className="settings-card">
      <h3>📐 模型参数</h3>

      <div className="param-item">
        <div className="param-header">
          <span>Temperature (创造性)</span>
          <span className="param-value">{params.temperature.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={params.temperature * 100}
          onChange={e => onParamChange('temperature', parseInt(e.target.value, 10) / 100)}
        />
        <div className="param-range">
          <span>确定</span>
          <span>创造</span>
        </div>
      </div>

      <div className="param-item">
        <div className="param-header">
          <span>Top-P (采样)</span>
          <span className="param-value">{params.top_p.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={params.top_p * 100}
          onChange={e => onParamChange('top_p', parseInt(e.target.value, 10) / 100)}
        />
      </div>

      <div className="param-item">
        <div className="param-header">
          <span>Repeat Penalty</span>
          <span className="param-value">{params.repeat_penalty.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="100"
          max="150"
          value={params.repeat_penalty * 100}
          onChange={e => onParamChange('repeat_penalty', parseInt(e.target.value, 10) / 100)}
        />
      </div>

      <div className="param-item">
        <div className="param-header">
          <span>Max Tokens</span>
          <span className="param-value">{params.max_tokens}</span>
        </div>
        <input
          type="range"
          min="32"
          max="2048"
          step="32"
          value={params.max_tokens}
          onChange={e => onParamChange('max_tokens', parseInt(e.target.value, 10))}
        />
      </div>

      <div className="param-item">
        <div className="param-header">
          <span>Context Size</span>
          <span className="param-value">{params.ctx_size}</span>
        </div>
        <input
          type="range"
          min="512"
          max="8192"
          step="256"
          value={params.ctx_size}
          onChange={e => onParamChange('ctx_size', parseInt(e.target.value, 10))}
        />
        <div className="param-range">
          <span>更省内存</span>
          <span>更长上下文</span>
        </div>
      </div>

      <div className="param-item">
        <div className="param-header">
          <span>Flash Attention</span>
          <span className="param-value">{flashAttention}</span>
        </div>
        <select
          value={flashAttention}
          onChange={e => onFlashAttentionChange(e.target.value as AppSettings['flash_attention'])}
        >
          <option value="auto">Auto</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
        <div className="param-range">
          <span>建议 GPU/Metal 保持 Auto 或 On</span>
        </div>
      </div>
    </div>
  );
}
