// ── [PCODE-348 | S15 | v0.1.0] T35.2a Integrations hub; email-in for replies to messages and ideas by email ──
//    Why:  only what the person wrote above the quote is kept; providers' JSON becomes one mail; the address
//          says what the mail is for, on our domain only.
import { describe, expect, it } from 'vitest';
import { bareAddress, inboundMail, inboundTarget, replyText } from '../src/emailin.js';

describe('email in', () => {
  it('keeps the reply above the quoted mail and the signature', () => {
    expect(replyText('Yes.\r\n\r\nOn Thu, 15 Oct 2026, Orqiva wrote:\r\n> old')).toBe('Yes.');
    expect(replyText('Passt.\nAm 15.10.2026 um 10:00 schrieb Orqiva <a@b.c>:\n> alt')).toBe(
      'Passt.',
    );
    expect(replyText('Fine\n-- \nBob\nCEO')).toBe('Fine');
    expect(replyText('a\n> quoted\nb')).toBe('a\nb');
    expect(replyText('> only quoted')).toBe('');
  });
  it('reads Postmark and plain JSON', () => {
    expect(
      inboundMail({
        FromFull: { Email: 'Bob@X.test' },
        ToFull: [{ Email: 'reply+abc@in.x' }],
        Subject: ' Re ',
        TextBody: 'hi',
      }),
    ).toEqual({ from: 'bob@x.test', to: ['reply+abc@in.x'], subject: 'Re', text: 'hi' });
    expect(
      inboundMail({
        from: 'Bob <bob@x.test>',
        to: 'a@x.test, B <b@y.test>',
        subject: 's',
        text: 't',
      })?.to,
    ).toEqual(['a@x.test', 'b@y.test']);
    expect(inboundMail({ from: 'nobody', to: 'a@x.test' })).toBeNull();
    expect(bareAddress(' Ada <ADA@x.test> ')).toBe('ada@x.test');
  });
  it('tells replies and ideas apart, on our domain only', () => {
    const t = 'a'.repeat(32);
    expect(inboundTarget('reply+' + t + '@In.X.test', 'in.x.test')).toEqual({
      kind: 'reply',
      token: t,
    });
    expect(inboundTarget('ideas+' + t + '@in.x.test', 'in.x.test')).toEqual({
      kind: 'ideas',
      token: t,
    });
    expect(inboundTarget('reply+' + t + '@other.test', 'in.x.test')).toBeNull();
    expect(inboundTarget('reply+short@in.x.test', 'in.x.test')).toBeNull();
    expect(inboundTarget('hello@in.x.test', 'in.x.test')).toBeNull();
  });
});
