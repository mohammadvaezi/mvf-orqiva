// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-108 | S15 | v0.1.0] Integrate Git hosts: GitHub and Gitea webhooks, commits and PRs on items, live ──
//    Why:  deliveries as GitHub and Gitea send them (headers, signatures, payload shapes), against the real
//          server and database, with a board subscribed to the live stream: a commit or PR naming a task
//          must reach the item and the board within the delivery itself.
import type { ActivityEvent, ServerMessage } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changesOf, sign, taskNumbers } from '../../src/git/webhook.js';
import { RawWsClient } from '../wsclient.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe('reading deliveries', () => {
  it('finds the task numbers of the project key in messages and branches', () => {
    expect(
      taskNumbers('APP', 'APP-12 Fix export, also app-13; not XAPP-14 or APP-15x2 or MYAPP-1'),
    ).toEqual([12, 13]);
    expect(taskNumbers('APP', 'feature/app-7-reprice')).toEqual([7]);
    expect(taskNumbers('APP', 'APP-123456789012')).toEqual([]);
  });

  it('reads pushes and pull requests the same way from both hosts', () => {
    const push = changesOf('push', {
      ref: 'refs/heads/feature/x',
      commits: [
        {
          id: 'a'.repeat(40),
          message: 'APP-1 first line\n\nbody',
          url: 'https://h/c',
          author: { name: 'Ada', username: 'ada' },
          timestamp: '2026-12-14T10:00:00Z',
        },
      ],
    });
    expect(push).toEqual([
      expect.objectContaining({
        kind: 'commit',
        ref: 'a'.repeat(40),
        title: 'APP-1 first line',
        author: 'ada',
        state: 'feature/x',
      }),
    ]);
    const pr = changesOf('pull_request', {
      action: 'closed',
      pull_request: {
        number: 9,
        title: 'APP-2 thing',
        html_url: 'https://h/pr/9',
        state: 'closed',
        merged: true,
        head: { ref: 'app-2' },
        user: { login: 'bob' },
      },
    });
    expect(pr[0]).toMatchObject({ kind: 'pull_request', ref: '9', state: 'merged', author: 'bob' });
    expect(changesOf('issues', {})).toEqual([]);
  });
});

