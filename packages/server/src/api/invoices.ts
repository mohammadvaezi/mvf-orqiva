// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-189 | S15 | v0.1.0] B7.5 Portal budget and invoices with PDF, quotes, meeting booking with agenda and calendar file ──
//    Why:  money and meetings between the team and a client. The team drafts an invoice from a month of
//          approved, billable time (people at their rates; AI cost as its own line when the client is shown
//          it), sends it and marks it paid; the PDF is made from the stored lines whenever it is opened, so
//          it is always the invoice as sent. The client's portal shows the budget burn against the plan, a
//          forecast at the last milestone, invoices and waiting quotes, and lets contacts book a review or
//          demo in free slots of their account owner and project leads, with an agenda and a calendar file.
import {
  localDay,
  mayFileRequest,
  offsetMinutes,
  requestRef,
  usdMicrosToCents,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { rateNow } from '../lib/money.js';
import { A4, pdfDocument, type PdfLine, type PdfText } from '../lib/pdf.js';
import { actorOf, asMember, type Access } from './access.js';
import { portalScope, type PortalCtx } from './portal.js';
import { monthReport } from './time.js';

const uuid = s.string({ format: 'uuid' });
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const mayBill = (a: Access): boolean =>
  a.role === 'admin' || a.role === 'owner' || a.role === 'billing';
const mayReadBills = (a: Access): boolean => mayBill(a) || a.role === 'auditor';

/** German money for documents: 1.286,00 €. */
export const money = (cents: number): string =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
    .format(cents / 100)
    .replace(/\u00a0/g, ' ');

const dateDe = (d: string | null): string =>
  d ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : '—';

export interface InvoiceLine {
  text: string;
  quantity: number;
  unit: string;
  unitCents: number;
  amountCents: number;
}

interface InvoiceRow {
  id: string;
  client_id: string;
  client_name: string;
  number: string;
  period_label: string;
  lines: InvoiceLine[];
  net_cents: string;
  vat_pct: string;
  gross_cents: string;
  state: string;
  issued_on: string | null;
  due_on: string | null;
  paid_on: string | null;
  note: string;
  created_at: Date;
}

const INVOICE_SELECT = `SELECT i.id, i.client_id, cl.name AS client_name, i.number, i.period_label, i.lines, i.net_cents, i.vat_pct,
    i.gross_cents, i.state, i.issued_on::text AS issued_on, i.due_on::text AS due_on, i.paid_on::text AS paid_on, i.note, i.created_at
  FROM client_invoices i JOIN clients cl ON cl.id = i.client_id`;

function invoiceJson(r: InvoiceRow, today = localDay(new Date())) {
  return {
    id: r.id,
    clientId: r.client_id,
    clientName: r.client_name,
    number: r.number,
    periodLabel: r.period_label,
    lines: r.lines,
    netCents: Number(r.net_cents),
    vatPct: Number(r.vat_pct),
    grossCents: Number(r.gross_cents),
    state: r.state,
    overdue: r.state === 'sent' && r.due_on !== null && r.due_on < today,
    issuedOn: r.issued_on,
    dueOn: r.due_on,
    paidOn: r.paid_on,
    note: r.note,
    createdAt: r.created_at.toISOString(),
  };
}

const totals = (lines: readonly InvoiceLine[], vatPct: number) => {
  const net = lines.reduce((n, l) => n + l.amountCents, 0);
  return { net, gross: net + Math.round((net * vatPct) / 100) };
};

/** The invoice as a one- or two-page A4 PDF. */
export function invoicePdf(inv: ReturnType<typeof invoiceJson>, issuer: string): Buffer {
  const pages: { texts: PdfText[]; lines: PdfLine[] }[] = [];
  let texts: PdfText[] = [];
  let lines: PdfLine[] = [];
  const L = 56;
  const R = A4.width - 56;
  texts.push({ x: L, y: 780, size: 16, text: issuer, bold: true });
  texts.push({ x: L, y: 740, size: 10, text: 'To' });
  texts.push({ x: L, y: 726, size: 12, text: inv.clientName, bold: true });
  texts.push({ x: R, y: 740, size: 20, text: 'Invoice', bold: true, align: 'right' });
  texts.push({ x: R, y: 720, size: 10, text: inv.number, align: 'right' });
  texts.push({
    x: R,
    y: 706,
    size: 10,
    text: 'Issued ' + dateDe(inv.issuedOn ?? inv.createdAt.slice(0, 10)),
    align: 'right',
  });
  texts.push({ x: R, y: 692, size: 10, text: 'Due ' + dateDe(inv.dueOn), align: 'right' });
  if (inv.periodLabel) texts.push({ x: L, y: 692, size: 10, text: 'Period: ' + inv.periodLabel });
  let y = 650;
  const head = (): void => {
    texts.push({ x: L, y, size: 9, text: 'Description', bold: true });
    texts.push({ x: 360, y, size: 9, text: 'Quantity', bold: true, align: 'right' });
    texts.push({ x: 450, y, size: 9, text: 'Unit price', bold: true, align: 'right' });
    texts.push({ x: R, y, size: 9, text: 'Amount', bold: true, align: 'right' });
    lines.push({ x1: L, y1: y - 6, x2: R, y2: y - 6 });
    y -= 22;
  };
  head();
  for (const l of inv.lines) {
    if (y < 140) {
      pages.push({ texts, lines });
      texts = [];
      lines = [];
      y = 780;
      head();
    }
    texts.push({
      x: L,
      y,
      size: 10,
      text: l.text.length > 52 ? l.text.slice(0, 51) + '…' : l.text,
    });
    texts.push({
      x: 360,
      y,
      size: 10,
      text:
        l.quantity.toLocaleString('de-DE', { maximumFractionDigits: 2 }) +
        (l.unit ? ' ' + l.unit : ''),
      align: 'right',
    });
    texts.push({ x: 450, y, size: 10, text: money(l.unitCents), align: 'right' });
    texts.push({ x: R, y, size: 10, text: money(l.amountCents), align: 'right' });
    y -= 18;
  }
  lines.push({ x1: 330, y1: y + 6, x2: R, y2: y + 6 });
  y -= 12;
  texts.push({ x: 450, y, size: 10, text: 'Net', align: 'right' });
  texts.push({ x: R, y, size: 10, text: money(inv.netCents), align: 'right' });
  y -= 16;
  texts.push({
    x: 450,
    y,
    size: 10,
    text: 'VAT ' + String(inv.vatPct).replace('.', ',') + ' %',
    align: 'right',
  });
  texts.push({ x: R, y, size: 10, text: money(inv.grossCents - inv.netCents), align: 'right' });
  y -= 18;
  texts.push({ x: 450, y, size: 11, text: 'Total', bold: true, align: 'right' });
  texts.push({ x: R, y, size: 11, text: money(inv.grossCents), bold: true, align: 'right' });
  if (inv.note) texts.push({ x: L, y: 96, size: 9, text: inv.note.slice(0, 120) });
  texts.push({
    x: L,
    y: 60,
    size: 8,
    text: issuer + ' · ' + inv.number + ' · made with Orqiva',
  });
  pages.push({ texts, lines });
  return pdfDocument(pages, 'Invoice ' + inv.number);
}

async function loadInvoice(c: PoolClient, id: string): Promise<InvoiceRow> {
  const r = (await c.query<InvoiceRow>(INVOICE_SELECT + ' WHERE i.id = $1', [id])).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Invoice not found');
  return r;
}

async function nextNumber(c: PoolClient, ws: string): Promise<string> {
  const n = (
    await c.query<{ no: number }>(
      'UPDATE workspaces SET next_invoice_no = next_invoice_no + 1 WHERE id = $1 RETURNING next_invoice_no - 1 AS no',
      [ws],
    )
  ).rows[0]?.no;
  return 'INV-' + localDay(new Date()).slice(0, 4) + '-' + String(n ?? 1).padStart(3, '0');
}

async function issuerName(c: PoolClient, ws: string): Promise<string> {
  return (
    (await c.query<{ name: string }>('SELECT name FROM workspaces WHERE id = $1', [ws])).rows[0]
      ?.name ?? 'Orqiva'
  );
}

// ── meetings ──
const SLOT_TIMES = ['09:00', '10:30', '14:00', '15:30'];

/** An instant from a local day and time in a time zone. */
function atLocal(day: string, hm: string, tz = 'Europe/Berlin'): Date {
  const guess = new Date(day + 'T' + hm + ':00Z');
  return new Date(guess.getTime() - offsetMinutes(guess, tz) * 60_000);
}

/** The people a client meets: the account owner and the leads of the client's projects. */
async function hostsOf(c: PoolClient, clientId: string): Promise<{ id: string; name: string }[]> {
  return (
    await c.query<{ id: string; name: string }>(
      `SELECT DISTINCT u.id, u.name FROM users u
        WHERE u.id = (SELECT owner_id FROM clients WHERE id = $1)
           OR u.id IN (SELECT pm.user_id FROM project_members pm JOIN projects p ON p.id = pm.project_id
                        WHERE p.client_id = $1 AND pm.role = 'lead')
        ORDER BY u.name`,
      [clientId],
    )
  ).rows;
}

/** Free 45-minute slots on the next ten workdays, at least two hours ahead. */
async function freeSlots(c: PoolClient, clientId: string, now = new Date()): Promise<string[]> {
  const hosts = await hostsOf(c, clientId);
  if (!hosts.length) return [];
  const ids = hosts.map((h) => h.id);
  const busy = (
    await c.query<{ starts_at: Date; minutes: number }>(
      `SELECT starts_at, minutes FROM meetings WHERE state = 'booked' AND attendee_ids && $1::uuid[]
         AND starts_at > now() - interval '1 day' AND starts_at < now() + interval '20 days'`,
      [ids],
    )
  ).rows;
  const owner = (
    await c.query<{ owner_id: string | null }>('SELECT owner_id FROM clients WHERE id = $1', [
      clientId,
    ])
  ).rows[0]?.owner_id;
  const away = (
    await c.query<{ starts_on: string; ends_on: string }>(
      `SELECT starts_on::text AS starts_on, ends_on::text AS ends_on FROM absences
        WHERE state = 'approved' AND user_id = $1 AND ends_on >= current_date`,
      [owner],
    )
  ).rows;
  const out: string[] = [];
  const first = new Date(now.getTime() + 2 * 3_600_000);
  for (let i = 0, days = 0; days < 10 && i < 21; i++) {
    const day = localDay(new Date(now.getTime() + i * 86_400_000));
    const wd = new Date(day + 'T00:00:00Z').getUTCDay();
    if (wd === 0 || wd === 6) continue;
    days += 1;
    if (away.some((x) => day >= x.starts_on && day <= x.ends_on)) continue;
    for (const t of SLOT_TIMES) {
      const at = atLocal(day, t);
      if (at < first) continue;
      const end = at.getTime() + 45 * 60_000;
      const clash = busy.some(
        (b) =>
          b.starts_at.getTime() < end && b.starts_at.getTime() + b.minutes * 60_000 > at.getTime(),
      );
      if (!clash) out.push(at.toISOString());
    }
  }
  return out;
}

/** What to talk about: the client's open requests, waiting quotes and running acceptance rounds. */
async function draftAgenda(
  c: PoolClient,
  ctx: Pick<PortalCtx, 'clientId' | 'projectIds'>,
): Promise<string> {
  const reqs = (
    await c.query<{
      kind: 'bug' | 'change' | 'feature' | 'question';
      number: number;
      title: string;
      state: string;
    }>(
      `SELECT kind, number, title, state FROM client_requests WHERE client_id = $1 AND closed_at IS NULL
        ORDER BY (state = 'quoted') DESC, response_due_at LIMIT 6`,
      [ctx.clientId],
    )
  ).rows;
  const rounds = (
    await c.query<{ name: string }>(
      "SELECT name FROM test_runs WHERE client_round AND status = 'running' AND project_id = ANY($1::uuid[]) LIMIT 3",
      [ctx.projectIds],
    )
  ).rows;
  const lines = [
    ...reqs.map(
      (r) =>
        '- ' +
        requestRef(r.kind, r.number) +
        ' ' +
        r.title +
        (r.state === 'quoted' ? ' (quote waiting)' : ''),
    ),
    ...rounds.map((r) => '- Acceptance: ' + r.name),
  ];
  return lines.length
    ? 'From your open items:\n' + lines.join('\n')
    : 'No open items; add yours below.';
}

const icsText = (t: string): string =>
  t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const icsTime = (d: Date): string =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** A calendar file for one meeting (RFC 5545). */
export function meetingIcs(m: {
  id: string;
  title: string;
  startsAt: Date;
  minutes: number;
  agenda: string;
  videoUrl: string;
}): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Orqiva//Meetings//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + m.id + '@orqiva',
    'DTSTAMP:' + icsTime(new Date()),
    'DTSTART:' + icsTime(m.startsAt),
    'DTEND:' + icsTime(new Date(m.startsAt.getTime() + m.minutes * 60_000)),
    'SUMMARY:' + icsText(m.title),
    'DESCRIPTION:' + icsText(m.agenda + (m.videoUrl ? '\n\n' + m.videoUrl : '')),
    ...(m.videoUrl ? ['LOCATION:' + icsText(m.videoUrl)] : []),
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

interface MeetingRow {
  id: string;
  client_id: string;
  title: string;
  kind: string;
  starts_at: Date;
  minutes: number;
  attendee_ids: string[];
  attendees: string[] | null;
  booked_by_name: string | null;
  agenda: string;
  video_url: string;
  state: string;
}

const MEETING_SELECT = `SELECT m.id, m.client_id, m.title, m.kind, m.starts_at, m.minutes, m.attendee_ids,
    (SELECT array_agg(u.name ORDER BY u.name) FROM users u WHERE u.id = ANY(m.attendee_ids)) AS attendees,
    b.name AS booked_by_name, m.agenda, m.video_url, m.state
  FROM meetings m LEFT JOIN users b ON b.id = m.booked_by`;

const meetingJson = (m: MeetingRow) => ({
  id: m.id,
  clientId: m.client_id,
  title: m.title,
  kind: m.kind,
  startsAt: m.starts_at.toISOString(),
  minutes: m.minutes,
  attendees: m.attendees ?? [],
  bookedBy: m.booked_by_name,
  agenda: m.agenda,
  videoUrl: m.video_url,
  state: m.state,
});

export function invoiceRoutes(pool: Pool): Route[] {
  const lineIn = s.object({
    text: s.string({ min: 1, max: 200 }),
    quantity: s.number({ min: 0, max: 100000 }),
    unit: s.optional(s.string({ max: 10 })),
    unitCents: s.number({ integer: true, min: -100_000_000, max: 100_000_000 }),
  });

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/clients/:clientId/invoices',
    summary:
      'A client’s invoices and upcoming meetings (admin, billing, auditor; meetings for members too)',
    tags: ['billing'],
    params: s.object({ workspaceId: uuid, clientId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        if (a.clientId) throw new HttpError(403, 'forbidden', 'This is the team’s view');
        const invoices = mayReadBills(a)
          ? (
              await c.query<InvoiceRow>(
                INVOICE_SELECT + ' WHERE i.client_id = $1 ORDER BY i.created_at DESC LIMIT 50',
                [params.clientId],
              )
            ).rows.map((r) => invoiceJson(r))
          : null;
        const meetings = (
          await c.query<MeetingRow>(
            MEETING_SELECT +
              " WHERE m.client_id = $1 AND m.state = 'booked' AND m.starts_at > now() - interval '1 hour' ORDER BY m.starts_at",
            [params.clientId],
          )
        ).rows.map(meetingJson);
        return { body: { invoices, meetings, mayBill: mayBill(a) } };
      }),
  });

  const fromTime = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/clients/:clientId/invoices/from-time',
    summary:
      'Draft an invoice from a month of approved, billable time and the AI cost (admin, billing)',
    tags: ['billing'],
    params: s.object({ workspaceId: uuid, clientId: uuid }),
    body: s.object({
      month: s.string({ pattern: /^\d{4}-\d{2}$/ }),
      vatPct: s.optional(s.number({ min: 0, max: 100 })),
    }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        if (!mayBill(a)) throw new HttpError(403, 'forbidden', 'Admins and billing write invoices');
        const cl = (
          await c.query<{ name: string; shares: Record<string, boolean> }>(
            'SELECT name, shares FROM clients WHERE id = $1',
            [params.clientId],
          )
        ).rows[0];
        if (!cl) throw new HttpError(404, 'not_found', 'Client not found');
        const rep = await monthReport(c, body.month);
        const mine = rep.priced.filter(
          (e) => e.client_id === params.clientId && e.billable && e.approved,
        );
        const groups = new Map<string, InvoiceLine>();
        const label =
          (MONTHS[Number(body.month.slice(5, 7)) - 1] ?? '') + ' ' + body.month.slice(0, 4);
        for (const e of mine) {
          const rate = e.rate ?? 0;
          const k = (e.project_key ?? '') + '|' + String(rate);
          const g = groups.get(k) ?? {
            text: 'Engineering ' + label + (e.project_key ? ' · ' + e.project_key : ''),
            quantity: 0,
            unit: 'h',
            unitCents: rate,
            amountCents: 0,
          };
          g.quantity = Math.round((g.quantity + e.minutes / 60) * 100) / 100;
          g.amountCents = Math.round(g.quantity * rate);
          groups.set(k, g);
        }
        const lines = [...groups.values()];
        const ai = rep.body.clients.find((x) => x.clientId === params.clientId)?.aiCents ?? 0;
        if (ai > 0)
          lines.push({
            text:
              cl.shares['ai_cost_line'] === false
                ? 'Engineering tools ' + label
                : 'AI agents at cost ' + label,
            quantity: 1,
            unit: '',
            unitCents: ai,
            amountCents: ai,
          });
        if (!lines.length)
          throw new HttpError(
            409,
            'conflict',
            'No approved billable time for ' + cl.name + ' in ' + label,
          );
        const vat = body.vatPct ?? 19;
        const t = totals(lines, vat);
        const end = new Date(body.month + '-01T00:00:00Z');
        end.setUTCMonth(end.getUTCMonth() + 1);
        end.setUTCDate(0);
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO client_invoices (workspace_id, client_id, number, period_label, period_from, period_to, lines, net_cents, vat_pct, gross_cents, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [
              a.workspaceId,
              params.clientId,
              await nextNumber(c, a.workspaceId),
              label,
              body.month + '-01',
              end.toISOString().slice(0, 10),
              JSON.stringify(lines),
              t.net,
              vat,
              t.gross,
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        const unapproved = rep.priced.filter(
          (e) => e.client_id === params.clientId && e.billable && !e.approved,
        ).length;
        return {
          status: 201,
          body: {
            invoice: invoiceJson(await loadInvoice(c, id ?? '')),
            unapprovedEntries: unapproved,
          },
        };
      }),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/clients/:clientId/invoices',
    summary: 'Write an invoice by hand (admin, billing)',
    tags: ['billing'],
    params: s.object({ workspaceId: uuid, clientId: uuid }),
    body: s.object({
      periodLabel: s.optional(s.string({ max: 120 })),
      lines: s.array(lineIn, { min: 1, max: 50 }),
      vatPct: s.optional(s.number({ min: 0, max: 100 })),
      note: s.optional(s.string({ max: 2000 })),
    }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        if (!mayBill(a)) throw new HttpError(403, 'forbidden', 'Admins and billing write invoices');
        const lines = body.lines.map((l) => ({
          text: l.text.trim(),
          quantity: l.quantity,
          unit: l.unit ?? '',
          unitCents: l.unitCents,
          amountCents: Math.round(l.quantity * l.unitCents),
        }));
        const vat = body.vatPct ?? 19;
        const t = totals(lines, vat);
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO client_invoices (workspace_id, client_id, number, period_label, lines, net_cents, vat_pct, gross_cents, note, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [
              a.workspaceId,
              params.clientId,
              await nextNumber(c, a.workspaceId),
              body.periodLabel ?? '',
              JSON.stringify(lines),
              t.net,
              vat,
              t.gross,
              body.note ?? '',
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        return { status: 201, body: invoiceJson(await loadInvoice(c, id ?? '')) };
      }),
  });

  const change = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/invoices/:invoiceId',
    summary:
      'Send (the client sees it from now on), mark paid, or void an invoice (admin, billing)',
    tags: ['billing'],
    params: s.object({ workspaceId: uuid, invoiceId: uuid }),
    body: s.object({
      state: s.enum(['sent', 'paid', 'void']),
      dueInDays: s.optional(s.number({ integer: true, min: 0, max: 120 })),
      paidOn: s.optional(s.string({ pattern: DAY_RE })),
    }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        if (!mayBill(a))
          throw new HttpError(403, 'forbidden', 'Admins and billing change invoices');
        const inv = await loadInvoice(c, params.invoiceId);
        const allowed: Record<string, string[]> = {
          draft: ['sent', 'void'],
          sent: ['paid', 'void'],
          paid: [],
          void: [],
        };
        if (!(allowed[inv.state] ?? []).includes(body.state))
          throw new HttpError(
            409,
            'conflict',
            'A ' + inv.state + ' invoice cannot become ' + body.state,
          );
        await c.query(
          `UPDATE client_invoices SET state = $2,
              issued_on = CASE WHEN $2 = 'sent' THEN current_date ELSE issued_on END,
              due_on = CASE WHEN $2 = 'sent' THEN current_date + $3::integer ELSE due_on END,
              paid_on = CASE WHEN $2 = 'paid' THEN coalesce($4::date, current_date) ELSE paid_on END
            WHERE id = $1`,
          [inv.id, body.state, body.dueInDays ?? 14, body.paidOn ?? null],
        );
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: { type: 'client', id: inv.client_id, label: inv.client_name },
          changes: {
            invoice: { from: inv.number + ' ' + inv.state, to: inv.number + ' ' + body.state },
          },
        });
        return { body: invoiceJson(await loadInvoice(c, inv.id)) };
      }),
  });

  const pdf = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/invoices/:invoiceId/pdf',
    summary: 'The invoice as PDF (the team; client contacts use the portal’s link)',
    tags: ['billing'],
    params: s.object({ workspaceId: uuid, invoiceId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        if (!mayReadBills(a))
          throw new HttpError(403, 'forbidden', 'Invoices are for admins and billing');
        const inv = invoiceJson(await loadInvoice(c, params.invoiceId));
        return {
          body: {},
          file: {
            data: invoicePdf(inv, await issuerName(c, a.workspaceId)),
            contentType: 'application/pdf',
            name: inv.number + '.pdf',
            inline: true,
          },
        };
      }),
  });

  // ── the portal ──
  const portalBilling = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/billing',
    summary:
      'Budget burn against the plan, forecast, AI cost, invoices and waiting quotes for the client',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ clientId: s.optional(uuid) }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        if (ctx.shares['budget'] === false)
          throw new HttpError(
            403,
            'forbidden',
            'Budget and invoices are not shared with ' + ctx.clientName,
          );
        const showAi = ctx.shares['ai_cost_line'] !== false;
        const budget = (
          await c.query<{ amount_cents: string }>(
            "SELECT amount_cents FROM budgets WHERE scope_type = 'client' AND scope_id = $1 AND measure IN ('total', 'time') ORDER BY created_at DESC LIMIT 1",
            [ctx.clientId],
          )
        ).rows[0];
        const time = (
          await c.query<{ cents: string; recent: string }>(
            `SELECT coalesce(sum(e.minutes * e.rate_cents / 60.0), 0) AS cents,
                coalesce(sum(e.minutes * e.rate_cents / 60.0) FILTER (WHERE e.day > current_date - 30), 0) AS recent
               FROM time_entries e WHERE e.billable AND e.rate_cents IS NOT NULL AND e.project_id = ANY($1::uuid[])`,
            [ctx.projectIds],
          )
        ).rows[0];
        const fx = await rateNow(c);
        const aiRow = (
          await c.query<{ micros: string; recent: string }>(
            `SELECT coalesce(sum(cost_micros), 0) AS micros,
                coalesce(sum(cost_micros) FILTER (WHERE created_at > now() - interval '30 days'), 0) AS recent
               FROM agent_runs WHERE project_id = ANY($1::uuid[])`,
            [ctx.projectIds],
          )
        ).rows[0];
        const aiCents = usdMicrosToCents(Number(aiRow?.micros ?? 0), fx.usdEur);
        const peopleCents = Math.round(Number(time?.cents ?? 0));
        const used = peopleCents + aiCents;
        const perDay =
          (Number(time?.recent ?? 0) + usdMicrosToCents(Number(aiRow?.recent ?? 0), fx.usdEur)) /
          30;
        // the plan: the project timeline from the first start to the last milestone
        const span = (
          await c.query<{ first: string | null; last: string | null }>(
            `SELECT min(start_date)::text AS first, max(due_date)::text AS last FROM items
              WHERE project_id = ANY($1::uuid[]) AND kind IN ('epic', 'milestone')`,
            [ctx.projectIds],
          )
        ).rows[0];
        const today = localDay(new Date());
        const daysLeft = span?.last
          ? Math.max(0, (Date.parse(span.last) - Date.parse(today)) / 86_400_000)
          : 0;
        const planPct =
          span?.first && span.last && span.last > span.first
            ? Math.min(
                1,
                Math.max(
                  0,
                  (Date.parse(today) - Date.parse(span.first)) /
                    (Date.parse(span.last) - Date.parse(span.first)),
                ),
              )
            : null;
        const added = (
          await c.query<{ cents: string }>(
            `SELECT coalesce(sum((r.impact->>'priceCents')::bigint), 0) AS cents FROM client_requests r
              WHERE r.client_id = $1 AND EXISTS (SELECT 1 FROM approvals x WHERE x.object_type = 'change_request'
                AND x.object_id = r.id::text AND x.decision = 'approved')`,
            [ctx.clientId],
          )
        ).rows[0];
        const quotes = (
          await c.query<{
            id: string;
            number: number;
            title: string;
            impact: { priceCents: number };
          }>(
            "SELECT id, number, title, impact FROM client_requests WHERE client_id = $1 AND state = 'quoted' ORDER BY quoted_at DESC",
            [ctx.clientId],
          )
        ).rows;
        const invoices = (
          await c.query<InvoiceRow>(
            INVOICE_SELECT +
              " WHERE i.client_id = $1 AND i.state <> 'draft' ORDER BY i.created_at DESC LIMIT 50",
            [ctx.clientId],
          )
        ).rows.map((r) => invoiceJson(r, today));
        return {
          body: {
            budgetCents: budget ? Number(budget.amount_cents) : null,
            usedCents: used,
            peopleCents,
            aiCents: showAi ? aiCents : null,
            forecastCents: span?.last ? Math.round(used + perDay * daysLeft) : null,
            forecastOn: span?.last ?? null,
            planCents:
              budget && planPct !== null ? Math.round(Number(budget.amount_cents) * planPct) : null,
            addedByChangesCents: Number(added?.cents ?? 0),
            invoices,
            openInvoices: invoices.filter((x) => x.state === 'sent').length,
            quotes: quotes.map((q) => ({
              id: q.id,
              ref: 'CR-' + String(q.number),
              title: q.title,
              priceCents: q.impact.priceCents,
            })),
          },
        };
      }),
  });

  const portalPdf = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/invoices/:invoiceId/pdf',
    summary: 'An invoice the team sent, as PDF, for the client',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, invoiceId: uuid }),
    query: s.object({ clientId: s.optional(uuid) }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        const r = (
          await c.query<InvoiceRow>(
            INVOICE_SELECT + " WHERE i.id = $1 AND i.client_id = $2 AND i.state <> 'draft'",
            [params.invoiceId, ctx.clientId],
          )
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Invoice not found');
        const inv = invoiceJson(r);
        return {
          body: {},
          file: {
            data: invoicePdf(inv, await issuerName(c, ctx.access.workspaceId)),
            contentType: 'application/pdf',
            name: inv.number + '.pdf',
            inline: true,
          },
        };
      }),
  });

  const portalMeetings = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/meetings',
    summary:
      'Free slots of the client’s account owner and project leads, and the meetings coming up',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ clientId: s.optional(uuid) }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        const upcoming = (
          await c.query<MeetingRow>(
            MEETING_SELECT +
              " WHERE m.client_id = $1 AND m.state = 'booked' AND m.starts_at > now() - interval '1 hour' ORDER BY m.starts_at",
            [ctx.clientId],
          )
        ).rows.map(meetingJson);
        return {
          body: {
            hosts: await hostsOf(c, ctx.clientId),
            slots: await freeSlots(c, ctx.clientId),
            upcoming,
            mayBook: !ctx.asTeam && mayFileRequest(ctx.roles),
            agenda: await draftAgenda(c, ctx),
          },
        };
      }),
  });

  const book = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/portal/meetings',
    summary: 'Book a review or demo in a free slot; the agenda is drafted from open items',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      startsAt: s.string({ format: 'date-time' }),
      kind: s.enum(['review', 'demo', 'other']),
      title: s.optional(s.string({ max: 200 })),
      agenda: s.optional(s.string({ max: 10000 })),
    }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      portalScope(pool, req, params.workspaceId, undefined, async (c, ctx) => {
        if (ctx.asTeam || !mayFileRequest(ctx.roles))
          throw new HttpError(403, 'forbidden', 'Viewers cannot book meetings');
        const at = new Date(body.startsAt);
        if (!(await freeSlots(c, ctx.clientId)).includes(at.toISOString()))
          throw new HttpError(409, 'conflict', 'This slot is no longer free');
        const hosts = await hostsOf(c, ctx.clientId);
        const title =
          body.title?.trim() ||
          (body.kind === 'demo' ? 'Demo' : body.kind === 'review' ? 'Review' : 'Meeting') +
            ' with ' +
            ctx.clientName;
        const agenda = body.agenda?.trim() || (await draftAgenda(c, ctx));
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO meetings (workspace_id, client_id, title, kind, starts_at, attendee_ids, booked_by, agenda)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [
              ctx.access.workspaceId,
              ctx.clientId,
              title,
              body.kind,
              at,
              [...hosts.map((h) => h.id), ctx.access.user.id],
              ctx.access.user.id,
              agenda,
            ],
          )
        ).rows[0]?.id;
        await recordEvent(c, ctx.access.workspaceId, {
          actor: actorOf(ctx.access),
          verb: 'created',
          object: { type: 'meeting', id: id ?? '', label: title },
          parent: { type: 'client', id: ctx.clientId, label: ctx.clientName },
          changes: {
            startsAt: { from: null, to: at.toISOString() },
            hosts: { from: null, to: hosts.map((h) => h.id) },
          },
        });
        const m = (await c.query<MeetingRow>(MEETING_SELECT + ' WHERE m.id = $1', [id])).rows[0];
        if (!m) throw new Error('meeting vanished');
        return { status: 201, body: meetingJson(m) };
      }),
  });

  const cancel = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/meetings/:meetingId/cancel',
    summary: 'Cancel a meeting (who booked it, a host, or an admin)',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, meetingId: uuid }),
    body: s.object({}),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const n = (
          await c.query(
            `UPDATE meetings SET state = 'cancelled' WHERE id = $1 AND state = 'booked'
               AND (booked_by = $2 OR $2 = ANY(attendee_ids) OR $3)`,
            [params.meetingId, a.user.id, a.role === 'admin' || a.role === 'owner'],
          )
        ).rowCount;
        if (!n) throw new HttpError(404, 'not_found', 'Meeting not found');
        return { body: { id: params.meetingId, state: 'cancelled' } };
      }),
  });

  const ics = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/meetings/:meetingId/ics',
    summary: 'The meeting as a calendar file',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, meetingId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        if (a.role === 'guest' && !a.clientId)
          throw new HttpError(403, 'forbidden', 'Meetings are for clients and the team');
        // a contact's transaction sees only their client's meetings (row-level security)
        const m = (
          await c.query<MeetingRow>(MEETING_SELECT + ' WHERE m.id = $1', [params.meetingId])
        ).rows[0];
        if (!m) throw new HttpError(404, 'not_found', 'Meeting not found');
        return {
          body: {},
          file: {
            data: Buffer.from(
              meetingIcs({
                id: m.id,
                title: m.title,
                startsAt: m.starts_at,
                minutes: m.minutes,
                agenda: m.agenda,
                videoUrl: m.video_url,
              }),
              'utf8',
            ),
            contentType: 'text/calendar; charset=utf-8',
            name: 'meeting.ics',
          },
        };
      }),
  });

  return [
    list,
    fromTime,
    create,
    change,
    pdf,
    portalBilling,
    portalPdf,
    portalMeetings,
    book,
    cancel,
    ics,
  ];
}
