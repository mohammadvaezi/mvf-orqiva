// ── [PCODE-361 | S15 | v0.1.0] T35.7c SAML encrypted assertions ──
//    Why:  XML Encryption as identity providers use it for assertions: the content key travels encrypted
//          with RSA-OAEP to our key, the assertion with AES (CBC or GCM). RSA 1.5 key transport is refused
//          (it is open to padding-oracle attacks), and every failure reads the same to the sender.
import { constants, createDecipheriv, privateDecrypt, type KeyObject } from 'node:crypto';
import { attr, child, textOf, type XmlElement } from './xml.js';

export const XENC = 'http://www.w3.org/2001/04/xmlenc#';
export const XENC11 = 'http://www.w3.org/2009/xmlenc11#';
const DS = 'http://www.w3.org/2000/09/xmldsig#';

export class XmlEncError extends Error {}

const CONTENT: Record<string, { cipher: string; keyLength: number; gcm: boolean }> = {
  [XENC + 'aes128-cbc']: { cipher: 'aes-128-cbc', keyLength: 16, gcm: false },
  [XENC + 'aes256-cbc']: { cipher: 'aes-256-cbc', keyLength: 32, gcm: false },
  [XENC11 + 'aes128-gcm']: { cipher: 'aes-128-gcm', keyLength: 16, gcm: true },
  [XENC11 + 'aes256-gcm']: { cipher: 'aes-256-gcm', keyLength: 32, gcm: true },
};
const DIGESTS: Record<string, string> = {
  'http://www.w3.org/2000/09/xmldsig#sha1': 'sha1',
  'http://www.w3.org/2001/04/xmlenc#sha256': 'sha256',
  'http://www.w3.org/2001/04/xmlenc#sha512': 'sha512',
};
const MGFS: Record<string, string> = {
  [XENC11 + 'mgf1sha1']: 'sha1',
  [XENC11 + 'mgf1sha256']: 'sha256',
  [XENC11 + 'mgf1sha512']: 'sha512',
};

const cipherValue = (e: XmlElement | undefined): Buffer => {
  const v = e ? child(child(e, XENC, 'CipherData') ?? e, XENC, 'CipherValue') : undefined;
  if (!v) throw new XmlEncError('no cipher value');
  return Buffer.from(textOf(v).replace(/\s+/g, ''), 'base64');
};

/** The content key, from an EncryptedKey for our RSA key. */
function contentKey(encryptedKey: XmlElement, key: KeyObject): Buffer {
  const method = child(encryptedKey, XENC, 'EncryptionMethod');
  const algorithm = method ? attr(method, 'Algorithm') : undefined;
  const digestEl = method ? child(method, DS, 'DigestMethod') : undefined;
  const digest = digestEl ? DIGESTS[attr(digestEl, 'Algorithm') ?? ''] : 'sha1';
  let oaepHash: string;
  if (algorithm === XENC + 'rsa-oaep-mgf1p') {
    // MGF1 with SHA-1 by definition; Node uses one hash for both
    if (digest !== 'sha1') throw new XmlEncError('unsupported OAEP digest');
    oaepHash = 'sha1';
  } else if (algorithm === XENC11 + 'rsa-oaep') {
    const mgfEl = method ? child(method, XENC11, 'MGF') : undefined;
    const mgf = mgfEl ? MGFS[attr(mgfEl, 'Algorithm') ?? ''] : 'sha1';
    if (!digest || mgf !== digest) throw new XmlEncError('unsupported OAEP digest');
    oaepHash = digest;
  } else throw new XmlEncError('unsupported key transport');
  return privateDecrypt(
    { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash },
    cipherValue(encryptedKey),
  );
}

/** The plaintext of an encrypted element (EncryptedAssertion and alike), as UTF-8 text. */
export function decryptElement(wrapper: XmlElement, key: KeyObject): string {
  const data = child(wrapper, XENC, 'EncryptedData');
  if (!data) throw new XmlEncError('no encrypted data');
  const method = child(data, XENC, 'EncryptionMethod');
  const content = CONTENT[method ? (attr(method, 'Algorithm') ?? '') : ''];
  if (!content) throw new XmlEncError('unsupported content encryption');
  // the key sits in the data's KeyInfo, or next to the data (found by a RetrievalMethod)
  const keyInfo = child(data, DS, 'KeyInfo');
  const encryptedKey =
    (keyInfo ? child(keyInfo, XENC, 'EncryptedKey') : undefined) ??
    child(wrapper, XENC, 'EncryptedKey');
  if (!encryptedKey) throw new XmlEncError('no encrypted key');
  const k = contentKey(encryptedKey, key);
  if (k.length !== content.keyLength) throw new XmlEncError('wrong key length');
  const bytes = cipherValue(data);
  if (content.gcm) {
    if (bytes.length < 12 + 16) throw new XmlEncError('too short');
    const d = createDecipheriv(content.cipher as 'aes-256-gcm', k, bytes.subarray(0, 12));
    d.setAuthTag(bytes.subarray(bytes.length - 16));
    return Buffer.concat([d.update(bytes.subarray(12, bytes.length - 16)), d.final()]).toString(
      'utf8',
    );
  }
  if (bytes.length < 32 || bytes.length % 16) throw new XmlEncError('bad length');
  const d = createDecipheriv(content.cipher, k, bytes.subarray(0, 16));
  d.setAutoPadding(false);
  const plain = Buffer.concat([d.update(bytes.subarray(16)), d.final()]);
  // XML Encryption padding: the last byte says how many bytes to drop (their values are arbitrary)
  const pad = plain[plain.length - 1] ?? 0;
  if (pad < 1 || pad > 16) throw new XmlEncError('bad padding');
  return plain.subarray(0, plain.length - pad).toString('utf8');
}
