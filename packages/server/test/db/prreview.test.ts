// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-302 | S15 | v0.1.0] T31.3 PR review queue (riskiest first) and side-by-side diff with fingerprints and viewed files ──
//    Why:  the queue orders open pull requests by risk and says why; a pull request's files are read from each
//          host (recorded answers of GitHub, Gitea, GitLab and Azure DevOps) once per head commit, with the
//          fingerprints of new lines; a file marked viewed stays viewed until a push changes it.
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
const answers = Object.fromEntries(
  HOSTS.map((h) => [
    h,
    JSON.parse(
      readFileSync(new URL('../fixtures/prfiles/' + h + '.json', import.meta.url), 'utf8'),
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

interface FileOut {
  path: string;
  oldPath: string | null;
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
  patch: string;
  viewed: boolean;
  markers: { line: number; task: string; title: string }[];
  missing: boolean;
  foreign: string[];
}
interface FilesOut {
  number: number;
  itemRef: string | null;
  risk: { level: string; reasons: string[] };
  files: FileOut[];
}
interface QueueOut {
  id: string;
  number: number;
  repo: string;
  risk: { score: number; level: string; reasons: string[] };
  files: number | null;
  viewed: number;
}

describe.skipIf(!hasDatabase)('pull request review (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let eve: Person;
  let host: Server;
  let base = '';
  let project = '';
  let requests = 0;
  const conns: Record<string, string> = {};
  const pulls: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  const filesOf = (h: string) =>
    t.call<FilesOut>(ada, 'GET', W('/pull-requests/' + (pulls[h] ?? '') + '/files'));
  const queue = async (): Promise<QueueOut[]> =>
    (await t.call<QueueOut[]>(ada, 'GET', W('/projects/' + project + '/review-queue'))).body;

  beforeAll(async () => {
    host = createServer((req, res) => {
      requests += 1;
      const url = new URL(req.url ?? '/', 'http://x');
      const name = (req.url ?? '').split('/')[1] ?? '';
      const book = answers[name];
      if (!book || !authorised(name, req.headers)) {
        res.writeHead(book ? 401 : 404);
        res.end('{"message":"Bad credentials"}');
        return;
      }
      // the raw path (GitLab's project id stays encoded), and for Azure's items the file and version
      const raw = '/' + ((req.url ?? '').split('?')[0] ?? '').split('/').slice(2).join('/');
      const key = raw.endsWith('/items')
        ? raw +
          '?path=' +
          (url.searchParams.get('path') ?? '') +
          '&version=' +
          (url.searchParams.get('versionDescriptor.version') ?? '')
        : raw;
      const body = book[key];
      if (body === undefined || Number(url.searchParams.get('page') ?? '1') > 1) {
        res.writeHead(body === undefined ? 404 : 200);
        res.end(body === undefined ? '{"message":"Not Found"}' : '[]');
        return;
      }
      res.setHeader('content-type', typeof body === 'string' ? 'text/plain' : 'application/json');
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
    await listenFetchable(host); // [PCODE-365 | S15 | v0.1.0]
    base = 'http://127.0.0.1:' + String((host.address() as AddressInfo).port);

    t = await startTestApp();
    ada = await t.signup('Ada');
    eve = await t.signup('Eve');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    const item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Cart keeps items between visits',
      })
    ).body.id;
    const pull = async (
      conn: string,
      number: number,
      extra: Record<string, unknown>,
    ): Promise<string> =>
      (
        await sys<{ id: string }>(
          `INSERT INTO pull_requests (workspace_id, project_id, connection_id, number, title, head_sha, additions, deletions, changed_files,
                                      checks_state, item_id, draft, opened_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now() - interval '1 day', now()) RETURNING id`,
          [
            ada.workspaceId,
            project,
            conn,
            number,
            extra['title'] ?? 'SHOP-1 Cart keeps items',
            HEAD,
            extra['additions'] ?? 5,
            extra['deletions'] ?? 0,
            extra['files'] ?? 4,
            extra['checks'] ?? 'passing',
            'item' in extra ? extra['item'] : item,
            extra['draft'] ?? false,
          ],
        )
      )[0]?.id ?? '';
    for (const h of HOSTS) {
      const r = await t.call<{ connection: { id: string } }>(
        ada,
        'POST',
        W('/projects/' + project + '/git'),
        { provider: h, repo: REPO[h] },
      );
      conns[h] = r.body.connection.id;
      await t.call(ada, 'PUT', W('/git/' + conns[h] + '/api'), {
        token: TOKEN,
        apiUrl: base + '/' + h,
      });
      pulls[h] = await pull(conns[h], 7, {});
    }
    // a big one without a task whose checks fail, a draft, and one whose connection has no token
    pulls['risky'] = await pull(conns['github'] ?? '', 8, {
      title: 'Rework everything',
      additions: 700,
      deletions: 200,
      checks: 'failing',
      item: null,
    });
    pulls['draft'] = await pull(conns['github'] ?? '', 9, {
      title: 'SHOP-1 Try a thing',
      additions: 700,
      draft: true,
    });
    const bare = await t.call<{ connection: { id: string } }>(
      ada,
      'POST',
      W('/projects/' + project + '/git'),
      { provider: 'github', repo: 'acme/other' },
    );
    pulls['bare'] = await pull(bare.body.connection.id, 1, { title: 'SHOP-1 Small' });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    host.close();
  });

  it('puts the riskiest pull request first and says why', async () => {
    const q = await queue();
    expect(q[0]).toMatchObject({
      number: 8,
      files: null,
      viewed: 0,
      risk: { level: 'high', reasons: ['900 lines changed', 'checks fail', 'no task'] },
    });
    const draft = q.find((p) => p.number === 9);
    expect(draft?.risk.reasons).toEqual(['700 lines changed', 'draft']);
    expect(draft?.risk.level).toBe('low');
    expect(q).toHaveLength(7);
  });

  it.each(HOSTS)('reads the changed files of a %s pull request', async (h) => {
    const r = await filesOf(h);
    expect(r.status).toBe(200);
    expect(r.body.itemRef).toBe('SHOP-1');
    expect(r.body.files.map((f) => [f.path, f.status, f.additions, f.deletions, f.binary])).toEqual(
      [
        ['src/cart.ts', 'modified', 2, 0, false],
        ['server/migrations/0007_cart.sql', 'added', 1, 0, false],
        ['README.md', 'modified', 2, 0, false],
        ['assets/logo.png', 'modified', 0, 0, true],
      ],
    );
    const [cart, sql, readme] = r.body.files;
    expect(cart?.markers).toEqual([
      { line: 2, task: 'SHOP-1', title: 'Cart keeps items between visits' },
    ]);
    expect([cart?.missing, sql?.missing, readme?.missing]).toEqual([false, true, false]);
    expect(cart?.patch.split('\n')[0]).toBe('@@ -1,4 +1,6 @@');
    expect(r.body.risk.reasons).toEqual([
      'touches migrations',
      '1 code file without a fingerprint',
    ]);
  });

  it('asks the host once per head commit', async () => {
    const before = requests;
    expect((await filesOf('github')).status).toBe(200);
    expect(requests).toBe(before);
    const again = await t.call(
      ada,
      'GET',
      W('/pull-requests/' + (pulls['github'] ?? '') + '/files?refresh=1'),
    );
    expect(again.status).toBe(200);
    expect(requests).toBe(before + 1);
  });

  it('keeps viewed marks per person until a push changes the file', async () => {
    const id = pulls['github'] ?? '';
    const mark = (path: string, viewed = true) =>
      t.call<{ viewed: number; files: number }>(ada, 'PUT', W('/pull-requests/' + id + '/viewed'), {
        path,
        viewed,
      });
    await mark('src/cart.ts');
    expect((await mark('README.md')).body).toEqual({ viewed: 2, files: 4 });
    expect((await mark('nope.ts')).status).toBe(404);
    expect((await queue()).find((p) => p.id === id)?.viewed).toBe(2);

    // a push: the cart changes again, the README does not
    const book = answers['github'] as Record<string, { filename: string; patch?: string }[]>;
    const list = book['/repos/acme/shop/pulls/7/files'] ?? [];
    const cart = list[0];
    if (cart) cart.patch = (cart.patch ?? '') + '\n+// and empties it on checkout';
    await sys('UPDATE pull_requests SET head_sha = $2 WHERE id = $1', [id, 'c9'.repeat(20)]);
    const files = (await filesOf('github')).body.files;
    expect(files.map((f) => [f.path, f.viewed])).toEqual([
      ['src/cart.ts', false],
      ['server/migrations/0007_cart.sql', false],
      ['README.md', true],
      ['assets/logo.png', false],
    ]);
    expect((await mark('README.md', false)).body).toEqual({ viewed: 0, files: 4 });
  });

  it('needs the connection’s token, and keeps other workspaces out', async () => {
    const r = await t.call<{ error: { message: string } }>(
      ada,
      'GET',
      W('/pull-requests/' + (pulls['bare'] ?? '') + '/files'),
    );
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('API token');
    const other = await t.call(
      eve,
      'GET',
      '/api/workspaces/' + eve.workspaceId + '/pull-requests/' + (pulls['github'] ?? '') + '/files',
    );
    expect(other.status).toBe(404);
  });
});
