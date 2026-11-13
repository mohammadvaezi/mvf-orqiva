// ── [PCODE-277 | S15 | v0.1.0] T28.6 PRD approval by named approvers, reopen on edit, promote to an epic with stories, client in ideation ──
//    Why:  a PRD reviewed by a team member and a client contact: each is asked, signs the exact version or
//          asks for changes, a new version voids what was decided, every approver approving settles it,
//          and promotion makes the epic with the story's scenarios as criteria. The contact reads, signs
//          and answers questions in the portal.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scriptedProvider, type ModelReply } from '../../src/agents/provider.js';
import { criterionOf, versionState } from '../../src/api/prdreview.js';
import { pumpWorkspace, vapidKeys } from '../../src/push/dispatch.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const say = (text: string): ModelReply => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage: { input: 10, output: 5 },
});

describe('review rules', () => {
  it('names the state of each version', () => {
    expect(versionState(false, 'approved', [])).toBe('superseded');
    expect(versionState(true, 'in_review', [{ decision: 'approved' }])).toBe('in_review');
    expect(versionState(true, 'proposed', [{ decision: 'declined' }])).toBe('changes_requested');
    expect(versionState(true, 'proposed', [])).toBe('draft');
    expect(versionState(true, 'approved', [])).toBe('approved');
    expect(criterionOf({ given: 'a booking', when: '18:00', then: 'an SMS\ngoes out' })).toBe(
      'Given a booking, when 18:00, then an SMS; goes out',
    );
  });
});

