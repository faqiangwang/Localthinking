// src/styles/tokens/shadows.ts
// 阴影系统设计令牌

export const shadows = {
  // 基础阴影
  sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
  md: '0 4px 6px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px rgba(0, 0, 0, 0.1)',
  xl: '0 20px 25px rgba(0, 0, 0, 0.15)',

  // 彩色阴影
  primary: '0 4px 12px rgba(0, 122, 255, 0.3)',
  success: '0 4px 12px rgba(52, 199, 89, 0.3)',
  error: '0 4px 12px rgba(255, 59, 48, 0.3)',

  // 内阴影
  inner: 'inset 0 2px 4px rgba(0, 0, 0, 0.06)',

  // 无阴影
  none: 'none',
} as const;

export type ShadowScale = keyof typeof shadows;
