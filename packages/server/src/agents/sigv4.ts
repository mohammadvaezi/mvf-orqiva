// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
//    Why:  Amazon Bedrock with access keys wants each request signed with AWS Signature Version 4. It is a
//          short, well-specified algorithm (a canonical request, a string to sign, a key derived by HMAC
//          from the secret, the date, the region and the service), so it is written here instead of
//          pulling in the AWS SDK. The path is encoded once more for the signature, as every AWS service
//          except S3 expects; Bedrock's model ids contain a colon, which makes this matter.
import { createHash, createHmac } from 'node:crypto';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SignInput {
  method: string;
  url: string;
  region: string;
  service: string;
  headers: Record<string, string>;
  body: string;
  credentials: AwsCredentials;
  now?: Date;
}

const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');
const hmac = (key: Buffer | string, s: string): Buffer =>
  createHmac('sha256', key).update(s).digest();

/** RFC 3986: everything but the unreserved characters percent-encoded. */
const rfc3986 = (s: string): string =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );

/** The headers to send: the given ones plus host, x-amz-date, the session token and Authorization. */
export function signRequest(i: SignInput): Record<string, string> {
  const url = new URL(i.url);
  const now = i.now ?? new Date();
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...i.headers,
    host: url.host,
    'x-amz-date': amzDate,
    ...(i.credentials.sessionToken ? { 'x-amz-security-token': i.credentials.sessionToken } : {}),
  };
  const lower = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = lower.map(([k]) => k).join(';');
  const canonicalHeaders = lower.map(([k, v]) => k + ':' + v + '\n').join('');
  const path =
    url.pathname
      .split('/')
      .map((seg) => rfc3986(seg))
      .join('/') || '/';
  const query = [...url.searchParams.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => k + '=' + v)
    .join('&');
  const canonical = [
    i.method.toUpperCase(),
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    sha256(i.body),
  ].join('\n');
  const scope = day + '/' + i.region + '/' + i.service + '/aws4_request';
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(
    hmac(hmac(hmac('AWS4' + i.credentials.secretAccessKey, day), i.region), i.service),
    'aws4_request',
  );
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return {
    ...headers,
    authorization:
      'AWS4-HMAC-SHA256 Credential=' +
      i.credentials.accessKeyId +
      '/' +
      scope +
      ', SignedHeaders=' +
      signedHeaders +
      ', Signature=' +
      signature,
  };
}
