// ── [PCODE-339 | S15 | v0.1.0] T34.1d Portal magic-link sign-in and passwordless invitations, MFA required per client ──
// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
//    Why:  every mail Orqiva sends, as plain text and as simple HTML that mail programs show alike: what
//          happened, in a sentence, and the one link to act on it. Everything put into the HTML is escaped.
//          Short, plain words; no tracking pixels, no remote images.

export interface MailText {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

function page(
  title: string,
  paragraphs: string[],
  action?: { label: string; url: string },
): string {
  const button = action
    ? `<p style="margin:24px 0"><a href="${esc(action.url)}" style="background:#4b3fce;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${esc(action.label)}</a></p>
<p style="color:#7f7e9c;font-size:12px">Or open this address: ${esc(action.url)}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f7fc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#23224a">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #ecebf4;border-radius:10px;padding:24px">
<p style="color:#4b3fce;font-weight:700;margin:0 0 16px">Orqiva</p>
<h1 style="font-size:18px;margin:0 0 12px">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="line-height:1.5;margin:0 0 10px">${esc(p)}</p>`).join('\n')}
${button}
</div></body></html>`;
}

function mail(
  subject: string,
  paragraphs: string[],
  action?: { label: string; url: string },
): MailText {
  const text =
    paragraphs.join('\n\n') +
    (action ? '\n\n' + action.label + ': ' + action.url : '') +
    '\n\n— Orqiva\n';
  return { subject, text, html: page(subject, paragraphs, action) };
}

export const testMail = (to: string, server: string): MailText =>
  mail('Orqiva can send mail', [
    'This test mail went from ' + server + ' to ' + to + '.',
    'Password resets, invitations, notifications and the daily digest will come this way.',
  ]);

export const resetMail = (p: { name: string; url: string }): MailText =>
  mail(
    'Reset your Orqiva password',
    [
      'Hello ' + p.name + ',',
      'Someone asked to reset the password of your Orqiva account. If it was you, choose a new one with the link below. It works once, within the next hour.',
      'If it was not you, ignore this mail: your password stays as it is.',
    ],
    { label: 'Choose a new password', url: p.url },
  );

// [PCODE-339 | S15 | v0.1.0] a client contact's sign-in link
export const signInLinkMail = (p: { name: string; url: string; minutes: number }): MailText =>
  mail(
    'Your sign-in link',
    [
      'Hello ' + p.name + ',',
      'here is your link to sign in. It works once, for the next ' +
        String(p.minutes) +
        ' minutes.',
      'If you did not ask for it, ignore this mail: nobody can sign in without it.',
    ],
    { label: 'Sign in', url: p.url },
  );

export const invitationMail = (p: {
  workspace: string;
  inviter: string;
  url: string;
  client?: string | null;
}): MailText =>
  mail(
    p.client
      ? p.inviter + ' invites you to follow your projects with ' + p.workspace
      : p.inviter + ' invites you to ' + p.workspace + ' on Orqiva',
    p.client
      ? [
          p.inviter +
            ' from ' +
            p.workspace +
            ' invites you, for ' +
            p.client +
            ', to the client portal: your projects, what waits for your answer, releases and the conversation with the team.',
          'The link works for 14 days.',
        ]
      : [
          p.inviter + ' invites you to the workspace ' + p.workspace + ' on Orqiva.',
          'The link works for 14 days. If you do not want to join, ignore this mail.',
        ],
    { label: 'Accept the invitation', url: p.url },
  );

export const noticeMail = (p: { title: string; body: string; url: string }): MailText =>
  mail(p.title, p.body ? [p.body] : [], { label: 'Open in Orqiva', url: p.url });

export function digestMail(p: {
  name: string;
  workspace: string;
  items: { title: string; kind: string }[];
  unread: number;
  url: string;
}): MailText {
  const lines = [
    'Good morning ' + p.name + ', this is what waits for you in ' + p.workspace + '.',
    ...(p.items.length
      ? [
          (p.items.length === 1 ? '1 thing' : String(p.items.length) + ' things') +
            ' in your inbox: ' +
            p.items.map((i) => i.title).join(' · '),
        ]
      : []),
    ...(p.unread
      ? [
          (p.unread === 1 ? '1 unread message' : String(p.unread) + ' unread messages') +
            ' in your conversations.',
        ]
      : []),
  ];
  return mail('Your day in ' + p.workspace, lines, { label: 'Open Orqiva', url: p.url });
}

export const tokenExpiryMail = (p: {
  name: string;
  token: string;
  expiresAt: Date;
  url: string;
}): MailText =>
  mail(
    'Your token “' + p.token + '” runs out soon',
    [
      'Hello ' + p.name + ',',
      'Your access token “' +
        p.token +
        '” stops working on ' +
        p.expiresAt.toUTCString().slice(0, 16) +
        '. Whatever uses it (a script, CI, a phone) then needs a new one.',
    ],
    { label: 'See your tokens', url: p.url.replace(/\/$/, '') + '/settings/tokens' },
  );

export const statusUpdateMail = (p: {
  client: string;
  workspace: string;
  title: string;
  body: string;
  url: string;
}): MailText =>
  mail(
    'Status update: ' + p.title,
    [p.workspace + ' has an update for ' + p.client + ':', p.body],
    { label: 'See the status page', url: p.url },
  );
