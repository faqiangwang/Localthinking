import { useCallback } from "react";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../types";
import { useSettingsStore } from "../store";

export function useSettings() {
  const {
    settings,
    loaded,
    error,
    updateSettings,
    updateParam,
    updateSystemPrompt,
    resetToDefaults,
  } = useSettingsStore();

  const saveSettings = useCallback((newSettings: AppSettings) => {
    updateSettings(newSettings);
  }, [updateSettings]);

  const persist = useCallback(() => {
    // Zustand persist middleware handles storage writes automatically.
  }, []);

  return {
    settings,
    loaded,
    error,
    saveSettings,
    updateParam,
    updateSystemPrompt,
    resetToDefaults,
    persist,
    DEFAULT_SETTINGS: DEFAULT_APP_SETTINGS,
  };
}
