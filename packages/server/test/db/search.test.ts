// ── [PCODE-346 | S15 | v0.1.0] T35.1a Cmd-K over agents, runs, people and settings; keyboard shortcut sheet ──
// ── [PCODE-100 | S15 | v0.1.0] Add filters, search and the keyboard command bar ──
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { ItemJson } from '../../src/api/items.js';
import { matchingSettings, searchQuery } from '../../src/api/search.js';
import { inSystem } from '../../src/db/pool.js'; // [PCODE-346 | S15 | v0.1.0]
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe('search query', () => {
  it('turns typed words into required prefixes and drops operators', () => {
    expect(searchQuery('Pass reset')).toBe('pass:* & reset:*');
    expect(searchQuery("x' | !y & (z)")).toBe('x:* & y:* & z:*');
    expect(searchQuery('Übergabe Prüfung')).toBe('übergabe:* & prüfung:*');
    expect(searchQuery('  ---  ')).toBeNull();
  });
  // [PCODE-346 | S15 | v0.1.0]
  it('finds settings by their name or key', () => {
    expect(matchingSettings('sprint').map((x) => x.key)).toContain('planning.sprint_weeks');
    expect(matchingSettings('LANGUAGE')).toEqual([{ key: 'locale.language', label: 'Language' }]);
    expect(matchingSettings('  ')).toEqual([]);
  });
});

