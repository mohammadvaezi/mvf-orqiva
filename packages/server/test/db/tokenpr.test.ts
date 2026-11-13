// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-288 | S15 | v0.1.0] T30.2 Design tokens exported as a pull request (GitHub, Gitea) ──
//    Why:  against a fake host that answers like GitHub and like Gitea: the token is kept sealed and
//          never shown; a pull request writes only the files that changed, on its own branch, with the
//          host's own calls; nothing changed opens nothing; a refused token says so; plain http only to
//          this machine.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { listenFetchable } from '../ports.js'; // [PCODE-365 | S15 | v0.1.0]

process.env['ORQIVA_SECRET_KEY'] = 'cd'.repeat(32);
const TOKEN = 'host-token-for-tests';

/** A repository host in memory: main has README.md and design-tokens/tokens.json. */
function fakeHost() {
  const branches = new Map<string, Map<string, string>>([
    [
      'main',
      new Map([
        ['README.md', '# Shop\n'],
        ['design-tokens/tokens.json', '{}\n'],
      ]),
    ],
  ]);
  const calls: string[] = [];
  const pulls: { title: string; head: string; base: string; body: string }[] = [];
  const read = (req: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((res) => {
      let b = '';
      req.on('data', (d: Buffer) => (b += d.toString()));
      req.on('end', () => {
        res(b ? (JSON.parse(b) as Record<string, unknown>) : {});
      });
    });
  const server = createServer((req, res) => {
    void (async () => {
      const u = new URL(req.url ?? '', 'http://x');
      const gitea = u.pathname.startsWith('/api/v1/');
      const path = u.pathname.replace(/^\/api\/v1/, '').replace(/^\/repos\/acme\/shop/, '');
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      };
      const auth = req.headers.authorization ?? '';
      if (auth !== (gitea ? 'token ' : 'Bearer ') + TOKEN) {
        send(401, { message: 'Bad credentials' });
        return;
      }
      calls.push((req.method ?? '') + ' ' + path);
      const body = await read(req);
      const file = /^\/contents\/(.+)$/.exec(path)?.[1];
      if (req.method === 'GET' && path === '') send(200, { default_branch: 'main' });
      else if (req.method === 'GET' && file) {
        const text = branches
          .get(u.searchParams.get('ref') ?? 'main')
          ?.get(decodeURIComponent(file));
        if (text === undefined) send(404, { message: 'Not Found' });
        else send(200, { sha: 'sha-' + file, content: Buffer.from(text).toString('base64') });
      } else if (req.method === 'GET' && path === '/git/ref/heads/main')
        send(200, { object: { sha: 'abc123' } });
      else if (req.method === 'POST' && (path === '/git/refs' || path === '/branches')) {
        const given = body['new_branch_name'] ?? body['ref'];
        const name = (typeof given === 'string' ? given : '').replace('refs/heads/', '');
        branches.set(name, new Map(branches.get('main')));
        send(201, {});
      } else if ((req.method === 'PUT' || req.method === 'POST') && file) {
        const b = branches.get(String(body['branch']));
        b?.set(
          decodeURIComponent(file),
          Buffer.from(String(body['content']), 'base64').toString('utf8'),
        );
        send(req.method === 'POST' ? 201 : 200, {});
      } else if (req.method === 'POST' && path === '/pulls') {
        pulls.push(body as (typeof pulls)[number]);
        send(201, {
          number: pulls.length,
          html_url: 'https://host.test/acme/shop/pull/' + String(pulls.length),
        });
      } else send(404, { message: 'Not Found' });
    })();
  });
  return { server, branches, calls, pulls };
}

