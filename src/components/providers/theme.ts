import { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

export const THEME_STORAGE_KEY = 'localmind-theme';

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function getResolvedTheme(theme: Theme): ResolvedTheme {
  if (theme !== 'system') {
    return theme;
  }

  if (typeof window === 'undefined') {
    return 'dark';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  return context;
}

export function useThemeVariable(variableName: string): string {
  const { resolvedTheme } = useTheme();
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') {
      return '';
    }

    return getComputedStyle(document.documentElement).getPropertyValue(variableName);
  });

  useEffect(() => {
    const root = document.documentElement;
    setValue(getComputedStyle(root).getPropertyValue(variableName));
  }, [resolvedTheme, variableName]);

  return value;
}
