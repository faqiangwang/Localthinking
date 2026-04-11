interface SettingsActionsProps {
  loaded: boolean;
  hasUnsavedChanges: boolean;
  saveError: string | null;
  settingsSaved: boolean;
  onSave: () => void;
  onResetSessions: () => void;
}

export function SettingsActions({
  loaded,
  hasUnsavedChanges,
  saveError,
  settingsSaved,
  onSave,
  onResetSessions,
}: SettingsActionsProps) {
  return (
    <>
      <div className="settings-actions">
        <button
          onClick={onSave}
          className="btn-save"
          disabled={!loaded || (!hasUnsavedChanges && !saveError)}
        >
          {settingsSaved ? '✓ 已保存' : '💾 保存所有设置'}
        </button>
        <button onClick={onResetSessions} className="btn-reset">
          🔄 重置所有会话
        </button>
      </div>
      {saveError && <div className="save-status error">{saveError.split('\n')[0]}</div>}
    </>
  );
}
