// ── [PCODE-436 | S15 | v0.1.0] T37 low: Untangle the three folder import cycles ──
//    Why:  how a moment reads on screen, for the old and the new screens.

/** "2026-10-03 01:42" in the reader's own time zone: the server sends UTC. */
export function localTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    String(d.getFullYear()) +
    '-' +
    p(d.getMonth() + 1) +
    '-' +
    p(d.getDate()) +
    ' ' +
    p(d.getHours()) +
    ':' +
    p(d.getMinutes())
  );
}
