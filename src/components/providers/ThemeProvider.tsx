// src/components/providers/ThemeProvider.tsx
// 主题提供者 - 支持深色/浅色主题切换

import { useEffect, useState, type ReactNode } from 'react';
import {
  ThemeContext,
  THEME_STORAGE_KEY,
  getResolvedTheme,
  type Theme,
  type ResolvedTheme,
} from './theme';

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
}

export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') {
      return defaultTheme;
    }

    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    return savedTheme ?? defaultTheme;
  });

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => getResolvedTheme(theme));

  // 设置主题到 DOM
  useEffect(() => {
    const root = window.document.documentElement;
    root.setAttribute('data-theme', resolvedTheme);

    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  // 监听系统主题变化
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setResolvedTheme(e.matches ? 'dark' : 'light');
    };

    handleChange(mediaQuery);

    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [theme]);

  // 更新主题
  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem(THEME_STORAGE_KEY, newTheme);

    if (newTheme !== 'system') {
      setResolvedTheme(newTheme);
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setResolvedTheme(mediaQuery.matches ? 'dark' : 'light');
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
