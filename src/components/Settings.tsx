// src/components/Settings.tsx - 重新设计的设置页面
import { useState, useEffect } from 'react';
import { ModelParams, AppSettings, cloneAppSettings } from '../types';
import { useSettingsRuntime } from '../hooks/useSettingsRuntime';
import { useSettingsStore } from '../store';
import { useChatStore } from '../store/chatStore';
import './Settings.css';
import {
  AboutCard,
  ApiServiceCard,
  ModelParamsCard,
  PerformanceCard,
  SettingsActions,
  SystemInfoCard,
  SystemPromptCard,
  ThreadsCard,
  VirtualMemoryCard,
} from './settings/index';

// 版本号
const APP_VERSION = '0.1.0';

export function Settings() {
  const { settings, loaded, error: settingsError, updateSettings } = useSettingsStore();
  const clearAllSessions = useChatStore(state => state.clearAllSessions);

  const [draftSettings, setDraftSettings] = useState<AppSettings>(() => cloneAppSettings());

  const params = draftSettings.model_params;
  const systemPrompt = draftSettings.system_prompt;
  const flashAttention = draftSettings.flash_attention;
  const apiEnabled = draftSettings.api_enabled;
  const apiPort = draftSettings.api_port;

  const updateDraftSettings = (updates: Partial<AppSettings>) => {
    setDraftSettings(prev => ({
      ...prev,
      ...updates,
      model_params: updates.model_params
        ? {
            ...prev.model_params,
            ...updates.model_params,
          }
        : prev.model_params,
    }));
  };

  const updateDraftParam = <K extends keyof ModelParams>(key: K, value: ModelParams[K]) => {
    setDraftSettings(prev => ({
      ...prev,
      model_params: {
        ...prev.model_params,
        [key]: value,
      },
    }));
  };

  const {
    threads,
    setThreads,
    settingsSaved,
    saveError,
    systemInfo,
    sysInfoLoading,
    vmInfo,
    vmLoading,
    vmMessage,
    hasUnsavedChanges,
    saveSettings,
    resetAllSessions,
    applyThreads,
    toggleApi,
    handleSetVm,
    handleEnableAutoVm,
  } = useSettingsRuntime({
    settings,
    draftSettings,
    updateSettings,
    updateDraftSettings,
    clearAllSessions,
  });

  // 同步统一设置 store 到页面草稿
  useEffect(() => {
    if (!loaded) {
      return;
    }

    setDraftSettings(cloneAppSettings(settings));
  }, [loaded, settings]);

  return (
    <div className="settings-container">
      <h2>⚙️ 设置</h2>

      {settingsError && (
        <div className="settings-card">
          <p className="hint">{settingsError}</p>
        </div>
      )}

      <SystemInfoCard loading={sysInfoLoading} systemInfo={systemInfo} vmInfo={vmInfo} />

      <ThreadsCard
        threads={threads}
        physicalCores={systemInfo?.physical_cores ?? 4}
        logicalCores={systemInfo?.logical_cores ?? 8}
        maxThreads={systemInfo?.logical_cores ?? 8}
        onThreadsChange={setThreads}
        onApply={applyThreads}
      />

      <ModelParamsCard
        params={params}
        flashAttention={flashAttention}
        onParamChange={updateDraftParam}
        onFlashAttentionChange={value => updateDraftSettings({ flash_attention: value })}
      />

      <VirtualMemoryCard
        vmLoading={vmLoading}
        vmMessage={vmMessage}
        onEnableAuto={handleEnableAutoVm}
        onSetRecommended={handleSetVm}
      />

      <PerformanceCard />

      <SystemPromptCard
        systemPrompt={systemPrompt}
        onSystemPromptChange={(value: string) => updateDraftSettings({ system_prompt: value })}
        onPresetSelect={(prompt: string) => updateDraftSettings({ system_prompt: prompt })}
      />

      <ApiServiceCard
        apiEnabled={apiEnabled}
        apiPort={apiPort}
        onToggleApi={toggleApi}
        onApiPortChange={(port: number) => updateDraftSettings({ api_port: port })}
      />

      <SettingsActions
        loaded={loaded}
        hasUnsavedChanges={hasUnsavedChanges}
        saveError={saveError}
        settingsSaved={settingsSaved}
        onSave={saveSettings}
        onResetSessions={resetAllSessions}
      />

      <AboutCard version={APP_VERSION} />
    </div>
  );
}
