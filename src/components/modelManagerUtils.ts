import type { LocalModelEntry, ModelInfo } from '../types';

export function extractRepoIdFromDownloadUrl(
  url: string
): { repoId: string; filename: string } | null {
  try {
    const parsedUrl = new URL(url);
    const segments = parsedUrl.pathname.split('/').filter(Boolean);
    const resolveIndex = segments.indexOf('resolve');

    if (resolveIndex < 2 || segments.length < resolveIndex + 2) {
      return null;
    }

    return {
      repoId: `${segments[0]}/${segments[1]}`,
      filename: decodeURIComponent(segments[segments.length - 1]),
    };
  } catch {
    return null;
  }
}

export function isMissingModelFileError(error: string): boolean {
  const normalized = error.toLowerCase();
  return (
    normalized.includes('文件不存在') ||
    normalized.includes('not exist') ||
    normalized.includes('no such file')
  );
}

export function createScannedLocalModelEntry(model: ModelInfo): LocalModelEntry {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: model.name,
    path: model.path,
    size: model.size_gb > 0 ? `${model.size_gb.toFixed(2)} GB` : '未知',
  };
}