describe.skipIf(!hasDatabase)('PRD review (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let cy: Person;
  let ines: Person;
  let project = '';
  let idea = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Review = {
    status: string;
    version: number | null;
    approvers: { name: string; kind: string; decision: string | null }[];
    versions: { version: number; state: string }[];
    mayDecide: boolean;
    promoted: { epicId: string | null } | null;
  };
  const content = (summary: string) => ({
    summary,
    problem: 'Customers forget bookings.',
    goals: ['Fewer no-shows'],
    scopeIn: ['SMS the day before'],
    scopeOut: [],
    risks: [],
    tasks: [
      { title: 'Send the SMS', estimate: 3 },
      { title: 'Opt-out link', estimate: 2 },
    ],
  });
  const pump = () =>
    pumpWorkspace(t.db.pool, ada.workspaceId, {
      allowEndpoint: () => true,
      subject: 'mailto:ops@example.test',
      keys: () => vapidKeys(t.db.pool),
    });
  const inbox = async (who: Person) =>
    (
      await t.call<{ items: { title: string; objectId: string; url: string }[] }>(
        who,
        'GET',
        W('/inbox'),
      )
    ).body.items.filter((i) => i.objectId === idea);
  const sign = (
    who: Person,
    version: number,
    decision: 'approve' | 'changes',
    name: string,
    note?: string,
  ) =>
    t.call<Review>(who, 'POST', W('/ideas/' + idea + '/review/decide'), {
      version,
      decision,
      name,
      consent: true,
      ...(note ? { note } : {}),
    });
  const portalSign = (version: number, decision: 'approve' | 'changes', note?: string) =>
    t.call<{ status: string }>(ines, 'POST', W('/portal/prds/' + idea + '/decision'), {
      version,
      decision,
      name: 'ines',
      consent: true,
      ...(note ? { note } : {}),
    });
  const review = async () =>
    (await t.call<Review>(ada, 'GET', W('/ideas/' + idea + '/review'))).body;

  beforeAll(async () => {
    t = await startTestApp({
      agents: { provider: () => Promise.resolve(scriptedProvider([say('READY: Remind them.')])) },
    });
    ada = await t.signup('Ada');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
    const helio = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' })).body
      .id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: helio });
    const inv = await t.call<{ invitation: { token: string } | null }>(
      ada,
      'POST',
      W('/clients/' + helio + '/contacts'),
      { email: 'ines@helio.example', portalRole: 'approver' },
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
      email: 'ines@helio.example',
      name: 'ines',
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      workspaceId: ada.workspaceId,
    };
    ines.id = (await t.call<{ user: { id: string } }>(ines, 'GET', '/auth/me')).body.user.id;
    idea = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/ideas'), {
        title: 'Booking reminders',
      })
    ).body.id;
    await t.call(ada, 'POST', W('/ideas/' + idea + '/requirements'), {
      text: 'As a customer, I want a reminder, so that I come.',
      kind: 'story',
      scenarios: [{ given: 'a booking tomorrow', when: 'it is 18:00', then: 'an SMS goes out' }],
    });
    await t.call(ada, 'POST', W('/ideas/' + idea + '/interview'), {});
    await t.call(ada, 'POST', W('/ideas/' + idea + '/proposals'), {
      content: content('Version one.'),
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('names team members and the client’s contacts as approvers, and then the owner does not sign alone', async () => {
    const cands = await t.call<{ userId: string; name: string; kind: string }[]>(
      ada,
      'GET',
      W('/ideas/' + idea + '/approver-candidates'),
    );
    expect(cands.body).toEqual(
      expect.arrayContaining([
        { userId: cy.id, name: cy.name, kind: 'team' },
        { userId: ines.id, name: 'ines', kind: 'client' },
      ]),
    );
    expect(
      (await t.call(ada, 'PUT', W('/ideas/' + idea + '/approvers'), { userIds: [ines.id, cy.id] }))
        .status,
    ).toBe(200);
    const owner = await t.call<{ error: { message: string } }>(
      ada,
      'POST',
      W('/ideas/' + idea + '/sign'),
      {
        version: 1,
        decision: 'approve',
        name: ada.name,
        consent: true,
      },
    );
    expect(owner.body.error.message).toBe(
      'This PRD has named approvers: they decide in its review',
    );
  });

  it('asks every approver, team in the app and client in the portal', async () => {
    const r = await t.call<Review>(ada, 'POST', W('/ideas/' + idea + '/review'));
    expect(r.body.status).toBe('in_review');
    expect(r.body.versions).toEqual([{ version: 1, state: 'in_review' }]);
    await pump();
    expect((await inbox(cy)).map((i) => [i.title, i.url])).toEqual([
      ['Please review and sign: HEL Booking reminders', '/ideas/' + idea],
    ]);
  });

  it('keeps each signed decision; a request for changes sends it back', async () => {
    expect((await sign(cy, 1, 'approve', 'Someone Else')).status).toBe(400);
    expect((await sign(ada, 1, 'approve', ada.name)).status).toBe(403);
    const cyOk = await sign(cy, 1, 'approve', cy.name);
    expect(cyOk.body.status).toBe('in_review');
    expect(cyOk.body.approvers.find((x) => x.kind === 'team')?.decision).toBe('approved');
    expect(cyOk.body.mayDecide).toBe(false);

    const list = await t.call<{ ideaId: string; markdown: string; mayDecide: boolean }[]>(
      ines,
      'GET',
      W('/portal/prds'),
    );
    expect(list.body).toHaveLength(1);
    expect(list.body[0]?.markdown).toContain('# HEL-I1 Booking reminders');
    expect(list.body[0]?.mayDecide).toBe(true);
    expect((await portalSign(1, 'changes')).status).toBe(400);
    const back = await portalSign(1, 'changes', 'Add the opt-out to the summary');
    expect(back.body.status).toBe('proposed');
    expect((await review()).versions).toEqual([{ version: 1, state: 'changes_requested' }]);
  });

  it('voids earlier decisions with a new version, and approves when every approver approved it', async () => {
    await t.call(ada, 'POST', W('/ideas/' + idea + '/proposals'), {
      content: content('Version two, with opt-out.'),
    });
    await t.call(ada, 'POST', W('/ideas/' + idea + '/review'));
    let r = await review();
    expect(r.versions).toEqual([
      { version: 2, state: 'in_review' },
      { version: 1, state: 'superseded' },
    ]);
    expect(r.approvers.map((x) => x.decision)).toEqual([null, null]);
    await sign(cy, 2, 'approve', cy.name);
    expect((await portalSign(2, 'approve')).body.status).toBe('approved');

    // an edit after approval reopens it and asks again
    await pump();
    await t.call(ada, 'POST', W('/ideas/' + idea + '/proposals'), {
      content: content('Version three.'),
    });
    r = await review();
    expect(r.status).toBe('in_review');
    expect(r.versions[0]).toEqual({ version: 3, state: 'in_review' });
    await pump();
    expect((await inbox(cy)).map((i) => i.title)).toContain(
      'Changed, please review again: HEL Booking reminders',
    );
    await sign(cy, 3, 'approve', cy.name);
    await portalSign(3, 'approve');
    expect((await review()).status).toBe('approved');
    // the trace shows the version the approvers signed
    const trace = await t.call<{ nodes: { kind: string; label: string; detail: string }[] }>(
      ada,
      'GET',
      W('/trace?ideaId=' + idea),
    );
    const prop = trace.body.nodes.find((n) => n.kind === 'proposal');
    expect(prop?.label).toBe('Proposal v3');
  });

  it('promotes the approved idea to an epic with its story and tasks, and freezes the PRD', async () => {
    const p = await t.call<{
      epic: { ref: string };
      items: { id: string; ref: string; kind: string }[];
    }>(cy, 'POST', W('/ideas/' + idea + '/promote'));
    expect(p.status).toBe(201);
    expect(p.body.epic.ref).toBe('HEL-1');
    expect(p.body.items.map((x) => [x.ref, x.kind])).toEqual([
      ['HEL-2', 'story'],
      ['HEL-3', 'task'],
      ['HEL-4', 'task'],
    ]);
    const story = p.body.items[0]?.id ?? '';
    const crit = await t.call<{ text: string }[]>(ada, 'GET', W('/items/' + story + '/criteria'));
    expect(crit.body.map((x) => x.text)).toEqual([
      'Given a booking tomorrow, when it is 18:00, then an SMS goes out',
    ]);
    const item = await t.call<{ parentId: string | null; kind: string }>(
      ada,
      'GET',
      W('/items/' + story),
    );
    expect(item.body.kind).toBe('story');
    expect((await review()).promoted?.epicId).toBeTruthy();
    expect(
      (await t.call(ada, 'POST', W('/ideas/' + idea + '/proposals'), { content: content('Four') }))
        .status,
    ).toBe(409);
  });

  it('lets the contact answer the questions handed to them in the portal', async () => {
    const other = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/ideas'), {
        title: 'Texting rules',
      })
    ).body.id;
    const q = await t.call<{ id: string }>(ada, 'POST', W('/ideas/' + other + '/questions'), {
      text: 'Which numbers may we text?',
      ownerId: ines.id,
    });
    expect(q.status).toBe(201);
    const open = await t.call<{ id: string; ideaRef: string }[]>(
      ines,
      'GET',
      W('/portal/questions'),
    );
    expect(open.body.map((x) => x.ideaRef)).toEqual(['HEL-I2']);
    expect(
      (
        await t.call(ines, 'POST', W('/portal/questions/' + q.body.id + '/answer'), {
          answer: 'Mobiles only',
        })
      ).status,
    ).toBe(200);
    expect((await t.call<unknown[]>(ines, 'GET', W('/portal/questions'))).body).toEqual([]);
    const ws = await t.call<{ questions: { answer: string; status: string }[] }>(
      ada,
      'GET',
      W('/ideas/' + other + '/workspace'),
    );
    expect(ws.body.questions.find((x) => x.answer === 'Mobiles only')?.status).toBe('answered');
  });
});
