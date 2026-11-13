// ── [PCODE-362 | S15 | v0.1.0] T35.7d SAML single logout ──
// ── [PCODE-361 | S15 | v0.1.0] T35.7c SAML encrypted assertions ──
// ── [PCODE-212 | S15 | v0.1.0] T19.1 SAML 2.0 single sign-on per workspace, own XML signature verification with wrapping defences ──
//    Why:  enterprises sign people in through their own identity provider. Orqiva is the service provider:
//          it sends an AuthnRequest by redirect and takes the signed response by POST. The check is strict
//          on purpose, because a SAML response is a bearer of identity: one signature algorithm family
//          (RSA with SHA-256), the signature must cover exactly the response or assertion we read (no
//          signature wrapping), the assertion must be for us, for this request, and in time.
import {
  createHash,
  createPublicKey,
  randomBytes,
  sign,
  verify,
  X509Certificate,
  type KeyObject,
} from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
  attr,
  canonicalize,
  child,
  children,
  descendants,
  parseXml,
  textOf,
  XmlError,
  type XmlElement,
} from './xml.js';
import { decryptElement } from './xmlenc.js'; // [PCODE-361 | S15 | v0.1.0]

export const SAMLP = 'urn:oasis:names:tc:SAML:2.0:protocol';
export const SAML = 'urn:oasis:names:tc:SAML:2.0:assertion';
export const DS = 'http://www.w3.org/2000/09/xmldsig#';
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const SUCCESS = 'urn:oasis:names:tc:SAML:2.0:status:Success';
const EXC_NS = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const SKEW_MS = 2 * 60_000;

export class SamlError extends Error {}

export interface SpConfig {
  /** our entity ID, and where the IdP posts back */
  entityId: string;
  acsUrl: string;
  /** [PCODE-362 | S15 | v0.1.0] where the IdP sends logout requests and answers */
  sloUrl?: string;
}
export interface IdpConfig {
  entityId: string;
  ssoUrl: string;
  /** the IdP's signing certificate, PEM or bare base64 */
  certificate: string;
}

const xmlEscape = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A new request ID: SAML IDs must not start with a digit. */
export const newRequestId = (): string => '_' + randomBytes(20).toString('hex');

/** The sign-in URL at the IdP: the AuthnRequest, deflated and base64'd, with the relay state. */
export function authnRequestUrl(
  sp: SpConfig,
  idp: IdpConfig,
  id: string,
  relayState: string,
  now = new Date(),
): string {
  const xml =
    '<samlp:AuthnRequest xmlns:samlp="' +
    SAMLP +
    '" xmlns:saml="' +
    SAML +
    '" ID="' +
    id +
    '" Version="2.0" IssueInstant="' +
    now.toISOString() +
    '" Destination="' +
    xmlEscape(idp.ssoUrl) +
    '" AssertionConsumerServiceURL="' +
    xmlEscape(sp.acsUrl) +
    '" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"><saml:Issuer>' +
    xmlEscape(sp.entityId) +
    '</saml:Issuer><samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/></samlp:AuthnRequest>';
  const url = new URL(idp.ssoUrl);
  url.searchParams.set('SAMLRequest', deflateRawSync(Buffer.from(xml)).toString('base64'));
  url.searchParams.set('RelayState', relayState);
  return url.toString();
}

