// ── [PCODE-271 | S15 | v0.1.0] Project tabs fixes from the deep UX check: handover double page, service accounts, lifecycle name, extraction duplicates, AI cases picker, webhook events, overdue sprint, tab overflow ──
// ── [PCODE-168 | S15 | v0.1.0] B3.1 Ideation and files on the server: blob store, sources, requirements, questions, risks, assumptions, decisions, glossary, scores, extraction ──
//    Why:  Ideation and the file store through the API against PostgreSQL: uploads kept once by hash with
//          their text, sources of every kind, requirements that cite only real passages, questions that
//          close when answered, risks by exposure, scores from two people with the spread, the Analyst's
//          extraction, merging a duplicate, decisions superseding each other, the glossary.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  scriptedProvider,
  type ModelProvider,
  type ModelReply,
} from '../../src/agents/provider.js';
import { cleanStatement, coverage, sameText, scoreOf } from '../../src/api/ideation.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const say = (text: string): ModelReply => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage: { input: 50, output: 20 },
});

describe('ideation rules', () => {
  it('scores RICE, ICE, WSJF, MoSCoW and value/effort, and refuses inputs out of range', () => {
    expect(scoreOf('rice', { reach: 1000, impact: 2, confidence: 80, effort: 4 })).toBe(400);
    expect(scoreOf('ice', { impact: 8, confidence: 5, ease: 2 })).toBe(80);
    expect(
      scoreOf('wsjf', { businessValue: 8, timeCriticality: 5, riskReduction: 3, jobSize: 8 }),
    ).toBe(2);
    expect(scoreOf('moscow', { category: 'must' })).toBe(4);
    expect(scoreOf('value_effort', { value: 9, effort: 3 })).toBe(3);
    expect(scoreOf('rice', { reach: 10, impact: 9, confidence: 50, effort: 1 })).toBeNull();
  });

  it('measures coverage per area; open questions hold it below full', () => {
    const c = coverage(
      [
        { area: 'scope', status: 'accepted' },
        { area: 'scope', status: 'proposed' },
        { area: 'scope', status: 'accepted' },
        { area: 'data', status: 'rejected' },
      ],
      [
        { area: 'security', status: 'answered' },
        { area: 'scope', status: 'open' },
      ],
    );
    expect(c).toMatchObject({ scope: 66, security: 33, data: 0, problem: 0 });
  });
});

