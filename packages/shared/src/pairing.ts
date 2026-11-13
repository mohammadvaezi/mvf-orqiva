// ── [PCODE-224 | S15 | v0.1.0] T21.1 Phone sign-in by pairing code, device tokens, QR code in the web app ──
//    Why:  how a phone signs in. The web app makes a pairing code and shows it as a QR code holding a link
//          (orqiva://pair?server=…&code=…) and as eight characters to type. The phone reads either and
//          redeems the code for a device token. The alphabet leaves out characters people confuse (0/O,
//          1/I/L, U/V), and typing ignores case, spaces and dashes.

export const PAIRING_ALPHABET = '23456789ABCDEFGHJKMNPQRSTWXYZ';
export const PAIRING_CODE_LENGTH = 8;
/** How long a pairing code works, in minutes. */
export const PAIRING_MINUTES = 10;
export const PAIRING_SCHEME = 'orqiva';

/** A code as typed ("ab3k-7mqx") in its stored form ("AB3K7MQX"), or null when it cannot be one. */
export function normalizePairingCode(typed: string): string | null {
  const code = typed.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== PAIRING_CODE_LENGTH) return null;
  for (const ch of code) if (!PAIRING_ALPHABET.includes(ch)) return null;
  return code;
}

/** A code for people to read: two groups of four. */
export const pairingCodeText = (code: string): string => code.slice(0, 4) + '-' + code.slice(4);

/** The server's address as people type it ("orqiva.example.com") with a scheme and without a trailing slash. */
export function normalizeServer(typed: string): string | null {
  let t = typed.trim();
  if (!t) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
    if (!/^https?:\/\//i.test(t)) return null;
  } else t = 'https://' + t;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password || u.search || u.hash) return null;
    return (u.origin + u.pathname).replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** The link a QR code holds. */
export function pairingLink(server: string, code: string): string {
  return (
    PAIRING_SCHEME +
    '://pair?server=' +
    encodeURIComponent(server) +
    '&code=' +
    encodeURIComponent(code)
  );
}

/** A scanned or opened link as server and code, or null when it is not a pairing link. */
export function parsePairingLink(text: string): { server: string; code: string } | null {
  const m = /^orqiva:\/\/pair\?(.*)$/i.exec(text.trim());
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const server = normalizeServer(q.get('server') ?? '');
  const code = normalizePairingCode(q.get('code') ?? '');
  return server && code ? { server, code } : null;
}
