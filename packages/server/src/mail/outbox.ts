// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-348 | S15 | v0.1.0] T35.2a Integrations hub; email-in for replies to messages and ideas by email ──
// ── [PCODE-339 | S15 | v0.1.0] T34.1d Portal magic-link sign-in and passwordless invitations, MFA required per client ──
// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
//    Why:  where mail waits and how it leaves. The settings come from the server's environment (orq install
//          writes them to its .env, readable only by the server); without them the server sends no mail and
//          says so, and every flow that would mail offers its link instead. A mail is queued inside the same
//          transaction as what caused it, so it goes only if that was committed. The worker sends what is
//          due, one node at a time per mail (SKIP LOCKED), and tries again after 1, 5, 30 minutes, 2 and 6
//          hours; a mail server's final "no" (5xx) ends it at once. Daily work rides on the same worker: the
//          digest at 07:00 in each person's time zone, and notices for tokens that run out within 7 days.
import { readFileSync } from 'node:fs';
import type { Pool, PoolClient } from 'pg';
import { inSystem } from '../db/pool.js';
import { digestMail, tokenExpiryMail } from './templates.js';
import {
  sendMail,
  SmtpError,
  type MailConfig,
  type MailMessage,
  type MailSecurity,
} from './smtp.js';

export type MailKind =
  'test' | 'reset' | 'invitation' | 'notice' | 'digest' | 'token' | 'status' | 'signin'; // [PCODE-339 | S15 | v0.1.0]

/** The settings in the environment, or null when this server sends no mail. */
export function mailConfigFromEnv(env: NodeJS.ProcessEnv): MailConfig | null {
  const host = env['ORQIVA_SMTP_HOST']?.trim();
  const from = env['ORQIVA_MAIL_FROM']?.trim();
  if (!host || !from) return null;
  const security = (env['ORQIVA_SMTP_SECURITY'] ?? 'starttls') as MailSecurity;
  if (!['starttls', 'tls', 'none'].includes(security)) return null;
  const file = env['ORQIVA_SMTP_PASSWORD_FILE'];
  const password = file ? readFileSync(file, 'utf8').trim() : env['ORQIVA_SMTP_PASSWORD'];
  const user = env['ORQIVA_SMTP_USER']?.trim();
  return {
    host,
    port: Number(env['ORQIVA_SMTP_PORT'] ?? (security === 'tls' ? 465 : 587)),
    security,
    from,
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
    ...(env['ORQIVA_PUBLIC_URL'] ? { helo: new URL(env['ORQIVA_PUBLIC_URL']).hostname } : {}),
  };
}

