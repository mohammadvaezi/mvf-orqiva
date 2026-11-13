// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
//    Why:  Web Push without a library, on Node's crypto. A message is encrypted for one browser as RFC 8291
//          says (ECDH P-256 with the browser's key, HKDF-SHA256 with its auth secret, AES-128-GCM, the
//          aes128gcm content coding of RFC 8188), and the request carries a VAPID token (RFC 8292: an ES256
//          JWT for the push service's origin) so the service knows it is us.
import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';

export interface PushSubscription {
  endpoint: string;
  /** the browser's P-256 public key, uncompressed, base64url */
  p256dh: string;
  /** the browser's 16-byte auth secret, base64url */
  auth: string;
}

const b64u = (b: Buffer): string => b.toString('base64url');
const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, len: number): Buffer =>
  Buffer.from(hkdfSync('sha256', ikm, salt, info, len));

/**
 * RFC 8291: the body of a push message. The sender's key pair and the salt are made fresh for every message;
 * tests pass the RFC's own to check the result byte for byte.
 */
export function encryptPush(
  sub: Pick<PushSubscription, 'p256dh' | 'auth'>,
  plaintext: Buffer,
  fixed?: { senderPrivate: Buffer; salt: Buffer },
): Buffer {
  const uaPublic = Buffer.from(sub.p256dh, 'base64url');
  const authSecret = Buffer.from(sub.auth, 'base64url');
  const ecdh = createECDH('prime256v1');
  if (fixed) ecdh.setPrivateKey(fixed.senderPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const salt = fixed?.salt ?? randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);
  // one record: the plaintext, then the delimiter of the last record
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

export interface VapidKeys {
  /** PKCS#8 PEM of the P-256 private key */
  privatePem: string;
  /** the public key, uncompressed point, base64url: what browsers subscribe with */
  publicKey: string;
}

/** A new VAPID key pair. */
export function newVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { privatePem: pemOfP256(ecdh.getPrivateKey()), publicKey: b64u(ecdh.getPublicKey()) };
}

/** A raw 32-byte P-256 private key as PKCS#8 PEM: an ECPrivateKey (RFC 5915) under the P-256 OID. */
export function pemOfP256(d: Buffer): string {
  const pkcs8 = Buffer.concat([
    Buffer.from('3041020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420', 'hex'),
    d,
  ]);
  return (
    // [PCODE-216 | S15 | v0.1.0] pe-scan: ignore secret/private-key -- only the PEM frame; the key is made at runtime
    '-----BEGIN PRIVATE KEY-----\n' + pkcs8.toString('base64') + '\n-----END PRIVATE KEY-----\n'
  );
}

/** The browser's side of RFC 8291, for tests: opens a message with the subscription's private key. */
export function decryptPush(uaPrivate: Buffer, auth: string, message: Buffer): Buffer {
  const salt = message.subarray(0, 16);
  const idlen = message.readUInt8(20);
  const asPublic = message.subarray(21, 21 + idlen);
  const body = message.subarray(21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic]);
  const ikm = hkdf(Buffer.from(auth, 'base64url'), shared, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(body.subarray(body.length - 16));
  const padded = Buffer.concat([
    decipher.update(body.subarray(0, body.length - 16)),
    decipher.final(),
  ]);
  let end = padded.length - 1;
  while (end > 0 && padded[end] === 0) end--;
  return padded.subarray(0, end);
}

/** RFC 8292: the Authorization header for a push service, valid for twelve hours. */
export function vapidHeader(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now = new Date(),
): string {
  const aud = new URL(endpoint).origin;
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(
    Buffer.from(
      JSON.stringify({ aud, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: subject }),
    ),
  );
  const key: KeyObject = createPrivateKey(keys.privatePem);
  const sig = sign('sha256', Buffer.from(header + '.' + claims), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return 'vapid t=' + header + '.' + claims + '.' + b64u(sig) + ', k=' + keys.publicKey;
}

/** Sends one message; 'gone' when the browser unsubscribed (404, 410), so the subscription can be removed. */
export async function sendPush(
  sub: PushSubscription,
  payload: Record<string, unknown>,
  keys: VapidKeys,
  subject: string,
  fetchImpl: typeof fetch = fetch,
): Promise<'ok' | 'gone' | 'failed'> {
  const body = encryptPush(sub, Buffer.from(JSON.stringify(payload), 'utf8'));
  try {
    const res = await fetchImpl(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization: vapidHeader(sub.endpoint, keys, subject),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: '86400',
        urgency: 'normal',
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}
