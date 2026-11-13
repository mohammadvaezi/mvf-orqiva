// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
//    Why:  our own SMTP client against a local mail server: plain on the local network, STARTTLS, TLS from
//          the start, both sign-in methods, a message any mail program reads (subject in any language, a
//          text and an HTML part, dots doubled), and the server's "later" told apart from its "never".
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localParts, mailConfigFromEnv } from '../src/mail/outbox.js';
import {
  buildMessage,
  encodeHeader,
  sendMail,
  SmtpError,
  type MailConfig,
} from '../src/mail/smtp.js';
import { headerOf, testCertificate, TestSmtpServer, textOf } from './smtpserver.js';

const cert = testCertificate();

describe('the message', () => {
  it('writes the headers and both parts, and encodes a subject in any language', () => {
    const m = buildMessage(
      { from: 'Orqiva <orqiva@example.test>' },
      { to: 'ada@example.test', subject: 'Größe ändern', text: 'Hi\n.dot', html: '<p>Hi</p>' },
      new Date('2026-10-11T08:00:00Z'),
      'abc',
    );
    expect(headerOf(m, 'From')).toBe('Orqiva <orqiva@example.test>');
    expect(headerOf(m, 'Subject')).toBe(
      '=?UTF-8?B?' + Buffer.from('Größe ändern').toString('base64') + '?=',
    );
    expect(headerOf(m, 'Message-ID')).toBe('<abc@example.test>');
    expect(headerOf(m, 'Date')).toBe('Sun, 11 Oct 2026 08:00:00 +0000');
    expect(m).toContain('multipart/alternative');
    expect(textOf(m)).toBe('Hi\r\n.dot');
    expect(encodeHeader('plain')).toBe('plain');
  });

  it('reads its settings from the environment, or sends no mail', () => {
    expect(mailConfigFromEnv({})).toBeNull();
    expect(
      mailConfigFromEnv({
        ORQIVA_SMTP_HOST: 'mail.example.test',
        ORQIVA_MAIL_FROM: 'a@example.test',
      }),
    ).toMatchObject({ host: 'mail.example.test', port: 587, security: 'starttls' });
    expect(
      mailConfigFromEnv({
        ORQIVA_SMTP_HOST: 'mail.example.test',
        ORQIVA_MAIL_FROM: 'a@example.test',
        ORQIVA_SMTP_SECURITY: 'tls',
        ORQIVA_SMTP_USER: 'u',
        ORQIVA_SMTP_PASSWORD: 'p',
      }),
    ).toMatchObject({ port: 465, security: 'tls', user: 'u', password: 'p' });
    expect(
      mailConfigFromEnv({
        ORQIVA_SMTP_HOST: 'h',
        ORQIVA_MAIL_FROM: 'a@b.c',
        ORQIVA_SMTP_SECURITY: 'ssl3',
      }),
    ).toBeNull();
  });

  it('knows the hour and the day where a person lives', () => {
    const now = new Date('2026-10-11T05:30:00Z');
    expect(localParts(now, 'Europe/Berlin')).toEqual({ hour: 7, day: '2026-10-11' });
    expect(localParts(now, 'America/New_York')).toEqual({ hour: 1, day: '2026-10-11' });
    expect(localParts(now, 'Not/AZone')).toEqual({ hour: 5, day: '2026-10-11' });
  });
});

describe('sending', () => {
  const plain = new TestSmtpServer();
  const starttls = new TestSmtpServer({ cert });
  const implicit = new TestSmtpServer({ cert, implicitTls: true });
  const base = (port: number, extra: Partial<MailConfig> = {}): MailConfig => ({
    host: '127.0.0.1',
    port,
    security: 'none',
    from: 'Orqiva <orqiva@example.test>',
    timeoutMs: 3000,
    ...extra,
  });

  beforeAll(async () => {
    await plain.start();
    if (cert) {
      await starttls.start();
      await implicit.start();
    }
  });
  afterAll(async () => {
    await plain.stop();
    if (cert) {
      await starttls.stop();
      await implicit.stop();
    }
  });

  it('sends on the local network with AUTH PLAIN, dots doubled', async () => {
    await sendMail(base(plain.port, { user: 'orqiva', password: 'secret' }), {
      to: 'ada@example.test',
      subject: 'Hello',
      text: 'line one\n.starts with a dot',
    });
    const got = plain.received.at(-1);
    expect(got).toMatchObject({
      from: 'orqiva@example.test',
      to: ['ada@example.test'],
      auth: 'PLAIN orqiva:secret',
      tls: false,
    });
    expect(textOf(got?.data ?? '')).toBe('line one\r\n.starts with a dot');
  });

  it('tells "try later" from "never"', async () => {
    plain.refuse = ['451 4.3.0 try later'];
    await expect(
      sendMail(base(plain.port), { to: 'a@example.test', subject: 's', text: 't' }),
    ).rejects.toMatchObject({
      temporary: true,
    });
    plain.refuse = ['550 5.1.1 no such user'];
    const err = await sendMail(base(plain.port), {
      to: 'a@example.test',
      subject: 's',
      text: 't',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmtpError);
    expect(err).toMatchObject({ temporary: false });
    expect((err as Error).message).toContain('550');
    await expect(
      sendMail(base(plain.port), { to: 'not an address', subject: 's', text: 't' }),
    ).rejects.toMatchObject({ temporary: false });
    await expect(
      sendMail(base(1), { to: 'a@example.test', subject: 's', text: 't' }),
    ).rejects.toMatchObject({
      temporary: true,
    });
  });

  it.skipIf(!cert)('upgrades with STARTTLS and signs in with AUTH over TLS', async () => {
    await sendMail(
      base(starttls.port, {
        security: 'starttls',
        user: 'orqiva',
        password: 'secret',
        tlsOptions: { ca: cert?.cert ?? '' },
      }),
      { to: 'ada@example.test', subject: 'Over TLS', text: 'secure', html: '<b>secure</b>' },
    );
    expect(starttls.received.at(-1)).toMatchObject({ tls: true, auth: 'PLAIN orqiva:secret' });
  });

  it.skipIf(!cert)(
    'speaks TLS from the start (port 465 style), and refuses an unknown certificate',
    async () => {
      await sendMail(
        base(implicit.port, { security: 'tls', tlsOptions: { ca: cert?.cert ?? '' } }),
        {
          to: 'ada@example.test',
          subject: 'Implicit',
          text: 'tls',
        },
      );
      expect(implicit.received.at(-1)).toMatchObject({ tls: true });
      await expect(
        sendMail(base(implicit.port, { security: 'tls' }), {
          to: 'a@example.test',
          subject: 's',
          text: 't',
        }),
      ).rejects.toBeInstanceOf(SmtpError);
    },
  );

  it.skipIf(!cert)(
    'refuses to send in the clear when STARTTLS was asked for and is missing',
    async () => {
      await expect(
        sendMail(base(plain.port, { security: 'starttls' }), {
          to: 'a@example.test',
          subject: 's',
          text: 't',
        }),
      ).rejects.toThrow(/STARTTLS/);
    },
  );
});
