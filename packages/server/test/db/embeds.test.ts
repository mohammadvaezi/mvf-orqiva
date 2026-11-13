// ── [PCODE-281 | S15 | v0.1.0] T29.3 Document embeds: live task lists, designs, Gantt, repo code; README import ──
//    Why:  the scan is told which files pages need, keeps their text and drops the rest on a full scan;
//          code lines come back numbered; a task query is answered with state, kind and person; the plan
//          comes back as bars; README files become pages of the "Built from the code" folder.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { embedsIn, readEmbed, readTaskQuery } from '@orqiva/shared';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe('embeds', () => {
  it('reads embeds and task queries', () => {
    expect(
      readTaskQuery('state:open kind:bug assignee:me label:"needs review" export limit:5'),
    ).toEqual({
      state: 'open',
      kind: 'bug',
      assignee: 'me',
      label: 'needs review',
      sprint: null,
      q: 'export',
      limit: 5,
    });
    expect(readEmbed('code: ./src/a.ts#L10-L4')).toEqual({
      kind: 'code',
      path: 'src/a.ts',
      from: 10,
      to: 10,
    });
    expect(readEmbed('code: src/a.ts')).toEqual({
      kind: 'code',
      path: 'src/a.ts',
      from: null,
      to: null,
    });
    expect(readEmbed('gantt')).toEqual({ kind: 'gantt', sprint: '' });
    expect(() => readEmbed('video: x')).toThrow('video is not something a page embeds');
    expect(embedsIn('x\n```embed\ndesign: Checkout\n```\n```embed\nnope\n```')).toEqual([
      { kind: 'design', ref: 'Checkout' },
    ]);
  });
});

describe.skipIf(!hasDatabase)('embeds on the server (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'EMB', name: 'Embeds' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('tells the scan which files pages need, and keeps their text', async () => {
    await t.call(ada, 'POST', P('/docs'), {
      title: 'Orders',
      body: 'See:\n\n```embed\ncode: src/orders.ts#L2-L3\n```\n',
    });
    const w = await t.call<{ paths: string[] }>(ada, 'GET', P('/code-texts/wanted'));
    expect(w.body.paths).toEqual(['src/orders.ts']);
    const put = await t.call<{ stored: number }>(ada, 'PUT', P('/code-texts'), {
      texts: [
        { path: 'src/orders.ts', text: 'line 1\nline 2\nline 3\nline 4\n' },
        { path: 'README.md', text: '# Embeds app\n\nHow to run it.' },
        { path: 'old.ts', text: 'x' },
      ],
    });
    expect(put.body.stored).toBe(3);
    const lines = await t.call<{ from: number; lines: string[]; total: number }>(
      ada,
      'GET',
      P('/code-text?path=src/orders.ts&from=2&to=3'),
    );
    expect(lines.body).toMatchObject({ from: 2, lines: ['line 2', 'line 3'], total: 5 });
    // a full scan drops what it did not send
    const full = await t.call<{ removed: number }>(ada, 'PUT', P('/code-texts'), {
      texts: [
        { path: 'src/orders.ts', text: 'line 1\nline 2\nline 3\nline 4\n' },
        { path: 'README.md', text: '# Embeds app\n\nHow to run it.' },
      ],
      full: true,
    });
    expect(full.body.removed).toBe(1);
    const gone = await t.call<{ error: { message: string } }>(
      ada,
      'GET',
      P('/code-text?path=old.ts'),
    );
    expect(gone.status).toBe(404);
    expect(gone.body.error.message).toContain('run orq docs scan');
  });

  it('turns README files into pages of the code folder', async () => {
    const r = await t.call<{ created: number }>(ada, 'POST', P('/docs/from-code'));
    expect(r.status).toBe(200);
    const tree = await t.call<{ title: string; generatedFrom: string }[]>(ada, 'GET', P('/docs'));
    expect(tree.body.find((n) => n.title === 'README')).toMatchObject({
      generatedFrom: 'README.md',
    });
  });

  it('answers a task query with state, kind and person, and the plan as bars', async () => {
    const make = async (title: string, kind: string, mine: boolean) =>
      (
        await t.call<{ id: string }>(ada, 'POST', P('/items'), {
          title,
          kind,
          ...(mine ? { assigneeId: ada.id } : {}),
          durationDays: 2,
        })
      ).body.id;
    await make('Fix the export', 'bug', true);
    await make('Write the guide', 'task', false);
    await make('Fix the login', 'bug', false);
    const q = await t.call<{
      total: number;
      tasks: { ref: string; kind: string; assignee: string | null; stateGroup: string }[];
    }>(ada, 'GET', P('/embed/tasks?query=' + encodeURIComponent('kind:bug state:open')));
    expect(q.body.total).toBe(2);
    expect(q.body.tasks.map((x) => x.kind)).toEqual(['bug', 'bug']);
    const mine = await t.call<{ tasks: { title: string; assignee: string | null }[] }>(
      ada,
      'GET',
      P('/embed/tasks?query=' + encodeURIComponent('assignee:me')),
    );
    expect(mine.body.tasks).toEqual([
      expect.objectContaining({ title: 'Fix the export', assignee: ada.name }),
    ]);
    const plan = await t.call<{
      bars: { title: string; start: string; finish: string }[];
      start: string | null;
    }>(ada, 'GET', P('/embed/plan'));
    expect(plan.body.bars).toHaveLength(3);
    expect(plan.body.start).toBeTruthy();
    expect((await t.call(ada, 'GET', P('/embed/plan?sprint=current'))).status).toBe(404);
  });
});
