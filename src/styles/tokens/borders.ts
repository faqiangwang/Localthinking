// src/styles/tokens/borders.ts
// 边框和圆角系统设计令牌

export const borders = {
  // 圆角
  radius: {
    none: '0',
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    '2xl': '20px',
    full: '9999px', // 圆形
  },

  // 边框宽度
  width: {
    thin: '1px',
    medium: '2px',
    thick: '3px',
  },

  // 边框样式
  style: {
    solid: 'solid',
    dashed: 'dashed',
    dotted: 'dotted',
  },
} as const;

export type BorderRadiusScale = keyof typeof borders.radius;
