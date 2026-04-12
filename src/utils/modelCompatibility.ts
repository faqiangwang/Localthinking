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

export function requiresCpuMoeCompatibilityMode(path: string): boolean {
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

export function getUnsupportedModelReason(path: string): string | null {
  if (!isDeepSeekFullModel(path)) {
    return null;
  }

  return [
    '当前版本对这类全量 DeepSeek MoE 模型仍不稳定，可能在首次推理时直接崩溃。',
    '建议优先改用 distill 或 dense 模型，例如 Qwen2.5-7B、DeepSeek-R1-Distill-Qwen-8B、DeepSeek-R1-Distill-Llama-8B、Gemma-2-2B。',
  ].join('\n\n');
}
