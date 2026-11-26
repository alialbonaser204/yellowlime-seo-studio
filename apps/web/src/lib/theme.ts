import { useCallback, useState } from 'react';

/** Light or dark, chosen by the Yellowlimer. Remembered per browser; light by default. */
export type ThemeChoice = 'licht' | 'donker';
const KEY = 'yl-theme';

function read(): ThemeChoice {
  try { return localStorage.getItem(KEY) === 'donker' ? 'donker' : 'licht'; } catch { return 'licht'; }
}

export function applyTheme(choice: ThemeChoice): boolean {
  const dark = choice === 'donker';
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  return dark;
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(() => { const c = read(); applyTheme(c); return c; });
  const set = useCallback((next: ThemeChoice) => {
    try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
    applyTheme(next);
    setChoice(next);
  }, []);
  const dark = choice === 'donker';
  const toggle = useCallback(() => set(dark ? 'licht' : 'donker'), [dark, set]);
  return { choice, dark, set, toggle };
}