/** Our service provider metadata, for the IdP's administrators. */
export function spMetadata(sp: SpConfig, encryptionCertificate?: string | null): string {
  // [PCODE-361 | S15 | v0.1.0] the certificate identity providers encrypt assertions to, and the methods we read
  const cert = encryptionCertificate
    ? encryptionCertificate.replace(/-----(BEGIN|END) CERTIFICATE-----|\s+/g, '')
    : '';
  const keyDescriptor = cert
    ? '<md:KeyDescriptor use="encryption"><ds:KeyInfo xmlns:ds="' +
      DS +
      '"><ds:X509Data><ds:X509Certificate>' +
      cert +
      '</ds:X509Certificate></ds:X509Data></ds:KeyInfo>' +
      [
        'http://www.w3.org/2009/xmlenc11#aes256-gcm',
        'http://www.w3.org/2009/xmlenc11#aes128-gcm',
        'http://www.w3.org/2001/04/xmlenc#aes256-cbc',
        'http://www.w3.org/2001/04/xmlenc#aes128-cbc',
        'http://www.w3.org/2009/xmlenc11#rsa-oaep',
        'http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p',
      ]
        .map((a) => '<md:EncryptionMethod Algorithm="' + a + '"/>')
        .join('') +
      '</md:KeyDescriptor>'
    : '';
  // [PCODE-362 | S15 | v0.1.0] the same certificate signs our logout messages; the logout address
  const signing = cert
    ? '<md:KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="' +
      DS +
      '"><ds:X509Data><ds:X509Certificate>' +
      cert +
      '</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>'
    : '';
  const logout =
    cert && sp.sloUrl
      ? '<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="' +
        xmlEscape(sp.sloUrl) +
        '"/>'
      : '';
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="' +
    xmlEscape(sp.entityId) +
    '"><md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="' +
    SAMLP +
    '">' +
    signing +
    keyDescriptor +
    logout +
    '<md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>' +
    '<md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="' +
    xmlEscape(sp.acsUrl) +
    '" index="0" isDefault="true"/></md:SPSSODescriptor></md:EntityDescriptor>\n'
  );
}

/** A PEM certificate from what an admin pastes (PEM or bare base64); refuses what is not a certificate. */
export function normaliseCertificate(text: string): string {
  const body = text.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]{100,}$/.test(body)) throw new SamlError('That is not a certificate');
  const pem =
    '-----BEGIN CERTIFICATE-----\n' +
    (body.match(/.{1,64}/g) ?? []).join('\n') +
    '\n-----END CERTIFICATE-----\n';
  try {
    new X509Certificate(pem);
  } catch {
    throw new SamlError('That is not a certificate');
  }
  return pem;
}

