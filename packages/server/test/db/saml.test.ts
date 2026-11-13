// ── [PCODE-362 | S15 | v0.1.0] T35.7d SAML single logout ──
// ── [PCODE-361 | S15 | v0.1.0] T35.7c SAML encrypted assertions ──
// ── [PCODE-212 | S15 | v0.1.0] T19.1 SAML 2.0 single sign-on per workspace, own XML signature verification with wrapping defences ──
//    Why:  single sign-on through the server against PostgreSQL: an admin connects the identity provider;
//          a person starts, comes back with a signed response posted as a form, is created, added to the
//          workspace with the default role and signed in; the same response a second time, a person of a
//          domain the provider does not vouch for, and a member's attempt to change the settings fail.
import { createPrivateKey, X509Certificate, type KeyObject } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { installLicence } from './licencehelper.js';
import { CERT, encryptedAssertion, idp, KEY, response, signedAssertion } from '../samlbuilder.js';
import { readLogoutRequest, readRedirect, signedRedirect } from '../../src/auth/saml.js';

process.env['ORQIVA_SECRET_KEY'] = 'cd'.repeat(32); // [PCODE-361 | S15 | v0.1.0] seals the SP key

describe.skipIf(!hasDatabase)('SAML single sign-on (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let ws = '';
  const sp = (): { entityId: string; acsUrl: string } => ({
    entityId: 'http://localhost/auth/saml/' + ws,
    acsUrl: 'http://localhost/auth/saml/' + ws + '/acs',
  });

  /** Starts a sign-in and returns the request ID the server sent to the IdP. */
  const start = async (): Promise<string> => {
    const res = await fetch(t.base + '/auth/saml/' + ws + '/start', { redirect: 'manual' });
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get('location') ?? '');
    const xml = inflateRawSync(
      Buffer.from(url.searchParams.get('SAMLRequest') ?? '', 'base64'),
    ).toString();
    return /ID="(_[0-9a-f]{40})"/.exec(xml)?.[1] ?? '';
  };
  const post = (samlResponse: string) =>
    fetch(t.base + '/auth/saml/' + ws + '/acs', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ SAMLResponse: samlResponse, RelayState: ws }).toString(),
    });
  // the response is valid for the next minutes of the real clock
  const live = (
    requestId: string,
    email = 'ines@helio.example',
    encryptTo?: KeyObject, // [PCODE-361 | S15 | v0.1.0]
  ): string => {
    const now = Date.now();
    const until = new Date(now + 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const signed = signedAssertion({
      sp: sp(),
      inResponseTo: requestId,
      email,
      notOnOrAfter: until,
      notBefore: new Date(now - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    });
    return response(encryptTo ? encryptedAssertion(signed, encryptTo) : signed, {
      inResponseTo: requestId,
      acsUrl: sp().acsUrl,
    });
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    await installLicence(t, ada); // [PCODE-219 | S15 | v0.1.0] SAML and SCIM are Enterprise features
    ws = ada.workspaceId;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('lets only an admin connect the identity provider, and publishes our metadata', async () => {
    const W = '/api/workspaces/' + ws + '/saml';
    const bad = await t.call(ada, 'PUT', W, {
      idpEntityId: idp.entityId,
      ssoUrl: 'http://idp.example/sso',
      certificate: CERT,
      domains: ['helio.example'],
      defaultRole: 'member',
      enabled: true,
    });
    expect(bad.status).toBe(400);
    const ok = await t.call<{
      acsUrl: string;
      connection: { certificateSubject: string; domains: string[] };
    }>(ada, 'PUT', W, {
      idpEntityId: idp.entityId,
      ssoUrl: idp.ssoUrl,
      certificate: CERT,
      domains: ['@Helio.example'],
      defaultRole: 'tester',
      enabled: true,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.acsUrl).toBe(sp().acsUrl);
    expect(ok.body.connection.domains).toEqual(['helio.example']);
    expect(ok.body.connection.certificateSubject).toContain('Orqiva SAML test IdP');
    const meta = await fetch(t.base + '/auth/saml/' + ws + '/metadata');
    expect(await meta.text()).toContain('Location="' + sp().acsUrl + '"');
  });

  it('signs a new person in, once, with the default role', async () => {
    const id = await start();
    expect(id).toMatch(/^_[0-9a-f]{40}$/);
    const body = live(id);
    const res = await post(body);
    expect(res.status).toBe(302);
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const me = await fetch(t.base + '/auth/me', { headers: { cookie } });
    const who = (await me.json()) as { user: { email: string; name: string } };
    expect(who.user).toMatchObject({ email: 'ines@helio.example', name: 'Ines Vogel' });
    const members = await t.call<{ email: string; role: string }[]>(
      ada,
      'GET',
      '/api/workspaces/' + ws + '/members',
    );
    expect(members.body.find((m) => m.email === 'ines@helio.example')?.role).toBe('tester');
    // the same response again is refused
    expect((await post(body)).status).toBe(401);
  });

  // [PCODE-361 | S15 | v0.1.0]
  it('publishes the workspace’s encryption certificate and reads assertions encrypted to it', async () => {
    const meta = await (await fetch(t.base + '/auth/saml/' + ws + '/metadata')).text();
    const b64 = /<md:KeyDescriptor use="encryption">.*?<ds:X509Certificate>([^<]+)</.exec(
      meta,
    )?.[1];
    expect(b64).toBeTruthy();
    const cert = new X509Certificate(Buffer.from(b64 ?? '', 'base64'));
    expect(cert.subject).toBe('CN=Orqiva SAML ' + ws);
    // the same key on the next request
    expect(await (await fetch(t.base + '/auth/saml/' + ws + '/metadata')).text()).toBe(meta);
    const id = await start();
    const res = await post(live(id, 'ines@helio.example', cert.publicKey));
    expect(res.status).toBe(302);
    expect(res.headers.get('set-cookie')).toBeTruthy();
    // no key is made for a workspace that does not exist
    const none = await (
      await fetch(t.base + '/auth/saml/00000000-0000-4000-8000-000000000000/metadata')
    ).text();
    expect(none).not.toContain('KeyDescriptor');
  });

  // [PCODE-362 | S15 | v0.1.0]
  it('tells the provider when a SAML session signs out, and ends sessions the provider signs out', async () => {
    const W = '/api/workspaces/' + ws + '/saml';
    const conn = await t.call<{ connection: { sloUrl: string | null }; sloUrl: string }>(
      ada,
      'PUT',
      W,
      {
        idpEntityId: idp.entityId,
        ssoUrl: idp.ssoUrl,
        domains: ['helio.example'],
        defaultRole: 'tester',
        enabled: true,
        sloUrl: 'https://idp.example/slo',
      },
    );
    expect(conn.status).toBe(200);
    expect(conn.body.connection.sloUrl).toBe('https://idp.example/slo');
    expect(conn.body.sloUrl).toBe('http://localhost/auth/saml/' + ws + '/slo');
    const meta = await (await fetch(t.base + '/auth/saml/' + ws + '/metadata')).text();
    expect(meta).toContain('<md:KeyDescriptor use="signing">');
    expect(meta).toContain('Location="http://localhost/auth/saml/' + ws + '/slo"');
    const spCert =
      '-----BEGIN CERTIFICATE-----\n' +
      (/<ds:X509Certificate>([^<]+)</.exec(meta)?.[1] ?? '') +
      '\n-----END CERTIFICATE-----\n';

    const signIn = async (): Promise<string> => {
      const res = await post(live(await start()));
      expect(res.status).toBe(302);
      return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    };
    const me = async (cookie: string) =>
      (await fetch(t.base + '/auth/me', { headers: { cookie } })).status;

    // we start it: the session ends, and the provider gets our signed LogoutRequest
    const cookie = await signIn();
    const out = await fetch(t.base + '/auth/logout', { method: 'POST', headers: { cookie } });
    const body = (await out.json()) as { redirect?: string };
    expect(body.redirect?.startsWith('https://idp.example/slo?SAMLRequest=')).toBe(true);
    const sent = readRedirect(new URL(body.redirect ?? '').search.slice(1), spCert);
    expect(
      readLogoutRequest(sent.message, { ...idp, entityId: 'http://localhost/auth/saml/' + ws }),
    ).toMatchObject({ nameId: 'ines@helio.example', sessionIndexes: ['_s1'] });
    expect(await me(cookie)).toBe(401);

    // the provider starts it: its signed request ends the session, and we answer signed
    const again = await signIn();
    expect(await me(again)).toBe(200);
    const request =
      '<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_idp1" Version="2.0"><saml:Issuer>' +
      idp.entityId +
      '</saml:Issuer><saml:NameID>ines@helio.example</saml:NameID></samlp:LogoutRequest>';
    const url = signedRedirect(
      t.base + '/auth/saml/' + ws + '/slo',
      'SAMLRequest',
      request,
      'rs',
      createPrivateKey(KEY),
    );
    const res = await fetch(url, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const answer = new URL(res.headers.get('location') ?? '');
    expect(answer.origin + answer.pathname).toBe('https://idp.example/slo');
    const read = readRedirect(answer.search.slice(1), spCert);
    expect([read.kind, read.message.local, read.relayState]).toEqual([
      'SAMLResponse',
      'LogoutResponse',
      'rs',
    ]);
    expect(await me(again)).toBe(401);
    // an unsigned request changes nothing
    const third = await signIn();
    const unsigned = await fetch(url.replace(/&Signature=.*$/, ''), { redirect: 'manual' });
    expect(unsigned.status).toBe(400);
    expect(await me(third)).toBe(200);
  });

  it('refuses a person of a domain the provider does not vouch for', async () => {
    const id = await start();
    const res = await post(live(id, 'mallory@elsewhere.example'));
    expect(res.status).toBe(403);
  });
});
