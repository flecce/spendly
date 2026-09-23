/**
 * Colour theme: follows the system unless the user picks one. The choice sits on
 * <html data-theme>, which the tokens in styles.css key off.
 */

export type Theme = 'system' | 'light' | 'dark';

export const THEMES: Theme[] = ['system', 'light', 'dark'];

const THEME_KEY = 'spendly.theme';
const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set<() => void>();

function savedTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

export let theme: Theme = savedTheme();

export const isDark = (): boolean => (theme === 'system' ? !!darkQuery?.matches : theme === 'dark');

/** Puts the choice on <html>; the browser chrome (address/status bar) follows the page background. */
export function applyTheme(): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (bg) for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name=theme-color]')) meta.content = bg;
}

export function setTheme(t: Theme): void {
  theme = t;
  try {
    if (t === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    /* storage unavailable */
  }
  applyTheme();
  listeners.forEach((fn) => fn());
}

/** Called when the effective theme may have changed (user choice or system switch). */
export function onThemeChange(fn: () => void): void {
  listeners.add(fn);
}

darkQuery?.addEventListener('change', () => {
  if (theme !== 'system') return;
  applyTheme();
  listeners.forEach((fn) => fn());
});
