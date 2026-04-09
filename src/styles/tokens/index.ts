// src/styles/tokens/index.ts
// 设计令牌统一导出

export { colors, darkColors } from './colors';
export { spacing } from './spacing';
export { typography } from './typography';
export { borders } from './borders';
export { shadows } from './shadows';

// 导出类型
export type { ColorPalette, ColorScale } from './colors';
export type { SpacingScale } from './spacing';
export type { FontSizeScale, FontWeightScale } from './typography';
export type { BorderRadiusScale } from './borders';
export type { ShadowScale } from './shadows';

// Z-index 层级
export const zIndex = {
  dropdown: 1000,
  sticky: 1020,
  fixed: 1030,
  modalBackdrop: 1040,
  modal: 1050,
  popover: 1060,
  tooltip: 1070,
} as const;

// 过渡动画
export const transitions = {
  fast: '150ms',
  base: '200ms',
  slow: '300ms',
} as const;

// 断点
export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
} as const;
