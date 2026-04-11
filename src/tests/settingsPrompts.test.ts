import { describe, expect, it } from 'vitest';
import { PROMPT_CATEGORIES } from '../components/settingsPrompts';

describe('PROMPT_CATEGORIES', () => {
  it('每个分类都应至少包含一个预设', () => {
    expect(PROMPT_CATEGORIES.length).toBeGreaterThan(0);
    expect(PROMPT_CATEGORIES.every(category => category.presets.length > 0)).toBe(true);
  });

  it('预设标签在全局范围内应唯一', () => {
    const labels = PROMPT_CATEGORIES.flatMap(category =>
      category.presets.map(preset => preset.label)
    );

    expect(new Set(labels).size).toBe(labels.length);
  });
});
