// ── [PCODE-282 | S15 | v0.1.0] T29.4 Live co-editing of documents with our own three-way merge ──
//    Why:  two people in one live draft: edits sent from the same revision merge, the same words changed
//          differently are kept twice and counted, a save outside the draft joins it, saving makes one
//          version for both and closes the draft; who is editing is shown.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

interface Live {
  rev: number;
  title: string;
  body: string;
  baseVersion: number;
  conflicts: number;
  editors: { name: string }[];
}

describe.skipIf(!hasDatabase)('live co-editing (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bo: Person;
  let page = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const D = (p = ''): string => W('/docs/' + page + p);
  const body = ['# Release', '', 'We ship on Monday.', '', 'Tests run nightly.', ''].join('\n');

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bo = await t.signup('Bo');
    await t.call(ada, 'POST', W('/members'), { email: bo.email, role: 'member' });
    const project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'LIV', name: 'Live' })
    ).body.id;
    const r = await t.call<{ page: { id: string } }>(
      ada,
      'POST',
      W('/projects/' + project + '/docs'),
      {
        title: 'Release',
        body,
      },
    );
    page = r.body.page.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('merges what two editors send from the same revision, and keeps both where they collide', async () => {
    const a = await t.call<Live>(ada, 'POST', D('/live'));
    const b = await t.call<Live>(bo, 'POST', D('/live'));
    expect(a.body).toMatchObject({ rev: 1, body, baseVersion: 1 });
    expect(b.body.editors.map((e) => e.name).sort()).toEqual([ada.name, bo.name].sort());

    // both edit from revision 1, different lines
    const s1 = await t.call<Live>(ada, 'POST', D('/live/sync'), {
      rev: 1,
      title: 'Release',
      body: body.replace('Monday', 'Tuesday'),
    });
    expect(s1.body.rev).toBe(2);
    const s2 = await t.call<Live>(bo, 'POST', D('/live/sync'), {
      rev: 1,
      title: 'Release',
      body: body.replace('nightly', 'hourly'),
    });
    expect(s2.body).toMatchObject({ rev: 3, conflicts: 0 });
    expect(s2.body.body).toBe(body.replace('Monday', 'Tuesday').replace('nightly', 'hourly'));

    // the same words, changed differently from revision 3
    const merged = s2.body.body;
    await t.call(ada, 'POST', D('/live/sync'), {
      rev: 3,
      title: 'Release',
      body: merged.replace('Tuesday', 'Friday'),
    });
    const clash = await t.call<Live>(bo, 'POST', D('/live/sync'), {
      rev: 3,
      title: 'Release',
      body: merged.replace('Tuesday', 'Thursday'),
    });
    expect(clash.body.conflicts).toBe(1);
    expect(clash.body.body).toContain('We ship on Friday.\nWe ship on Thursday.');

    // nothing changed: the answer is the current draft, no new revision
    const idle = await t.call<Live>(ada, 'POST', D('/live/sync'), {
      rev: clash.body.rev,
      title: 'Release',
      body: clash.body.body,
    });
    expect(idle.body.rev).toBe(clash.body.rev);
    expect(
      (await t.call(ada, 'POST', D('/live/sync'), { rev: 99, title: 'x', body: 'x' })).status,
    ).toBe(409);
  });

  it('takes in a save made outside the draft, then saves one version for everyone', async () => {
    // an agent or the API saves the page meanwhile
    const outside = await t.call(ada, 'PUT', D(''), {
      body: body + '\nAdded outside.\n',
      baseVersion: 1,
    });
    expect(outside.status).toBe(200);
    const again = await t.call<Live>(bo, 'POST', D('/live'));
    expect(again.body.baseVersion).toBe(2);
    expect(again.body.body).toContain('Added outside.');
    expect(again.body.body).toContain('We ship on Friday.');

    const saved = await t.call<{ version: number }>(bo, 'POST', D('/live/save'), {
      rev: again.body.rev,
      title: 'Release notes',
      body: again.body.body.replace(
        'We ship on Friday.\nWe ship on Thursday.',
        'We ship on Friday.',
      ),
    });
    expect(saved.body.version).toBe(3);
    const pageNow = await t.call<{ page: { title: string; version: number }; body: string }>(
      ada,
      'GET',
      D(''),
    );
    expect(pageNow.body.page).toMatchObject({ title: 'Release notes', version: 3 });
    expect(pageNow.body.body).toContain('hourly');
    expect(pageNow.body.body).not.toContain('Thursday');
    // the draft is closed for the other editor
    const late = await t.call<{ error: { message: string } }>(ada, 'POST', D('/live/sync'), {
      rev: 1,
      title: 'x',
      body: 'x',
    });
    expect(late.body.error.message).toContain('saved or closed');
  });

  it('closes an unchanged draft when the last editor leaves', async () => {
    await t.call(ada, 'POST', D('/live'));
    const left = await t.call<{ open: boolean }>(ada, 'DELETE', D('/live'));
    expect(left.body.open).toBe(false);
  });
});
