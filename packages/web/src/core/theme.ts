// ── [PCODE-90 | S15 | v0.1.0] Build the web app shell with login and the ported design system ──
//    Why:  the page follows the system's light or dark setting; a person can pin one. The choice is a
//          per-browser convenience, so storage may fail (private windows) without breaking anything.

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'pe-theme';

export function storedTheme(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  try {
    if (choice === 'system') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, choice);
  } catch {
    // storage unavailable: the choice lasts for this page only
  }
}
