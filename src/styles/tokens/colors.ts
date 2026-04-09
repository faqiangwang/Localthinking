// src/styles/tokens/colors.ts
// 颜色系统设计令牌

export const colors = {
  // 主色调
  primary: {
    main: '#007aff',
    light: '#4da3ff',
    dark: '#0056b3',
  },

  // 灰度色阶（从深到浅）
  gray: {
    900: '#1c1c1e',
    800: '#2c2c2e',
    700: '#3a3a3c',
    600: '#48484a',
    500: '#636366',
    400: '#8e8e93',
    300: '#c7c7cc',
    200: '#e5e5e7',
    100: '#e8e8ed',
    50: '#f5f5f7',
  },

  // 语义化颜色
  semantic: {
    success: '#34c759',
    warning: '#ff9500',
    error: '#ff3b30',
    info: '#007aff',
  },

  // 背景色
  background: {
    primary: '#ffffff',
    secondary: '#f5f5f7',
    tertiary: '#f8f9fa',
  },

  // 文字颜色
  text: {
    primary: '#1a1a1a',
    secondary: '#666666',
    tertiary: '#8e8e93',
    inverse: '#ffffff',
  },

  // 边框颜色
  border: {
    light: '#e5e5e5',
    medium: '#d1d1d6',
    dark: '#c7c7cc',
  },

  // 渐变色
  gradient: {
    primary: 'linear-gradient(135deg, #007aff, #0056b3)',
    success: 'linear-gradient(135deg, #34c759, #30d158)',
    purple: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    avatarAssistant: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    avatarUser: 'linear-gradient(135deg, #007aff 0%, #0056b3 100%)',
  },
} as const;

// 深色主题颜色
export const darkColors = {
  ...colors,
  background: {
    primary: '#1c1c1e',
    secondary: '#2c2c2e',
    tertiary: '#3a3a3c',
  },
  text: {
    primary: '#ffffff',
    secondary: '#c7c7cc',
    tertiary: '#8e8e93',
    inverse: '#1a1a1a',
  },
} as const;

export type ColorPalette = typeof colors;
export type ColorScale = keyof ColorPalette['gray'];
