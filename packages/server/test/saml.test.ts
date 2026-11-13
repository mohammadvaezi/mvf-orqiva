// ── [PCODE-362 | S15 | v0.1.0] T35.7d SAML single logout ──
// ── [PCODE-361 | S15 | v0.1.0] T35.7c SAML encrypted assertions ──
// ── [PCODE-212 | S15 | v0.1.0] T19.1 SAML 2.0 single sign-on per workspace, own XML signature verification with wrapping defences ──
//    Why:  the SAML check against responses built here the way an identity provider signs them: the
//          assertion and SignedInfo are written by hand in canonical form and signed with a test-only key,
//          then embedded in a response with extra namespaces and whitespace, so the canonicaliser must
//          reproduce the signed bytes on its own. Then every way a response must be refused: changed,
//          wrapped, expired, for another audience or request, with a DOCTYPE, signed by someone else.
import { createPrivateKey, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  authnRequestUrl,
  logoutRequestXml,
  logoutResponseXml,
  normaliseCertificate,
  readLogoutRequest,
  readRedirect,
  SamlError,
  signedRedirect,
  spMetadata,
  verifyResponse,
} from '../src/auth/saml.js';
import { derOid, selfSignedCertificate } from '../src/auth/x509.js';
import { canonicalize, parseXml, XmlError } from '../src/auth/xml.js';
import {
  canonicalAssertion,
  CERT,
  encryptedAssertion,
  idp,
  KEY,
  NOW,
  OTHER_CERT,
  OTHER_KEY,
  response,
  signedAssertion,
  sp,
} from './samlbuilder.js';

const check = (b64: string, requestId = '_req1', cert = CERT) =>
  verifyResponse(b64, { sp, idp: { ...idp, certificate: cert }, requestId, now: NOW });

describe('exclusive canonicalization', () => {
  it('writes only the namespaces an element uses, sorted, with attributes in order', () => {
    const doc = parseXml(
      '<a:r xmlns:a="urn:a" xmlns:b="urn:b" xmlns:c="urn:c"><b:x z="1" c:y="2" a="3"/>text &amp; &lt;</a:r>',
    );
    const x = doc.children[0];
    if (x?.kind !== 'element') throw new Error('no element');
    expect(canonicalize(x)).toBe('<b:x xmlns:b="urn:b" xmlns:c="urn:c" a="3" z="1" c:y="2"></b:x>');
    expect(canonicalize(doc)).toBe(
      '<a:r xmlns:a="urn:a"><b:x xmlns:b="urn:b" xmlns:c="urn:c" a="3" z="1" c:y="2"></b:x>text &amp; &lt;</a:r>',
    );
  });

  it('refuses DTDs, entities and unbound prefixes', () => {
    expect(() => parseXml('<!DOCTYPE x [<!ENTITY e "boom">]><x>&e;</x>')).toThrow(XmlError);
    expect(() => parseXml('<x>&e;</x>')).toThrow('Unknown entity');
    expect(() => parseXml('<p:x/>')).toThrow('Unbound prefix');
  });
});

