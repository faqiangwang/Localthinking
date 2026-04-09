// src/components/providers/ThemeProvider.tsx
// 主题提供者 - 支持深色/浅色主题切换

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const THEME_STORAGE_KEY = 'localmind-theme';

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
}

export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    // 从 localStorage 读取保存的主题
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    return savedTheme || defaultTheme;
  });

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    return getResolvedTheme(theme);
  });

  // 设置主题到 DOM
  useEffect(() => {
    const root = window.document.documentElement;
    root.setAttribute('data-theme', resolvedTheme);

    // 添加主题类名到 body
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  // 监听系统主题变化
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const newResolvedTheme = e.matches ? 'dark' : 'light';
      setResolvedTheme(newResolvedTheme);
    };

    // 初始化
    handleChange(mediaQuery);

    // 监听变化
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [theme]);

  // 更新主题
  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem(THEME_STORAGE_KEY, newTheme);

    // 如果不是 system 主题，立即更新 resolvedTheme
    if (newTheme !== 'system') {
      setResolvedTheme(newTheme);
    } else {
      // system 主题由 useEffect 处理
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      setResolvedTheme(mediaQuery.matches ? 'dark' : 'light');
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// 辅助函数：获取解析后的主题
function getResolvedTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

// Hook: 使用主题
export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  return context;
}

// Hook: 获取当前主题的 CSS 变量值
export function useThemeVariable(variableName: string): string {
  const { resolvedTheme } = useTheme();

  // 在组件挂载后获取 CSS 变量值
  const [value, setValue] = useState(() => {
    if (typeof window !== 'undefined') {
      return getComputedStyle(document.documentElement).getPropertyValue(variableName);
    }
    return '';
  });

  useEffect(() => {
    const root = document.documentElement;
    const newValue = getComputedStyle(root).getPropertyValue(variableName);
    setValue(newValue);
  }, [variableName, resolvedTheme]);

  return value;
}