describe.skipIf(!hasDatabase)('token export as a pull request (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bo: Person;
  let project = '';
  let host: ReturnType<typeof fakeHost>;
  let url = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  type Conn = { id: string; canWrite: boolean; apiUrl: string | null };
  type Answer = {
    unchanged: boolean;
    export: { pullNumber: number; pullUrl: string; files: string[]; branch: string } | null;
  };

  beforeAll(async () => {
    host = fakeHost();
    await listenFetchable(host.server); // [PCODE-365 | S15 | v0.1.0]
    url = 'http://127.0.0.1:' + String((host.server.address() as AddressInfo).port);
    t = await startTestApp();
    ada = await t.signup('Ada');
    bo = await t.signup('Bo');
    await t.call(ada, 'POST', W('/members'), { email: bo.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    await t.call(ada, 'PUT', P('/tokens/color.primary'), {
      type: 'color',
      valueLight: '#4f46e5',
      valueDark: '#818cf8',
    });
    await t.call(ada, 'PUT', P('/tokens/space.4'), { type: 'dimension', valueLight: '16px' });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    await new Promise((r) => host.server.close(r));
  });

  const connect = async (provider: 'github' | 'gitea', apiUrl: string): Promise<string> => {
    const c = await t.call<{ connection: Conn }>(ada, 'POST', P('/git'), {
      provider,
      repo: 'acme/shop',
    });
    const id = c.body.connection.id;
    const set = await t.call<Conn>(ada, 'PUT', W('/git/' + id + '/api'), { token: TOKEN, apiUrl });
    expect(set.body).toMatchObject({ canWrite: true, apiUrl });
    expect(JSON.stringify(set.body)).not.toContain(TOKEN);
    return id;
  };

  it('keeps the token for admins only, sealed, and only plain http to this machine', async () => {
    const c = await t.call<{ connection: Conn }>(ada, 'POST', P('/git'), {
      provider: 'github',
      repo: 'acme/other',
    });
    const id = c.body.connection.id;
    expect((await t.call(bo, 'PUT', W('/git/' + id + '/api'), { token: TOKEN })).status).toBe(403);
    expect(
      (
        await t.call(ada, 'PUT', W('/git/' + id + '/api'), {
          token: TOKEN,
          apiUrl: 'http://example.com',
        })
      ).status,
    ).toBe(400);
    await t.call(ada, 'PUT', W('/git/' + id + '/api'), { token: TOKEN });
    const stored = await inSystem(t.db.pool, (c) =>
      c.query<{ api_token: string }>('SELECT api_token FROM git_connections WHERE id = $1', [id]),
    );
    expect(stored.rows[0]?.api_token).toMatch(/^v1\./);
    expect(stored.rows[0]?.api_token).not.toContain(TOKEN);
    const list = await t.call<Conn[]>(ada, 'GET', P('/git'));
    expect(list.body.find((x) => x.id === id)?.canWrite).toBe(true);
    await t.call(ada, 'DELETE', W('/git/' + id));
  });

  it('opens a GitHub pull request with only the files that changed', async () => {
    const id = await connect('github', url);
    const r = await t.call<Answer>(bo, 'POST', P('/tokens/pull-request'), {
      connectionId: id,
      formats: ['css', 'w3c', 'android'],
    });
    expect(r.status).toBe(201);
    expect(r.body.export).toMatchObject({
      pullNumber: 1,
      pullUrl: 'https://host.test/acme/shop/pull/1',
    });
    expect(r.body.export?.files).toEqual([
      'design-tokens/tokens.css',
      'design-tokens/tokens.json',
      'design-tokens/android/res/values/tokens.xml',
      'design-tokens/android/res/values-night/tokens.xml',
    ]);
    const branch = host.branches.get(r.body.export?.branch ?? '');
    expect(branch?.get('design-tokens/tokens.css')).toContain('--color-primary: #4f46e5;');
    expect(host.pulls[0]).toMatchObject({
      base: 'main',
      title: 'Design tokens from Orqiva (SHOP)',
    });
    expect(host.pulls[0]?.body).toContain('- `design-tokens/tokens.css`');
    expect(host.calls).toContain('POST /git/refs');

    // the same tokens again, against main that now holds them: nothing to open
    for (const [k, v] of branch ?? []) host.branches.get('main')?.set(k, v);
    const again = await t.call<Answer>(bo, 'POST', P('/tokens/pull-request'), {
      connectionId: id,
      formats: ['css'],
    });
    expect(again.body).toEqual({ unchanged: true, export: null });
    const listed = await t.call<{ pullUrl: string; by: string }[]>(
      ada,
      'GET',
      P('/tokens/pull-requests'),
    );
    expect(listed.body).toEqual([
      expect.objectContaining({ pullUrl: 'https://host.test/acme/shop/pull/1', by: 'Bo' }),
    ]);
    await t.call(ada, 'DELETE', W('/git/' + id));
  });

  it('uses Gitea’s own calls, and says when the host refuses the token', async () => {
    const id = await connect('gitea', url + '/api/v1');
    host.calls.length = 0;
    const r = await t.call<Answer>(ada, 'POST', P('/tokens/pull-request'), {
      connectionId: id,
      formats: ['ios'],
      folder: 'mobile/tokens',
    });
    expect(r.status).toBe(201);
    expect(host.calls).toContain('POST /branches');
    expect(host.calls).toContain('POST /contents/mobile/tokens/ios/Tokens.swift');
    await t.call(ada, 'PUT', W('/git/' + id + '/api'), {
      token: 'wrong-token-x',
      apiUrl: url + '/api/v1',
    });
    const refused = await t.call<{ error: { message: string } }>(
      ada,
      'POST',
      P('/tokens/pull-request'),
      {
        connectionId: id,
        formats: ['ts'],
      },
    );
    expect(refused.status).toBe(502);
    expect(refused.body.error.message).toBe('The host refused the token: Bad credentials');
    await t.call(ada, 'PUT', W('/git/' + id + '/api'), { token: null });
    expect(
      (await t.call(ada, 'POST', P('/tokens/pull-request'), { connectionId: id, formats: ['ts'] }))
        .status,
    ).toBe(409);
  });
});
