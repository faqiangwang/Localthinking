function extractLowercaseFileName(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/');
  const segments = normalizedPath.split('/');
  return (segments[segments.length - 1] || path).toLowerCase();
}

export function getUnsupportedModelReason(path: string): string | null {
  const fileName = extractLowercaseFileName(path);

  const isDeepSeekFullModel =
    fileName.includes('deepseek-v2') ||
    fileName.includes('deepseek-v3') ||
    (fileName.includes('deepseek-r1') && !fileName.includes('distill'));

  const isLikelyMoeModel =
    fileName.includes('mixtral') ||
    fileName.includes('-moe') ||
    fileName.includes('_moe') ||
    fileName.includes(' moe ') ||
    /\ba\d+b\b/.test(fileName);

  if (!isDeepSeekFullModel && !isLikelyMoeModel) {
    return null;
  }

  return [
    '当前内置的 llama 后端对该类 MoE 模型支持不稳定，可能在首次推理时直接崩溃。',
    '建议改用非 MoE 的 GGUF 模型，例如 Qwen2.5-7B、DeepSeek-R1-Distill-Qwen-8B、DeepSeek-R1-Distill-Llama-8B、Gemma-2-2B。',
  ].join('\n\n');
}
