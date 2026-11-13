// ── [PCODE-356 | S15 | v0.1.0] T35.5a Translation layer for a German UI, language choice, text extraction ──
//    Why:  which language a person sees: their own setting, else their workspace's, else (for a client's
//          contact) their client's, else what this browser used last, else the browser's own language. The
//          choice is kept, so the next visit (and its sign-in page) starts in it.
import { startTranslating, translator, type Dictionary } from './translate.js';

export type Language = 'en' | 'de';
const KEY = 'orqiva.lang';

/** The language to show. */
export function chooseLanguage(o: {
  user?: string | null;
  workspace?: string | null;
  client?: string | null;
  stored?: string | null;
  browser?: string | null;
}): Language {
  const pick = (v: string | null | undefined): Language | null =>
    v === 'de' || v?.toLowerCase().startsWith('de-')
      ? 'de'
      : v === 'en' || v?.toLowerCase().startsWith('en')
        ? 'en'
        : null;
  return (
    pick(o.user) ?? pick(o.workspace) ?? pick(o.client) ?? pick(o.stored) ?? pick(o.browser) ?? 'en'
  );
}

export function storedLanguage(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let current: Language = 'en';
let stop: (() => void) | null = null;

/** Shows the page in a language: German translates it as it changes; English shows it as written. */
export async function applyLanguage(lang: Language): Promise<void> {
  try {
    window.localStorage.setItem(KEY, lang);
  } catch {
    // kept for this page only
  }
  document.documentElement.lang = lang;
  if (lang === current && (lang === 'en' || stop)) return;
  current = lang;
  stop?.();
  stop = null;
  if (lang === 'en') {
    // the English texts come back with the next render; a reload shows them at once
    window.location.reload();
    return;
  }
  // the dictionary is a file of its own: only who reads German loads it
  const res = await fetch('/i18n/de.json').catch(() => null);
  const dict = res?.ok ? ((await res.json()) as Dictionary) : {};
  stop = startTranslating(document.body, translator(dict));
}

/** The language this page shows now. */
export const currentLanguage = (): Language => current;
