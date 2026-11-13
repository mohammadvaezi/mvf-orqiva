// ── [PCODE-306 | S15 | v0.1.0] T31.6 Versions from commits: conventional commits, tags and components per path ──
//    Why:  pushes and tags arriving by webhook give the version plan: the whole repository goes from its last
//          tag by its strongest change; components get their own versions from the commits in their folder;
//          a planned release takes the version and the changelog, and components may share a number.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sign } from '../../src/git/webhook.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const sha = (c: string): string => c.repeat(40);

interface Plan {
  componentId: string | null;
  name: string;
  lastTag: string | null;
  lastVersion: string | null;
  commits: number;
  nonConventional: number;
  bump: string;
  next: string | null;
  reason: string;
  changelog: string;
  planned: boolean;
}

describe.skipIf(!hasDatabase)('versions from commits (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let project = '';
  const conn = { id: '', path: '', secret: '' };
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const repository = { full_name: 'acme/shop', default_branch: 'main' };
  const github = async (event: string, payload: Record<string, unknown>) => {
    const body = Buffer.from(JSON.stringify({ repository, ...payload }));
    const res = await fetch(t.base + conn.path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': event,
        'x-hub-signature-256': 'sha256=' + sign(conn.secret, body),
      },
      body,
    });
    expect(res.status).toBe(200);
  };
  let minute = 0;
  const push = (ref: string, commits: { id: string; message: string; files?: string[] }[]) =>
    github('push', {
      ref,
      after: commits.at(-1)?.id,
      commits: commits.map((c) => ({
        id: c.id,
        message: c.message,
        url: 'https://github.com/acme/shop/commit/' + c.id,
        timestamp: new Date(Date.UTC(2026, 9, 12, 10, minute++)).toISOString(),
        author: { name: 'Ada', username: 'ada' },
        added: [],
        modified: c.files ?? [],
        removed: [],
      })),
    });
  const tag = (name: string, at: string) =>
    github('push', { ref: 'refs/tags/' + name, after: at, commits: [] });
  const plan = async (): Promise<Plan[]> =>
    (await t.call<Plan[]>(ada, 'GET', W('/projects/' + project + '/version-plan'))).body;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    const r = await t.call<{ connection: { id: string; webhookPath: string }; secret: string }>(
      ada,
      'POST',
      W('/projects/' + project + '/git'),
      { provider: 'github', repo: 'acme/shop' },
    );
    Object.assign(conn, {
      id: r.body.connection.id,
      path: r.body.connection.webhookPath,
      secret: r.body.secret,
    });
    await push('refs/heads/main', [
      { id: sha('a'), message: 'chore: start', files: ['README.md'] },
    ]);
    await tag('v1.2.0', sha('a'));
    await tag('web-v0.3.1', sha('a'));
    await tag('nightly', sha('a'));
    await push('refs/heads/main', [
      {
        id: sha('1'),
        message: 'feat(cart): keep items between visits',
        files: ['server/src/cart.ts'],
      },
      { id: sha('2'), message: 'fix: totals round to cents', files: ['web/src/total.ts'] },
      { id: sha('3'), message: 'docs: how to run it', files: ['README.md'] },
      { id: sha('4'), message: 'Tidy the header', files: ['web/src/header.ts'] },
      {
        id: sha('5'),
        message:
          'refactor(api): one way to page\n\nBREAKING CHANGE: the v1 list endpoints are gone',
        files: ['server/src/api.ts'],
      },
    ]);
    // work on a branch is not in the next version
    await push('refs/heads/feature/x', [
      { id: sha('6'), message: 'feat: not merged yet', files: ['web/src/x.ts'] },
    ]);
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('plans the repository from its last tag by its strongest change', async () => {
    const [p] = await plan();
    expect(p).toMatchObject({
      componentId: null,
      lastTag: 'v1.2.0',
      lastVersion: '1.2.0',
      commits: 5,
      nonConventional: 1,
      bump: 'major',
      next: '2.0.0',
      reason: '1 breaking change',
      planned: false,
    });
    expect(p?.changelog).toBe(
      [
        '### Breaking changes',
        '',
        '- **api:** one way to page (5555555)',
        '',
        '### Features',
        '',
        '- **cart:** keep items between visits (1111111)',
        '',
        '### Fixes',
        '',
        '- totals round to cents (2222222)',
        '',
        '### Other changes',
        '',
        '- Tidy the header (4444444)',
      ].join('\n'),
    );
  });

  it('versions each component from the commits in its folder', async () => {
    expect(
      (
        await t.call(bob, 'POST', W('/projects/' + project + '/version-components'), {
          connectionId: conn.id,
          name: 'web',
          folder: 'web',
          tagPrefix: 'web-v',
        })
      ).status,
    ).toBe(403);
    for (const [name, prefix] of [
      ['web', 'web-v'],
      ['server', 'server-v'],
    ] as const)
      expect(
        (
          await t.call(ada, 'POST', W('/projects/' + project + '/version-components'), {
            connectionId: conn.id,
            name,
            folder: '/' + name + '/',
            tagPrefix: prefix,
          })
        ).status,
      ).toBe(201);
    const ps = await plan();
    expect(ps.map((p) => [p.name, p.lastVersion, p.commits, p.bump, p.next, p.reason])).toEqual([
      ['server', null, 2, 'major', '1.0.0', '1 breaking change'],
      [
        'web',
        '0.3.1',
        2,
        'patch',
        '0.3.2',
        '1 fix, 1 message not in the conventional form (counted as fixes)',
      ],
    ]);
  });

  it('plans the release with the version and the changelog', async () => {
    const web = (await plan()).find((p) => p.name === 'web');
    const body = { connectionId: conn.id, componentId: web?.componentId };
    const r = await t.call<{ id: string; version: string; component: string }>(
      bob,
      'POST',
      W('/projects/' + project + '/version-plan/release'),
      body,
    );
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ version: '0.3.2', component: 'web' });
    const release = await t.call<{
      release: { name: string; component: string; notesTeam: string };
    }>(ada, 'GET', W('/releases/' + r.body.id));
    expect(release.body.release).toMatchObject({ name: 'web 0.3.2', component: 'web' });
    expect(release.body.release.notesTeam).toContain('- totals round to cents (2222222)');
    expect(
      (await t.call(bob, 'POST', W('/projects/' + project + '/version-plan/release'), body)).status,
    ).toBe(409);
    expect((await plan()).find((p) => p.name === 'web')?.planned).toBe(true);

    // the project's own line and a component may share a number
    const server = (await plan()).find((p) => p.name === 'server');
    await t.call(ada, 'POST', W('/projects/' + project + '/version-plan/release'), {
      connectionId: conn.id,
      componentId: server?.componentId,
    });
    expect(
      (await t.call(ada, 'POST', W('/projects/' + project + '/releases'), { version: '1.0.0' }))
        .status,
    ).toBe(201);
  });
});
