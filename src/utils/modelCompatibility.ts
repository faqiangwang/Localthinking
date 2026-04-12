function extractLowercaseFileName(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/');
  const segments = normalizedPath.split('/');
  return (segments[segments.length - 1] || path).toLowerCase();
}

export function isDeepSeekFullModel(path: string): boolean {
  const fileName = extractLowercaseFileName(path);
  return (
    fileName.includes('deepseek-v2') ||
    fileName.includes('deepseek-v3') ||
    (fileName.includes('deepseek-r1') && !fileName.includes('distill'))
  );
}

export function isMoeModel(path: string): boolean {
  const fileName = extractLowercaseFileName(path);
  return (
    fileName.includes('mixtral') ||
    fileName.includes('-moe') ||
    fileName.includes('_moe') ||
    fileName.includes(' moe ') ||
    /\ba\d+b\b/.test(fileName) ||
    isDeepSeekFullModel(path)
  );
}

export function supportsCpuMoeFallback(path: string): boolean {
  return isMoeModel(path);
}
