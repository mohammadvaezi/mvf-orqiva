// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-150 | S15 | v0.1.0] Add the cloud tenant and harden sign-in, rate limits and headers ──
//    Why:  a second sign-in factor every authenticator app understands: TOTP (RFC 6238) on HOTP
//          (RFC 4226), written here on Node's HMAC. Secrets travel as base32 (RFC 4648); a code is accepted
//          one step either side of now (clock drift) and never twice, so a code seen over a shoulder cannot be
//          replayed.
import { createHmac, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31] ?? '';
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31] ?? '';
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 4226: the code for a counter. */
export function hotp(
  secret: Buffer,
  counter: number,
  digits = 6,
  algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1',
): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, secret).update(msg).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const bin =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    (((mac[offset + 1] ?? 0) & 0xff) << 16) |
    (((mac[offset + 2] ?? 0) & 0xff) << 8) |
    ((mac[offset + 3] ?? 0) & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const STEP_S = 30;
export const stepAt = (now: Date): number => Math.floor(now.getTime() / 1000 / STEP_S);

/** RFC 6238: the code at a moment. */
export const totp = (
  secret: Buffer,
  now: Date,
  digits = 6,
  algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1',
): string => hotp(secret, stepAt(now), digits, algorithm);

/** The step a code belongs to (now, or one either side), if it is right and newer than the last one used. */
export function matchTotp(
  secret: Buffer,
  code: string,
  now: Date,
  lastStep: number | null,
): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const at = stepAt(now);
  for (const step of [at, at - 1, at + 1])
    if ((lastStep === null || step > lastStep) && hotp(secret, step) === c) return step;
  return null;
}

export const newTotpSecret = (): Buffer => randomBytes(20);

/** The link authenticator apps read from a QR code. */
export const otpauthUri = (secret: Buffer, account: string): string =>
  'otpauth://totp/' +
  encodeURIComponent('Orqiva:' + account) +
  '?secret=' +
  base32Encode(secret) +
  '&issuer=Orqiva&algorithm=SHA1&digits=6&period=' +
  String(STEP_S);

/** Ten one-time recovery codes, xxxx-xxxx. */
export function recoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const s = randomBytes(5).toString('hex');
    return s.slice(0, 5) + '-' + s.slice(5);
  });
}
