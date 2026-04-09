// src/hooks/useDownload.ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useState, useEffect } from "react";
import { DownloadProgress, DownloadResult } from "../types";

// 重新导出类型，保持向后兼容
export type { DownloadProgress, DownloadResult };

export function useDownload() {
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDownloadedPath, setLastDownloadedPath] = useState<string | null>(null);

  useEffect(() => {
    const unProgress = listen<DownloadProgress>("model://progress", (e) => {
      const payload = e.payload;

      // 验证进度数据的合理性
      if (payload.total > 0 && payload.downloaded <= payload.total) {
        setProgress(payload);
        if (payload.percent >= 100) {
          setDownloading(false);
        }
      } else if (payload.downloaded > payload.total) {
        // 如果下载量超过总量，修正百分比
        console.warn('[下载] 进度异常: downloaded > total, 修正百分比');
        setProgress({
          ...payload,
          percent: 100
        });
        if (payload.percent >= 100) {
          setDownloading(false);
        }
      }
    });
    return () => {
      unProgress.then((f) => f());
    };
  }, []);

  const downloadModel = async (repoId: string, filename: string): Promise<DownloadResult> => {
    console.log('[下载] 开始下载流程:', { repoId, filename });
    setDownloading(true);
    setError(null);
    setProgress(null);
    setLastDownloadedPath(null);
    try {
      // 获取下载 URL（国内镜像）
      const url = await invoke<string>("resolve_model_url", { repoId, filename });
      console.log('[下载] 解析到的 URL:', url);
      // 调用下载命令，返回下载完成的文件路径
      const downloadedPath = await invoke<string>("download_model", { url, filename });
      setLastDownloadedPath(downloadedPath);
      return { success: true, path: downloadedPath };
    } catch (e) {
      const errorMsg = String(e);
      console.error('[下载] 失败:', errorMsg);
      setError(errorMsg);
      setDownloading(false);
      setProgress(null);  // 下载失败时重置进度
      return { success: false, error: errorMsg };
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
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
