// ── [PCODE-284 | S15 | v0.1.0] T29.6 Documents: tree drag and drop, files, image annotation, read analytics, per-task knowledge, checked citations ──
//    Why:  files attached to a page show in the tree; opening a page counts as a read of its version and
//          watchers who have not read the latest are named; a page opened to a task is readable by that
//          task's agents and no others; a citation is checked against the page.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { citedOn, readablePages } from '../../src/api/documents.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe('citations', () => {
  it('finds a cited passage on the page, spaces and case aside', () => {
    expect(citedOn('Roll back\nwithin ten   minutes.', 'roll back within TEN minutes')).toBe(true);
    expect(citedOn('Roll back within ten minutes.', 'within five minutes')).toBe(false);
    expect(citedOn('x', '   ')).toBe(false);
  });
});

describe.skipIf(!hasDatabase)('page files, readers and task knowledge (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bo: Person;
  let project = '';
  let page = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bo = await t.signup('Bo');
    await t.call(ada, 'POST', W('/members'), { email: bo.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'EXT', name: 'Extras' })
    ).body.id;
    page = (
      await t.call<{ page: { id: string } }>(ada, 'POST', W('/projects/' + project + '/docs'), {
        title: 'Runbook',
        body: 'Restart the API.',
      })
    ).body.page.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('attaches files to a page and shows them in the tree', async () => {
    const up = await fetch(t.base + W('/files?name=diagram.png&projectId=' + project), {
      method: 'POST',
      headers: { cookie: ada.cookie, 'content-type': 'image/png' },
      body: Buffer.from('png bytes'),
    });
    const file = (await up.json()) as { id: string };
    const r = await t.call<{ name: string }[]>(ada, 'POST', W('/docs/' + page + '/files'), {
      fileId: file.id,
    });
    expect(r.status).toBe(201);
    expect(r.body.map((f) => f.name)).toEqual(['diagram.png']);
    const tree = await t.call<{ id: string; files: { name: string }[] }[]>(
      ada,
      'GET',
      W('/projects/' + project + '/docs'),
    );
    expect(tree.body.find((n) => n.id === page)?.files.map((f) => f.name)).toEqual(['diagram.png']);
    const gone = await t.call<unknown[]>(ada, 'DELETE', W('/docs/' + page + '/files/' + file.id));
    expect(gone.body).toEqual([]);
  });

  it('counts who read which version, and names watchers behind', async () => {
    await t.call(bo, 'POST', W('/docs/' + page + '/watch'));
    await t.call(bo, 'GET', W('/docs/' + page));
    await t.call(ada, 'PUT', W('/docs/' + page), {
      body: 'Restart the API, then check health.',
      baseVersion: 1,
    });
    await t.call(ada, 'GET', W('/docs/' + page));
    await t.call(ada, 'GET', W('/docs/' + page));
    const r = await t.call<{
      version: number;
      readers: { name: string; version: number; reads: number; latest: boolean }[];
      unreadWatchers: { name: string }[];
    }>(ada, 'GET', W('/docs/' + page + '/readers'));
    expect(r.body.version).toBe(2);
    expect(r.body.readers.map((x) => [x.name, x.version, x.reads, x.latest])).toEqual([
      [ada.name, 2, 2, true],
      [bo.name, 1, 1, false],
    ]);
    expect(r.body.unreadWatchers.map((x) => x.name)).toEqual([bo.name]);
  });

  it('opens a page to one task’s agents', async () => {
    const item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Fix restarts',
      })
    ).body.id;
    const other = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Other',
      })
    ).body.id;
    const add = await t.call<{ ref: string }[]>(ada, 'POST', W('/docs/' + page + '/tasks'), {
      ref: 'ext-1',
    });
    expect(add.body.map((x) => x.ref)).toEqual(['EXT-1']);
    expect(
      (await t.call(ada, 'POST', W('/docs/' + page + '/tasks'), { ref: 'NOPE-9' })).status,
    ).toBe(400);
    const readable = (itemId: string | null) =>
      inSystem(t.db.pool, async (c) =>
        (await readablePages(c, project, 'coder', itemId)).map((p) => p.id),
      );
    expect(await readable(item)).toEqual([page]);
    expect(await readable(other)).toEqual([]);
    expect(await readable(null)).toEqual([]);
  });
});
