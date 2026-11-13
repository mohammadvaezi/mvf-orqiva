// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-280 | S15 | v0.1.0] T29.2 Block editor for documents: edit in place, insert menu, drag to reorder, paste images ──
// ── [PCODE-278 | S15 | v0.1.0] T28.7 T28 exit check, docs and sprint close ──
//    Why:  the T28 exit as one product owner's path, end to end against the real server: a link read as a
//          source, the interview steered by coverage to its end, the Analyst's personas and stories, the
//          matrix and the evidence, a PRD with its kind's sections and citations, its estimate and a Word
//          file, review by a team member and a client contact signing in the portal, an edit that reopens
//          it, and promotion to an epic whose story carries its scenario as a criterion.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scriptedProvider, type ModelReply } from '../../src/agents/provider.js';
import { docxText } from '../../src/files/docx.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { listenFetchable } from '../ports.js'; // [PCODE-365 | S15 | v0.1.0]

const say = (text: string): ModelReply => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage: { input: 20, output: 10 },
});
const json = (o: unknown): ModelReply => say('```json\n' + JSON.stringify(o) + '\n```');

describe.skipIf(!hasDatabase)('T28 exit: ideation and the PRD (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let cy: Person;
  let ines: Person;
  let web: Server;
  let site = '';
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const model = scriptedProvider([
    // the interview: one question about users, then the summary when told to finish
    say('[users] Who forgets their slot most often?'),
    say('READY: Busy parents forget slots; a reminder the day before helps.'),
    // the Analyst
    json({
      personas: [
        { name: 'Parent', role: 'Books slots for the family', pains: 'Forgets', source: 'S1' },
      ],
      requirements: [
        {
          text: 'A reminder goes out the day before the slot',
          kind: 'functional',
          area: 'scope',
          priority: 'must',
          source: 'S1',
          passage: 'A reminder the day before',
        },
        {
          text: 'As a parent, I want a reminder, so that I keep my slot.',
          kind: 'story',
          area: 'users',
          persona: 'Parent',
          scenarios: [{ given: 'a slot tomorrow', when: 'it is 18:00', then: 'an SMS goes out' }],
        },
      ],
    }),
    // the Architect, with the feature's sections and citations
    json({
      summary: 'Remind parents the day before [R-1].',
      problem: 'Parents forget their slot [S1].',
      goals: ['Fewer missed slots [R-1, R-2]'],
      scopeIn: ['SMS the day before [R-1]'],
      scopeOut: ['E-mail reminders'],
      risks: [],
      sections: [{ key: 'metrics', title: 'Success metrics', body: 'Missed slots halve [R-1].' }],
      tasks: [
        { title: 'Send the reminder', estimate: 3 },
        { title: 'Opt-out', estimate: 2 },
      ],
    }),
  ]);

  beforeAll(async () => {
    web = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        '<html><head><title>Support notes</title></head><body><main><p>A reminder the day before would save slots.</p></main></body></html>',
      );
    });
    await listenFetchable(web); // [PCODE-365 | S15 | v0.1.0]
    site = 'http://127.0.0.1:' + String((web.address() as AddressInfo).port);
    t = await startTestApp({ agents: { provider: () => Promise.resolve(model) } });
    ada = await t.signup('Ada');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
    const client = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Kita' })).body
      .id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'KIT', name: 'Kita app' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: client });
    const inv = await t.call<{ invitation: { token: string } | null }>(
      ada,
      'POST',
      W('/clients/' + client + '/contacts'),
      { email: 'ines@kita.example', portalRole: 'approver' },
    );
    const res = await fetch(
      t.base + '/auth/invitations/' + (inv.body.invitation?.token ?? '') + '/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ines', password: 'a client password 1' }),
      },
    );
    ines = {
      id: '',
      email: 'ines@kita.example',
      name: 'ines',
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      workspaceId: ada.workspaceId,
    };
    ines.id = (await t.call<{ user: { id: string } }>(ines, 'GET', '/auth/me')).body.user.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    await new Promise((r) => web.close(r));
  });

  it('takes an idea from a link to an epic, signed by the team and the client', async () => {
    const idea = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/ideas'), {
        title: 'Slot reminders',
        body: 'Parents forget their slots.',
      })
    ).body.id;

    // intake: a link read by the server
    const src = await t.call<{ title: string; link: { status: string } }>(
      ada,
      'POST',
      W('/ideas/' + idea + '/sources'),
      { kind: 'link', url: site + '/notes' },
    );
    expect(src.body).toMatchObject({ title: 'Support notes', link: { status: 'read' } });

    // the interview by coverage, ended by the owner
    const q = await t.call<{ messages: { area: string | null }[] }>(
      ada,
      'POST',
      W('/ideas/' + idea + '/interview'),
      {},
    );
    expect(q.body.messages[0]?.area).toBe('users');
    const done = await t.call<{
      idea: { interviewDone: boolean };
      coverage: Record<string, number>;
    }>(ada, 'POST', W('/ideas/' + idea + '/interview'), { answer: 'Busy parents.', enough: true });
    expect(done.body.idea.interviewDone).toBe(true);
    expect(done.body.coverage['users']).toBe(67);

    // the Analyst: a persona, a story with its scenario, a cited requirement
    const x = await t.call<{ requirements: number; personas: number; cited: number }>(
      ada,
      'POST',
      W('/ideas/' + idea + '/extract'),
    );
    expect(x.body).toMatchObject({ requirements: 2, personas: 1, cited: 1 });
    for (const r of (
      await t.call<{ requirements: { id: string }[] }>(
        ada,
        'GET',
        W('/ideas/' + idea + '/workspace'),
      )
    ).body.requirements)
      await t.call(ada, 'PATCH', W('/requirements/' + r.id), { status: 'accepted' });

    // the matrix and the evidence
    await t.call(ada, 'PUT', W('/ideas/' + idea + '/scores/value_effort'), {
      inputs: { value: 8, effort: 3 },
    });
    await t.call(ada, 'POST', W('/ideas/' + idea + '/sources'), {
      kind: 'quote',
      body: 'I missed two slots.',
      saidBy: 'A parent',
    });
    const matrix = await t.call<{ quadrant: string | null }[]>(
      ada,
      'GET',
      W('/projects/' + project + '/idea-matrix'),
    );
    expect(matrix.body[0]?.quadrant).toBe('quick_win');
    const ev = await t.call<{ ideas: { voices: number }[] }>(
      ada,
      'GET',
      W('/projects/' + project + '/evidence'),
    );
    expect(ev.body.ideas[0]?.voices).toBe(1);

    // the PRD: sections of a feature, citations, estimate, Word
    const draft = await t.call<{ version: number }>(
      ada,
      'POST',
      W('/ideas/' + idea + '/proposals/draft'),
    );
    expect(draft.status).toBe(201);
    const prd = await t.call<{ report: { cited: number; total: number } }>(
      ada,
      'GET',
      W('/ideas/' + idea + '/prd'),
    );
    expect(prd.body.report.cited).toBeGreaterThanOrEqual(5);
    const est = await t.call<{ range: { size: string; basis: string } }>(
      ada,
      'GET',
      W('/ideas/' + idea + '/estimate'),
    );
    expect(est.body.range).toMatchObject({ size: 'S', basis: 'standard' });
    const word = await fetch(t.base + W('/ideas/' + idea + '/prd/export?format=docx'), {
      headers: { cookie: ada.cookie },
    });
    const words = docxText(Buffer.from(await word.arrayBuffer()));
    expect(words).toContain('Success metrics');
    expect(words).toContain('As a parent, I want a reminder');

    // review by a team member and the client's contact
    await t.call(ada, 'PUT', W('/ideas/' + idea + '/approvers'), { userIds: [cy.id, ines.id] });
    await t.call(ada, 'POST', W('/ideas/' + idea + '/review'));
    const signCy = (version: number) =>
      t.call(cy, 'POST', W('/ideas/' + idea + '/review/decide'), {
        version,
        decision: 'approve',
        name: cy.name,
        consent: true,
      });
    const signInes = (version: number) =>
      t.call<{ status: string }>(ines, 'POST', W('/portal/prds/' + idea + '/decision'), {
        version,
        decision: 'approve',
        name: 'ines',
        consent: true,
      });
    await signCy(1);
    expect((await signInes(1)).body.status).toBe('approved');

    // an edit before promotion reopens it; both sign again
    const v1 = (
      await t.call<{ content: Record<string, unknown> }[]>(
        ada,
        'GET',
        W('/ideas/' + idea + '/proposals'),
      )
    ).body[0]?.content;
    await t.call(ada, 'POST', W('/ideas/' + idea + '/proposals'), {
      content: { ...v1, goals: ['Fewer missed slots [R-1, R-2]', 'No extra calls'] },
    });
    const reopened = await t.call<{ status: string; versions: { state: string }[] }>(
      ada,
      'GET',
      W('/ideas/' + idea + '/review'),
    );
    expect(reopened.body.status).toBe('in_review');
    expect(reopened.body.versions.map((v) => v.state)).toEqual(['in_review', 'superseded']);
    await signCy(2);
    expect((await signInes(2)).body.status).toBe('approved');

    // promotion: an epic, the story with its criterion, the tasks
    const p = await t.call<{ epic: { ref: string }; items: { id: string; kind: string }[] }>(
      ada,
      'POST',
      W('/ideas/' + idea + '/promote'),
    );
    expect(p.body.epic.ref).toBe('KIT-1');
    expect(p.body.items.map((i) => i.kind)).toEqual(['story', 'task', 'task']);
    const crit = await t.call<{ text: string }[]>(
      ada,
      'GET',
      W('/items/' + (p.body.items[0]?.id ?? '') + '/criteria'),
    );
    expect(crit.body[0]?.text).toBe(
      'Given a slot tomorrow, when it is 18:00, then an SMS goes out',
    );
  });
});
