// src/store/modelStore.ts
// 模型状态管理 - Zustand

import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import {
  type LocalModelEntry,
  type SystemInfo,
  LEGACY_STORAGE_KEYS,
  STORAGE_KEYS,
  isValidLocalModelEntry,
} from '../types';

const MODEL_STORE_VERSION = 1;

interface PersistedModelState {
  customModels: LocalModelEntry[];
  lastModelPath: string | null;
}

interface ModelStore extends PersistedModelState {
  modelLoaded: boolean;
  modelPath: string | null;
  systemInfo: SystemInfo | null;
  loading: boolean;
  error: string | null;
  runtimeInitialized: boolean;

  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  setSystemInfo: (systemInfo: SystemInfo | null) => void;
  setLoadedModelPath: (path: string | null) => void;
  setLastModelPath: (path: string | null) => void;
  upsertCustomModel: (model: LocalModelEntry) => void;
  mergeCustomModels: (models: LocalModelEntry[]) => number;
  removeCustomModel: (path: string) => void;
  ensureRuntimeInitialized: () => boolean;
}

function normalizeCustomModels(value: unknown): LocalModelEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isValidLocalModelEntry);
}

const modelStorage: StateStorage = {
  getItem: (name) => {
    const current = localStorage.getItem(name);
    if (current) {
      return current;
    }

    const legacyCustomModels = localStorage.getItem(STORAGE_KEYS.CUSTOM_MODELS);
    const legacyLastModelPath = localStorage.getItem(LEGACY_STORAGE_KEYS.LAST_MODEL_PATH);

    if (!legacyCustomModels && !legacyLastModelPath) {
      return null;
    }

    let customModels: LocalModelEntry[] = [];

    if (legacyCustomModels) {
      try {
        customModels = normalizeCustomModels(JSON.parse(legacyCustomModels));
      } catch {
        customModels = [];
      }
    }

    const migrated = JSON.stringify({
      state: {
        customModels,
        lastModelPath: legacyLastModelPath || null,
      },
      version: MODEL_STORE_VERSION,
    });

    localStorage.setItem(name, migrated);
    localStorage.removeItem(STORAGE_KEYS.CUSTOM_MODELS);
    localStorage.removeItem(LEGACY_STORAGE_KEYS.LAST_MODEL_PATH);

    return migrated;
  },
  setItem: (name, value) => {
    localStorage.setItem(name, value);
    localStorage.removeItem(STORAGE_KEYS.CUSTOM_MODELS);
    localStorage.removeItem(LEGACY_STORAGE_KEYS.LAST_MODEL_PATH);
  },
  removeItem: (name) => {
    localStorage.removeItem(name);
    localStorage.removeItem(STORAGE_KEYS.CUSTOM_MODELS);
    localStorage.removeItem(LEGACY_STORAGE_KEYS.LAST_MODEL_PATH);
  },
};

function mergeUniqueModels(
  currentModels: LocalModelEntry[],
  incomingModels: LocalModelEntry[]
): { models: LocalModelEntry[]; addedCount: number; changed: boolean } {
  const merged = [...currentModels];
  let addedCount = 0;
  let changed = false;

  for (const model of incomingModels) {
    const existingIndex = merged.findIndex((entry) => entry.path === model.path);
    if (existingIndex >= 0) {
      const nextModel = {
        ...merged[existingIndex],
        ...model,
        id: merged[existingIndex].id,
      };
      if (JSON.stringify(nextModel) !== JSON.stringify(merged[existingIndex])) {
        merged[existingIndex] = nextModel;
        changed = true;
      }
      continue;
    }

    merged.push(model);
    addedCount += 1;
    changed = true;
  }

  return { models: merged, addedCount, changed };
}

export const useModelStore = create<ModelStore>()(
  persist(
    (set, get) => ({
      modelLoaded: false,
      modelPath: null,
      systemInfo: null,
      loading: false,
      error: null,
      customModels: [],
      lastModelPath: null,
      runtimeInitialized: false,

      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      clearError: () => set({ error: null }),
      setSystemInfo: (systemInfo) => set({ systemInfo }),
      setLoadedModelPath: (path) =>
        set({
          modelPath: path,
          modelLoaded: !!path,
          error: null,
        }),
      setLastModelPath: (path) => set({ lastModelPath: path }),
      upsertCustomModel: (model) =>
        set((state) => ({
          customModels: mergeUniqueModels(state.customModels, [model]).models,
        })),
      mergeCustomModels: (models) => {
        const { models: mergedModels, addedCount, changed } = mergeUniqueModels(
          get().customModels,
          models
        );

        if (changed) {
          set({ customModels: mergedModels });
        }

        return addedCount;
      },
      removeCustomModel: (path) =>
        set((state) => ({
          customModels: state.customModels.filter((model) => model.path !== path),
          lastModelPath: state.lastModelPath === path ? null : state.lastModelPath,
        })),
      ensureRuntimeInitialized: () => {
        if (get().runtimeInitialized) {
          return false;
        }

        set({ runtimeInitialized: true });
        return true;
      },
    }),
    {
      name: STORAGE_KEYS.MODEL_STORE,
      version: MODEL_STORE_VERSION,
      storage: createJSONStorage(() => modelStorage),
      partialize: (state) => ({
        customModels: state.customModels,
        lastModelPath: state.lastModelPath,
      }),
      migrate: (persistedState) => {
        const state = persistedState as Partial<PersistedModelState> | undefined;
        return {
          customModels: normalizeCustomModels(state?.customModels),
          lastModelPath: typeof state?.lastModelPath === 'string' ? state.lastModelPath : null,
        };
      },
    }
  )
);
