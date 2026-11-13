// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-120 | S15 | v0.1.0] Build the agent runtime: agents, queued runs, model providers, tools with approvals, budgets, streamed steps ──
//    Why:  a customer's model key is a secret: it is stored only encrypted (AES-256-GCM) with the server's
//          own key from ORQIVA_SECRET_KEY, which never sits in the database. A database copy alone
//          reveals nothing; a server without the key cannot store or use provider keys and says so.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class SecretKeyMissing extends Error {
  constructor() {
    super(
      'The server has no ORQIVA_SECRET_KEY, so it cannot keep provider keys. Run orq install again or set it.',
    );
  }
}

/** The 32-byte key from the environment: base64 or hex. */
export function serverKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env['ORQIVA_SECRET_KEY'] ?? '';
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new SecretKeyMissing();
  return key;
}

/** "v1.<iv>.<tag>.<ciphertext>", all base64url. */
export function seal(plain: string, key: Buffer = serverKey()): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    c.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.');
}

export function open(sealed: string, key: Buffer = serverKey()): string {
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || body === undefined) throw new Error('not a sealed secret');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}
