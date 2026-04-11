// src/hooks/useDownload.ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useState, useEffect } from 'react';
import { DownloadProgress, DownloadResult } from '../types';

// 重新导出类型，保持向后兼容
export type { DownloadProgress, DownloadResult };

export function useDownload() {
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDownloadedPath, setLastDownloadedPath] = useState<string | null>(null);

  useEffect(() => {
    const unProgress = listen<DownloadProgress>('model://progress', e => {
      const payload = e.payload;

      if (payload.total > 0 && payload.downloaded <= payload.total) {
        setProgress(payload);
        if (payload.percent >= 100) {
          setDownloading(false);
        }
      } else if (payload.downloaded > payload.total) {
        console.warn('[下载] 进度异常: downloaded > total, 修正百分比');
        setProgress({
          ...payload,
          percent: 100,
        });
        if (payload.percent >= 100) {
          setDownloading(false);
        }
      }
    });
    return () => {
      unProgress.then(f => f());
    };
  }, []);

  const downloadModel = async (repoId: string, filename: string): Promise<DownloadResult> => {
    setDownloading(true);
    setError(null);
    setProgress(null);
    setLastDownloadedPath(null);
    try {
      const url = await invoke<string>('resolve_model_url', { repoId, filename });
      const downloadedPath = await invoke<string>('download_model', { url, filename });
      setLastDownloadedPath(downloadedPath);
      return { success: true, path: downloadedPath };
    } catch (e) {
      const errorMsg = String(e);
      console.error('[下载] 失败:', errorMsg);
      setError(errorMsg);
      setDownloading(false);
      setProgress(null);
      return { success: false, error: errorMsg };
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  return {
    progress,
    downloading,
    error,
    downloadModel,
    formatBytes,
    lastDownloadedPath,
  };
}
