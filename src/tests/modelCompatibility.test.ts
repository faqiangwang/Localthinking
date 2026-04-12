import { describe, expect, it } from 'vitest';
import { requiresCpuMoeCompatibilityMode } from '../utils/modelCompatibility';

describe('modelCompatibility', () => {
  it('应识别需要 CPU MoE 兼容模式的模型', () => {
    expect(requiresCpuMoeCompatibilityMode('/models/Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf')).toBe(
      true
    );
    expect(requiresCpuMoeCompatibilityMode('/models/Qwen3-30B-A3B-Instruct-Q4_K_M.gguf')).toBe(
      true
    );
    expect(requiresCpuMoeCompatibilityMode('/models/DeepSeek-V3-Q4_K_M.gguf')).toBe(true);
  });

  it('不应误伤 distill 或常规 dense 模型', () => {
    expect(requiresCpuMoeCompatibilityMode('/models/Qwen2.5-7B-Instruct-Q4_K_M.gguf')).toBe(false);
    expect(
      requiresCpuMoeCompatibilityMode('/models/DeepSeek-R1-Distill-Qwen-8B-Q4_K_M.gguf')
    ).toBe(false);
    expect(requiresCpuMoeCompatibilityMode('/models/Gemma-2-2B-it-Q4_K_M.gguf')).toBe(false);
  });
});
