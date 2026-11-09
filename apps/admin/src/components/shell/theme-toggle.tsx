'use client';

import { useSyncExternalStore } from 'react';

import { IconButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';

export type Theme = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'birem-admin-theme';

/**
 * Inline script executed before paint so the stored theme applies without a flash. Kept as a
 * string because it must run before React hydrates.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

const listeners = new Set<() => void>();

function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function writeTheme(theme: Theme): void {
  try {
    if (theme === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable (private mode); the attribute still applies for this page.
  }
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function resolvedIsDark(theme: Theme): boolean {
  if (theme !== 'system') return theme === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, readTheme, () => 'system' as const);
  return [theme, writeTheme];
}

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const isDark = typeof window !== 'undefined' && resolvedIsDark(theme);
  return (
    <IconButton
      label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      <Icon name={isDark ? 'sun' : 'moon'} />
    </IconButton>
  );
}
