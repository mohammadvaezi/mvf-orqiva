// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
//    Why:  numbers, money, dates and times follow the workspace's "Number and money format" setting
//          (German by default, the owner's decision at gate A1; English when a workspace chooses it),
//          not a locale written into each screen.

let current = 'de-DE';

/** The locale every screen formats numbers, dates and times with. */
export const fmtLocale = (): string => current;

/** Set once the workspace's settings are read. */
export function setFormatLocale(value: unknown): void {
  if (value === 'de-DE' || value === 'en-GB') current = value;
}
