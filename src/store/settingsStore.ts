// src/store/settingsStore.ts
// 设置状态管理 - Zustand

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { AppSettings, DEFAULT_APP_SETTINGS } from '../types';

interface SettingsStore {
  // 状态
  settings: AppSettings;
  loaded: boolean;
  error: string | null;

  // Actions
  updateSettings: (settings: Partial<AppSettings>) => void;
  updateParam: <K extends keyof AppSettings['model_params']>(
    key: K,
    value: AppSettings['model_params'][K]
  ) => void;
  updateSystemPrompt: (prompt: string) => void;
  resetToDefaults: () => void;
  clearError: () => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      // 初始状态
      settings: DEFAULT_APP_SETTINGS,
      loaded: true,
      error: null,

      // 更新设置
      updateSettings: (newSettings) =>
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
          error: null,
        })),

      // 更新单个参数
      updateParam: (key, value) =>
        set((state) => ({
          settings: {
            ...state.settings,
            model_params: {
              ...state.settings.model_params,
              [key]: value,
            },
          },
          error: null,
        })),

      // 更新系统提示词
      updateSystemPrompt: (prompt) =>
        set((state) => ({
          settings: {
            ...state.settings,
            system_prompt: prompt,
          },
          error: null,
        })),

      // 重置为默认设置
      resetToDefaults: () =>
        set({
          settings: DEFAULT_APP_SETTINGS,
          error: null,
        }),

      // 清除错误
      clearError: () => set({ error: null }),
    }),
    {
      name: 'localmind-settings',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
