// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-305 | S15 | v0.1.0] T31.5b The merge queue: in order per branch, merged through the host when the policy passes ──
//    Why:  pull requests wait in line per branch; "Merge next" asks the host (recorded answers of GitHub,
//          Gitea, GitLab and Azure DevOps) whether the first still merges cleanly and merges it pinned to the
//          checked commit; conflicts, a rule not met or a refusal take it out of line with the reason; a
//          rule still waiting and a stack keep its place.
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { listenFetchable } from '../ports.js'; // [PCODE-365 | S15 | v0.1.0]

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);
const TOKEN = 'host-token-for-the-stand-in';
const HOSTS = ['github', 'gitea', 'gitlab', 'azure'] as const;
const REPO = {
  github: 'acme/shop',
  gitea: 'acme/shop',
  gitlab: 'acme/web/shop',
  azure: 'contoso/Shop/shop-web',
};
const HEAD = 'a7'.repeat(20);
const book = Object.fromEntries(
  HOSTS.map((h) => [
    h,
    JSON.parse(
      readFileSync(new URL('../fixtures/prmerge/' + h + '.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>,
  ]),
);

interface Sent {
  host: string;
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}
interface Outcome {
  outcome: string;
  number: number | null;
  reason: string;
}
interface Entry {
  number: number;
  repo: string;
  lane: string;
  state: string;
  reason: string;
  method: string;
}

describe.skipIf(!hasDatabase)('the merge queue (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let host: Server;
  let project = '';
  let item = '';
  const sent: Sent[] = [];
  const conns: Record<string, string> = {};
  const pulls: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  const enqueue = (key: string, method?: string) =>
    t.call<{ position: number }>(
      ada,
      'POST',
      W('/pull-requests/' + (pulls[key] ?? '') + '/queue'),
      method ? { method } : {},
    );
  const next = (h: string, base = 'main') =>
    t.call<Outcome>(ada, 'POST', W('/projects/' + project + '/merge-queue/next'), {
      lane: (conns[h] ?? '') + ':' + base,
    });
  const queue = async (): Promise<Entry[]> =>
    (await t.call<Entry[]>(ada, 'GET', W('/projects/' + project + '/merge-queue'))).body;
  const pull = async (
    h: string,
    number: number,
    extra: { branch?: string; base?: string; draft?: boolean; checks?: string } = {},
  ): Promise<string> =>
    (
      await sys<{ id: string }>(
        `INSERT INTO pull_requests (workspace_id, project_id, connection_id, number, title, branch, base, head_sha,
                                    checks_state, item_id, draft, opened_at, updated_at)
         VALUES ($1, $2, $3, $4::int, 'SHOP-1 Work ' || $4::text, $5, $6, $7, $8, $9, $10, now(), now()) RETURNING id`,
        [
          ada.workspaceId,
          project,
          conns[h],
          number,
          extra.branch ?? 'feature/' + String(number),
          extra.base ?? 'main',
          HEAD,
          extra.checks ?? 'passing',
          item,
          extra.draft ?? false,
        ],
      )
    )[0]?.id ?? '';

  beforeAll(async () => {
    host = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const name = (req.url ?? '').split('/')[1] ?? '';
        const raw = '/' + ((req.url ?? '').split('?')[0] ?? '').split('/').slice(2).join('/');
        const method = req.method ?? 'GET';
        const text = Buffer.concat(chunks).toString('utf8');
        sent.push({
          host: name,
          method,
          path: raw,
          body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
        });
        const key = method + ' ' + raw;
        const known = book[name] ?? {};
        if (!(key in known)) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end('{"message":"Not Found"}');
          return;
        }
        const body = known[key] as Record<string, unknown> | null;
        const status = typeof body?.['__status'] === 'number' ? body['__status'] : 200;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(body === null ? '' : JSON.stringify(body));
      });
    });
    await listenFetchable(host); // [PCODE-365 | S15 | v0.1.0]
    const base = 'http://127.0.0.1:' + String((host.address() as AddressInfo).port);

    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Cart keeps items between visits',
      })
    ).body.id;
    for (const h of HOSTS) {
      const r = await t.call<{ connection: { id: string } }>(
        ada,
        'POST',
        W('/projects/' + project + '/git'),
        { provider: h, repo: REPO[h] },
      );
      conns[h] = r.body.connection.id;
      await t.call(ada, 'PUT', W('/git/' + (conns[h] ?? '') + '/api'), {
        token: TOKEN,
        apiUrl: base + '/' + h,
      });
      pulls[h] = await pull(h, 7, { branch: 'feature/cart' });
    }
    pulls['dirty'] = await pull('github', 8);
    pulls['refused'] = await pull('github', 9);
    pulls['stacked'] = await pull('github', 10, { base: 'feature/cart' });
    pulls['draft'] = await pull('github', 11, { draft: true });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    host.close();
  });

  it('keeps the line: no drafts, each pull request once', async () => {
    expect((await enqueue('dirty')).body.position).toBe(1);
    expect((await enqueue('github', 'squash')).body.position).toBe(2);
    expect((await enqueue('refused', 'merge')).body.position).toBe(3);
    expect((await enqueue('github')).status).toBe(409);
    expect((await enqueue('draft')).status).toBe(409);
    expect((await enqueue('stacked')).body.position).toBe(1);
    const q = await queue();
    expect(q.map((e) => [e.number, e.state, e.lane.endsWith(':main')])).toEqual([
      [8, 'queued', true],
      [7, 'queued', true],
      [9, 'queued', true],
      [10, 'queued', false],
    ]);
  });

  it('takes out what cannot merge, merges what can, and says why', async () => {
    const out = (await next('github')).body;
    expect(out).toEqual({ outcome: 'removed', number: 8, reason: 'It has conflicts with main' });

    const from = sent.length;
    expect((await next('github')).body).toEqual({
      outcome: 'merged',
      number: 7,
      reason: 'Merged by squash',
    });
    const calls = sent.slice(from);
    expect(calls.map((x) => x.method + ' ' + x.path)).toEqual([
      'GET /repos/acme/shop/pulls/7',
      'PUT /repos/acme/shop/pulls/7/merge',
    ]);
    expect(calls[1]?.body).toEqual({
      merge_method: 'squash',
      sha: HEAD,
      commit_title: 'SHOP-1 Work 7 (#7)',
    });

    const refused = (await next('github')).body;
    expect(refused.outcome).toBe('removed');
    expect(refused.reason).toContain('Base branch was modified');
    expect((await next('github')).body.outcome).toBe('empty');

    const states = await sys<{ state: string }>('SELECT state FROM pull_requests WHERE id = $1', [
      pulls['github'],
    ]);
    expect(states[0]?.state).toBe('merged');
    const q = await queue();
    expect(q.filter((e) => e.lane.endsWith(':main')).map((e) => [e.number, e.state])).toEqual([
      [8, 'removed'],
      [7, 'merged'],
      [9, 'removed'],
    ]);
  });

  it('lets a stacked pull request wait for the one below', async () => {
    await sys("UPDATE pull_requests SET state = 'open', merged_at = NULL WHERE id = $1", [
      pulls['github'],
    ]);
    const r = (await next('github', 'feature/cart')).body;
    expect(r).toMatchObject({ outcome: 'waiting', number: 10 });
    expect(r.reason).toBe('Stacked on #7: that merges first');
    expect((await queue()).find((e) => e.number === 10)?.state).toBe('queued');
    await t.call(ada, 'DELETE', W('/pull-requests/' + (pulls['stacked'] ?? '') + '/queue'));
    expect((await queue()).find((e) => e.number === 10)?.reason).toBe('taken out by Ada');
  });

  it('keeps the place while a rule waits, then merges on Gitea', async () => {
    await t.call(ada, 'PUT', W('/projects/' + project + '/merge-policy'), {
      requireTask: true,
      requireFingerprints: false,
      requireApproval: false,
      requireChecks: true,
      requireSensitiveApproval: false,
      blockConflicts: true,
      postStatus: false,
    });
    await sys("UPDATE pull_requests SET checks_state = 'pending' WHERE id = $1", [pulls['gitea']]);
    await enqueue('gitea', 'rebase');
    expect((await next('gitea')).body).toMatchObject({
      outcome: 'waiting',
      reason: 'Waiting: checks running',
    });
    await sys("UPDATE pull_requests SET checks_state = 'passing' WHERE id = $1", [pulls['gitea']]);
    const from = sent.length;
    expect((await next('gitea')).body.outcome).toBe('merged');
    expect(sent.slice(from).at(-1)).toMatchObject({
      method: 'POST',
      path: '/repos/acme/shop/pulls/7/merge',
      body: { Do: 'rebase', head_commit_id: HEAD },
    });
  });

  it.each(['gitlab', 'azure'] as const)('merges through %s', async (h) => {
    await enqueue(h, 'squash');
    const from = sent.length;
    expect((await next(h)).body.outcome).toBe('merged');
    const write = sent.slice(from).at(-1);
    if (h === 'gitlab')
      expect(write).toMatchObject({
        method: 'PUT',
        path: '/projects/acme%2Fweb%2Fshop/merge_requests/7/merge',
        body: { squash: true, sha: HEAD },
      });
    else
      expect(write).toMatchObject({
        method: 'PATCH',
        path: '/contoso/Shop/_apis/git/repositories/shop-web/pullRequests/7',
        body: {
          status: 'completed',
          lastMergeSourceCommit: { commitId: HEAD },
          completionOptions: { mergeStrategy: 'squash', deleteSourceBranch: false },
        },
      });
  });
});
