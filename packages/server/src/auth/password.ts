// ── [PCODE-88 | S15 | v0.1.0] Implement authentication: email and password, sessions, OIDC login ──
//    Why:  passwords are stored as scrypt hashes (memory-hard, in Node's own crypto) with a random salt and
//          the cost parameters in the stored string, so the cost can rise later without breaking old hashes.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (
  password: string,
  salt: Buffer,
  keylen: number,
  opts: ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });

const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 128 * N * R * 2;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

/** "scrypt$N$r$p$salt$hash" (salt and hash base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(
    password.normalize('NFKC'),
    Buffer.from(salt, 'base64url'),
    expected.length,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 128 * Number(n) * Number(r) * 2,
    },
  );
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash that matches nothing, verified when the email is unknown so both paths take the same time. */
export const DUMMY_HASH =
  'scrypt$' +
  String(N) +
  '$8$1$' +
  Buffer.alloc(16).toString('base64url') +
  '$' +
  Buffer.alloc(KEYLEN).toString('base64url');
