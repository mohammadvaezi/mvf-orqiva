// ── [PCODE-274 | S15 | v0.1.0] T28.3 Stories with Given/When/Then and personas; value/effort matrix, evidence library, compare ──
//    Why:  personas belong to the project and are named once; a story carries its persona and scenarios
//          through add, change and the Analyst's extraction; the matrix places ideas by mean value and
//          effort; the evidence library counts quotes, linked client requests and distinct voices.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scriptedProvider, type ModelProvider } from '../../src/agents/provider.js';
import { quadrantOf } from '../../src/api/ideaviews.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe('the matrix', () => {
  it('names the quadrant from value and effort', () => {
    expect(quadrantOf(8, 2)).toBe('quick_win');
    expect(quadrantOf(8, 8)).toBe('big_bet');
    expect(quadrantOf(3, 2)).toBe('fill_in');
    expect(quadrantOf(3, 9)).toBe('money_pit');
  });
});

describe.skipIf(!hasDatabase)('personas, stories, matrix and evidence (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let cy: Person;
  let project = '';
  let idea = '';
  let other = '';
  let current: ModelProvider | null = null;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Req = {
    id: string;
    code: string;
    kind: string;
    personaId: string | null;
    personaName: string | null;
    scenarios: { given: string; when: string; then: string }[];
  };
  type Persona = { id: string; name: string; role: string; stories: number };

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
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'BKG', name: 'Bookings' })
    ).body.id;
    idea = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/ideas'), {
        title: 'Booking reminders',
      })
    ).body.id;
    other = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/ideas'), {
        title: 'Online payment',
      })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps personas per project, named once', async () => {
    const p = await t.call<Persona>(ada, 'POST', W('/projects/' + project + '/personas'), {
      name: 'Dispatcher',
      role: 'Plans the drivers',
      pains: 'Calls customers who forgot',
    });
    expect(p.status).toBe(201);
    expect(p.body).toMatchObject({ name: 'Dispatcher', stories: 0 });
    const dup = await t.call(ada, 'POST', W('/projects/' + project + '/personas'), {
      name: 'dispatcher',
    });
    expect(dup.status).toBe(409);
    const changed = await t.call<Persona>(ada, 'PATCH', W('/personas/' + p.body.id), {
      role: 'Plans drivers and routes',
    });
    expect(changed.body.role).toBe('Plans drivers and routes');
  });

  it('keeps a story with its persona and scenarios, and changes them', async () => {
    const personas = (await t.call<Persona[]>(ada, 'GET', W('/projects/' + project + '/personas')))
      .body;
    const dispatcher = personas[0]?.id ?? '';
    const r = await t.call<Req>(ada, 'POST', W('/ideas/' + idea + '/requirements'), {
      text: 'As a dispatcher, I want to see who confirmed, so that I call only the others.',
      kind: 'story',
      personaId: dispatcher,
      scenarios: [
        { given: 'ten bookings tomorrow', when: 'six confirm', then: 'four are listed to call' },
        { given: 'x', when: 'y', then: '' },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ personaId: dispatcher, personaName: 'Dispatcher' });
    expect(r.body.scenarios).toEqual([
      { given: 'ten bookings tomorrow', when: 'six confirm', then: 'four are listed to call' },
    ]);
    const more = await t.call<Req>(ada, 'PATCH', W('/requirements/' + r.body.id), {
      scenarios: [
        ...r.body.scenarios,
        { given: 'nobody confirms', when: '18:00', then: 'all listed' },
      ],
    });
    expect(more.body.scenarios).toHaveLength(2);
    const none = await t.call<Req>(ada, 'PATCH', W('/requirements/' + r.body.id), {
      personaId: null,
    });
    expect(none.body.personaId).toBeNull();
    expect(none.body.scenarios).toHaveLength(2);
    // a persona of another project is refused
    const elsewhere = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OTH', name: 'Other' })
    ).body.id;
    const foreign = await t.call<Persona>(ada, 'POST', W('/projects/' + elsewhere + '/personas'), {
      name: 'Driver',
    });
    const refused = await t.call(ada, 'PATCH', W('/requirements/' + r.body.id), {
      personaId: foreign.body.id,
    });
    expect(refused.status).toBe(400);
  });

  it('takes personas and stories with scenarios from the Analyst', async () => {
    await t.call(ada, 'POST', W('/ideas/' + idea + '/sources'), {
      kind: 'text',
      body: 'Customers forget their booking. A reminder the day before helps.',
    });
    current = scriptedProvider([
      {
        content: [
          {
            type: 'text',
            text:
              '```json\n' +
              JSON.stringify({
                personas: [
                  { name: 'Customer', role: 'Books a slot', pains: 'Forgets it', source: 'S1' },
                  { name: 'Dispatcher', role: 'ignored: exists' },
                ],
                requirements: [
                  {
                    text: 'As a customer, I want a reminder the day before, so that I do not forget.',
                    kind: 'story',
                    area: 'users',
                    persona: 'customer',
                    scenarios: [
                      { given: 'a booking tomorrow', when: 'it is 18:00', then: 'an SMS goes out' },
                    ],
                    source: 'S1',
                    passage: 'A reminder the day before helps.',
                  },
                  {
                    text: 'As a driver, I want no reminders.',
                    kind: 'story',
                    persona: 'Driver',
                  },
                ],
              }) +
              '\n```',
          },
        ],
        stopReason: 'end_turn',
        usage: { input: 10, output: 5 },
      },
    ]);
    const x = await t.call<{ requirements: number; personas: number }>(
      ada,
      'POST',
      W('/ideas/' + idea + '/extract'),
    );
    expect(x.status).toBe(200);
    expect(x.body).toMatchObject({ requirements: 2, personas: 1 });
    const ws = (
      await t.call<{ requirements: Req[]; personas: Persona[] }>(
        ada,
        'GET',
        W('/ideas/' + idea + '/workspace'),
      )
    ).body;
    // the story's persona is matched by name or made; Driver is new in this project
    expect(ws.personas.map((p) => [p.name, p.stories])).toEqual([
      ['Customer', 1],
      ['Dispatcher', 0],
      ['Driver', 1],
    ]);
    const story = ws.requirements.find((r) => r.personaName === 'Customer');
    expect(story?.scenarios).toEqual([
      { given: 'a booking tomorrow', when: 'it is 18:00', then: 'an SMS goes out' },
    ]);
  });

  it('places the open ideas by mean value and effort', async () => {
    await t.call(ada, 'PUT', W('/ideas/' + idea + '/scores/value_effort'), {
      inputs: { value: 9, effort: 2 },
    });
    await t.call(cy, 'PUT', W('/ideas/' + idea + '/scores/value_effort'), {
      inputs: { value: 7, effort: 4 },
    });
    const m = await t.call<
      {
        ref: string;
        value: number | null;
        effort: number | null;
        scorers: number;
        quadrant: string | null;
      }[]
    >(ada, 'GET', W('/projects/' + project + '/idea-matrix'));
    expect(m.body).toEqual([
      expect.objectContaining({
        ref: 'BKG-I1',
        value: 8,
        effort: 3,
        scorers: 2,
        quadrant: 'quick_win',
      }),
      expect.objectContaining({
        ref: 'BKG-I2',
        value: null,
        effort: null,
        scorers: 0,
        quadrant: null,
      }),
    ]);
  });

  it('gathers quotes and linked client requests as evidence, with distinct voices', async () => {
    const client = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' }))
      .body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: client });
    const ask = async (title: string) =>
      (
        await t.call<{ id: string }>(ada, 'POST', W('/client-requests'), {
          kind: 'feature',
          title,
          clientId: client,
          projectId: project,
        })
      ).body.id;
    const r1 = await ask('Remind our customers');
    const r2 = await ask('SMS reminders please');
    await t.call(ada, 'POST', W('/ideas/' + idea + '/sources'), {
      kind: 'quote',
      body: 'I forgot my slot twice.',
      saidBy: 'Mrs Koch',
    });
    await t.call(ada, 'POST', W('/ideas/' + idea + '/sources'), {
      kind: 'quote',
      body: 'A text the day before would help.',
      saidBy: 'mrs koch',
    });
    await t.call(ada, 'POST', W('/ideas/' + other + '/sources'), {
      kind: 'quote',
      body: 'Let me pay online.',
      saidBy: 'Mr Lang',
    });
    const cands = await t.call<{ id: string; ref: string }[]>(
      ada,
      'GET',
      W('/ideas/' + idea + '/request-candidates'),
    );
    expect(cands.body.map((r) => r.id).sort()).toEqual([r1, r2].sort());
    await t.call(ada, 'POST', W('/ideas/' + idea + '/requests'), { requestId: r1 });
    const linked = await t.call<{ ref: string; clientName: string }[]>(
      ada,
      'POST',
      W('/ideas/' + idea + '/requests'),
      { requestId: r2 },
    );
    expect(linked.body.map((r) => r.clientName)).toEqual(['Helio', 'Helio']);
    expect(linked.body[0]?.ref).toMatch(/^F-\d+$/);

    const ev = await t.call<{
      ideas: { ref: string; quotes: number; requests: number; voices: number }[];
      quotes: { ideaRef: string; saidBy: string }[];
      requests: { ideaRef: string; title: string }[];
    }>(ada, 'GET', W('/projects/' + project + '/evidence'));
    // Mrs Koch twice is one voice; Helio's two requests are one more
    expect(ev.body.ideas).toEqual([
      {
        id: idea,
        ref: 'BKG-I1',
        title: 'Booking reminders',
        status: 'new',
        quotes: 2,
        requests: 2,
        voices: 2,
      },
      {
        id: other,
        ref: 'BKG-I2',
        title: 'Online payment',
        status: 'new',
        quotes: 1,
        requests: 0,
        voices: 1,
      },
    ]);
    expect(ev.body.quotes).toHaveLength(3);
    expect(ev.body.requests.map((r) => r.ideaRef)).toEqual(['BKG-I1', 'BKG-I1']);

    const after = await t.call<unknown[]>(ada, 'DELETE', W('/ideas/' + idea + '/requests/' + r1));
    expect(after.body).toHaveLength(1);
  });
});
