// src/components/DownloadProgress.tsx
import type { DownloadProgress as DownloadProgressType } from "../hooks/useDownload";

interface DownloadProgressProps {
  progress: DownloadProgressType | null;
  formatBytes: (bytes: number) => string;
}

export function DownloadProgress({ progress, formatBytes }: DownloadProgressProps) {
  if (!progress) return null;

  return (
    <div className="download-progress">
      <h3>下载进度</h3>
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${progress.percent}%` }}
        ></div>
      </div>
      <p>
        {formatBytes(progress.downloaded)} / {formatBytes(progress.total)} (
        {progress.percent}%)
      </p>
    </div>
  );
}