/** Checks one Signature element against the IdP's key; returns the element it covers. */
function checkSignature(sig: XmlElement, doc: XmlElement, idp: IdpConfig): XmlElement {
  const signedInfo = child(sig, DS, 'SignedInfo');
  if (!signedInfo) throw new SamlError('The signature has no SignedInfo');
  const c14n = attr(child(signedInfo, DS, 'CanonicalizationMethod') ?? signedInfo, 'Algorithm');
  if (c14n !== EXC_C14N) throw new SamlError('Only exclusive canonicalization is accepted');
  if (attr(child(signedInfo, DS, 'SignatureMethod') ?? signedInfo, 'Algorithm') !== RSA_SHA256)
    throw new SamlError('Only RSA-SHA256 signatures are accepted');
  const refs = children(signedInfo, DS, 'Reference');
  if (refs.length !== 1) throw new SamlError('A signature must cover exactly one element');
  const ref = refs[0] as XmlElement;
  const uri = attr(ref, 'URI') ?? '';
  if (!/^#[A-Za-z_][\w.-]*$/.test(uri))
    throw new SamlError('The signature must point at an element by its ID');
  const id = uri.slice(1);
  // the ID must be unique in the whole document: a duplicate is the classic wrapping trick
  const all: XmlElement[] = [];
  const walk = (x: XmlElement): void => {
    if (attr(x, 'ID') === id) all.push(x);
    for (const c of x.children) if (c.kind === 'element') walk(c);
  };
  walk(doc);
  if (all.length !== 1) throw new SamlError('The signed ID is not unique');
  const target = all[0] as XmlElement;
  // the signature must sit inside the element it signs (enveloped)
  if (sig.parent !== target)
    throw new SamlError('The signature must be inside the element it signs');
  const transforms = children(child(ref, DS, 'Transforms') ?? ref, DS, 'Transform');
  const algs = transforms.map((t) => attr(t, 'Algorithm'));
  if (
    !(algs.length === 2 && algs[0] === ENVELOPED && algs[1] === EXC_C14N) &&
    !(algs.length === 1 && algs[0] === ENVELOPED)
  )
    throw new SamlError('Unexpected transforms');
  const inclusiveOf = (e: XmlElement | undefined): string[] => {
    const list = e ? child(e, EXC_NS, 'InclusiveNamespaces') : undefined;
    return list ? (attr(list, 'PrefixList') ?? '').split(/\s+/).filter(Boolean) : [];
  };
  if (attr(child(ref, DS, 'DigestMethod') ?? ref, 'Algorithm') !== SHA256)
    throw new SamlError('Only SHA-256 digests are accepted');
  const digest = createHash('sha256')
    .update(canonicalize(target, { omit: sig, inclusive: inclusiveOf(transforms[1]) }), 'utf8')
    .digest('base64');
  const expected = textOf(child(ref, DS, 'DigestValue') ?? ref).replace(/\s+/g, '');
  if (digest !== expected) throw new SamlError('The signed content was changed');
  const sigValue = Buffer.from(
    textOf(child(sig, DS, 'SignatureValue') ?? sig).replace(/\s+/g, ''),
    'base64',
  );
  const signed = canonicalize(signedInfo, {
    inclusive: inclusiveOf(child(signedInfo, DS, 'CanonicalizationMethod')),
  });
  const key = createPublicKey(
    new X509Certificate(normaliseCertificate(idp.certificate)).publicKey.export({
      type: 'spki',
      format: 'pem',
    }),
  );
  if (!verify('sha256', Buffer.from(signed, 'utf8'), key, sigValue))
    throw new SamlError('The signature does not match the certificate');
  return target;
}

export interface SamlIdentity {
  nameId: string;
  email: string | null;
  name: string | null;
  sessionIndex: string | null;
  /** [PCODE-362 | S15 | v0.1.0] the NameID's format, sent back when signing out */
  nameIdFormat: string;
}

// [PCODE-361 | S15 | v0.1.0]
/** The assertion inside an EncryptedAssertion, parsed with the namespaces in scope where it sat. */
function decryptAssertion(
  sealed: XmlElement,
  key: KeyObject | null,
): { assertion: XmlElement; root: XmlElement } {
  if (!key)
    throw new SamlError(
      'The assertion is encrypted, but this server has no key to read it (ORQIVA_SECRET_KEY is not set)',
    );
  let text: string;
  try {
    text = decryptElement(sealed, key);
  } catch {
    throw new SamlError('The assertion cannot be decrypted with this workspace’s key');
  }
  const decls = [...sealed.scope.entries()]
    .map(([p, uri]) => (p ? ' xmlns:' + p : ' xmlns') + '="' + xmlEscape(uri) + '"')
    .join('');
  let root: XmlElement;
  try {
    root = parseXml(
      '<orqiva-decrypted' +
        decls +
        '>' +
        text.replace(/^\s*<\?xml[^>]*\?>/, '') +
        '</orqiva-decrypted>',
    );
  } catch {
    throw new SamlError('The decrypted assertion is not acceptable XML');
  }
  const inner = root.children.filter((n): n is XmlElement => n.kind === 'element');
  const assertion = inner[0];
  if (inner.length !== 1 || !assertion || assertion.ns !== SAML || assertion.local !== 'Assertion')
    throw new SamlError('The encrypted part is not one assertion');
  return { assertion, root };
}

/**
 * Checks a SAML response (base64 from the POST) for us and the request we sent; returns who it is.
 * Anything not exactly right is a SamlError.
 */
export function verifyResponse(
  base64: string,
  o: {
    sp: SpConfig;
    idp: IdpConfig;
    requestId: string;
    now?: Date;
    /** [PCODE-361 | S15 | v0.1.0] our key, to read an encrypted assertion; null when the server has none */
    spKey?: KeyObject | null;
  },
): SamlIdentity {
  const now = (o.now ?? new Date()).getTime();
  let doc: XmlElement;
  try {
    doc = parseXml(Buffer.from(base64, 'base64').toString('utf8'));
  } catch (e) {
    throw new SamlError(
      e instanceof XmlError
        ? 'The response is not acceptable XML: ' + e.message
        : 'The response cannot be read',
    );
  }
  if (doc.ns !== SAMLP || doc.local !== 'Response')
    throw new SamlError('This is not a SAML response');
  // [PCODE-361 | S15 | v0.1.0] an encrypted assertion is read with our key, then checked like a plain one
  const encrypted = descendants(doc, SAML, 'EncryptedAssertion');
  const plain = descendants(doc, SAML, 'Assertion');
  if (encrypted.length + plain.length !== 1)
    throw new SamlError('A response must carry exactly one assertion');
  const sealed = encrypted[0];
  if ((sealed ?? plain[0])?.parent !== doc)
    throw new SamlError('The assertion must sit directly in the response');
  const { assertion, root } = sealed
    ? decryptAssertion(sealed, o.spKey ?? null)
    : { assertion: plain[0] as XmlElement, root: doc };
  // which signatures are there: on the response, on the assertion (directly under each)
  const responseSig = child(doc, DS, 'Signature');
  const assertionSig = child(assertion, DS, 'Signature');
  if (!responseSig && !assertionSig) throw new SamlError('The response is not signed');
  const found =
    descendants(doc, DS, 'Signature').length +
    (sealed ? descendants(assertion, DS, 'Signature').length : 0);
  if (found > (responseSig ? 1 : 0) + (assertionSig ? 1 : 0))
    throw new SamlError('Signatures in unexpected places');
  if (responseSig && checkSignature(responseSig, doc, o.idp) !== doc)
    throw new SamlError('The response signature covers something else');
  if (assertionSig && checkSignature(assertionSig, root, o.idp) !== assertion)
    throw new SamlError('The assertion signature covers something else');

  const status = attr(
    child(child(doc, SAMLP, 'Status') ?? doc, SAMLP, 'StatusCode') ?? doc,
    'Value',
  );
  if (status !== SUCCESS) throw new SamlError('The identity provider did not sign you in');
  if (attr(doc, 'InResponseTo') !== o.requestId)
    throw new SamlError('This response answers another request');
  const dest = attr(doc, 'Destination');
  if (dest !== undefined && dest !== o.sp.acsUrl)
    throw new SamlError('This response is for another address');
  const issuers = [child(doc, SAML, 'Issuer'), child(assertion, SAML, 'Issuer')].filter(
    (x): x is XmlElement => x !== undefined,
  );
  if (!issuers.length || issuers.some((x) => textOf(x).trim() !== o.idp.entityId))
    throw new SamlError('The response comes from another identity provider');

  const subject = child(assertion, SAML, 'Subject');
  const nameIdEl = subject ? child(subject, SAML, 'NameID') : undefined;
  if (!subject || !nameIdEl) throw new SamlError('The assertion names nobody');
  const confirmations = children(subject, SAML, 'SubjectConfirmation').filter(
    (c) => attr(c, 'Method') === 'urn:oasis:names:tc:SAML:2.0:cm:bearer',
  );
  const confirmed = confirmations.some((c) => {
    const d = child(c, SAML, 'SubjectConfirmationData');
    if (!d) return false;
    const until = Date.parse(attr(d, 'NotOnOrAfter') ?? '');
    return (
      attr(d, 'Recipient') === o.sp.acsUrl &&
      attr(d, 'InResponseTo') === o.requestId &&
      Number.isFinite(until) &&
      now < until + SKEW_MS
    );
  });
  if (!confirmed) throw new SamlError('The assertion is not for this sign-in, or has expired');
  const cond = child(assertion, SAML, 'Conditions');
  if (!cond) throw new SamlError('The assertion has no conditions');
  const before = Date.parse(attr(cond, 'NotBefore') ?? '');
  const after = Date.parse(attr(cond, 'NotOnOrAfter') ?? '');
  if (
    !Number.isFinite(before) ||
    !Number.isFinite(after) ||
    now + SKEW_MS < before ||
    now >= after + SKEW_MS
  )
    throw new SamlError('The assertion is not valid now');
  const audiences = descendants(cond, SAML, 'Audience').map((a) => textOf(a).trim());
  if (!audiences.includes(o.sp.entityId))
    throw new SamlError('The assertion is meant for another service');

  const values = (names: string[]): string | null => {
    for (const a of descendants(assertion, SAML, 'Attribute')) {
      const n = (attr(a, 'Name') ?? '').toLowerCase();
      if (names.some((x) => n === x || n.endsWith('/' + x))) {
        const v = child(a, SAML, 'AttributeValue');
        if (v) return textOf(v).trim() || null;
      }
    }
    return null;
  };
  const nameId = textOf(nameIdEl).trim();
  const format = attr(nameIdEl, 'Format') ?? '';
  const email =
    values(['email', 'mail', 'emailaddress']) ??
    (format.endsWith('emailAddress') || nameId.includes('@') ? nameId : null);
  const authn = child(assertion, SAML, 'AuthnStatement');
  return {
    nameId,
    email: email ? email.toLowerCase() : null,
    name: values(['displayname', 'name', 'cn']),
    sessionIndex: authn ? (attr(authn, 'SessionIndex') ?? null) : null,
    nameIdFormat: format,
  };
}

// [PCODE-362 | S15 | v0.1.0] single logout over the HTTP-Redirect binding

/** Our LogoutRequest for a person the IdP signed in. */
export function logoutRequestXml(
  sp: SpConfig,
  destination: string,
  id: string,
  who: { nameId: string; nameIdFormat: string; sessionIndex: string | null },
  now = new Date(),
): string {
  return (
    '<samlp:LogoutRequest xmlns:samlp="' +
    SAMLP +
    '" xmlns:saml="' +
    SAML +
    '" ID="' +
    id +
    '" Version="2.0" IssueInstant="' +
    now.toISOString() +
    '" Destination="' +
    xmlEscape(destination) +
    '"><saml:Issuer>' +
    xmlEscape(sp.entityId) +
    '</saml:Issuer><saml:NameID' +
    (who.nameIdFormat ? ' Format="' + xmlEscape(who.nameIdFormat) + '"' : '') +
    '>' +
    xmlEscape(who.nameId) +
    '</saml:NameID>' +
    (who.sessionIndex
      ? '<samlp:SessionIndex>' + xmlEscape(who.sessionIndex) + '</samlp:SessionIndex>'
      : '') +
    '</samlp:LogoutRequest>'
  );
}

/** Our answer to the IdP's LogoutRequest. */
export function logoutResponseXml(
  sp: SpConfig,
  destination: string,
  id: string,
  inResponseTo: string,
  now = new Date(),
): string {
  return (
    '<samlp:LogoutResponse xmlns:samlp="' +
    SAMLP +
    '" xmlns:saml="' +
    SAML +
    '" ID="' +
    id +
    '" Version="2.0" IssueInstant="' +
    now.toISOString() +
    '" Destination="' +
    xmlEscape(destination) +
    '" InResponseTo="' +
    xmlEscape(inResponseTo) +
    '"><saml:Issuer>' +
    xmlEscape(sp.entityId) +
    '</saml:Issuer><samlp:Status><samlp:StatusCode Value="' +
    SUCCESS +
    '"/></samlp:Status></samlp:LogoutResponse>'
  );
}

/** A signed HTTP-Redirect URL carrying a SAML message (deflated, base64), signed with RSA-SHA256. */
export function signedRedirect(
  target: string,
  kind: 'SAMLRequest' | 'SAMLResponse',
  xml: string,
  relayState: string | null,
  key: KeyObject,
): string {
  const query =
    kind +
    '=' +
    encodeURIComponent(deflateRawSync(Buffer.from(xml)).toString('base64')) +
    (relayState ? '&RelayState=' + encodeURIComponent(relayState) : '') +
    '&SigAlg=' +
    encodeURIComponent(RSA_SHA256);
  const signature = sign('sha256', Buffer.from(query), key).toString('base64');
  return (
    target +
    (target.includes('?') ? '&' : '?') +
    query +
    '&Signature=' +
    encodeURIComponent(signature)
  );
}

/** A message that came by HTTP-Redirect, its signature checked against the IdP's certificate. The
 *  signed text is the query as it arrived (the raw, still-encoded values), in the binding's order. */
export function readRedirect(
  rawQuery: string,
  certificate: string,
): { kind: 'SAMLRequest' | 'SAMLResponse'; message: XmlElement; relayState: string | null } {
  const raw = new Map<string, string>();
  for (const part of rawQuery.split('&')) {
    const at = part.indexOf('=');
    if (at > 0) raw.set(part.slice(0, at), part.slice(at + 1));
  }
  const kind = raw.has('SAMLRequest')
    ? 'SAMLRequest'
    : raw.has('SAMLResponse')
      ? 'SAMLResponse'
      : null;
  const value = kind ? raw.get(kind) : undefined;
  if (!kind || value === undefined) throw new SamlError('No SAML message in the address');
  const decode = (v: string): string => decodeURIComponent(v.replace(/\+/g, ' '));
  const sigAlg = raw.get('SigAlg');
  const signature = raw.get('Signature');
  if (!sigAlg || !signature) throw new SamlError('The message is not signed');
  if (decode(sigAlg) !== RSA_SHA256) throw new SamlError('Only RSA-SHA256 signatures are accepted');
  const relay = raw.get('RelayState');
  const signed =
    kind + '=' + value + (relay !== undefined ? '&RelayState=' + relay : '') + '&SigAlg=' + sigAlg;
  let good = false;
  try {
    good = verify(
      'sha256',
      Buffer.from(signed),
      createPublicKey(certificate),
      Buffer.from(decode(signature), 'base64'),
    );
  } catch {
    good = false;
  }
  if (!good)
    throw new SamlError('The signature does not match the identity provider’s certificate');
  let message: XmlElement;
  try {
    message = parseXml(
      inflateRawSync(Buffer.from(decode(value), 'base64'), { maxOutputLength: 200_000 }).toString(
        'utf8',
      ),
    );
  } catch {
    throw new SamlError('The message cannot be read');
  }
  if (message.ns !== SAMLP) throw new SamlError('This is not a SAML message');
  return { kind, message, relayState: relay !== undefined ? decode(relay) : null };
}

/** Who an IdP's LogoutRequest signs out; refuses one from another provider or out of time. */
export function readLogoutRequest(
  message: XmlElement,
  idp: IdpConfig,
  now = new Date(),
): { id: string; nameId: string; sessionIndexes: string[] } {
  if (message.local !== 'LogoutRequest') throw new SamlError('This is not a logout request');
  const issuer = child(message, SAML, 'Issuer');
  if (!issuer || textOf(issuer).trim() !== idp.entityId)
    throw new SamlError('The request comes from another identity provider');
  const until = attr(message, 'NotOnOrAfter');
  if (until !== undefined && !(now.getTime() < Date.parse(until) + SKEW_MS))
    throw new SamlError('The logout request has expired');
  const id = attr(message, 'ID') ?? '';
  const nameIdEl = child(message, SAML, 'NameID');
  if (!id || !nameIdEl) throw new SamlError('The logout request names nobody');
  return {
    id,
    nameId: textOf(nameIdEl).trim(),
    sessionIndexes: children(message, SAMLP, 'SessionIndex').map((e) => textOf(e).trim()),
  };
}