describe('SAML responses', () => {
  it('accepts a correctly signed assertion and says who it is', () => {
    expect(check(response(signedAssertion({})))).toEqual({
      nameId: 'ines@helio.example',
      email: 'ines@helio.example',
      name: 'Ines Vogel',
      sessionIndex: '_s1',
      nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress', // [PCODE-362 | S15 | v0.1.0]
    });
  });

  it('refuses a changed assertion', () => {
    expect(() => check(response(signedAssertion({ tamper: true })))).toThrow(
      'The signed content was changed',
    );
  });

  it('refuses a signature by another key, or checked against another certificate', () => {
    expect(() => check(response(signedAssertion({ key: OTHER_KEY })))).toThrow('does not match');
    expect(() => check(response(signedAssertion({})), '_req1', OTHER_CERT)).toThrow(
      'does not match',
    );
  });

  it('refuses signature wrapping: a second assertion, or a duplicate ID', () => {
    const good = signedAssertion({});
    const evil = canonicalAssertion({ email: 'admin@helio.example' }, '_evil');
    expect(() => check(response(good + evil))).toThrow('exactly one assertion');
    const dupId = canonicalAssertion({ email: 'admin@helio.example' }, '_a1');
    // the signed one hidden in an extension, a forged one with the same ID read instead
    const wrapped = response('<samlp:Extensions>' + good + '</samlp:Extensions>' + dupId);
    expect(() => check(wrapped)).toThrow(SamlError);
  });

  it('refuses another request, another audience, an expired assertion and a DOCTYPE', () => {
    expect(() =>
      check(response(signedAssertion({ inResponseTo: '_other' }), { inResponseTo: '_other' })),
    ).toThrow('another request');
    expect(() => check(response(signedAssertion({})), '_req2')).toThrow('another request');
    expect(() => check(response(signedAssertion({ audience: 'https://evil.example' })))).toThrow(
      'another service',
    );
    expect(() =>
      check(response(signedAssertion({ notOnOrAfter: '2026-10-10T09:50:00Z' }))),
    ).toThrow(SamlError);
    expect(() => check(response(signedAssertion({}), { doctype: true }))).toThrow(
      'not acceptable XML',
    );
  });

  it('builds the redirect request and the metadata', () => {
    const url = new URL(authnRequestUrl(sp, idp, '_req1', 'rs', NOW));
    expect(url.origin + url.pathname).toBe('https://idp.example/sso');
    const xml = inflateRawSync(
      Buffer.from(url.searchParams.get('SAMLRequest') ?? '', 'base64'),
    ).toString();
    expect(xml).toContain('ID="_req1"');
    expect(xml).toContain('AssertionConsumerServiceURL="' + sp.acsUrl + '"');
    expect(url.searchParams.get('RelayState')).toBe('rs');
    expect(spMetadata(sp)).toContain('entityID="' + sp.entityId + '"');
    expect(normaliseCertificate(CERT.replace(/-----[A-Z ]+-----|\n/g, ''))).toBe(
      normaliseCertificate(CERT),
    );
    expect(() => normaliseCertificate('hello')).toThrow('not a certificate');
  });
});

// [PCODE-361 | S15 | v0.1.0]
describe('our own certificate', () => {
  it('writes object identifiers and a self-signed certificate that verifies', () => {
    expect(derOid('1.2.840.113549.1.1.11').toString('hex')).toBe('06092a864886f70d01010b');
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = selfSignedCertificate({
      commonName: 'Orqiva SAML ws1',
      privateKey,
      publicKey,
      days: 3650,
      now: NOW,
    });
    const cert = new X509Certificate(pem);
    expect(cert.subject).toBe('CN=Orqiva SAML ws1');
    expect(cert.issuer).toBe('CN=Orqiva SAML ws1');
    expect(cert.verify(publicKey)).toBe(true);
    expect(new Date(cert.validTo).getUTCFullYear()).toBe(2036);
    // it goes into the metadata for encryption, without the PEM lines
    const meta = spMetadata(sp, pem);
    expect(meta).toContain('<md:KeyDescriptor use="encryption">');
    expect(meta).not.toContain('BEGIN CERTIFICATE');
    expect(spMetadata(sp)).not.toContain('KeyDescriptor');
  });
});

