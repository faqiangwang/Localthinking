import { PROMPT_CATEGORIES } from '../settingsPrompts';

interface SystemPromptCardProps {
  systemPrompt: string;
  onSystemPromptChange: (value: string) => void;
  onPresetSelect: (prompt: string) => void;
}

export function SystemPromptCard({
  systemPrompt,
  onSystemPromptChange,
  onPresetSelect,
}: SystemPromptCardProps) {
  return (
    <div className="settings-card">
      <h3>💬 系统提示词</h3>
      <p className="hint">定义 AI 助手的专业领域和回复风格</p>
      <textarea
        value={systemPrompt}
        onChange={e => onSystemPromptChange(e.target.value)}
        placeholder="定义 AI 助手的角色..."
        rows={4}
      />

      <div className="prompt-categories">
        {PROMPT_CATEGORIES.map(category => (
          <div key={category.title} className="prompt-category">
            <h4>{category.title}</h4>
            <div className="preset-buttons">
              {category.presets.map(preset => (
                <button key={preset.label} onClick={() => onPresetSelect(preset.prompt)}>
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
