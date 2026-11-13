// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
//    Why:  who a comment mentions. "@ada" names a person by the part of the address before the @, or by
//          the name written without spaces ("@AdaLovelace"), in any case; the same rule for the web app's
//          hint and the server's notifications.

export interface Mentionable {
  id: string;
  name: string;
  email: string;
}

/** The handle shown when mentioning someone: their address before the @. */
export const handleOf = (p: Pick<Mentionable, 'email'>): string =>
  (p.email.split('@')[0] ?? '').toLowerCase();

/** The people a text mentions, each once, in the order of the list. */
export function mentionsIn<P extends Mentionable>(text: string, people: readonly P[]): P[] {
  const words = new Set<string>();
  for (const m of text.matchAll(/(?:^|[^\w@])@([\w][\w.-]*)/g)) {
    const w = (m[1] ?? '').replace(/[.-]+$/, '').toLowerCase();
    if (w) words.add(w);
  }
  if (!words.size) return [];
  return people.filter(
    (p) => words.has(handleOf(p)) || words.has(p.name.replace(/\s+/g, '').toLowerCase()),
  );
}
