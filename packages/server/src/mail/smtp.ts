// ── [PCODE-348 | S15 | v0.1.0] T35.2a Integrations hub; email-in for replies to messages and ideas by email ──
// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
//    Why:  our own SMTP client (RFC 5321) on node:net and node:tls, so the server keeps its one runtime
//          dependency. It speaks to any mail server: STARTTLS on the submission port (587), TLS from the
//          start (465), or plain only for a server on the local network. AUTH PLAIN or LOGIN when a user
//          is set. The message (RFC 5322 with MIME) carries a plain text and an HTML part, both base64, a
//          subject encoded for any language (RFC 2047), and a Message-ID of our own domain. Every step has
//          a timeout; an answer the server did not expect ends the attempt with the server's own words.
import { randomBytes } from 'node:crypto';
import * as net from 'node:net';
import * as tls from 'node:tls';

export type MailSecurity = 'starttls' | 'tls' | 'none';

export interface MailConfig {
  host: string;
  port: number;
  security: MailSecurity;
  user?: string;
  password?: string;
  /** "Orqiva <orqiva@example.com>" */
  from: string;
  /** the name this server greets with (EHLO); its public host by default */
  helo?: string;
  timeoutMs?: number;
  /** tests and private mail servers with their own certificate authority */
  tlsOptions?: tls.ConnectionOptions;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** [PCODE-348 | S15 | v0.1.0] where a reply goes: Orqiva's inbound address for this conversation */
  replyTo?: string;
}

export class SmtpError extends Error {
  constructor(
    message: string,
    /** a 4xx answer: try again later; a 5xx answer: this mail will not go */
    readonly temporary: boolean,
  ) {
    super(message);
    this.name = 'SmtpError';
  }
}

/** The address inside "Name <address>", or the text itself. */
export const addressOf = (from: string): string =>
  /<([^<>]+)>/.exec(from)?.[1]?.trim() ?? from.trim();

const ADDRESS = /^[^\s@<>"(),;:\\[\]]+@[^\s@<>"(),;:\\[\]]+\.[^\s@<>"(),;:\\[\]]+$/;
export const plausibleAddress = (a: string): boolean => a.length <= 254 && ADDRESS.test(a);

/** "=?UTF-8?B?…?=" when a header holds more than plain ASCII. */
export function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return '=?UTF-8?B?' + Buffer.from(value, 'utf8').toString('base64') + '?=';
}

const base64Lines = (text: string): string =>
  (
    Buffer.from(text, 'utf8')
      .toString('base64')
      .match(/.{1,76}/g) ?? []
  ).join('\r\n');

/** The message as sent after DATA, without the final dot; lines end in CRLF. */
export function buildMessage(
  cfg: Pick<MailConfig, 'from'>,
  m: MailMessage,
  now: Date = new Date(),
  id: string = randomBytes(12).toString('hex'),
): string {
  const domain = addressOf(cfg.from).split('@')[1] ?? 'localhost';
  const fromName = /^(.*?)\s*<[^<>]+>$/.exec(cfg.from)?.[1]?.replace(/^"|"$/g, '') ?? '';
  const from = fromName
    ? encodeHeader(fromName) + ' <' + addressOf(cfg.from) + '>'
    : addressOf(cfg.from);
  const headers = [
    'From: ' + from,
    'To: ' + m.to,
    'Subject: ' + encodeHeader(m.subject.replace(/[\r\n]+/g, ' ')),
    'Date: ' + now.toUTCString().replace('GMT', '+0000'),
    'Message-ID: <' + id + '@' + domain + '>',
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    ...(m.replyTo ? ['Reply-To: ' + m.replyTo.replace(/[\r\n<>]+/g, '')] : []), // [PCODE-348 | S15 | v0.1.0]
  ];
  const text = m.text.replace(/\r?\n/g, '\r\n');
  if (!m.html) {
    return [
      ...headers,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(text),
    ].join('\r\n');
  }
  const boundary = 'orqiva-' + randomBytes(9).toString('hex');
  return [
    ...headers,
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(text),
    '--' + boundary,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(m.html),
    '--' + boundary + '--',
  ].join('\r\n');
}

/** Reads SMTP replies (one or more lines "250-…", last one "250 …") from a socket. */
class Replies {
  private buf = '';
  private waiting: ((r: { code: number; text: string }) => void) | null = null;
  private failure: ((e: Error) => void) | null = null;
  private socket: net.Socket | tls.TLSSocket;

  constructor(socket: net.Socket | tls.TLSSocket) {
    this.socket = socket;
    this.attach(socket);
  }

  private onData: ((chunk: Buffer) => void) | null = null;
  private onError: ((e: Error) => void) | null = null;
  private onClose: (() => void) | null = null;

