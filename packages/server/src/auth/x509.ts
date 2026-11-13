// ── [PCODE-361 | S15 | v0.1.0] T35.7c SAML encrypted assertions ──
//    Why:  identity providers encrypt assertions to a certificate the service provider publishes. Node can
//          make keys but not certificates, so this writes the few DER structures of a self-signed X.509 v3
//          certificate (RSA with SHA-256, a common name, a validity) itself instead of taking a dependency.
import { randomBytes, sign, type KeyObject } from 'node:crypto';

function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, body: Buffer): Buffer =>
  Buffer.concat([Buffer.from([tag]), length(body.length), body]);
const sequence = (...parts: Buffer[]): Buffer => tlv(0x30, Buffer.concat(parts));
const set = (...parts: Buffer[]): Buffer => tlv(0x31, Buffer.concat(parts));
const NULL = Buffer.from([0x05, 0x00]);

/** A positive INTEGER from big-endian bytes. */
export function derInteger(bytes: Buffer): Buffer {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  const b = bytes.subarray(i);
  return tlv(0x02, (b[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
}

/** An OBJECT IDENTIFIER from its dotted form. */
export function derOid(dotted: string): Buffer {
  const [a = 0, b = 0, ...rest] = dotted.split('.').map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk: number[] = [];
    let v = n;
    do {
      chunk.unshift(v % 128);
      v = Math.floor(v / 128);
    } while (v > 0);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] = (chunk[i] ?? 0) | 0x80;
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

/** UTCTime before 2050, GeneralizedTime from then on (RFC 5280). */
function derTime(d: Date): Buffer {
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  return d.getUTCFullYear() < 2050
    ? tlv(0x17, Buffer.from(iso.slice(2)))
    : tlv(0x18, Buffer.from(iso));
}

const SHA256_RSA = sequence(derOid('1.2.840.113549.1.1.11'), NULL);
const nameOf = (cn: string): Buffer =>
  sequence(set(sequence(derOid('2.5.4.3'), tlv(0x0c, Buffer.from(cn, 'utf8')))));

/** A self-signed certificate (PEM) for an RSA key pair. */
export function selfSignedCertificate(o: {
  commonName: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  days: number;
  now?: Date;
}): string {
  const now = o.now ?? new Date();
  const serial = randomBytes(16);
  serial[0] = ((serial[0] ?? 0) & 0x7f) | 0x01;
  const name = nameOf(o.commonName);
  const tbs = sequence(
    tlv(0xa0, derInteger(Buffer.from([2]))),
    derInteger(serial),
    SHA256_RSA,
    name,
    sequence(derTime(now), derTime(new Date(now.getTime() + o.days * 86_400_000))),
    name,
    o.publicKey.export({ type: 'spki', format: 'der' }),
  );
  const signature = sign('sha256', tbs, o.privateKey);
  const der = sequence(tbs, SHA256_RSA, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  return (
    '-----BEGIN CERTIFICATE-----\n' +
    (der.toString('base64').match(/.{1,64}/g) ?? []).join('\n') +
    '\n-----END CERTIFICATE-----\n'
  );
}
