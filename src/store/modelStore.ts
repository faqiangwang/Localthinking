// src/store/modelStore.ts
// 模型状态管理 - Zustand

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ModelInfo } from '../types';

interface ModelStore {
  // 状态
  modelLoaded: boolean;
  loading: boolean;
  error: string | null;
  currentModel: ModelInfo | null;
  customModels: ModelInfo[];

  // Actions
  setLoading: (loading: boolean) => void;
  setModelLoaded: (loaded: boolean) => void;
  setCurrentModel: (model: ModelInfo | null) => void;
  setError: (error: string | null) => void;
  addCustomModel: (model: ModelInfo) => void;
  removeCustomModel: (path: string) => void;
  clearError: () => void;
}

export const useModelStore = create<ModelStore>()(
  persist(
    (set) => ({
      // 初始状态
      modelLoaded: false,
      loading: false,
      error: null,
      currentModel: null,
      customModels: [],

      // 设置加载状态
      setLoading: (loading) => set({ loading }),

      // 设置模型已加载状态
      setModelLoaded: (modelLoaded) => set({ modelLoaded }),

      // 设置当前模型
      setCurrentModel: (model) => set({ currentModel: model, modelLoaded: !!model }),

      // 设置错误
      setError: (error) => set({ error }),

      // 添加自定义模型
      addCustomModel: (model) =>
        set((state) => ({
          customModels: [...state.customModels, model],
        })),

      // 移除自定义模型
      removeCustomModel: (path) =>
        set((state) => ({
          customModels: state.customModels.filter((m) => m.path !== path),
        })),

      // 清除错误
      clearError: () => set({ error: null }),
    }),
    {
      name: 'localmind-model',
      // 只持久化自定义模型列表
      partialize: (state) => ({
        customModels: state.customModels,
      }),
    }
  )
);
