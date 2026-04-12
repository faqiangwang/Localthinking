import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect } from 'react';
import { type LocalModelEntry, type SystemInfo } from '../types';
import { useModelStore } from '../store';
import { getUnsupportedModelReason } from '../utils/modelCompatibility';

interface LoadModelResult {
  success: boolean;
  error?: string;
}

function formatLoadError(errorMessage: string): string {
  if (errorMessage.includes('\n\n')) {
    return errorMessage;
  }

  if (errorMessage.includes('不存在')) {
    return `${errorMessage}\n\n建议：请检查模型文件是否存在，或重新下载模型。`;
  }

  if (errorMessage.includes('内存')) {
    return `${errorMessage}\n\n建议：关闭其他程序释放内存，或使用更小的模型。`;
  }

  if (errorMessage.includes('损坏') || errorMessage.includes('格式')) {
    return `${errorMessage}\n\n建议：请重新下载模型文件。`;
  }

  return errorMessage;
}

export function useModel() {
  const {
    modelLoaded,
    modelPath,
    systemInfo,
    loading,
    error,
    customModels,
    lastModelPath,
    setLoading,
    setError,
    clearError,
    setSystemInfo,
    setLoadedModelPath,
    setLastModelPath,
    upsertCustomModel,
    mergeCustomModels,
    removeCustomModel,
    ensureRuntimeInitialized,
  } = useModelStore();

  const refreshSystemInfo = useCallback(async (): Promise<SystemInfo | null> => {
    try {
      const info = await invoke<SystemInfo>('system_info');
      setSystemInfo(info);
      return info;
    } catch (e) {
      const errorMessage = String(e);
      setError(errorMessage);
      return null;
    }
  }, [setError, setSystemInfo]);

  const loadModel = useCallback(
    async (path: string, silent = false): Promise<LoadModelResult> => {
      if (modelLoaded && modelPath === path) {
        clearError();
        return { success: true };
      }

      const unsupportedReason = getUnsupportedModelReason(path);
      if (unsupportedReason) {
        setError(unsupportedReason);
        return {
          success: false,
          error: unsupportedReason,
        };
      }

      if (!silent) {
        setLoading(true);
        clearError();
      }

      try {
        await invoke('load_model', { path });
        setLoadedModelPath(path);
        setLastModelPath(path);
        return { success: true };
      } catch (e) {
        const displayError = formatLoadError(String(e));
        setError(displayError);

        if (lastModelPath === path) {
          setLastModelPath(null);
        }

        return {
          success: false,
          error: displayError,
        };
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [
      clearError,
      lastModelPath,
      modelLoaded,
      modelPath,
      setError,
      setLastModelPath,
      setLoadedModelPath,
      setLoading,
    ]
  );

  const setThreads = useCallback(
    async (n: number) => {
      try {
        await invoke('set_threads', { n });
        await refreshSystemInfo();
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      }
    },
    [refreshSystemInfo, setError]
  );

  const addCustomModel = useCallback(
    (model: LocalModelEntry) => {
      upsertCustomModel(model);
    },
    [upsertCustomModel]
  );

  useEffect(() => {
    if (!ensureRuntimeInitialized()) {
      return;
    }

    let cancelled = false;

    const initialize = async () => {
      await refreshSystemInfo();

      const pathToLoad = lastModelPath ?? customModels[0]?.path ?? null;
      if (!cancelled && pathToLoad) {
        await loadModel(pathToLoad, true);
      }
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [customModels, ensureRuntimeInitialized, lastModelPath, loadModel, refreshSystemInfo]);

  return {
    modelLoaded,
    modelPath,
    systemInfo,
    loading,
    error,
    customModels,
    loadModel,
    setThreads,
    addCustomModel,
    mergeCustomModels,
    removeCustomModel,
    clearError,
  };
}

export function clearSavedModel() {
  useModelStore.getState().setLastModelPath(null);
}