describe('encrypted assertions', () => {
  const ours = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const theirs = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const read = (b64: string, key: typeof ours.privateKey | null = ours.privateKey) =>
    verifyResponse(b64, { sp, idp, requestId: '_req1', now: NOW, spKey: key });
  // the assertion leans on the response for its saml prefix, as many providers write it
  const bare = signedAssertion({}).replace(
    ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
    '',
  );

  it('reads AES-GCM with RSA-OAEP and AES-CBC with OAEP MGF1, the key inside or beside the data', () => {
    for (const enc of [
      encryptedAssertion(bare, ours.publicKey),
      encryptedAssertion(bare, ours.publicKey, { content: 'aes128-cbc', transport: 'mgf1p' }),
      encryptedAssertion(bare, ours.publicKey, { keyBeside: true }),
    ])
      expect(read(response(enc))).toMatchObject({
        nameId: 'ines@helio.example',
        sessionIndex: '_s1',
      });
  });

  it('refuses RSA 1.5, another key, no key, a changed assertion and an unsigned one', () => {
    expect(() =>
      read(response(encryptedAssertion(bare, ours.publicKey, { transport: 'rsa15' }))),
    ).toThrow('cannot be decrypted');
    expect(() => read(response(encryptedAssertion(bare, theirs.publicKey)))).toThrow(
      'cannot be decrypted',
    );
    expect(() => read(response(encryptedAssertion(bare, ours.publicKey)), null)).toThrow(
      'no key to read it',
    );
    expect(() =>
      read(response(encryptedAssertion(signedAssertion({ tamper: true }), ours.publicKey))),
    ).toThrow('The signed content was changed');
    expect(() =>
      read(response(encryptedAssertion(canonicalAssertion({}, '_a1'), ours.publicKey))),
    ).toThrow('not signed');
    // one assertion only: an encrypted one next to a plain one is refused
    expect(() =>
      read(response(encryptedAssertion(bare, ours.publicKey) + signedAssertion({}, '_a2'))),
    ).toThrow('exactly one assertion');
  });
});

// [PCODE-362 | S15 | v0.1.0]
describe('single logout over HTTP-Redirect', () => {
  const who = {
    nameId: 'ines@helio.example',
    nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    sessionIndex: '_s1',
  };
  const idpKey = createPrivateKey(KEY);

  it('signs a message that the other side reads back, and refuses a changed or unsigned one', () => {
    const xml = logoutRequestXml(sp, 'https://idp.example/slo', '_lr1', who, NOW);
    const url = new URL(
      signedRedirect('https://idp.example/slo?x=1', 'SAMLRequest', xml, 'back', idpKey),
    );
    expect(url.searchParams.get('x')).toBe('1');
    const query = url.search.slice(1).replace(/^x=1&/, '');
    const read = readRedirect(query, CERT);
    expect(read.kind).toBe('SAMLRequest');
    expect(read.relayState).toBe('back');
    expect(readLogoutRequest(read.message, { ...idp, entityId: sp.entityId }, NOW)).toEqual({
      id: '_lr1',
      nameId: 'ines@helio.example',
      sessionIndexes: ['_s1'],
    });
    expect(() =>
      readRedirect(query.replace('RelayState=back', 'RelayState=elsewhere'), CERT),
    ).toThrow('signature does not match');
    expect(() => readRedirect(query, OTHER_CERT)).toThrow('signature does not match');
    expect(() => readRedirect(query.replace(/&Signature=.*$/, ''), CERT)).toThrow('not signed');
    expect(() =>
      readRedirect(
        query.replace(
          /SigAlg=[^&]+/,
          'SigAlg=' + encodeURIComponent('http://www.w3.org/2000/09/xmldsig#rsa-sha1'),
        ),
        CERT,
      ),
    ).toThrow('Only RSA-SHA256');
  });

  it('reads who an IdP signs out, and refuses another issuer or an expired request', () => {
    const answer = logoutResponseXml(sp, 'https://idp.example/slo', '_r9', '_lr1', NOW);
    expect(answer).toContain('InResponseTo="_lr1"');
    const message = (issuer: string, until: string) =>
      readRedirect(
        new URL(
          signedRedirect(
            'https://orqiva.example/slo',
            'SAMLRequest',
            '<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_x" Version="2.0" NotOnOrAfter="' +
              until +
              '"><saml:Issuer>' +
              issuer +
              '</saml:Issuer><saml:NameID>ines@helio.example</saml:NameID></samlp:LogoutRequest>',
            null,
            idpKey,
          ),
        ).search.slice(1),
        CERT,
      ).message;
    expect(
      readLogoutRequest(message(idp.entityId, '2026-10-10T10:05:00Z'), idp, NOW).sessionIndexes,
    ).toEqual([]);
    expect(() =>
      readLogoutRequest(message('https://evil.example', '2026-10-10T10:05:00Z'), idp, NOW),
    ).toThrow('another identity provider');
    expect(() =>
      readLogoutRequest(message(idp.entityId, '2026-10-10T09:00:00Z'), idp, NOW),
    ).toThrow('expired');
  });
});
