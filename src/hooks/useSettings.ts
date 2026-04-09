// src/hooks/useSettings.ts
import { useState, useEffect, useCallback, useRef } from "react";
import {
  ModelParams,
  AppSettings,
  DEFAULT_MODEL_PARAMS,
  DEFAULT_APP_SETTINGS,
  STORAGE_KEYS,
  isValidAppSettings,
} from "../types";

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 防抖定时器引用
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 从 localStorage 加载设置
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (isValidAppSettings(parsed)) {
          setSettings({
            model_params: { ...DEFAULT_MODEL_PARAMS, ...parsed.model_params },
            system_prompt: parsed.system_prompt || DEFAULT_APP_SETTINGS.system_prompt,
            api_enabled: parsed.api_enabled ?? DEFAULT_APP_SETTINGS.api_enabled,
            api_port: parsed.api_port ?? DEFAULT_APP_SETTINGS.api_port,
          });
          setError(null);
        } else {
          setError("设置格式不正确，使用默认设置");
          setSettings(DEFAULT_APP_SETTINGS);
          // 自动保存默认设置
          localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(DEFAULT_APP_SETTINGS));
        }
      } catch (e) {
        setError("设置解析失败，使用默认设置");
        setSettings(DEFAULT_APP_SETTINGS);
        // 自动保存默认设置
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(DEFAULT_APP_SETTINGS));
      }
    } else {
      // 没有保存的设置，自动保存默认设置
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(DEFAULT_APP_SETTINGS));
    }
    setLoaded(true);
  }, []);

  // 保存设置到 localStorage
  const saveSettings = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(newSettings));
      setError(null);
    } catch (e) {
      setError("设置保存失败");
    }
  }, []);

  // 更新单个参数（使用防抖保存）
  const updateParam = useCallback(<K extends keyof ModelParams>(
    key: K,
    value: ModelParams[K]
  ) => {
    const newSettings = {
      ...settings,
      model_params: {
        ...settings.model_params,
        [key]: value,
      },
    };
    setSettings(newSettings);

    // 防抖：500ms 后保存到 localStorage
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(newSettings));
        setError(null);
      } catch (e) {
        setError("设置保存失败");
      }
    }, 500);
  }, [settings]);

  // 更新系统提示词（使用防抖保存）
  const updateSystemPrompt = useCallback((prompt: string) => {
    const newSettings = {
      ...settings,
      system_prompt: prompt,
    };
    setSettings(newSettings);

    // 防抖：500ms 后保存到 localStorage
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(newSettings));
        setError(null);
      } catch (e) {
        setError("设置保存失败");
      }
    }, 500);
  }, [settings]);

  // 重置为默认设置
  const resetToDefaults = useCallback(() => {
    setSettings(DEFAULT_APP_SETTINGS);
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(DEFAULT_APP_SETTINGS));
      setError(null);
    } catch (e) {
      setError("重置设置失败");
    }
  }, []);

  // 持久化当前设置（立即保存，清除防抖定时器）
  const persist = useCallback(() => {
    // 清除防抖定时器
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }

    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
      setError(null);
    } catch (e) {
      setError("设置持久化失败");
    }
  }, [settings]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    };
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