describe.skipIf(!hasDatabase)('Git host webhooks (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let board: RawWsClient;
  let project = '';
  const items: Record<number, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const conns: Record<string, { id: string; secret: string; path: string }> = {};

  const deliver = async (
    provider: 'github' | 'gitea',
    event: string,
    payload: unknown,
    opts: { secret?: string; connection?: string } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const conn = conns[provider];
    if (!conn) throw new Error('no connection');
    const body = Buffer.from(JSON.stringify(payload));
    const sig = sign(opts.secret ?? conn.secret, body);
    const headers: Record<string, string> =
      provider === 'github'
        ? { 'x-github-event': event, 'x-hub-signature-256': 'sha256=' + sig }
        : { 'x-gitea-event': event, 'x-gitea-signature': sig };
    const res = await fetch(
      t.base + (opts.connection ? '/hooks/git/' + opts.connection : conn.path),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
      },
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const events = (): ActivityEvent[] =>
    board.messages<ServerMessage>().flatMap((m) => (m.type === 'event' ? [m.event] : []));

  beforeAll(async () => {
    t = await startTestApp({ live: true });
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    for (const n of [1, 2]) {
      const r = await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Item ' + String(n),
      });
      items[n] = r.body.id;
    }
    board = await RawWsClient.open(t.port, { cookie: ada.cookie });
    board.sendJson({ type: 'subscribe', workspaceId: ada.workspaceId });
    await board.until(() => board.messages<ServerMessage>().some((m) => m.type === 'subscribed'));
  }, 60_000);

  afterAll(async () => {
    board.destroy();
    await t.stop();
  });

  it('lets an admin connect a repository and shows the secret only once', async () => {
    expect(
      (
        await t.call(bob, 'POST', W('/projects/' + project + '/git'), {
          provider: 'github',
          repo: 'acme/app',
        })
      ).status,
    ).toBe(403);
    for (const [provider, repo] of [
      ['github', 'acme/app'],
      ['gitea', 'team/app-mirror'],
    ] as const) {
      const r = await t.call<{ connection: { id: string; webhookPath: string }; secret: string }>(
        ada,
        'POST',
        W('/projects/' + project + '/git'),
        {
          provider,
          repo,
        },
      );
      expect(r.status).toBe(201);
      expect(r.body.secret).toMatch(/^[0-9a-f]{64}$/);
      conns[provider] = {
        id: r.body.connection.id,
        secret: r.body.secret,
        path: r.body.connection.webhookPath,
      };
    }
    expect(
      (
        await t.call(ada, 'POST', W('/projects/' + project + '/git'), {
          provider: 'github',
          repo: 'acme/app',
        })
      ).status,
    ).toBe(409);
    const list = await t.call<Record<string, unknown>[]>(
      bob,
      'GET',
      W('/projects/' + project + '/git'),
    );
    expect(list.body.map((c) => c['repo'])).toEqual(['acme/app', 'team/app-mirror']);
    expect(JSON.stringify(list.body)).not.toContain(conns['github']?.secret ?? 'x');
  });

  it('answers a ping, and refuses a wrong signature, another repository and an unknown connection', async () => {
    expect(
      (await deliver('github', 'ping', { zen: 'hi', repository: { full_name: 'acme/app' } }))
        .status,
    ).toBe(200);
    expect(
      (
        await deliver(
          'github',
          'push',
          { repository: { full_name: 'acme/app' } },
          { secret: 'x'.repeat(64) },
        )
      ).status,
    ).toBe(401);
    expect(
      (await deliver('github', 'push', { repository: { full_name: 'evil/app' }, commits: [] }))
        .status,
    ).toBe(400);
    expect(
      (await deliver('github', 'push', {}, { connection: '00000000-0000-4000-8000-000000000000' }))
        .status,
    ).toBe(404);
  });

  it('puts a pushed commit on its item and on the board at once', async () => {
    const sha = 'b'.repeat(40);
    const r = await deliver('github', 'push', {
      ref: 'refs/heads/main',
      repository: { full_name: 'Acme/App' },
      commits: [
        {
          id: sha,
          message: 'APP-1 Export as CSV\n\nAlso touches APP-2.',
          url: 'https://github.com/acme/app/commit/' + sha,
          author: { name: 'Ada L', username: 'ada' },
          timestamp: '2026-12-14T10:00:00Z',
        },
        {
          id: 'c'.repeat(40),
          message: 'chore: no task here',
          url: '',
          author: { name: 'Ada' },
          timestamp: '2026-12-14T10:01:00Z',
        },
      ],
    });
    expect(r.body).toMatchObject({ ok: true, event: 'push', linked: 2 });
    // the event is committed with the delivery, so it is on the board by the time the host has its answer
    await board.until(
      () => events().some((e) => e.subject === items[1] && e.data.changes?.['commit']?.to === sha),
      2000,
    );
    const e = events().find((x) => x.subject === items[1]);
    expect(e?.data.actor).toEqual({ kind: 'integration', id: 'github', name: 'ada via GitHub' });
    const links = await t.call<
      { kind: string; ref: string; title: string; state: string; provider: string; repo: string }[]
    >(ada, 'GET', W('/items/' + String(items[1]) + '/git'));
    expect(links.body).toEqual([
      expect.objectContaining({
        kind: 'commit',
        ref: sha,
        title: 'APP-1 Export as CSV',
        state: 'main',
        provider: 'github',
        repo: 'acme/app',
      }),
    ]);
    // the same push delivered again (hosts retry) links nothing new and tells nobody twice
    const before = events().length;
    expect(
      (
        await deliver('github', 'push', {
          ref: 'refs/heads/main',
          repository: { full_name: 'acme/app' },
          commits: [{ id: sha, message: 'APP-1 Export as CSV', author: {} }],
        })
      ).body['linked'],
    ).toBe(0);
    await new Promise((res) => setTimeout(res, 200));
    expect(events().length).toBe(before);
  });

  it('follows a Gitea pull request from open to merged', async () => {
    const pr = (state: string, merged: boolean) => ({
      action: merged ? 'closed' : 'opened',
      number: 4,
      repository: { full_name: 'team/app-mirror' },
      pull_request: {
        number: 4,
        title: 'Reprice',
        html_url: 'https://gitea.test/team/app-mirror/pulls/4',
        state,
        merged,
        head: { ref: 'app-2-reprice' },
        user: { login: 'bob' },
      },
    });
    expect((await deliver('gitea', 'pull_request', pr('open', false))).body['linked']).toBe(1);
    expect((await deliver('gitea', 'pull_request', pr('open', false))).body['linked']).toBe(0);
    expect((await deliver('gitea', 'pull_request', pr('closed', true))).body['linked']).toBe(1);
    await board.until(() =>
      events().some(
        (e) =>
          e.subject === items[2] &&
          JSON.stringify(e.data.changes?.['pullRequest']?.to ?? null).includes('merged'),
      ),
    );
    const links = await t.call<{ kind: string; ref: string; state: string; author: string }[]>(
      ada,
      'GET',
      W('/items/' + String(items[2]) + '/git'),
    );
    expect(links.body.find((l) => l.kind === 'pull_request')).toMatchObject({
      ref: '4',
      state: 'merged',
      author: 'bob',
    });
    expect(links.body.find((l) => l.kind === 'commit')?.ref).toBe('b'.repeat(40));
  });

  it('refuses deliveries once the repository is disconnected', async () => {
    expect((await t.call(ada, 'DELETE', W('/git/' + String(conns['github']?.id)))).status).toBe(
      200,
    );
    expect(
      (await deliver('github', 'ping', { repository: { full_name: 'acme/app' } })).status,
    ).toBe(404);
  });
});