describe.skipIf(!hasDatabase)('search and filters (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let gus: Person;
  let ws = '';
  let app = { id: '', states: [] as { id: string; name: string }[] };
  let ops = { id: '' };
  const W = (p: string): string => '/api/workspaces/' + ws + p;
  const titles = (items: ItemJson[]): string[] => items.map((i) => i.title).sort();

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    gus = await t.signup('Gus');
    ws = ada.workspaceId;
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    app = (await t.call<typeof app>(ada, 'POST', W('/projects'), { key: 'APP', name: 'The App' }))
      .body;
    ops = (
      await t.call<typeof ops>(ada, 'POST', W('/projects'), { key: 'OPS', name: 'Operations' })
    ).body;
    await t.call(ada, 'POST', W('/projects/' + app.id + '/guests'), { userId: gus.id });
    const label = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + app.id + '/labels'), {
        name: 'security',
        color: '#ef4444',
      })
    ).body;
    await t.call(ada, 'POST', W('/projects/' + app.id + '/items'), {
      title: 'Password reset by email',
      labelIds: [label.id],
      assigneeId: ada.id,
    });
    await t.call(ada, 'POST', W('/projects/' + app.id + '/items'), {
      title: 'Übergabe an den Kunden',
      description: 'Prüfung der Dokumentation',
    });
    await t.call(ada, 'POST', W('/projects/' + app.id + '/items'), { title: 'Sign-in page' });
    await t.call(ada, 'POST', W('/projects/' + ops.id + '/items'), {
      title: 'Password rotation for servers',
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('finds items by word prefixes, in titles and descriptions, in German too', async () => {
    const r = await t.call<{ items: { ref: string }[] }>(ada, 'GET', W('/search?q=pass'));
    expect(r.body.items.map((i) => i.ref).sort()).toEqual(['APP-1', 'OPS-1']);
    const de = await t.call<{ items: { ref: string }[] }>(
      ada,
      'GET',
      W('/search?q=' + encodeURIComponent('prüf')),
    );
    expect(de.body.items.map((i) => i.ref)).toEqual(['APP-2']);
  });

  it('finds an item by its reference, in any case, and projects by key or name', async () => {
    const r = await t.call<{ items: { ref: string; title: string }[] }>(
      ada,
      'GET',
      W('/search?q=app-3'),
    );
    expect(r.body.items).toEqual([
      expect.objectContaining({ ref: 'APP-3', title: 'Sign-in page' }),
    ]);
    const p = await t.call<{ projects: { key: string }[] }>(ada, 'GET', W('/search?q=oper'));
    expect(p.body.projects.map((x) => x.key)).toEqual(['OPS']);
  });

  it('shows a guest only hits from their projects', async () => {
    const r = await t.call<{ items: { ref: string }[]; projects: { key: string }[] }>(
      gus,
      'GET',
      W('/search?q=pass'),
    );
    expect(r.body.items.map((i) => i.ref)).toEqual(['APP-1']);
    expect(
      (await t.call<{ items: unknown[] }>(gus, 'GET', W('/search?q=OPS-1'))).body.items,
    ).toEqual([]);
  });

  it('filters a project’s items by text, assignee, label and sprint', async () => {
    const list = (q: string): Promise<ItemJson[]> =>
      t.call<ItemJson[]>(ada, 'GET', W('/projects/' + app.id + '/items?' + q)).then((r) => r.body);
    expect(titles(await list('q=email'))).toEqual(['Password reset by email']);
    expect(titles(await list('assigneeId=me'))).toEqual(['Password reset by email']);
    expect(titles(await list('assigneeId=none'))).toHaveLength(2);
    const labels = (
      await t.call<{ id: string }[]>(ada, 'GET', W('/projects/' + app.id + '/labels'))
    ).body;
    expect(titles(await list('labelId=' + (labels[0]?.id ?? '')))).toEqual([
      'Password reset by email',
    ]);
    expect(await list('sprintId=backlog')).toHaveLength(3);
    expect(
      (await t.call(ada, 'GET', W('/projects/' + app.id + '/items?assigneeId=someone'))).status,
    ).toBe(400);
  });

  it('saves filters per person', async () => {
    const saved = await t.call<{ id: string }>(ada, 'POST', W('/projects/' + app.id + '/filters'), {
      name: 'Mine',
      query: { assigneeId: 'me' },
    });
    expect(saved.status).toBe(201);
    expect(
      (
        await t.call<{ name: string }[]>(ada, 'GET', W('/projects/' + app.id + '/filters'))
      ).body.map((f) => f.name),
    ).toEqual(['Mine']);
    expect(
      (await t.call<unknown[]>(gus, 'GET', W('/projects/' + app.id + '/filters'))).body,
    ).toEqual([]);
    expect((await t.call(gus, 'DELETE', W('/filters/' + saved.body.id))).status).toBe(404);
    expect((await t.call(ada, 'DELETE', W('/filters/' + saved.body.id))).status).toBe(200);
  });
  // [PCODE-346 | S15 | v0.1.0] agents, runs, people and settings for the team; none for a guest
  it('finds agents, runs, people and settings for the team only', async () => {
    type Hits = {
      agents: { name: string }[];
      runs: { instruction: string; agent: string }[];
      people: { name: string }[];
      settings: { key: string }[];
    };
    await t.call(ada, 'GET', W('/agents'));
    await inSystem(t.db.pool, (c) =>
      c.query(
        `INSERT INTO agent_runs (workspace_id, project_id, agent_id, instruction, status, model)
         SELECT $1, $2, id, 'Summarise the password policy', 'succeeded', 'demo' FROM agents WHERE workspace_id = $1 AND key = 'analyst'`,
        [ws, app.id],
      ),
    );
    const q = (who: Person, text: string) =>
      t.call<Hits>(who, 'GET', W('/search?q=' + encodeURIComponent(text)));
    expect((await q(ada, 'analyst')).body.agents.map((x) => x.name)).toEqual(['Analyst agent']);
    const runs = (await q(ada, 'password policy')).body.runs;
    expect(runs).toEqual([
      expect.objectContaining({
        instruction: 'Summarise the password policy',
        agent: 'Analyst agent',
      }),
    ]);
    expect((await q(ada, 'gus')).body.people.map((x) => x.name)).toEqual(['Gus']);
    expect((await q(ada, 'working days')).body.settings.map((x) => x.key)).toEqual([
      'calendar.working_days',
    ]);
    const guest = (await q(gus, 'analyst')).body;
    expect([guest.agents, guest.runs, guest.people, guest.settings]).toEqual([[], [], [], []]);
  });
});
