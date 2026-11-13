// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
//    Why:  a mail server for tests, on node:net: it greets, answers EHLO with STARTTLS and AUTH, upgrades
//          to TLS with a certificate made for the run, takes MAIL, RCPT and DATA, and keeps what it got.
//          It can refuse the next mails with a temporary (4xx) or final (5xx) answer, so retries are tested.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tls from 'node:tls';

export interface Received {
  from: string;
  to: string[];
  data: string;
  auth: string | null;
  tls: boolean;
}

/** A certificate for 127.0.0.1 made by openssl for this run, or null when openssl is missing. */
export function testCertificate(): { key: string; cert: string } | null {
  const dir = mkdtempSync(join(tmpdir(), 'orq-smtp-'));
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(dir, 'k.pem'),
        '-out',
        join(dir, 'c.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
    return {
      key: readFileSync(join(dir, 'k.pem'), 'utf8'),
      cert: readFileSync(join(dir, 'c.pem'), 'utf8'),
    };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export class TestSmtpServer {
  readonly received: Received[] = [];
  /** answers for the next mails' RCPT, e.g. ['451 try later'] */
  refuse: string[] = [];
  port = 0;
  private server: net.Server;

  constructor(
    private readonly opts: {
      cert?: { key: string; cert: string } | null;
      /** implicit TLS (port 465 style) instead of STARTTLS */
      implicitTls?: boolean;
      requireAuth?: boolean;
    } = {},
  ) {
    const serve = (socket: net.Socket | tls.TLSSocket, secure: boolean): void => {
      this.session(socket, secure);
    };
    this.server =
      opts.implicitTls && opts.cert
        ? tls.createServer({ key: opts.cert.key, cert: opts.cert.cert }, (s) => {
            serve(s, true);
          })
        : net.createServer((s) => {
            serve(s, false);
          });
  }

  async start(): Promise<number> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as net.AddressInfo).port;
    return this.port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) =>
      this.server.close(() => {
        r();
      }),
    );
  }

  private session(first: net.Socket | tls.TLSSocket, startsSecure: boolean): void {
    let socket = first;
    let secure = startsSecure;
    let buf = '';
    let inData = false;
    let mail: Received = { from: '', to: [], data: '', auth: null, tls: secure };
    let auth: string | null = null;
    let loginStep: 0 | 1 | 2 = 0;
    let loginUser = '';
    const say = (line: string): void => {
      socket.write(line + '\r\n');
    };
    const onLine = (line: string): void => {
      if (inData) {
        if (line === '.') {
          inData = false;
          mail.data = mail.data.replace(/\r\n$/, '');
          this.received.push({ ...mail, auth, tls: secure });
          mail = { from: '', to: [], data: '', auth: null, tls: secure };
          say('250 2.0.0 queued');
        } else mail.data += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
        return;
      }
      if (loginStep === 1) {
        loginUser = Buffer.from(line, 'base64').toString();
        loginStep = 2;
        say('334 UGFzc3dvcmQ6');
        return;
      }
      if (loginStep === 2) {
        auth = 'LOGIN ' + loginUser + ':' + Buffer.from(line, 'base64').toString();
        loginStep = 0;
        say('235 2.7.0 ok');
        return;
      }
      const verb = line.split(' ')[0]?.toUpperCase() ?? '';
      if (verb === 'EHLO') {
        const caps = ['250-test.local'];
        if (this.opts.cert && !secure && !this.opts.implicitTls) caps.push('250-STARTTLS');
        caps.push('250 AUTH PLAIN LOGIN');
        for (const c of caps) say(c);
      } else if (verb === 'STARTTLS') {
        say('220 2.0.0 go ahead');
        const cert = this.opts.cert;
        if (!cert) return;
        socket.removeAllListeners('data');
        const upgraded = new tls.TLSSocket(socket, {
          isServer: true,
          key: cert.key,
          cert: cert.cert,
        });
        socket = upgraded;
        secure = true;
        buf = '';
        upgraded.on('data', onData);
        upgraded.on('error', () => undefined);
      } else if (verb === 'AUTH') {
        const [, mech, token] = line.split(' ');
        if (mech?.toUpperCase() === 'PLAIN') {
          const parts = Buffer.from(token ?? '', 'base64')
            .toString()
            .split('\0');
          auth = 'PLAIN ' + (parts[1] ?? '') + ':' + (parts[2] ?? '');
          say('235 2.7.0 ok');
        } else {
          loginStep = 1;
          say('334 VXNlcm5hbWU6');
        }
      } else if (verb === 'MAIL') {
        if (this.opts.requireAuth && !auth) {
          say('530 5.7.0 authentication required');
          return;
        }
        mail.from = /<([^>]*)>/.exec(line)?.[1] ?? '';
        say('250 2.1.0 ok');
      } else if (verb === 'RCPT') {
        const no = this.refuse.shift();
        if (no) {
          say(no);
          return;
        }
        mail.to.push(/<([^>]*)>/.exec(line)?.[1] ?? '');
        say('250 2.1.5 ok');
      } else if (verb === 'DATA') {
        inData = true;
        say('354 end with .');
      } else if (verb === 'QUIT') {
        say('221 2.0.0 bye');
        socket.end();
      } else say('502 5.5.2 not implemented');
    };
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString('utf8');
      let i = buf.indexOf('\r\n');
      while (i >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        onLine(line);
        i = buf.indexOf('\r\n');
      }
    };
    socket.on('data', onData);
    socket.on('error', () => undefined);
    say('220 test.local ESMTP ready');
  }
}

/** The text part of a received mail, decoded (it is sent as base64). */
export function textOf(data: string): string {
  const m =
    /Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?:\r\n--|$)/.exec(
      data,
    );
  return Buffer.from((m?.[1] ?? '').replace(/\r\n/g, ''), 'base64').toString('utf8');
}

export const headerOf = (data: string, name: string): string =>
  new RegExp('^' + name + ': (.*)$', 'mi').exec(data)?.[1] ?? '';

/** A header as people read it: "=?UTF-8?B?…?=" decoded. */
export const subjectOf = (data: string): string =>
  headerOf(data, 'Subject').replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g, (_m, b64: string) =>
    Buffer.from(b64, 'base64').toString('utf8'),
  );
