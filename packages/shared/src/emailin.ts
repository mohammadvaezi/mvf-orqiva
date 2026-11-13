// ── [PCODE-348 | S15 | v0.1.0] T35.2a Integrations hub; email-in for replies to messages and ideas by email ──
//    Why:  mail that arrives for Orqiva: a reply to a notice keeps only what the person wrote above the
//          quoted mail; the address it went to says what it is for (a reply, ideas for a project); and the
//          mail providers' webhooks (Postmark-style or plain JSON) become one shape.

export interface InboundMail {
  from: string;
  to: string[];
  subject: string;
  text: string;
}

/** The bare address of "Name <a@b.c>", lower case. */
export function bareAddress(s: string): string {
  return (/<([^<>]+)>/.exec(s)?.[1] ?? s).trim().toLowerCase();
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A provider's JSON as one mail: Postmark (From, ToFull, TextBody, StrippedTextReply) or plain {from, to, subject, text}. */
export function inboundMail(body: Record<string, unknown>): InboundMail | null {
  const fromFull = body['FromFull'] as { Email?: unknown } | undefined;
  const from = bareAddress(str(fromFull?.Email) || str(body['From']) || str(body['from']));
  const toFull = Array.isArray(body['ToFull'])
    ? (body['ToFull'] as { Email?: unknown }[]).map((x) => str(x.Email))
    : [];
  const toRaw = body['to'] ?? body['To'] ?? '';
  const toList = toFull.length
    ? toFull
    : Array.isArray(toRaw)
      ? toRaw.map(str)
      : str(toRaw).split(',');
  const to = toList.map(bareAddress).filter((x) => x.includes('@'));
  const text =
    str(body['StrippedTextReply']) ||
    str(body['TextBody']) ||
    str(body['text']) ||
    str(body['stripped-text']);
  if (!from.includes('@') || !to.length) return null;
  return { from, to, subject: (str(body['Subject']) || str(body['subject'])).trim(), text };
}

const QUOTE_START = [
  /^On .{4,200} wrote:\s*$/,
  /^Am .{4,200} schrieb .{1,200}:\s*$/,
  /^-{2,}\s*(Original Message|Ursprüngliche Nachricht)\s*-{2,}/i,
  /^From: .+$/,
  /^Von: .+$/,
  /^_{10,}$/,
];

/** What the person wrote: the reply above the quoted mail and the signature, trimmed. */
export function replyText(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const l of lines) {
    const t = l.trim();
    if (QUOTE_START.some((r) => r.test(t))) break;
    if (t === '--' || t === '-- ') break;
    if (t.startsWith('>')) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}

/** What an address is for: a reply token, ideas for a project's token, or nothing known. */
export function inboundTarget(
  address: string,
  domain: string,
): { kind: 'reply' | 'ideas'; token: string } | null {
  const [local, host] = bareAddress(address).split('@');
  if (!local || !host || host !== domain.toLowerCase()) return null;
  const m = /^(reply|ideas)\+([a-z0-9]{16,64})$/.exec(local);
  return m?.[1] && m[2] ? { kind: m[1] as 'reply' | 'ideas', token: m[2] } : null;
}
