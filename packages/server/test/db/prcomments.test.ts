// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-303 | S15 | v0.1.0] T31.4 Line comments from people and the AI, posted to the host with approve or request changes ──
//    Why:  a reviewer's comments on lines stay drafts until the review is submitted; the Reviewer agent's
//          suggestions are accepted or dismissed; the review reaches each host (recorded answers of GitHub,
//          Gitea, GitLab and Azure DevOps) in the host's own shape, with the writer's name in every text;
//          a comment on a file that changed since is kept, not posted.
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scriptedProvider, type ModelProvider } from '../../src/agents/provider.js';
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
const book = (dir: string, h: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(new URL('../fixtures/' + dir + '/' + h + '.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
const reads = Object.fromEntries(HOSTS.map((h) => [h, book('prfiles', h)]));
const writes = Object.fromEntries(HOSTS.map((h) => [h, book('prwrite', h)]));

interface Sent {
  host: string;
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}
interface Comment {
  id: string;
  path: string;
  line: number;
  side: string;
  body: string;
  source: string;
  state: string;
  severity: string | null;
  author: string | null;
  mine: boolean;
  outdated: boolean;
}
interface Thread {
  comments: Comment[];
  reviews: { decision: string; body: string; comments: number; author: string; hostRef: string }[];
}

const said = (text: string): Parameters<typeof scriptedProvider>[0][number] => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage: { input: 300, output: 40 },
});

describe.skipIf(!hasDatabase)('pull request comments and reviews (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let host: Server;
  let current: (ModelProvider & { requests: { messages: unknown }[] }) | null = null;
  let project = '';
  const sent: Sent[] = [];
  const pulls: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  const thread = (who: Person, h: string) =>
    t.call<Thread>(who, 'GET', W('/pull-requests/' + (pulls[h] ?? '') + '/comments'));
  const comment = (h: string, c: Record<string, unknown>) =>
    t.call<Comment>(ada, 'POST', W('/pull-requests/' + (pulls[h] ?? '') + '/comments'), c);
  const submit = (h: string, decision: string, body?: string) =>
    t.call<{ posted: number; outdated: number; review: { hostRef: string } }>(
      ada,
      'POST',
      W('/pull-requests/' + (pulls[h] ?? '') + '/reviews'),
      body === undefined ? { decision } : { decision, body },
    );

  beforeAll(async () => {
    host = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const name = (req.url ?? '').split('/')[1] ?? '';
        const url = new URL(req.url ?? '/', 'http://x');
        const raw = '/' + ((req.url ?? '').split('?')[0] ?? '').split('/').slice(2).join('/');
        const method = req.method ?? 'GET';
        const read = reads[name];
        if (!read || req.headers['authorization']?.includes('wrong')) {
          res.writeHead(read ? 401 : 404);
          res.end('{"message":"Bad credentials"}');
          return;
        }
        const text = Buffer.concat(chunks).toString('utf8');
        sent.push({
          host: name,
          method,
          path: raw,
          body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
        });
        const key = raw.endsWith('/items')
          ? raw +
            '?path=' +
            (url.searchParams.get('path') ?? '') +
            '&version=' +
            (url.searchParams.get('versionDescriptor.version') ?? '')
          : raw;
        const body =
          writes[name]?.[method + ' ' + raw] ?? (method === 'GET' ? read[key] : undefined);
        if (body === undefined || Number(url.searchParams.get('page') ?? '1') > 1) {
          res.writeHead(body === undefined ? 404 : 200);
          res.end(body === undefined ? '{"message":"Not Found"}' : '[]');
          return;
        }
        res.setHeader('content-type', typeof body === 'string' ? 'text/plain' : 'application/json');
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
      });
    });
    await listenFetchable(host); // [PCODE-365 | S15 | v0.1.0]
    const base = 'http://127.0.0.1:' + String((host.address() as AddressInfo).port);

    t = await startTestApp({
      agents: {
        provider: () => {
          if (!current) throw new Error('no script');
          return Promise.resolve(current);
        },
      },
    });
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    const item = (
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
      const conn = r.body.connection.id;
      await t.call(ada, 'PUT', W('/git/' + conn + '/api'), {
        token: TOKEN,
        apiUrl: base + '/' + h,
      });
      pulls[h] =
        (
          await sys<{ id: string }>(
            `INSERT INTO pull_requests (workspace_id, project_id, connection_id, number, title, head_sha, additions, deletions,
                                        changed_files, checks_state, item_id, opened_at, updated_at)
             VALUES ($1, $2, $3, 7, 'SHOP-1 Cart keeps items', $4, 5, 0, 4, 'passing', $5, now(), now()) RETURNING id`,
            [ada.workspaceId, project, conn, HEAD, item],
          )
        )[0]?.id ?? '';
      expect(
        (await t.call(ada, 'GET', W('/pull-requests/' + (pulls[h] ?? '') + '/files'))).status,
      ).toBe(200);
    }
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    host.close();
  });

  it('keeps comments on lines the diff shows, as drafts only their writer sees', async () => {
    const r = await comment('github', {
      path: 'src/cart.ts',
      line: 5,
      body: 'Save after remove too.',
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ side: 'new', state: 'draft', source: 'person', mine: true });
    expect((await comment('github', { path: 'src/cart.ts', line: 99, body: 'x' })).status).toBe(
      422,
    );
    // no line was removed from the cart, so its old side takes no comment
    expect(
      (await comment('github', { path: 'src/cart.ts', line: 4, side: 'old', body: 'x' })).status,
    ).toBe(422);
    expect((await comment('github', { path: 'nope.ts', line: 1, body: 'x' })).status).toBe(404);
    expect((await thread(bob, 'github')).body.comments).toEqual([]);

    const changed = await t.call<Comment>(ada, 'PATCH', W('/pull-request-comments/' + r.body.id), {
      body: 'Save after remove, too.',
    });
    expect(changed.body.body).toBe('Save after remove, too.');
    expect((await t.call(bob, 'DELETE', W('/pull-request-comments/' + r.body.id))).status).toBe(
      409,
    );
  });

  it('lets the AI suggest comments on added lines, to accept or dismiss', async () => {
    current = scriptedProvider([
      said(
        'Here is what I found:\n' +
          JSON.stringify([
            { path: 'src/cart.ts', line: 2, severity: 'risk', body: 'Items are kept forever.' },
            { path: 'src/cart.ts', line: 99, body: 'Not a line of the change.' },
            { path: 'nope.ts', line: 1, body: 'Not a file of the change.' },
            { path: 'README.md', line: 3, severity: 'odd', body: 'Say what the cart does.' },
          ]),
      ),
    ]);
    const r = await t.call<Thread>(
      ada,
      'POST',
      W('/pull-requests/' + (pulls['github'] ?? '') + '/ai-comments'),
    );
    expect(r.status).toBe(201);
    const prompt = JSON.stringify(current.requests[0]?.messages);
    expect(prompt).toContain('FILE src/cart.ts');
    expect(prompt).toContain('    5 +   save(items);');
    expect(prompt).toContain('Task SHOP-1: Cart keeps items between visits');
    const ai = r.body.comments.filter((c) => c.source === 'ai');
    expect(ai.map((c) => [c.path, c.line, c.severity, c.state])).toEqual([
      ['README.md', 3, 'note', 'suggested'],
      ['src/cart.ts', 2, 'risk', 'suggested'],
    ]);
    // Bob sees the suggestions too, not Ada's draft
    expect((await thread(bob, 'github')).body.comments.map((c) => c.source)).toEqual(['ai', 'ai']);

    const [readme, cart] = ai;
    const accepted = await t.call<Comment>(
      ada,
      'POST',
      W('/pull-request-comments/' + (cart?.id ?? '') + '/decide'),
      { accept: true, body: 'Items are kept forever; clear them on checkout.' },
    );
    expect(accepted.body).toMatchObject({ state: 'draft', mine: true, author: 'Ada' });
    await t.call(ada, 'POST', W('/pull-request-comments/' + (readme?.id ?? '') + '/decide'), {
      accept: false,
    });
    expect(
      (
        await t.call(bob, 'POST', W('/pull-request-comments/' + (readme?.id ?? '') + '/decide'), {
          accept: true,
        })
      ).status,
    ).toBe(409);

    // asking again replaces what is still undecided, never what a person decided
    current = scriptedProvider([said('[]')]);
    const again = await t.call<Thread>(
      ada,
      'POST',
      W('/pull-requests/' + (pulls['github'] ?? '') + '/ai-comments'),
    );
    expect(again.body.comments.map((c) => [c.path, c.line, c.state])).toEqual([
      ['README.md', 3, 'dismissed'],
      ['src/cart.ts', 2, 'draft'],
      ['src/cart.ts', 5, 'draft'],
    ]);
  });

  it.each(HOSTS)('posts a review that asks for changes to %s', async (h) => {
    if (h !== 'github') {
      await comment(h, { path: 'src/cart.ts', line: 2, body: 'Items are kept forever.' });
      await comment(h, { path: 'src/cart.ts', line: 5, body: 'Save after remove, too.' });
    }
    const from = sent.length;
    const r = await submit(h, 'request_changes', 'Two things before this goes in.');
    expect(r.status).toBe(201);
    expect(r.body.posted).toBe(2);
    const calls = sent.slice(from).filter((x) => x.host === h);
    const sig = (body: unknown) => String(body).split('\n\n— ')[1];
    if (h === 'github' || h === 'gitea') {
      expect(calls.map((x) => x.method + ' ' + x.path)).toEqual([
        'POST /repos/acme/shop/pulls/7/reviews',
      ]);
      const b = calls[0]?.body ?? {};
      expect(b['event']).toBe('REQUEST_CHANGES');
      expect(b['commit_id']).toBe(HEAD);
      expect(sig(b['body'])).toBe('Ada (via Orqiva)');
      const cs = b['comments'] as Record<string, unknown>[];
      expect(
        cs.map((c) =>
          h === 'github' ? [c['path'], c['line'], c['side']] : [c['path'], c['new_position']],
        ),
      ).toEqual(
        h === 'github'
          ? [
              ['src/cart.ts', 2, 'RIGHT'],
              ['src/cart.ts', 5, 'RIGHT'],
            ]
          : [
              ['src/cart.ts', 2],
              ['src/cart.ts', 5],
            ],
      );
      expect(sig(cs[0]?.['body'])).toBe(
        h === 'github' ? 'Ada, from an AI suggestion (via Orqiva)' : 'Ada (via Orqiva)',
      );
      expect(r.body.review.hostRef).toBe(h === 'github' ? '2304511870' : '57');
    } else if (h === 'gitlab') {
      const mr = '/projects/acme%2Fweb%2Fshop/merge_requests/7';
      expect(calls.map((x) => x.method + ' ' + x.path)).toEqual([
        'GET ' + mr,
        'POST ' + mr + '/discussions',
        'POST ' + mr + '/discussions',
        'POST ' + mr + '/notes',
      ]);
      expect(calls[1]?.body?.['position']).toEqual({
        position_type: 'text',
        base_sha: 'b8'.repeat(20),
        start_sha: 'b8'.repeat(20),
        head_sha: HEAD,
        new_path: 'src/cart.ts',
        old_path: 'src/cart.ts',
        new_line: 2,
      });
      expect(String(calls[3]?.body?.['body'])).toMatch(
        /^\*\*Changes requested\.\*\*\n\nTwo things/,
      );
      expect(r.body.review.hostRef).toBe('6a9c1750b37d513a43987b574953fceb50b03ce7');
    } else {
      const pr = '/contoso/Shop/_apis/git/repositories/shop-web/pullRequests/7';
      expect(calls.map((x) => x.method + ' ' + x.path)).toEqual([
        'POST ' + pr + '/threads',
        'POST ' + pr + '/threads',
        'POST ' + pr + '/threads',
        'GET /contoso/_apis/connectionData',
        'PUT ' + pr + '/reviewers/5c1e2d0a-7b2f-4c6e-9a51-3f0d9e8b7a61',
      ]);
      expect(calls[1]?.body?.['threadContext']).toEqual({
        filePath: '/src/cart.ts',
        rightFileStart: { line: 5, offset: 1 },
        rightFileEnd: { line: 5, offset: 1 },
      });
      expect(calls[2]?.body?.['threadContext']).toBeUndefined();
      expect(calls[4]?.body).toEqual({ vote: -5 });
      expect(r.body.review.hostRef).toBe('148');
    }
    const after = (await thread(ada, h)).body;
    expect(after.comments.filter((c) => c.state === 'posted')).toHaveLength(2);
    expect(after.reviews).toMatchObject([
      { decision: 'request_changes', comments: 2, author: 'Ada' },
    ]);
    const state = await sys<{ review_state: string }>(
      'SELECT review_state FROM pull_requests WHERE id = $1',
      [pulls[h]],
    );
    expect(state[0]?.review_state).toBe('changes_requested');
  });

  it('keeps a comment on a file that changed since, and approves without it', async () => {
    const c = await comment('gitlab', { path: 'README.md', line: 3, body: 'Say more.' });
    await sys(
      "UPDATE pull_request_files SET patch_hash = 'changed' WHERE pull_request_id = $1 AND path = 'README.md'",
      [pulls['gitlab']],
    );
    expect(
      (await thread(ada, 'gitlab')).body.comments.find((x) => x.id === c.body.id)?.outdated,
    ).toBe(true);
    expect((await submit('gitlab', 'comment')).status).toBe(422);
    const from = sent.length;
    const r = await submit('gitlab', 'approve');
    expect(r.body).toMatchObject({ posted: 0, outdated: 1 });
    expect(sent.slice(from).map((x) => x.method + ' ' + (x.path.split('/').pop() ?? ''))).toEqual([
      'GET 7',
      'POST approve',
    ]);
    expect((await thread(ada, 'gitlab')).body.comments.find((x) => x.id === c.body.id)?.state).toBe(
      'draft',
    );
  });

  it('needs an open pull request and the connection’s token', async () => {
    await sys("UPDATE pull_requests SET state = 'merged' WHERE id = $1", [pulls['gitea']]);
    expect((await submit('gitea', 'approve')).status).toBe(409);
    await sys("UPDATE pull_requests SET state = 'open' WHERE id = $1", [pulls['gitea']]);
    await sys(
      'UPDATE git_connections SET api_token = NULL WHERE id = (SELECT connection_id FROM pull_requests WHERE id = $1)',
      [pulls['gitea']],
    );
    const r = await submit('gitea', 'approve');
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toContain('API token');
  });
});