  /** Reads from this socket from now on (after STARTTLS: the TLS socket, never the raw one again). */
  attach(socket: net.Socket | tls.TLSSocket): void {
    const old = this.socket;
    if (this.onData) old.off('data', this.onData);
    if (this.onError) old.off('error', this.onError);
    if (this.onClose) old.off('close', this.onClose);
    this.socket = socket;
    this.buf = '';
    // bytes, not text: the raw socket must stay a byte stream for the TLS layer that may take it over
    this.onData = (chunk: Buffer) => {
      this.buf += chunk.toString('utf8');
      this.drain();
    };
    this.onError = (e: Error) => this.failure?.(e);
    this.onClose = () =>
      this.failure?.(new SmtpError('The mail server closed the connection', true));
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  private drain(): void {
    const lines = this.buf.split('\r\n');
    // a reply is complete at a line whose fourth character is a space
    const end = lines.findIndex((l) => /^\d{3} /.test(l) || /^\d{3}$/.test(l));
    if (end < 0 || !this.waiting) return;
    const reply = lines.slice(0, end + 1);
    this.buf = lines.slice(end + 1).join('\r\n');
    const last = reply[reply.length - 1] ?? '';
    const w = this.waiting;
    this.waiting = null;
    this.failure = null;
    w({ code: Number(last.slice(0, 3)), text: reply.map((l) => l.slice(4)).join('\n') });
  }

  next(timeoutMs: number): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.waiting = null;
        reject(new SmtpError('The mail server did not answer in time', true));
      }, timeoutMs);
      this.waiting = (r) => {
        clearTimeout(t);
        resolve(r);
      };
      this.failure = (e) => {
        clearTimeout(t);
        this.waiting = null;
        reject(e);
      };
      this.drain();
    });
  }

  write(line: string): void {
    this.socket.write(line + '\r\n');
  }

  get current(): net.Socket | tls.TLSSocket {
    return this.socket;
  }
}

function connect(cfg: MailConfig): Promise<net.Socket | tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const timeout = cfg.timeoutMs ?? 15_000;
    const socket =
      cfg.security === 'tls'
        ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, ...cfg.tlsOptions })
        : net.connect({ host: cfg.host, port: cfg.port });
    const t = setTimeout(() => {
      socket.destroy();
      reject(
        new SmtpError('Cannot reach the mail server ' + cfg.host + ':' + String(cfg.port), true),
      );
    }, timeout);
    socket.once(cfg.security === 'tls' ? 'secureConnect' : 'connect', () => {
      clearTimeout(t);
      resolve(socket);
    });
    socket.once('error', (e: Error) => {
      clearTimeout(t);
      reject(new SmtpError('Cannot reach the mail server: ' + e.message, true));
    });
  });
}

/** Sends one message; resolves when the server accepted it for delivery. */
export async function sendMail(cfg: MailConfig, m: MailMessage): Promise<void> {
  if (!plausibleAddress(m.to)) throw new SmtpError('Not an email address: ' + m.to, false);
  const timeout = cfg.timeoutMs ?? 15_000;
  const socket = await connect(cfg);
  const r = new Replies(socket);
  const expect = async (codes: number[], what: string): Promise<string> => {
    const reply = await r.next(timeout);
    if (!codes.includes(reply.code))
      throw new SmtpError(
        what + ': ' + String(reply.code) + ' ' + (reply.text.split('\n')[0] ?? ''),
        reply.code >= 400 && reply.code < 500,
      );
    return reply.text;
  };
  const say = async (line: string, codes: number[], what: string): Promise<string> => {
    r.write(line);
    return expect(codes, what);
  };
  try {
    await expect([220], 'Greeting');
    const helo = cfg.helo ?? 'orqiva.local';
    let ehlo = await say('EHLO ' + helo, [250], 'EHLO');
    if (cfg.security === 'starttls') {
      if (!/^STARTTLS\b/im.test(ehlo))
        throw new SmtpError('The mail server offers no STARTTLS; set ORQIVA_SMTP_SECURITY', false);
      await say('STARTTLS', [220], 'STARTTLS');
      const secure = tls.connect({
        socket: r.current,
        servername: cfg.host,
        ...cfg.tlsOptions,
      });
      await new Promise<void>((resolve, reject) => {
        secure.once('secureConnect', resolve);
        secure.once('error', reject);
      });
      r.attach(secure);
      ehlo = await say('EHLO ' + helo, [250], 'EHLO after STARTTLS');
    }
    if (cfg.user) {
      const auth = /^AUTH\b(.*)$/im.exec(ehlo)?.[1]?.toUpperCase() ?? '';
      if (/\bPLAIN\b/.test(auth) || !/\bLOGIN\b/.test(auth)) {
        const token = Buffer.from('\0' + cfg.user + '\0' + (cfg.password ?? '')).toString('base64');
        await say('AUTH PLAIN ' + token, [235], 'Sign-in');
      } else {
        await say('AUTH LOGIN', [334], 'Sign-in');
        await say(Buffer.from(cfg.user).toString('base64'), [334], 'Sign-in');
        await say(Buffer.from(cfg.password ?? '').toString('base64'), [235], 'Sign-in');
      }
    }
    await say('MAIL FROM:<' + addressOf(cfg.from) + '>', [250], 'Sender');
    await say('RCPT TO:<' + m.to + '>', [250, 251], 'Recipient');
    await say('DATA', [354], 'DATA');
    // a line that starts with a dot gets a second one (RFC 5321 4.5.2)
    const body = buildMessage(cfg, m).replace(/^\./gm, '..');
    r.write(body + '\r\n.');
    await expect([250], 'Message');
    r.write('QUIT');
  } finally {
    setTimeout(() => {
      r.current.destroy();
    }, 50).unref();
  }
}
