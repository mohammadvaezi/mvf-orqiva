// ── [PCODE-283 | S15 | v0.1.0] T29.5 Documents: named versions in the screen, visual diff, mentions in comments, page search and Cmd-K ──
//    Why:  pages turn up in the global search for the team (not for guests), a comment naming someone puts
//          it in their inbox with a link to the page, and a version's own text is there for the diff.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('documents: search, mentions, versions (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bo: Person;
  let gus: Person;
  let project = '';
  let page = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bo = await t.signup('Bo');
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: bo.email, role: 'member' });
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'DOC', name: 'Docs' })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + project + '/guests'), { userId: gus.id });
    page = (
      await t.call<{ page: { id: string } }>(ada, 'POST', W('/projects/' + project + '/docs'), {
        title: 'Rollback runbook',
        body: 'How to roll back a failed deployment within ten minutes.',
      })
    ).body.page.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('finds pages in the global search for the team, not for guests', async () => {
    const r = await t.call<{
      docs: { id: string; title: string; projectKey: string; snippet: string }[];
    }>(bo, 'GET', W('/search?q=rollback'));
    expect(r.body.docs).toEqual([
      expect.objectContaining({ id: page, title: 'Rollback runbook', projectKey: 'DOC' }),
    ]);
    const g = await t.call<{ docs: unknown[] }>(gus, 'GET', W('/search?q=rollback'));
    expect(g.body.docs).toEqual([]);
  });

  it('tells the person a comment names, with a link to the page', async () => {
    const c = await t.call(ada, 'POST', W('/docs/' + page + '/comments'), {
      body: 'Could @' + (bo.email.split('@')[0] ?? '') + ' check step 3?',
    });
    expect(c.status).toBe(201);
    let items: { title: string; url: string }[] = [];
    for (let i = 0; i < 20 && !items.length; i++) {
      await new Promise((r) => setTimeout(r, 100));
      items = (await t.call<{ items: { title: string; url: string }[] }>(bo, 'GET', W('/inbox')))
        .body.items;
    }
    expect(items[0]).toMatchObject({
      title: ada.name + ' mentioned you on Rollback runbook',
      url: '/projects/' + project + '/documents?page=' + page,
    });
    // naming oneself tells nobody
    await t.call(ada, 'POST', W('/docs/' + page + '/comments'), {
      body: 'Note to @' + (ada.email.split('@')[0] ?? ''),
    });
    await new Promise((r) => setTimeout(r, 300));
    expect((await t.call<{ items: unknown[] }>(ada, 'GET', W('/inbox'))).body.items).toHaveLength(
      0,
    );
  });

  it('gives a version’s own text and name', async () => {
    await t.call(ada, 'PUT', W('/docs/' + page), { body: 'Version two.', baseVersion: 1 });
    await t.call(ada, 'PATCH', W('/docs/' + page + '/versions/1'), { name: 'Sent to ops' });
    const v1 = await t.call<{ version: number; name: string; body: string }>(
      ada,
      'GET',
      W('/docs/' + page + '/versions/1'),
    );
    expect(v1.body).toMatchObject({
      version: 1,
      name: 'Sent to ops',
      body: 'How to roll back a failed deployment within ten minutes.',
    });
    expect((await t.call(ada, 'GET', W('/docs/' + page + '/versions/9'))).status).toBe(404);
  });
});
