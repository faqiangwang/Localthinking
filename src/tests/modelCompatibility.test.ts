import { describe, expect, it } from 'vitest';
import { getUnsupportedModelReason } from '../utils/modelCompatibility';

describe('modelCompatibility', () => {
  it('应识别高风险的 MoE 模型文件名', () => {
    expect(getUnsupportedModelReason('/models/Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf')).toContain(
      'MoE'
    );
    expect(getUnsupportedModelReason('/models/Qwen3-30B-A3B-Instruct-Q4_K_M.gguf')).toContain(
      'MoE'
    );
    expect(getUnsupportedModelReason('/models/DeepSeek-V3-Q4_K_M.gguf')).toContain('DeepSeek');
    expect(getUnsupportedModelReason('/models/DeepSeek-R1-Q4_K_M.gguf')).toContain('DeepSeek');
  });

  it('不应误伤 distill 或常规 dense 模型', () => {
    expect(getUnsupportedModelReason('/models/DeepSeek-R1-Distill-Qwen-8B-Q4_K_M.gguf')).toBeNull();
    expect(getUnsupportedModelReason('/models/Qwen2.5-7B-Instruct-Q4_K_M.gguf')).toBeNull();
    expect(getUnsupportedModelReason('/models/Gemma-2-2B-it-Q4_K_M.gguf')).toBeNull();
  });
});