/** Queues a mail; it leaves with the transaction's commit. */
export async function queueMail(
  c: PoolClient,
  m: MailMessage & { kind: MailKind; workspaceId?: string | null },
): Promise<void> {
  await c.query(
    `INSERT INTO mail_outbox (workspace_id, to_address, subject, text_body, html_body, kind, reply_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      m.workspaceId ?? null,
      m.to,
      m.subject.slice(0, 300),
      m.text,
      m.html ?? '',
      m.kind,
      m.replyTo ?? '',
    ], // [PCODE-348 | S15 | v0.1.0]
  );
  await c.query("SELECT pg_notify('orqiva_mail', '')");
}

const BACKOFF_MIN = [1, 5, 30, 120, 360];

export interface MailWorkerOptions {
  pool: Pool;
  config: MailConfig | null;
  /** where links in mails point */
  publicUrl: string;
  send?: (cfg: MailConfig, m: MailMessage) => Promise<void>;
  now?: () => Date;
  pollMs?: number;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

export class MailWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<unknown> = Promise.resolve();
  private listener: PoolClient | null = null;
  private lastDaily = '';

  constructor(private readonly opts: MailWorkerOptions) {}

  async start(): Promise<void> {
    this.listener = await this.opts.pool.connect();
    this.listener.on('notification', () => {
      void this.kick();
    });
    await this.listener.query('LISTEN orqiva_mail');
    this.timer = setInterval(() => {
      void this.kick();
    }, this.opts.pollMs ?? 30_000);
    this.timer.unref();
    void this.kick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const l = this.listener;
    this.listener = null;
    if (l) {
      await l.query('UNLISTEN *').catch(() => undefined);
      l.release();
    }
    await this.running;
  }

  /** One round after the one running now. */
  kick(): Promise<unknown> {
    this.running = this.running
      .then(() => this.round())
      .catch((err: unknown) => {
        this.opts.log?.('mail round failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return this.running;
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  /** Sends what is due; once an hour, the daily work. */
  async round(): Promise<number> {
    const hour = this.now().toISOString().slice(0, 13);
    if (hour !== this.lastDaily) {
      this.lastDaily = hour;
      await this.daily();
    }
    if (!this.opts.config) return 0;
    let sent = 0;
    for (;;) {
      const done = await this.sendOne();
      if (done === null) return sent;
      if (done) sent++;
    }
  }

  /** null: nothing due; true: sent; false: tried and failed (it waits or is given up). */
  private async sendOne(): Promise<boolean | null> {
    const cfg = this.opts.config;
    if (!cfg) return null;
    return inSystem(this.opts.pool, async (c) => {
      const m = (
        await c.query<{
          id: string;
          to_address: string;
          subject: string;
          text_body: string;
          html_body: string;
          attempts: number;
          reply_to: string; // [PCODE-348 | S15 | v0.1.0]
        }>(
          `SELECT id, to_address, subject, text_body, html_body, attempts, reply_to FROM mail_outbox
            WHERE status = 'pending' AND next_at <= $1 ORDER BY next_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [this.now()],
        )
      ).rows[0];
      if (!m) return null;
      try {
        await (this.opts.send ?? sendMail)(cfg, {
          to: m.to_address,
          subject: m.subject,
          text: m.text_body,
          ...(m.html_body ? { html: m.html_body } : {}),
          ...(m.reply_to ? { replyTo: m.reply_to } : {}), // [PCODE-348 | S15 | v0.1.0]
        });
        await c.query(
          "UPDATE mail_outbox SET status = 'sent', sent_at = $2, attempts = attempts + 1, last_error = '' WHERE id = $1",
          [m.id, this.now()],
        );
        return true;
      } catch (err) {
        const final = err instanceof SmtpError && !err.temporary;
        const wait = BACKOFF_MIN[m.attempts];
        const giveUp = final || wait === undefined;
        await c.query(
          `UPDATE mail_outbox SET attempts = attempts + 1, last_error = $2,
                  status = CASE WHEN $3 THEN 'failed' ELSE 'pending' END,
                  next_at = $4
            WHERE id = $1`,
          [
            m.id,
            (err instanceof Error ? err.message : String(err)).slice(0, 500),
            giveUp,
            new Date(this.now().getTime() + (wait ?? 0) * 60_000),
          ],
        );
        this.opts.log?.('mail not sent', {
          id: m.id,
          attempt: m.attempts + 1,
          final: giveUp,
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    });
  }

  /** The daily digest at 07:00 in each person's time zone, and tokens that run out within 7 days. */
  async daily(): Promise<void> {
    if (!this.opts.config) return;
    const now = this.now();
    await inSystem(this.opts.pool, async (c) => {
      // people who want the digest by email (the default) and are at 07:00 where they live
      const people = (
        await c.query<{
          user_id: string;
          workspace_id: string;
          email: string;
          name: string;
          ws_name: string;
          tz: string;
        }>(
          `SELECT m.user_id, m.workspace_id, u.email, u.name, w.name AS ws_name, coalesce(mp.timezone, 'UTC') AS tz
             FROM workspace_members m
             JOIN users u ON u.id = m.user_id
             JOIN workspaces w ON w.id = m.workspace_id
             LEFT JOIN member_profiles mp ON mp.user_id = m.user_id AND mp.workspace_id = m.workspace_id
             LEFT JOIN notification_rules r ON r.user_id = m.user_id AND r.workspace_id = m.workspace_id AND r.event_kind = 'digest'
            WHERE m.suspended_at IS NULL AND (r.channels IS NULL OR 'email' = ANY (r.channels))`,
        )
      ).rows;
      for (const p of people) {
        const local = localParts(now, p.tz);
        if (local.hour !== 7) continue;
        // [PCODE-365 | S15 | v0.1.0] look first: a quiet check does not use up the day, so work that
        // arrives later in the hour still gets its digest
        const sent = (
          await c.query(
            'SELECT 1 FROM mail_digests WHERE user_id = $1 AND workspace_id = $2 AND day = $3',
            [p.user_id, p.workspace_id, local.day],
          )
        ).rowCount;
        if (sent) continue;
        const items = (
          await c.query<{ title: string; kind: string }>(
            `SELECT title, kind FROM inbox_items WHERE user_id = $1 AND workspace_id = $2 AND state = 'open'
              ORDER BY created_at DESC LIMIT 20`,
            [p.user_id, p.workspace_id],
          )
        ).rows;
        const unread = Number(
          (
            await c.query<{ n: string }>(
              `SELECT count(*) AS n FROM messages m JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = $1
                WHERE m.workspace_id = $2 AND m.deleted_at IS NULL AND m.parent_id IS NULL
                  AND m.author_id IS DISTINCT FROM $1 AND m.created_at > cm.last_read_at AND NOT cm.muted`,
              [p.user_id, p.workspace_id],
            )
          ).rows[0]?.n ?? 0,
        );
        // a quiet day sends nothing
        if (!items.length && !unread) continue;
        const fresh = (
          await c.query(
            'INSERT INTO mail_digests (user_id, workspace_id, day) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [p.user_id, p.workspace_id, local.day],
          )
        ).rowCount;
        if (!fresh) continue;
        await queueMail(c, {
          ...digestMail({
            name: p.name,
            workspace: p.ws_name,
            items,
            unread,
            url: this.opts.publicUrl,
          }),
          to: p.email,
          kind: 'digest',
          workspaceId: p.workspace_id,
        });
      }
      // tokens of people that run out within 7 days, told once
      const tokens = (
        await c.query<{
          id: string;
          name: string;
          expires_at: Date;
          email: string;
          person: string;
        }>(
          `UPDATE api_tokens t SET expiry_notice_at = $1
             FROM users u
            WHERE u.id = t.user_id AND t.revoked_at IS NULL AND t.expiry_notice_at IS NULL
              AND t.expires_at IS NOT NULL AND t.expires_at > $1 AND t.expires_at <= $1 + interval '7 days'
            RETURNING t.id, t.name, t.expires_at, u.email, u.name AS person`,
          [now],
        )
      ).rows;
      for (const t of tokens)
        await queueMail(c, {
          ...tokenExpiryMail({
            name: t.person,
            token: t.name,
            expiresAt: t.expires_at,
            url: this.opts.publicUrl,
          }),
          to: t.email,
          kind: 'token',
        });
    });
  }
}

/** The hour and the day (YYYY-MM-DD) of a moment in a time zone. */
export function localParts(now: Date, timeZone: string): { hour: number; day: string } {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return { hour: Number(get('hour')), day: get('year') + '-' + get('month') + '-' + get('day') };
}
