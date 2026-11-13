// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-301 | S15 | v0.1.0] T31.2b Git history backfill through the hosts' APIs; branches and tags in the Repositories screen ──
//    Why:  the past of a repository read through each host's API (recorded answers of GitHub, Gitea, GitLab
//          and Azure DevOps, served by a stand-in that checks each host's way of sending the token): the
//          default branch, commits, branches, tags and pull requests are kept, tasks are linked, but
//          nothing moves or closes and the activity gets one line per read.
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
const answers = Object.fromEntries(
  HOSTS.map((h) => [
    h,
    JSON.parse(
      readFileSync(new URL('../fixtures/hostapi/' + h + '.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>,
  ]),
);
const authorised = (
  host: string,
  headers: Record<string, string | string[] | undefined>,
): boolean =>
  host === 'github'
    ? headers['authorization'] === 'Bearer ' + TOKEN
    : host === 'gitea'
      ? headers['authorization'] === 'token ' + TOKEN
      : host === 'gitlab'
        ? headers['private-token'] === TOKEN
        : headers['authorization'] === 'Basic ' + Buffer.from(':' + TOKEN).toString('base64');

describe.skipIf(!hasDatabase)('Git history backfill (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let host: Server;
  let base = '';
  let project = '';
  const conns: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);

  beforeAll(async () => {
    host = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const [, name, ...rest] = url.pathname.split('/');
      const path = '/' + rest.join('/');
      const filter = url.searchParams.get('filter');
      const page = Number(url.searchParams.get('page') ?? '1');
      const book = answers[name ?? ''];
      res.setHeader('content-type', 'application/json');
      if (!book || !authorised(name ?? '', req.headers)) {
        res.writeHead(book ? 401 : 404);
        res.end('{"message":"Bad credentials"}');
        return;
      }
      // raw paths: GitLab's project id stays encoded
      const raw = '/' + ((req.url ?? '').split('?')[0] ?? '').split('/').slice(2).join('/');
      const body = book[filter ? raw + '?filter=' + filter : raw] ?? book[path];
      if (body === undefined) {
        res.writeHead(404);
        res.end('{"message":"Not Found"}');
        return;
      }
      res.end(JSON.stringify(page > 1 ? [] : body));
    });
    await listenFetchable(host); // [PCODE-365 | S15 | v0.1.0]
    base = 'http://127.0.0.1:' + String((host.address() as AddressInfo).port);

    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    for (const n of [1, 2, 3])
      await t.call(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Item ' + String(n),
      });
    for (const h of HOSTS) {
      const r = await t.call<{ connection: { id: string } }>(
        ada,
        'POST',
        W('/projects/' + project + '/git'),
        {
          provider: h,
          repo: REPO[h],
        },
      );
      conns[h] = r.body.connection.id;
    }
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    host.close();
  });

  it('needs a token, and says when the host refuses it', async () => {
    const r = await t.call<{ error: { message: string } }>(
      ada,
      'POST',
      W('/git/' + (conns['github'] ?? '') + '/backfill'),
      {},
    );
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('API token');
    await t.call(ada, 'PUT', W('/git/' + (conns['github'] ?? '') + '/api'), {
      token: 'not-the-token',
      apiUrl: base + '/github',
    });
    const refused = await t.call<{ error: { message: string } }>(
      ada,
      'POST',
      W('/git/' + (conns['github'] ?? '') + '/backfill'),
      {},
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain('The host refused the token');
  });

  it.each(HOSTS)('reads the past of a %s repository', async (h) => {
    const id = conns[h] ?? '';
    await t.call(ada, 'PUT', W('/git/' + id + '/api'), { token: TOKEN, apiUrl: base + '/' + h });
    const r = await t.call(ada, 'POST', W('/git/' + id + '/backfill'), {});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      defaultBranch: 'main',
      commits: 2,
      branches: 2,
      tags: 1,
      pullRequests: 1,
    });
    const refs = (
      await t.call<
        {
          connectionId: string;
          commits: number;
          branches: { name: string; message: string | null }[];
          tags: { name: string; sha: string }[];
        }[]
      >(ada, 'GET', W('/projects/' + project + '/git/refs'))
    ).body.find((x) => x.connectionId === id);
    expect(refs?.commits).toBe(2);
    expect(refs?.branches.map((b) => b.name)).toEqual(['main', 'feature/shop-3-search']);
    expect(refs?.branches[0]?.message).toMatch(
      /SHOP-2 Totals round to cents$|^Merge pull request #4/,
    );
    expect(refs?.tags).toEqual([expect.objectContaining({ name: 'v1.0.0', sha: '1a'.repeat(20) })]);
  });

  it('links tasks without moving or closing them, with one line of activity per read', async () => {
    const prs = (
      await t.call<{ repo: string; state: string; itemRef: string }[]>(
        ada,
        'GET',
        W('/projects/' + project + '/pull-requests?state=all'),
      )
    ).body;
    expect(prs.map((p) => p.state + ' ' + p.itemRef).sort()).toEqual([
      'merged SHOP-2',
      'merged SHOP-2',
      'merged SHOP-2',
      'merged SHOP-2',
    ]);
    const states = await sys<{ sequence: number; grp: string }>(
      'SELECT i.sequence, st.grp FROM items i JOIN project_states st ON st.id = i.state_id WHERE i.project_id = $1 ORDER BY i.sequence',
      [project],
    );
    expect(states.every((s) => s.grp !== 'completed' && s.grp !== 'started')).toBe(true);
    const links = await sys<{ n: string }>(
      "SELECT count(*) AS n FROM item_git_links l JOIN items i ON i.id = l.item_id WHERE i.project_id = $1 AND l.kind = 'commit'",
      [project],
    );
    expect(Number(links[0]?.n)).toBe(8); // SHOP-1 and SHOP-2's commits on four hosts
    const events = await sys<{ n: string }>(
      "SELECT count(*) AS n FROM activity_events WHERE envelope->'data'->'changes' ? 'gitHistory'",
    );
    expect(Number(events[0]?.n)).toBe(4);
    const itemEvents = await sys<{ n: string }>(
      "SELECT count(*) AS n FROM activity_events e JOIN items i ON i.id::text = e.object_id WHERE i.project_id = $1 AND e.type <> 'orqiva.item.created'",
      [project],
    );
    expect(Number(itemEvents[0]?.n)).toBe(0);
  });
});
