import { useCallback, useEffect, useState } from 'react';

/** Light, dark, or follow the computer's setting. Remembered per browser. */
export type ThemeChoice = 'licht' | 'donker' | 'systeem';
const KEY = 'yl-theme';

function read(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); return v === 'licht' || v === 'donker' ? v : 'systeem'; } catch { return 'systeem'; }
}
const systemDark = () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

export function applyTheme(choice: ThemeChoice): boolean {
  const dark = choice === 'donker' || (choice === 'systeem' && systemDark());
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  return dark;
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  const [dark, setDark] = useState(() => applyTheme(read()));
  useEffect(() => {
    setDark(applyTheme(choice));
    if (choice !== 'systeem') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(applyTheme('systeem'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [choice]);
  const set = useCallback((next: ThemeChoice) => {
    try { if (next === 'systeem') localStorage.removeItem(KEY); else localStorage.setItem(KEY, next); } catch { /* private mode */ }
    setChoice(next);
  }, []);
  /** One click: switch to the opposite of what is shown now. */
  const toggle = useCallback(() => set(dark ? 'licht' : 'donker'), [dark, set]);
  return { choice, dark, set, toggle };
}
