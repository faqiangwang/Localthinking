// src/store/settingsStore.ts
// 设置状态管理 - Zustand

import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import {
  type AppSettings,
  type AppSettingsPatch,
  DEFAULT_APP_SETTINGS,
  LEGACY_STORAGE_KEYS,
  STORAGE_KEYS,
  cloneAppSettings,
  mergeAppSettings,
  normalizeAppSettings,
} from '../types';

const SETTINGS_STORE_VERSION = 1;

interface SettingsStore {
  // 状态
  settings: AppSettings;
  loaded: boolean;
  error: string | null;

  // Actions
  finishHydration: (error?: string | null) => void;
  updateSettings: (settings: AppSettingsPatch) => void;
  updateParam: <K extends keyof AppSettings['model_params']>(
    key: K,
    value: AppSettings['model_params'][K]
  ) => void;
  updateSystemPrompt: (prompt: string) => void;
  resetToDefaults: () => void;
  clearError: () => void;
}

const settingsStorage: StateStorage = {
  getItem: (name) => {
    const current = localStorage.getItem(name);
    if (current) {
      return current;
    }

    const legacy = localStorage.getItem(LEGACY_STORAGE_KEYS.SETTINGS);
    if (!legacy) {
      return null;
    }

    try {
      const migrated = JSON.stringify({
        state: {
          settings: normalizeAppSettings(JSON.parse(legacy)),
          loaded: true,
          error: null,
        },
        version: SETTINGS_STORE_VERSION,
      });

      localStorage.setItem(name, migrated);
      localStorage.removeItem(LEGACY_STORAGE_KEYS.SETTINGS);
      return migrated;
    } catch {
      localStorage.removeItem(LEGACY_STORAGE_KEYS.SETTINGS);
      return null;
    }
  },
  setItem: (name, value) => {
    localStorage.setItem(name, value);
    localStorage.removeItem(LEGACY_STORAGE_KEYS.SETTINGS);
  },
  removeItem: (name) => {
    localStorage.removeItem(name);
    localStorage.removeItem(LEGACY_STORAGE_KEYS.SETTINGS);
  },
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      // 初始状态
      settings: cloneAppSettings(DEFAULT_APP_SETTINGS),
      loaded: false,
      error: null,

      finishHydration: (error) =>
        set((state) => ({
          loaded: true,
          error: error ?? state.error,
          settings: error ? cloneAppSettings(DEFAULT_APP_SETTINGS) : state.settings,
        })),

      // 更新设置
      updateSettings: (newSettings) =>
        set((state) => ({
          settings: mergeAppSettings(state.settings, newSettings),
          error: null,
        })),

      // 更新单个参数
      updateParam: (key, value) =>
        set((state) => ({
          settings: mergeAppSettings(state.settings, {
            model_params: {
              [key]: value,
            },
          }),
          error: null,
        })),

      // 更新系统提示词
      updateSystemPrompt: (prompt) =>
        set((state) => ({
          settings: mergeAppSettings(state.settings, {
            system_prompt: prompt,
          }),
          error: null,
        })),

      // 重置为默认设置
      resetToDefaults: () =>
        set({
          settings: cloneAppSettings(DEFAULT_APP_SETTINGS),
          error: null,
        }),

      // 清除错误
      clearError: () => set({ error: null }),
    }),
    {
      name: STORAGE_KEYS.SETTINGS,
      version: SETTINGS_STORE_VERSION,
      storage: createJSONStorage(() => settingsStorage),
      partialize: (state) => ({
        settings: state.settings,
      }),
      migrate: (persistedState) => {
        const state = persistedState as Partial<SettingsStore> | undefined;
        return {
          settings: normalizeAppSettings(state?.settings),
          loaded: true,
          error: null,
        };
      },
      onRehydrateStorage: () => (state, error) => {
        state?.finishHydration(error ? '设置加载失败，已恢复默认值。' : null);
      },
    }
  )
);
