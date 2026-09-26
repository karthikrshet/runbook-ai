import { useCallback, useState } from 'react';

/**
 * Per-viewer display preferences. Browser storage can be missing or blocked (private
 * windows, previews), so every access is guarded and the defaults always work.
 */

export type Theme = 'dark' | 'light';

const THEME_KEY = 'runbookai.theme';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A preference that cannot be saved still applies for this page view.
  }
}

/** Dark first, unless this viewer chose light. */
export function storedTheme(): Theme {
  return read(THEME_KEY) === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const choose = useCallback((next: Theme) => {
    applyTheme(next);
    write(THEME_KEY, next);
    setTheme(next);
  }, []);
  return [theme, choose];
}

/** A remembered on/off setting, such as a collapsed panel. */
export function useStoredFlag(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    const saved = read(key);
    return saved === null ? initial : saved === 'true';
  });
  const set = useCallback(
    (next: boolean) => {
      write(key, String(next));
      setValue(next);
    },
    [key],
  );
  return [value, set];
}
