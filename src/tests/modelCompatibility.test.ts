import { describe, expect, it } from 'vitest';
import { isMoeModel, supportsCpuMoeFallback } from '../utils/modelCompatibility';

describe('modelCompatibility', () => {
  it('应识别 MoE 模型', () => {
    expect(isMoeModel('/models/Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf')).toBe(true);
    expect(isMoeModel('/models/Qwen3-30B-A3B-Instruct-Q4_K_M.gguf')).toBe(true);
    expect(isMoeModel('/models/DeepSeek-V3-Q4_K_M.gguf')).toBe(true);
  });

  it('应将 CPU MoE 兼容视为回退能力而不是默认执行模式', () => {
    expect(supportsCpuMoeFallback('/models/Qwen3-30B-A3B-Instruct-Q4_K_M.gguf')).toBe(true);
  });

  it('不应误伤 distill 或常规 dense 模型', () => {
    expect(isMoeModel('/models/Qwen2.5-7B-Instruct-Q4_K_M.gguf')).toBe(false);
    expect(isMoeModel('/models/DeepSeek-R1-Distill-Qwen-8B-Q4_K_M.gguf')).toBe(false);
    expect(isMoeModel('/models/Gemma-2-2B-it-Q4_K_M.gguf')).toBe(false);
  });
});
