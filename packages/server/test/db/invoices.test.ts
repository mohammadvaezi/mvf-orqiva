// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-189 | S15 | v0.1.0] B7.5 Portal budget and invoices with PDF, quotes, meeting booking with agenda and calendar file ──
//    Why:  money and meetings against the real database: an invoice is drafted from approved, billable
//          time, sent (only then the client sees it), its PDF opens for both sides; the portal shows the
//          budget burn and waiting quotes; a contact books a free slot of the account owner (once), gets a
//          calendar file, and the host is told; a viewer only looks.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { pumpWorkspace, vapidKeys } from '../../src/push/dispatch.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] ??= '7d'.repeat(32);

describe.skipIf(!hasDatabase)('invoices and meetings (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let ines: Person;
  let paul: Person;
  let client = '';
  let project = '';
  let invoice = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));

  async function contact(email: string, role: string): Promise<Person> {
    const r = await t.call<{ invitation: { token: string } }>(
      ada,
      'POST',
      W('/clients/' + client + '/contacts'),
      {
        email,
        portalRole: role,
      },
    );
    const res = await fetch(t.base + '/auth/invitations/' + r.body.invitation.token + '/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: email.split('@')[0], password: 'a client password 1' }),
    });
    const p: Person = {
      id: '',
      email,
      name: email.split('@')[0] ?? '',
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      workspaceId: ada.workspaceId,
    };
    p.id = (await t.call<{ user: { id: string } }>(p, 'GET', '/auth/me')).body.user.id;
    return p;
  }

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    client = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' })).body.id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: client });
    ines = await contact('ines@helio.example', 'approver');
    paul = await contact('paul@helio.example', 'viewer');
    // approved September: 10 h at 110 €, 2 h not approved, 3 h not billable
    await sys(
      `INSERT INTO time_entries (workspace_id, user_id, project_id, label, day, minutes, billable, source, rate_cents)
       VALUES ($1, $2, $3, 'Build', '2026-09-14', 600, true, 'manual', 11000),
              ($1, $2, $3, 'Build', '2026-09-21', 120, true, 'manual', NULL),
              ($1, $2, $3, 'Meetings', '2026-09-14', 180, false, 'manual', 11000)`,
      [ada.workspaceId, ada.id, project],
    );
    await sys(
      "INSERT INTO timesheets (workspace_id, user_id, week, state) VALUES ($1, $2, '2026-09-14', 'approved')",
      [ada.workspaceId, ada.id],
    );
    await sys(
      "INSERT INTO budgets (workspace_id, scope_type, scope_id, measure, period, amount_cents) VALUES ($1, 'client', $2, 'total', 'total', 500000)",
      [ada.workspaceId, client],
    );
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('drafts an invoice from approved, billable time', async () => {
    const r = await t.call<{
      invoice: {
        id: string;
        number: string;
        lines: { text: string; quantity: number; amountCents: number }[];
        netCents: number;
        grossCents: number;
        state: string;
      };
      unapprovedEntries: number;
    }>(ada, 'POST', W('/clients/' + client + '/invoices/from-time'), { month: '2026-09' });
    expect(r.status).toBe(201);
    expect(r.body.invoice).toMatchObject({
      number: 'INV-' + new Date().getFullYear().toString() + '-001',
      state: 'draft',
      netCents: 110000,
      grossCents: 130900,
    });
    expect(r.body.invoice.lines).toEqual([
      expect.objectContaining({
        text: 'Engineering September 2026 · HEL',
        quantity: 10,
        amountCents: 110000,
      }),
    ]);
    expect(r.body.unapprovedEntries).toBe(1);
    invoice = r.body.invoice.id;
    expect(
      (
        await t.call(ada, 'POST', W('/clients/' + client + '/invoices/from-time'), {
          month: '2026-01',
        })
      ).status,
    ).toBe(409);
  });

  it('shows the client an invoice only once it is sent, with its PDF', async () => {
    type Billing = {
      invoices: { id: string; state: string }[];
      usedCents: number;
      budgetCents: number;
      quotes: unknown[];
    };
    expect((await t.call<Billing>(ines, 'GET', W('/portal/billing'))).body.invoices).toEqual([]);
    expect((await t.call(ines, 'GET', W('/portal/invoices/' + invoice + '/pdf'))).status).toBe(404);
    const sent = await t.call<{ state: string; dueOn: string }>(
      ada,
      'PATCH',
      W('/invoices/' + invoice),
      {
        state: 'sent',
        dueInDays: 14,
      },
    );
    expect(sent.body.state).toBe('sent');
    expect((await t.call(ada, 'PATCH', W('/invoices/' + invoice), { state: 'sent' })).status).toBe(
      409,
    );
    const b = await t.call<Billing>(ines, 'GET', W('/portal/billing'));
    expect(b.body.invoices.map((x) => x.state)).toEqual(['sent']);
    expect(b.body).toMatchObject({ budgetCents: 500000, usedCents: 110000 });
    const pdf = await fetch(t.base + W('/portal/invoices/' + invoice + '/pdf'), {
      headers: { cookie: ines.cookie },
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toContain('application/pdf');
    const bytes = Buffer.from(await pdf.arrayBuffer()).toString('latin1');
    expect(bytes.startsWith('%PDF-1.4')).toBe(true);
    expect(bytes).toContain('(INV-');
    expect(bytes).toContain('1.309,00 \\200');
    expect(bytes.trimEnd().endsWith('%%EOF')).toBe(true);
    // the client's share switch hides the section
    await t.call(ada, 'PATCH', W('/clients/' + client), { shares: { budget: false } });
    expect((await t.call(ines, 'GET', W('/portal/billing'))).status).toBe(403);
    await t.call(ada, 'PATCH', W('/clients/' + client), { shares: { budget: true } });
  });

  it('books a free slot of the account owner once, with a calendar file and a notice', async () => {
    type M = {
      slots: string[];
      mayBook: boolean;
      agenda: string;
      upcoming: { id: string; title: string }[];
    };
    const m = await t.call<M>(ines, 'GET', W('/portal/meetings'));
    expect(m.body.slots.length).toBeGreaterThan(10);
    expect(m.body.mayBook).toBe(true);
    expect((await t.call<M>(paul, 'GET', W('/portal/meetings'))).body.mayBook).toBe(false);
    const slot = m.body.slots[0] ?? '';
    expect(
      (await t.call(paul, 'POST', W('/portal/meetings'), { startsAt: slot, kind: 'review' }))
        .status,
    ).toBe(403);
    const booked = await t.call<{ id: string; title: string; attendees: string[] }>(
      ines,
      'POST',
      W('/portal/meetings'),
      { startsAt: slot, kind: 'review' },
    );
    expect(booked.status).toBe(201);
    expect(booked.body.title).toBe('Review with Helio');
    expect(booked.body.attendees).toEqual(['Ada', 'ines']);
    expect(
      (await t.call(ines, 'POST', W('/portal/meetings'), { startsAt: slot, kind: 'demo' })).status,
    ).toBe(409);
    expect((await t.call<M>(ines, 'GET', W('/portal/meetings'))).body.slots).not.toContain(slot);
    const ics = await fetch(t.base + W('/meetings/' + booked.body.id + '/ics'), {
      headers: { cookie: ines.cookie },
    });
    const text = await ics.text();
    expect(text).toContain('BEGIN:VEVENT');
    expect(text).toContain('SUMMARY:Review with Helio');
    await pumpWorkspace(t.db.pool, ada.workspaceId, {
      subject: 'mailto:ops@example.test',
      keys: () => vapidKeys(t.db.pool),
    });
    const titles = (
      await sys('SELECT title FROM inbox_items WHERE user_id = $1', [ada.id])
    ).rows.map((r) => (r as { title: string }).title);
    expect(titles.some((x) => x.startsWith('ines booked Review with Helio on '))).toBe(true);
    const team = await t.call<{ meetings: { id: string }[]; invoices: unknown[] }>(
      ada,
      'GET',
      W('/clients/' + client + '/invoices'),
    );
    expect(team.body.meetings.map((x) => x.id)).toEqual([booked.body.id]);
    expect(
      (await t.call(ines, 'POST', W('/meetings/' + booked.body.id + '/cancel'), {})).status,
    ).toBe(200);
  });
});
