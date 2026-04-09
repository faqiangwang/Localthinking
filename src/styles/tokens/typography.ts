// src/styles/tokens/typography.ts
// 字体系统设计令牌

export const typography = {
  // 字体家族
  fontFamily: {
    base: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '"SF Mono", Monaco, "Courier New", monospace',
  },

  // 字体大小
  fontSize: {
    xs: '11px',
    sm: '12px',
    base: '13px',
    md: '14px',
    lg: '16px',
    xl: '18px',
    '2xl': '20px',
    '3xl': '24px',
    '4xl': '28px',
  },

  // 字重
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },

  // 行高
  lineHeight: {
    tight: '1.2',
    normal: '1.5',
    relaxed: '1.8',
  },

  // 字间距
  letterSpacing: {
    normal: 'normal',
    wide: '0.5px',
    wider: '1px',
  },
} as const;

export type FontSizeScale = keyof typeof typography.fontSize;
export type FontWeightScale = keyof typeof typography.fontWeight;
