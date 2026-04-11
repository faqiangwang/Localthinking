import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type AppSettings, type SystemInfo, type VirtualMemoryInfo, STORAGE_KEYS } from '../types';

interface UseSettingsRuntimeArgs {
  settings: AppSettings;
  draftSettings: AppSettings;
  updateSettings: (settings: AppSettings) => void;
  updateDraftSettings: (updates: Partial<AppSettings>) => void;
  clearAllSessions: () => void;
}

export function useSettingsRuntime({
  settings,
  draftSettings,
  updateSettings,
  updateDraftSettings,
  clearAllSessions,
}: UseSettingsRuntimeArgs) {
  const [threads, setThreads] = useState(4);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [sysInfoLoading, setSysInfoLoading] = useState(true);
  const [vmInfo, setVmInfo] = useState<VirtualMemoryInfo | null>(null);
  const [vmLoading, setVmLoading] = useState(false);
  const [vmMessage, setVmMessage] = useState<string | null>(null);

  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(draftSettings) !== JSON.stringify(settings),
    [draftSettings, settings]
  );

  const refreshSystemInfo = useCallback(async (withLoading = false): Promise<SystemInfo | null> => {
    if (withLoading) {
      setSysInfoLoading(true);
    }

    try {
      const info = await invoke<SystemInfo>('system_info');
      setSystemInfo(info);
      setThreads(info.n_threads);
      return info;
    } catch (error) {
      console.warn('获取系统信息失败:', error);
      return null;
    } finally {
      if (withLoading) {
        setSysInfoLoading(false);
      }
    }
  }, []);

  const refreshVirtualMemoryInfo = useCallback(async (): Promise<VirtualMemoryInfo | null> => {
    try {
      const info = await invoke<VirtualMemoryInfo>('get_virtual_memory_info');
      setVmInfo(info);
      return info;
    } catch (error) {
      console.warn('获取虚拟内存信息失败:', error);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!settingsSaved) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSettingsSaved(false);
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [settingsSaved]);

  useEffect(() => {
    if (hasUnsavedChanges && settingsSaved) {
      setSettingsSaved(false);
    }
  }, [hasUnsavedChanges, settingsSaved]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshSystemInfo(true);
    }, 800);

    return () => window.clearTimeout(timer);
  }, [refreshSystemInfo]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshVirtualMemoryInfo();
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [refreshVirtualMemoryInfo]);

  const saveSettings = useCallback(() => {
    setSaveError(null);

    const applyRuntimeSettings = async () => {
      if (draftSettings.model_params.ctx_size !== settings.model_params.ctx_size) {
        await invoke('set_context_size', { size: draftSettings.model_params.ctx_size });
      }

      if (draftSettings.api_port !== settings.api_port) {
        await invoke('set_api_port', { port: draftSettings.api_port });
      }
    };

    void applyRuntimeSettings()
      .then(() => {
        updateSettings(draftSettings);
        setSettingsSaved(true);
      })
      .catch(error => {
        setSettingsSaved(false);
        setSaveError(String(error));
      });
  }, [draftSettings, settings.api_port, settings.model_params.ctx_size, updateSettings]);

  const resetAllSessions = useCallback(() => {
    if (window.confirm('确定要删除所有会话吗？这将清除所有对话历史，但会保留你的设置。')) {
      invoke('stop_generation').catch(() => {});
      clearAllSessions();
      localStorage.removeItem(STORAGE_KEYS.CHAT_STORE);
      localStorage.removeItem(STORAGE_KEYS.SESSIONS);
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSION);
      setSaveError(null);
    }
  }, [clearAllSessions]);

  const applyThreads = useCallback(async () => {
    try {
      setSaveError(null);
      await invoke('set_threads', { n: threads });
      await refreshSystemInfo();
    } catch (error) {
      setSaveError(String(error));
    }
  }, [refreshSystemInfo, threads]);

  const toggleApi = useCallback(async () => {
    const nextEnabled = !draftSettings.api_enabled;

    try {
      setSaveError(null);
      await invoke('set_api_enabled', { enabled: nextEnabled });
      updateDraftSettings({ api_enabled: nextEnabled });
      updateSettings({
        ...draftSettings,
        api_enabled: nextEnabled,
      });
      setSettingsSaved(true);
    } catch (error) {
      setSaveError(String(error));
    }
  }, [draftSettings, updateDraftSettings, updateSettings]);

  const handleSetVm = useCallback(async () => {
    setVmLoading(true);
    setVmMessage(null);

    try {
      await invoke('set_virtual_memory', {
        config: { initial_mb: 8192, maximum_mb: 16384 },
      });
      await refreshVirtualMemoryInfo();
      setVmMessage('虚拟内存已设置，需要重启电脑生效');
    } catch (error) {
      setVmMessage(String(error));
    } finally {
      setVmLoading(false);
    }
  }, [refreshVirtualMemoryInfo]);

  const handleEnableAutoVm = useCallback(async () => {
    setVmLoading(true);
    setVmMessage(null);

    try {
      await invoke('enable_auto_virtual_memory');
      await refreshVirtualMemoryInfo();
      setVmMessage('已启用自动管理，需要重启电脑生效');
    } catch (error) {
      setVmMessage(String(error));
    } finally {
      setVmLoading(false);
    }
  }, [refreshVirtualMemoryInfo]);

  return {
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
  };
}
