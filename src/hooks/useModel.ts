// src/hooks/useModel.ts
import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect, useCallback, useRef } from "react";
import { SystemInfo } from "../types";

// 最后使用的模型路径存储键
const LAST_MODEL_PATH_KEY = "localmind_last_model_path";

// 共享状态（用于多组件同步）
let globalLoading = false;
let globalError: string | null = null;
let globalListeners: Array<() => void> = [];

function notifyListeners() {
  globalListeners.forEach(fn => fn());
}

export function useModel() {
  const [, forceUpdate] = useState({});
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelPath, setModelPath] = useState<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  // 同步全局状态
  useEffect(() => {
    const listener = () => {
      forceUpdate({});
    };
    globalListeners.push(listener);
    return () => {
      globalListeners = globalListeners.filter(fn => fn !== listener);
    };
  }, []);

  // 初始化时加载系统信息
  useEffect(() => {
    const loadSystemInfo = async () => {
      try {
        const info = await invoke<SystemInfo>("system_info");
        setSystemInfo(info);
      } catch (e) {
        console.warn("获取系统信息失败:", e);
      }
    };
    loadSystemInfo();
  }, []);

  // 初始化时加载上次使用的模型（只在首次挂载时执行一次）
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const initModel = async () => {
      const savedPath = localStorage.getItem(LAST_MODEL_PATH_KEY);
      if (savedPath) {
        // 加载上次使用的模型，显示 loading 状态
        console.log('正在加载上次使用的模型:', savedPath);
        await loadModelInternal(savedPath, false);
      } else {
        // 如果没有保存的模型，尝试加载第一个可用的模型
        try {
          const customModels = localStorage.getItem('localmind_custom_models');
          if (customModels) {
            const models = JSON.parse(customModels);
            if (Array.isArray(models) && models.length > 0) {
              console.log('正在加载第一个可用模型:', models[0].path);
              await loadModelInternal(models[0].path, false);
            }
          }
        } catch (e) {
          console.warn('尝试自动加载模型失败:', e);
        }
      }
    };
    initModel();
  }, []);

  const loadModelInternal = useCallback(async (path: string, silent: boolean = false): Promise<boolean> => {
    if (!silent) {
      setLoading(true);
      setError(null);
      globalLoading = true;
      notifyListeners();
    }

    try {
      await invoke("load_model", { path });
      setModelPath(path);
      setModelLoaded(true);
      setError(null);
      globalError = null;
      globalLoading = false;
      localStorage.setItem(LAST_MODEL_PATH_KEY, path);
      notifyListeners();
      return true;
    } catch (e) {
      const errMsg = String(e);
      console.error("加载模型失败:", errMsg);

      // 增强错误消息
      let displayError = errMsg;
      if (!errMsg.includes("\n\n")) {
        // 如果后端没有提供详细建议，添加一些基本建议
        if (errMsg.includes("不存在")) {
          displayError = `${errMsg}\n\n建议：请检查模型文件是否存在，或重新下载模型。`;
        } else if (errMsg.includes("内存")) {
          displayError = `${errMsg}\n\n建议：关闭其他程序释放内存，或使用更小的模型。`;
        } else if (errMsg.includes("损坏") || errMsg.includes("格式")) {
          displayError = `${errMsg}\n\n建议：请重新下载模型文件。`;
        }
      }

      setError(displayError);
      globalError = displayError;
      globalLoading = false;
      notifyListeners();

      // 如果静默加载失败，清除保存的路径
      if (silent) {
        localStorage.removeItem(LAST_MODEL_PATH_KEY);
      }
      return false;
    } finally {
      if (!silent) {
        setLoading(false);
        globalLoading = false;
        notifyListeners();
      }
    }
  }, []);

  const loadModel = useCallback(async (path: string, silent = false) => {
    return loadModelInternal(path, silent);
  }, [loadModelInternal]);

  const setThreads = useCallback(async (n: number) => {
    try {
      await invoke("set_threads", { n });
      const info = await invoke<SystemInfo>("system_info");
      setSystemInfo(info);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  return {
    modelLoaded,
    modelPath,
    systemInfo,
    loading: loading || globalLoading,
    error: error || globalError,
    loadModel,
    setThreads,
  };
}

// 导出清除函数供外部使用
export function clearSavedModel() {
  localStorage.removeItem(LAST_MODEL_PATH_KEY);
}
