// ── [PCODE-361 | S15 | v0.1.0] T35.7c SAML encrypted assertions ──
// ── [PCODE-212 | S15 | v0.1.0] T19.1 SAML 2.0 single sign-on per workspace, own XML signature verification with wrapping defences ──
//    Why:  signed SAML responses for the tests, made the way an identity provider makes them: the
//          assertion and SignedInfo written by hand in canonical form and signed with a test-only key
//          (test/fixtures, made for these tests and used nowhere else).
import {
  constants,
  createCipheriv,
  createHash,
  publicEncrypt,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';
import { readFileSync } from 'node:fs';

const fixture = (f: string): string =>
  readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
export const KEY = fixture('saml-idp-test.key');
export const CERT = fixture('saml-idp-test.crt');
export const OTHER_KEY = fixture('saml-other-test.key');
export const OTHER_CERT = fixture('saml-other-test.crt');
export const NOW = new Date('2026-10-10T10:00:00Z');
export const sp = {
  entityId: 'https://orqiva.example/auth/saml/ws1',
  acsUrl: 'https://orqiva.example/auth/saml/ws1/acs',
};
export const idp = {
  entityId: 'https://idp.example/saml',
  ssoUrl: 'https://idp.example/sso',
  certificate: CERT,
};
const S = 'urn:oasis:names:tc:SAML:2.0:assertion';
const DSN = 'http://www.w3.org/2000/09/xmldsig#';

export interface Opts {
  sp?: { entityId: string; acsUrl: string };
  inResponseTo?: string;
  audience?: string;
  notOnOrAfter?: string;
  notBefore?: string;
  key?: string;
  email?: string;
  tamper?: boolean;
}

/** The assertion in exclusive canonical form, without its signature. */
export function canonicalAssertion(o: Opts, id: string): string {
  const until = o.notOnOrAfter ?? '2026-10-10T10:05:00Z';
  return (
    '<saml:Assertion xmlns:saml="' +
    S +
    '" ID="' +
    id +
    '" IssueInstant="2026-10-10T09:59:58Z" Version="2.0">' +
    '<saml:Issuer>https://idp.example/saml</saml:Issuer>' +
    '<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">' +
    (o.email ?? 'ines@helio.example') +
    '</saml:NameID>' +
    '<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="' +
    (o.inResponseTo ?? '_req1') +
    '" NotOnOrAfter="' +
    until +
    '" Recipient="' +
    (o.sp ?? sp).acsUrl +
    '"></saml:SubjectConfirmationData></saml:SubjectConfirmation></saml:Subject>' +
    '<saml:Conditions NotBefore="' +
    (o.notBefore ?? '2026-10-10T09:59:00Z') +
    '" NotOnOrAfter="' +
    until +
    '"><saml:AudienceRestriction><saml:Audience>' +
    (o.audience ?? (o.sp ?? sp).entityId) +
    '</saml:Audience></saml:AudienceRestriction></saml:Conditions>' +
    '<saml:AuthnStatement AuthnInstant="2026-10-10T09:59:58Z" SessionIndex="_s1"></saml:AuthnStatement>' +
    '<saml:AttributeStatement><saml:Attribute Name="displayName"><saml:AttributeValue>Ines Vogel</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>' +
    '</saml:Assertion>'
  );
}

/** A signed assertion, embedded the way an IdP sends it (signature after the issuer). */
export function signedAssertion(o: Opts, id = '_a1'): string {
  const canon = canonicalAssertion(o, id);
  const digest = createHash('sha256').update(canon).digest('base64');
  const signedInfo =
    '<ds:SignedInfo xmlns:ds="' +
    DSN +
    '"><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></ds:CanonicalizationMethod>' +
    '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></ds:SignatureMethod>' +
    '<ds:Reference URI="#' +
    id +
    '"><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></ds:Transform>' +
    '<ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></ds:Transform></ds:Transforms>' +
    '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod><ds:DigestValue>' +
    digest +
    '</ds:DigestValue></ds:Reference></ds:SignedInfo>';
  const value = sign('sha256', Buffer.from(signedInfo), o.key ?? KEY).toString('base64');
  // in the document SignedInfo inherits ds from Signature, and the issuer is followed by the signature
  const sig =
    '<ds:Signature xmlns:ds="' +
    DSN +
    '">' +
    signedInfo.replace(' xmlns:ds="' + DSN + '"', '') +
    '<ds:SignatureValue>\n' +
    (value.match(/.{1,64}/g) ?? []).join('\n') +
    '\n</ds:SignatureValue></ds:Signature>';
  let body = canon.replace('</saml:Issuer>', '</saml:Issuer>' + sig);
  if (o.tamper) body = body.replace('ines@helio.example', 'admin@helio.example');
  return body;
}

export const response = (
  assertionXml: string,
  o: { inResponseTo?: string; doctype?: boolean; acsUrl?: string } = {},
): string =>
  Buffer.from(
    (o.doctype ? '<!DOCTYPE r [<!ENTITY x "y">]>' : '<?xml version="1.0" encoding="UTF-8"?>\n') +
      '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="' +
      S +
      '" xmlns:unused="urn:unused" ID="_r1" Version="2.0" ' +
      'IssueInstant="2026-10-10T09:59:58Z" Destination="' +
      (o.acsUrl ?? sp.acsUrl) +
      '" InResponseTo="' +
      (o.inResponseTo ?? '_req1') +
      '">\n  ' +
      '<saml:Issuer>https://idp.example/saml</saml:Issuer>\n  ' +
      '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>\n  ' +
      assertionXml +
      '\n</samlp:Response>',
  ).toString('base64');

// [PCODE-361 | S15 | v0.1.0] an assertion encrypted to the service provider's key, as identity providers send it
export function encryptedAssertion(
  assertionXml: string,
  spPublicKey: KeyObject,
  o: {
    content?: 'aes256-gcm' | 'aes128-cbc';
    transport?: 'oaep' | 'mgf1p' | 'rsa15';
    keyBeside?: boolean;
  } = {},
): string {
  const gcm = (o.content ?? 'aes256-gcm') === 'aes256-gcm';
  const key = randomBytes(gcm ? 32 : 16);
  let data: Buffer;
  if (gcm) {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    data = Buffer.concat([iv, c.update(assertionXml), c.final(), c.getAuthTag()]);
  } else {
    const iv = randomBytes(16);
    const c = createCipheriv('aes-128-cbc', key, iv);
    data = Buffer.concat([iv, c.update(assertionXml), c.final()]);
  }
  const transport = o.transport ?? 'oaep';
  const wrapped =
    transport === 'rsa15'
      ? publicEncrypt({ key: spPublicKey, padding: constants.RSA_PKCS1_PADDING }, key)
      : publicEncrypt(
          {
            key: spPublicKey,
            padding: constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: transport === 'oaep' ? 'sha256' : 'sha1',
          },
          key,
        );
  const X = 'http://www.w3.org/2001/04/xmlenc#';
  const X11 = 'http://www.w3.org/2009/xmlenc11#';
  const keyMethod =
    transport === 'oaep'
      ? '<xenc:EncryptionMethod Algorithm="' +
        X11 +
        'rsa-oaep"><ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="' +
        X +
        'sha256"/><xenc11:MGF xmlns:xenc11="' +
        X11 +
        '" Algorithm="' +
        X11 +
        'mgf1sha256"/></xenc:EncryptionMethod>'
      : '<xenc:EncryptionMethod Algorithm="' +
        X +
        (transport === 'rsa15' ? 'rsa-1_5' : 'rsa-oaep-mgf1p') +
        '"/>';
  const encryptedKey =
    '<xenc:EncryptedKey xmlns:xenc="' +
    X +
    '">' +
    keyMethod +
    '<xenc:CipherData><xenc:CipherValue>' +
    wrapped.toString('base64') +
    '</xenc:CipherValue></xenc:CipherData></xenc:EncryptedKey>';
  return (
    '<saml:EncryptedAssertion><xenc:EncryptedData xmlns:xenc="' +
    X +
    '" Type="http://www.w3.org/2001/04/xmlenc#Element"><xenc:EncryptionMethod Algorithm="' +
    (gcm ? X11 + 'aes256-gcm' : X + 'aes128-cbc') +
    '"/>' +
    (o.keyBeside
      ? ''
      : '<ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
        encryptedKey +
        '</ds:KeyInfo>') +
    '<xenc:CipherData><xenc:CipherValue>\n' +
    (data.toString('base64').match(/.{1,76}/g) ?? []).join('\n') +
    '\n</xenc:CipherValue></xenc:CipherData></xenc:EncryptedData>' +
    (o.keyBeside ? encryptedKey : '') +
    '</saml:EncryptedAssertion>'
  );
}
