// src/styles/tokens/spacing.ts
// 间距系统设计令牌（8px 基数）

export const spacing = {
  // 基础间距（8px 基数）
  xs: '4px',   // 0.5rem
  sm: '8px',   // 1rem
  md: '16px',  // 2rem
  lg: '24px',  // 3rem
  xl: '32px',  // 4rem
  xxl: '48px', // 6rem

  // 特殊间距
  none: '0',
  tight: '2px',
  base: '12px',
  wide: '40px',

  // 负间距
  negative: {
    sm: '-8px',
    md: '-16px',
    lg: '-24px',
  },
} as const;

export type SpacingScale = keyof typeof spacing;
