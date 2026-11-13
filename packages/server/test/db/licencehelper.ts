// ── [PCODE-219 | S15 | v0.1.0] T20.2 Pricing and self-serve purchase for self-hosted customers (offers, buy flow, licence orders, plan enforcement) ──
//    Why:  features of a plan (SAML, SCIM) need a licence now; tests install one signed with a key made for
//          the test, as the vendor's would be.
import { generateKeyPairSync } from 'node:crypto';
import type { Licence } from '@orqiva/shared';
import { signLicence, useLicenceKeyForTests } from '../../src/licence/licence.js';
import type { Person, TestApp } from './apphelper.js';

const keys = generateKeyPairSync('ed25519');
export const TEST_SIGNING_KEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
useLicenceKeyForTests(keys.publicKey.export({ type: 'spki', format: 'pem' }).toString());

export const testLicence = (over: Partial<Licence> = {}): Licence => ({
  v: 1,
  id: 'lic-test',
  customer: 'Test GmbH',
  email: 'it@test.example',
  plan: 'enterprise',
  seats: 50,
  features: [],
  issued: '2026-10-01T00:00:00.000Z',
  expires: '2099-01-01T00:00:00.000Z',
  ...over,
});

/** Installs a licence (Enterprise unless told otherwise) on the person's workspace. */
export async function installLicence(
  t: TestApp,
  owner: Person,
  over: Partial<Licence> = {},
): Promise<void> {
  const r = await t.call(owner, 'PUT', '/api/workspaces/' + owner.workspaceId + '/licence', {
    token: signLicence(testLicence(over), TEST_SIGNING_KEY),
  });
  if (r.status !== 200) throw new Error('licence not installed: ' + String(r.status));
}