describe.skipIf(!hasDatabase)('ideation and files (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let cy: Person;
  let current: ModelProvider | null = null;
  let project = '';
  let idea = '';
  let other = '';
  let file = '';
  const ids: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const upload = (who: Person, name: string, type: string, data: string | Buffer, q = '') =>
    fetch(t.base + W('/files?name=' + encodeURIComponent(name) + '&projectId=' + project + q), {
      method: 'POST',
      headers: { cookie: who.cookie, 'content-type': type },
      body: data,
    });
  type Ws = {
    idea: {
      status: string;
      lastActivityAt: string;
      mergedIntoId: string | null;
      rejectedReason: string;
    };
    sources: { id: string; label: string; kind: string; textLength: number }[];
    requirements: {
      code: string;
      status: string;
      sourceId: string | null;
      passage: string;
      text: string;
    }[];
    questions: { status: string; answeredAt: string | null; ownerName: string | null }[];
    risks: { exposure: number }[];
    assumptions: { text: string }[];
    scores: {
      method: string;
      count: number;
      mean: number;
      spread: number;
      mine: { score: number } | null;
    }[];
    coverage: Record<string, number>;
    decisions: { code: string }[];
  };
  const ws = async (id = idea): Promise<Ws> =>
    (await t.call<Ws>(ada, 'GET', W('/ideas/' + id + '/workspace'))).body;

  beforeAll(async () => {
    t = await startTestApp({
      agents: {
        provider: () => {
          if (!current) throw new Error('no script');
          return Promise.resolve(current);
        },
      },
    });
    ada = await t.signup('Ada');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'IDE', name: 'Ideas' })
    ).body.id;
    idea = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/ideas'), {
        title: 'Live tracking for customers',
        body: 'Customers ask where their parcel is.',
      })
    ).body.id;
    other = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/ideas'), {
        title: 'Parcel tracking page',
        body: 'Same thing, asked by support.',
      })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('stores an upload once by its hash, keeps its text, and serves it back', async () => {
    const text =
      '# Brief\nThe page must show the live position. Drivers should share location only on duty.';
    const r = await upload(ada, 'brief.md', 'text/markdown', text);
    expect(r.status).toBe(201);
    const f = (await r.json()) as {
      id: string;
      sha256: string;
      hasText: boolean;
      url: string;
      sizeBytes: number;
    };
    expect(f).toMatchObject({ hasText: true, sizeBytes: Buffer.byteLength(text) });
    file = f.id;
    const again = (await (await upload(ada, 'copy.md', 'text/markdown', text)).json()) as {
      sha256: string;
    };
    expect(again.sha256).toBe(f.sha256);
    const back = await fetch(t.base + f.url, { headers: { cookie: ada.cookie } });
    expect(back.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(await back.text()).toBe(text);
    const png = await upload(ada, 'shot.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const pngUrl = ((await png.json()) as { url: string }).url;
    expect(
      (await fetch(t.base + pngUrl, { headers: { cookie: ada.cookie } })).headers.get(
        'content-disposition',
      ),
    ).toMatch(/^inline/);
    expect((await upload(ada, '', 'text/plain', 'x')).status).toBe(400);
    expect((await upload(ada, 'empty.txt', 'text/plain', '')).status).toBe(400);
    const list = await t.call<{ id: string }[]>(ada, 'GET', W('/projects/' + project + '/files'));
    expect(list.body.length).toBe(3);
  });

  it('adds sources of every kind and refuses incomplete ones', async () => {
    const s1 = await t.call<{ label: string; textLength: number }>(
      ada,
      'POST',
      W('/ideas/' + idea + '/sources'),
      { kind: 'file', fileId: file },
    );
    expect(s1.status).toBe(201);
    expect(s1.body.label).toBe('S1');
    expect(s1.body.textLength).toBeGreaterThan(20);
    expect(
      (
        await t.call(ada, 'POST', W('/ideas/' + idea + '/sources'), {
          kind: 'quote',
          body: 'I call support three times a day to ask where the truck is.',
          saidBy: 'Nordwind dispatch',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await t.call(ada, 'POST', W('/ideas/' + idea + '/sources'), {
          kind: 'link',
          url: 'javascript:alert(1)',
        })
      ).status,
    ).toBe(400);
    expect(
      (await t.call(ada, 'POST', W('/ideas/' + idea + '/sources'), { kind: 'text' })).status,
    ).toBe(400);
    const w = await ws();
    expect(w.sources.map((s) => s.kind)).toEqual(['file', 'quote']);
    ids['S1'] = w.sources[0]?.id ?? '';
  });

  it('numbers requirements and accepts a citation only when the passage is in the source', async () => {
    const ok = await t.call<{ code: string; passage: string }>(
      ada,
      'POST',
      W('/ideas/' + idea + '/requirements'),
      {
        text: 'Show the live position of the truck',
        area: 'scope',
        sourceId: ids['S1'],
        passage: 'The page must show   the live position.',
      },
    );
    expect(ok.status).toBe(201);
    expect(ok.body.code).toBe('R-1');
    const bad = await t.call(ada, 'POST', W('/ideas/' + idea + '/requirements'), {
      text: 'x',
      sourceId: ids['S1'],
      passage: 'This sentence is not there.',
    });
    expect(bad.status).toBe(400);
  });

  it('closes a question when it is answered, ranks risks by exposure, keeps assumptions', async () => {
    const q = await t.call<{ id: string }>(ada, 'POST', W('/ideas/' + idea + '/questions'), {
      text: 'Who may see a driver’s position?',
      area: 'security',
      ownerId: cy.id,
      dueDate: '2030-01-10',
    });
    expect(q.status).toBe(201);
    const a = await t.call<{ status: string; answeredAt: string | null }>(
      ada,
      'PATCH',
      W('/idea-questions/' + q.body.id),
      { answer: 'Only the customer of the shipment.' },
    );
    expect(a.body.status).toBe('answered');
    expect(a.body.answeredAt).not.toBeNull();
    expect(
      (
        await t.call(ada, 'POST', W('/ideas/' + idea + '/questions'), {
          text: 'x',
          dueDate: 'tomorrow!',
        })
      ).status,
    ).toBe(400);
    await t.call(ada, 'POST', W('/ideas/' + idea + '/risks'), {
      text: 'GPS gaps in tunnels',
      likelihood: 2,
      impact: 2,
    });
    await t.call(ada, 'POST', W('/ideas/' + idea + '/risks'), {
      text: 'Location data leaks',
      likelihood: 3,
      impact: 5,
    });
    await t.call(ada, 'POST', W('/ideas/' + idea + '/assumptions'), {
      text: 'Drivers keep the app open',
      validateHow: 'Ask three drivers',
    });
    const w = await ws();
    expect(w.risks.map((r) => r.exposure)).toEqual([15, 4]);
    expect(w.coverage).toMatchObject({ security: 33, scope: 33 });
  });

  it('takes scores from two people and shows how far apart they are', async () => {
    expect(
      (
        await t.call(ada, 'PUT', W('/ideas/' + idea + '/scores/ice'), {
          inputs: { impact: 8, confidence: 5, ease: 5 },
        })
      ).status,
    ).toBe(200);
    await t.call(cy, 'PUT', W('/ideas/' + idea + '/scores/ice'), {
      inputs: { impact: 4, confidence: 5, ease: 5 },
    });
    expect(
      (await t.call(ada, 'PUT', W('/ideas/' + idea + '/scores/rice'), { inputs: { reach: 1 } }))
        .status,
    ).toBe(400);
    const ice = (await ws()).scores.find((x) => x.method === 'ice');
    expect(ice).toMatchObject({ count: 2, mean: 150, spread: 0.67, mine: { score: 200 } });
  });

  it('lets the Analyst extract, citing only what is really in the sources', async () => {
    current = scriptedProvider([
      say(
        '```json\n' +
          JSON.stringify({
            requirements: [
              {
                text: 'Drivers share their location only while on duty',
                kind: 'non_functional',
                area: 'security',
                priority: 'must',
                source: 'S1',
                passage: 'Drivers should share location only on duty.',
              },
              {
                text: 'Support sees the same map',
                kind: 'functional',
                area: 'users',
                source: 'S2',
                passage: 'invented passage',
              },
              { text: 'Show the live position of the truck', source: 'S1', passage: '' },
            ],
            questions: [{ text: 'How often does the position refresh?', area: 'non_functional' }],
            assumptions: [{ text: 'Customers have a smartphone', validateHow: 'Survey' }],
            risks: [{ text: 'Battery drain', likelihood: 9, impact: 2 }],
            glossary: [{ term: 'Tour', definition: 'All stops of one truck on one day' }],
          }) +
          '\n```',
      ),
    ]);
    const r = await t.call<{
      requirements: number;
      cited: number;
      questions: number;
      risks: number;
      glossary: number;
    }>(ada, 'POST', W('/ideas/' + idea + '/extract'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      requirements: 2,
      cited: 1,
      questions: 1,
      risks: 1,
      glossary: 1,
    });
    const w = await ws();
    expect(w.requirements.map((x) => [x.code, x.status, x.passage !== ''])).toEqual([
      ['R-1', 'accepted', true],
      ['R-2', 'proposed', true],
      ['R-3', 'proposed', false],
    ]);
    expect(w.risks[0]?.exposure).toBe(15);
  });

  // [PCODE-271 | S15 | v0.1.0] a second extraction keeps what is new, not markers, labels, prompt lines or repeats
  it('keeps only new statements from a second extraction', async () => {
    expect(cleanStatement('- Show the map.')).toBe('Show the map.');
    expect(cleanStatement('A: Drivers must sign in')).toBe('Drivers must sign in');
    expect(cleanStatement('EXISTING requirements: - Show the map')).toBeNull();
    expect(cleanStatement('### S1 Call notes')).toBeNull();
    expect(sameText('Show the map.')).toBe(sameText('- show  the map'));
    current = scriptedProvider([
      say(
        JSON.stringify({
          requirements: [
            { text: '- Show the live position of the truck.' },
            { text: 'EXISTING requirements: - Support sees the same map' },
            { text: 'A: Dispatchers must see late trucks first' },
            { text: 'Dispatchers must see late trucks first.' },
          ],
          questions: [{ text: 'Q: Who pays for the SMS?' }, { text: 'Who pays for the SMS?' }],
        }),
      ),
    ]);
    const r = await t.call<{ requirements: number; questions: number }>(
      ada,
      'POST',
      W('/ideas/' + idea + '/extract'),
    );
    expect(r.body).toMatchObject({ requirements: 1, questions: 1 });
    const w = await ws();
    expect(w.requirements.map((x) => x.text).slice(-1)).toEqual([
      'Dispatchers must see late trucks first',
    ]);
  });

  it('merges a duplicate idea into this one', async () => {
    await t.call(ada, 'POST', W('/ideas/' + other + '/requirements'), {
      text: 'Support can open the tracking page',
    });
    await t.call(ada, 'POST', W('/ideas/' + other + '/sources'), {
      kind: 'text',
      body: 'Support ticket 4411',
    });
    const m = await t.call<{ status: string; mergedIntoId: string; rejectedReason: string }>(
      ada,
      'POST',
      W('/ideas/' + other + '/merge'),
      { intoId: idea },
    );
    expect(m.body).toMatchObject({
      status: 'declined',
      mergedIntoId: idea,
      rejectedReason: 'Merged into IDE-I1',
    });
    const w = await ws();
    // R-4 came from the second extraction
    expect(w.requirements.map((x) => x.code)).toEqual(['R-1', 'R-2', 'R-3', 'R-4', 'R-5']);
    expect(w.sources).toHaveLength(3);
    expect(
      (await t.call(ada, 'POST', W('/ideas/' + idea + '/merge'), { intoId: idea })).status,
    ).toBe(400);
  });

  it('keeps the decision log and the glossary per project', async () => {
    const d1 = await t.call<{ id: string; code: string }>(
      ada,
      'POST',
      W('/projects/' + project + '/decisions'),
      { title: 'Use OpenStreetMap tiles', status: 'accepted', ideaId: idea },
    );
    expect(d1.body.code).toBe('ADR-1');
    const d2 = await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/decisions'), {
      title: 'Use our own tile server',
    });
    const sup = await t.call<{ status: string; supersededBy: string }>(
      ada,
      'PATCH',
      W('/decisions/' + d1.body.id),
      { supersededBy: d2.body.id },
    );
    expect(sup.body).toMatchObject({ status: 'superseded', supersededBy: d2.body.id });
    expect((await ws()).decisions.map((d) => d.code)).toEqual(['ADR-1']);
    expect(
      (
        await t.call(ada, 'POST', W('/projects/' + project + '/glossary'), {
          term: 'tour',
          definition: 'again',
        })
      ).status,
    ).toBe(409);
    const g = await t.call<{ term: string }[]>(ada, 'GET', W('/projects/' + project + '/glossary'));
    expect(g.body.map((x) => x.term)).toEqual(['Tour']);
  });

  it('keeps ideation from client contacts', async () => {
    const helio = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' })).body
      .id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: helio });
    const inv = await t.call<{ invitation: { token: string } }>(
      ada,
      'POST',
      W('/clients/' + helio + '/contacts'),
      { email: 'ines@helio.example', portalRole: 'viewer' },
    );
    const res = await fetch(t.base + '/auth/invitations/' + inv.body.invitation.token + '/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ines', password: 'a client password 1' }),
    });
    const ines: Person = {
      id: '',
      email: 'ines@helio.example',
      name: 'Ines',
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      workspaceId: ada.workspaceId,
    };
    expect((await t.call(ines, 'GET', W('/ideas/' + idea + '/workspace'))).status).toBe(403);
    expect((await t.call(ines, 'GET', W('/projects/' + project + '/glossary'))).status).toBe(403);
    expect((await upload(ines, 'x.txt', 'text/plain', 'x')).status).toBe(403);
  });
});
