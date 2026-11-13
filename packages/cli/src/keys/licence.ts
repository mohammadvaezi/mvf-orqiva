// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-148 | S15 | v0.1.0] Add signed licence keys with seats, features and expiry ──
//    Why:  the vendor side of licences. `orq licence issue` signs a licence with the vendor's private key,
//          read from a file the vendor keeps (never from the repository, never printed); `orq licence
//          keygen` makes a new key pair once. The server checks the result offline with the public key.
import { generateKeyPairSync, randomUUID, sign, createPrivateKey } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { licenceProblems, PLANS, PREFIX, type Licence, type Plan } from '@orqiva/shared';

export class LicenceError extends Error {}

/** A licence signed with the private key, as the token customers install. */
export function signLicence(licence: Licence, privateKeyPem: string): string {
  const problems = licenceProblems(licence);
  if (problems.length) throw new LicenceError('The licence is incomplete: ' + problems.join('; '));
  const payload = Buffer.from(JSON.stringify(licence), 'utf8');
  const signature = sign(null, payload, createPrivateKey(privateKeyPem));
  return PREFIX + payload.toString('base64url') + '.' + signature.toString('base64url');
}

/** A licence from the command's options. */
export function licenceFrom(o: {
  customer: string;
  email: string;
  plan: string;
  seats: number;
  days: number | null;
  features: string[];
  now: Date;
}): Licence {
  if (!PLANS.includes(o.plan as Plan))
    throw new LicenceError('--plan is one of ' + PLANS.join(', '));
  return {
    v: 1,
    id: randomUUID(),
    customer: o.customer,
    email: o.email,
    plan: o.plan as Plan,
    seats: o.seats,
    features: o.features,
    issued: o.now.toISOString(),
    expires: o.days === null ? null : new Date(o.now.getTime() + o.days * 86_400_000).toISOString(),
  };
}

/** A new Ed25519 key pair: the private key into a file only its owner reads, the public key printed. */
export function keygen(dir: string): { privatePath: string; publicPem: string } {
  const privatePath = join(dir, 'licence-ed25519.pem');
  if (existsSync(privatePath))
    throw new LicenceError(
      privatePath + ' exists; a new key would orphan every licence signed with it',
    );
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  writeFileSync(join(dir, 'licence-ed25519.pub.pem'), publicPem);
  return { privatePath, publicPem };
}

export function readPrivateKey(path: string): string {
  if (!existsSync(path)) throw new LicenceError('No private key at ' + path);
  return readFileSync(path, 'utf8');
}
