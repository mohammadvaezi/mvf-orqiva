// ── [PCODE-197 | S15 | v0.1.0] T16.1 Docs from code: API reference, system overview and built-by-task pages, drift warnings ──
//    Why:  documentation built from the code through the API against PostgreSQL: a rebuild makes the
//          folder and its pages once, adds a version only when the text changed, drops a page whose source
//          is gone and refuses hand edits; hand-written pages naming changed or vanished files show drift.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('docs from code (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  type Node = {
    id: string;
    title: string;
    kind: string;
    parentId: string | null;
    generatedFrom: string;
    version: number;
  };
  const tree = async () => (await t.call<Node[]>(mo, 'GET', P('/docs'))).body;
  const openapi = (extra: Record<string, unknown> = {}) => ({
    openapi: '3.0.0',
    paths: {
      '/tours': { get: { summary: 'List tours', tags: ['Tours'] }, ...extra },
      '/health': { get: { summary: 'Alive', tags: ['Ops'], security: [] } },
    },
  });

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    await t.call(ada, 'POST', W('/members'), { email: mo.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'DOC', name: 'Docs' })
    ).body.id;
    const item = (await t.call<{ id: string }>(mo, 'POST', P('/items'), { title: 'Tour list' }))
      .body.id;
    await t.call(mo, 'POST', P('/code-scan'), {
      files: [
        {
          path: 'src/api/tours.ts',
          lines: 300,
          complexity: 40,
          churn: 9,
          authors: { mo: 300 },
          lastCommitAt: '2026-10-01T10:00:00Z',
        },
        {
          path: 'src/live/socket.ts',
          lines: 120,
          complexity: 10,
          churn: 2,
          authors: { ada: 120 },
          lastCommitAt: '2026-10-01T10:00:00Z',
        },
      ],
      full: true,
    });
    await t.call(mo, 'POST', P('/api-endpoints/import'), { openapi: openapi() });
    await inSystem(t.db.pool, async (c) => {
      await c.query(
        `INSERT INTO item_fingerprints (workspace_id, project_id, item_id, path, line, kind, sprint_code, version)
         VALUES ($1, $2, $3, 'src/api/tours.ts', 1, 'header', 'S01', '0.1.0'), ($1, $2, $3, 'src/api/tours.ts', 40, 'block', 'S01', '0.1.0')`,
        [ada.workspaceId, project, item],
      );
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('builds the folder and its pages, then rebuilds in place', async () => {
    const first = await t.call(mo, 'POST', P('/docs/from-code'));
    expect(first.body).toEqual({ created: 4, updated: 0, unchanged: 0, removed: 0 });
    const nodes = await tree();
    const folder = nodes.find((n) => n.kind === 'folder' && n.title === 'Built from the code');
    expect(folder).toBeDefined();
    expect(
      nodes.filter((n) => n.parentId === folder?.id).map((n) => [n.title, n.generatedFrom]),
    ).toEqual([
      ['System overview (from code)', 'code scan (2 files)'],
      ['Ops API (from code)', 'OpenAPI (1 entry)'],
      ['Tours API (from code)', 'OpenAPI (1 entry)'],
      ['Built by task (from code)', 'fingerprints (1 tasks)'],
    ]);
    const byTask = nodes.find((n) => n.title.startsWith('Built by task'));
    const page = await t.call<{ body: string }>(mo, 'GET', W('/docs/' + (byTask?.id ?? '')));
    expect(page.body.body).toContain('- `src/api/tours.ts` lines 1, 40');

    expect((await t.call(mo, 'POST', P('/docs/from-code'))).body).toEqual({
      created: 0,
      updated: 0,
      unchanged: 4,
      removed: 0,
    });
    // the Ops tag goes, Tours gets a second endpoint
    await t.call(mo, 'POST', P('/api-endpoints/import'), {
      openapi: {
        paths: {
          '/tours': {
            get: { summary: 'List tours', tags: ['Tours'] },
            post: { summary: 'Plan a tour', tags: ['Tours'] },
          },
        },
      },
    });
    expect((await t.call(mo, 'POST', P('/docs/from-code'))).body).toEqual({
      created: 0,
      updated: 1,
      unchanged: 2,
      removed: 1,
    });
    expect((await tree()).some((n) => n.title === 'Ops API (from code)')).toBe(false);
    const tours = (await tree()).find((n) => n.title === 'Tours API (from code)');
    expect(tours?.version).toBe(2);
  });

  it('refuses hand edits on a page built from the code', async () => {
    const tours = (await tree()).find((n) => n.title === 'Tours API (from code)');
    const r = await t.call<{ error: { message: string } }>(
      mo,
      'PUT',
      W('/docs/' + (tours?.id ?? '')),
      { body: 'mine', baseVersion: tours?.version ?? 0 },
    );
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('built from the code');
    expect(
      (await t.call(mo, 'POST', W('/docs/' + (tours?.id ?? '') + '/versions/1/restore'))).status,
    ).toBe(409);
  });

  it('flags hand-written pages that disagree with the code', async () => {
    const adr = (
      await t.call<{ page: { id: string } }>(mo, 'POST', P('/docs'), {
        title: 'ADR-007 Reconnects',
        body: 'We back off exponentially in `src/live/socket.ts:88`; the old poller in src/live/poll.ts is gone.',
      })
    ).body.page.id;
    await t.call(mo, 'POST', P('/docs'), { title: 'Fine', body: 'Nothing about code here.' });
    expect((await t.call<unknown[]>(mo, 'GET', P('/docs/drift'))).body).toEqual([
      {
        pageId: adr,
        title: 'ADR-007 Reconnects',
        ownerName: 'Mo',
        refs: [{ path: 'src/live/poll.ts', line: null, state: 'gone', changedAt: null }],
      },
    ]);
    // the socket changes after the page was written
    await t.call(mo, 'POST', P('/code-scan'), {
      files: [
        {
          path: 'src/live/socket.ts',
          lines: 130,
          lastCommitAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    });
    const drift = await t.call<{ refs: { path: string; line: number | null; state: string }[] }[]>(
      mo,
      'GET',
      P('/docs/drift'),
    );
    expect(drift.body[0]?.refs.map((r) => [r.path, r.line, r.state])).toEqual([
      ['src/live/socket.ts', 88, 'changed'],
      ['src/live/poll.ts', null, 'gone'],
    ]);
  });
});
