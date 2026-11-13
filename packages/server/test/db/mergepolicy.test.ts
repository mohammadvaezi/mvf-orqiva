// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-304 | S15 | v0.1.0] T31.5a Conflicts, stacked pull requests, and merge policies the host enforces through a commit status ──
//    Why:  an admin's merge policy is checked rule by rule; each host (recorded answers of GitHub, Gitea,
//          GitLab and Azure DevOps) is asked whether the pull request merges cleanly and gets the verdict as
//          the commit status orqiva/policy, once per verdict; a webhook that changes the pull request posts
//          the new verdict; our own status never counts as a check; stacked pull requests know their place.
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { azureMergeState, gitlabMergeState } from '../../src/git/hosts.js';
import { sign } from '../../src/git/webhook.js';
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
      readFileSync(new URL('../fixtures/prstatus/' + h + '.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>,
  ]),
);

interface Sent {
  host: string;
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}
interface Verdict {
  state: string;
  description: string;
  rules: { key: string; state: string; why: string }[];
  mergeable: string;
  stack: { parent: number | null; parentMerged: number | null; children: number[]; depth: number };
  posted: { state: string } | null;
  error: string;
}

const POLICY = {
  requireTask: true,
  requireFingerprints: false,
  requireApproval: true,
  requireChecks: true,
  requireSensitiveApproval: false,
  blockConflicts: true,
  postStatus: true,
};

describe('host merge states', () => {
  it('reads GitLab’s and Azure DevOps’ words into GitHub’s', () => {
    expect(gitlabMergeState({ detailed_merge_status: 'conflict' })).toBe('dirty');
    expect(gitlabMergeState({ detailed_merge_status: 'need_rebase' })).toBe('behind');
    expect(gitlabMergeState({ detailed_merge_status: 'not_approved' })).toBe('blocked');
    expect(gitlabMergeState({ merge_status: 'cannot_be_merged' })).toBe('dirty');
    expect(gitlabMergeState({ detailed_merge_status: 'checking' })).toBe('');
    expect(azureMergeState({ mergeStatus: 'conflicts' })).toBe('dirty');
    expect(azureMergeState({ mergeStatus: 'queued' })).toBe('');
  });
});

describe.skipIf(!hasDatabase)('merge policies, conflicts and stacks (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let host: Server;
  let project = '';
  const sent: Sent[] = [];
  const pulls: Record<string, string> = {};
  const hook = { path: '', secret: '' };
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  const verdict = (id: string) =>
    t.call<Verdict>(ada, 'GET', W('/pull-requests/' + id + '/policy'));
  const check = (id: string) =>
    t.call<Verdict>(ada, 'POST', W('/pull-requests/' + id + '/policy/check'));
  const statuses = () => sent.filter((x) => x.method === 'POST');
  const github = async (event: string, payload: Record<string, unknown>) => {
    const body = Buffer.from(
      JSON.stringify({ repository: { full_name: 'acme/shop' }, ...payload }),
    );
    const res = await fetch(t.base + hook.path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': event,
        'x-hub-signature-256': 'sha256=' + sign(hook.secret, body),
      },
      body,
    });
    expect(res.status).toBe(200);
  };
  /** the verdict is posted after the webhook is answered */
  const settle = async (count: number): Promise<void> => {
    for (let i = 0; i < 50 && statuses().length < count; i++)
      await new Promise((r) => setTimeout(r, 50));
  };

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
        const body = book[name]?.[method + ' ' + raw];
        res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'application/json' });
        res.end(body === undefined ? '{"message":"Not Found"}' : JSON.stringify(body));
      });
    });
    await listenFetchable(host); // [PCODE-365 | S15 | v0.1.0]
    const base = 'http://127.0.0.1:' + String((host.address() as AddressInfo).port);

    t = await startTestApp();
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
      const r = await t.call<{ connection: { id: string; webhookPath: string }; secret: string }>(
        ada,
        'POST',
        W('/projects/' + project + '/git'),
        { provider: h, repo: REPO[h] },
      );
      const conn = r.body.connection.id;
      if (h === 'github') {
        hook.path = r.body.connection.webhookPath;
        hook.secret = r.body.secret;
        pulls['conn'] = conn;
      }
      await t.call(ada, 'PUT', W('/git/' + conn + '/api'), {
        token: TOKEN,
        apiUrl: base + '/' + h,
      });
      pulls[h] =
        (
          await sys<{ id: string }>(
            `INSERT INTO pull_requests (workspace_id, project_id, connection_id, number, title, branch, base, head_sha,
                                        checks_state, item_id, opened_at, updated_at)
             VALUES ($1, $2, $3, 7, 'SHOP-1 Cart keeps items', 'feature/cart', 'main', $4, 'passing', $5, now(), now())
             RETURNING id`,
            [ada.workspaceId, project, conn, HEAD, item],
          )
        )[0]?.id ?? '';
    }
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    host.close();
  });

  it('lets admins set the policy', async () => {
    const none = await t.call(ada, 'GET', W('/projects/' + project + '/merge-policy'));
    expect(none.body).toMatchObject({ requireTask: false, postStatus: false, updatedAt: null });
    expect(
      (await t.call(bob, 'PUT', W('/projects/' + project + '/merge-policy'), POLICY)).status,
    ).toBe(403);
    const set = await t.call(ada, 'PUT', W('/projects/' + project + '/merge-policy'), POLICY);
    expect(set.body).toMatchObject(POLICY);
  });

  it('says rule by rule what is missing', async () => {
    const r = await verdict(pulls['github'] ?? '');
    expect(r.body.rules.map((x) => [x.key, x.state])).toEqual([
      ['requireTask', 'met'],
      ['requireApproval', 'failing'],
      ['requireChecks', 'met'],
      ['blockConflicts', 'pending'],
    ]);
    expect(r.body).toMatchObject({
      state: 'failure',
      description: 'Not met: not approved. Waiting: not known yet whether it merges cleanly',
      mergeable: 'unknown',
      posted: null,
    });
  });

  it.each(HOSTS)('asks %s whether it merges cleanly and posts the verdict', async (h) => {
    const from = sent.length;
    const r = await check(pulls[h] ?? '');
    expect(r.status).toBe(200);
    const calls = sent.slice(from);
    expect(calls.map((x) => x.method)).toEqual(['GET', 'POST']);
    const body = calls[1]?.body ?? {};
    const expected = {
      github: ['conflicts', 'Not met: not approved; has conflicts'],
      gitea: ['clean', 'Not met: not approved'],
      gitlab: ['behind', 'Not met: not approved'],
      azure: ['clean', 'Not met: not approved'],
    }[h];
    expect(r.body.mergeable).toBe(expected[0]);
    expect(body['description']).toBe(expected[1]);
    if (h === 'github' || h === 'gitea')
      expect(body).toMatchObject({ state: 'failure', context: 'orqiva/policy' });
    else if (h === 'gitlab') expect(body).toMatchObject({ state: 'failed', name: 'orqiva/policy' });
    else
      expect(body).toMatchObject({
        state: 'failed',
        context: { genre: 'orqiva', name: 'policy' },
      });
    expect(calls[1]?.path).toBe(
      {
        github: '/repos/acme/shop/statuses/' + HEAD,
        gitea: '/repos/acme/shop/statuses/' + HEAD,
        gitlab: '/projects/acme%2Fweb%2Fshop/statuses/' + HEAD,
        azure: '/contoso/Shop/_apis/git/repositories/shop-web/pullRequests/7/statuses',
      }[h],
    );
    expect(r.body.posted?.state).toBe('failure');

    // the same verdict on the same commit is not posted again
    const again = sent.length;
    await check(pulls[h] ?? '');
    expect(sent.slice(again).map((x) => x.method)).toEqual(['GET']);
  });

  it('posts the new verdict when a webhook changes the pull request', async () => {
    const before = statuses().length;
    await github('pull_request_review', {
      action: 'submitted',
      review: { state: 'approved' },
      pull_request: {
        number: 7,
        title: 'SHOP-1 Cart keeps items',
        state: 'open',
        head: { ref: 'feature/cart', sha: HEAD },
        base: { ref: 'main' },
      },
    });
    await settle(before + 1);
    expect(
      statuses()
        .slice(before)
        .map((x) => x.body?.['description']),
    ).toEqual(['Not met: has conflicts']);

    // our own status coming back is not a check of the pull request
    await github('status', { sha: HEAD, state: 'failure', context: 'orqiva/policy' });
    const kept = await sys<{ checks_state: string }>(
      'SELECT checks_state FROM pull_requests WHERE id = $1',
      [pulls['github']],
    );
    expect(kept[0]?.checks_state).toBe('passing');
    expect(statuses()).toHaveLength(before + 1);

    // a failing CI is, and its verdict is posted
    await github('status', { sha: HEAD, state: 'failure', context: 'ci/build' });
    await settle(before + 2);
    expect(statuses()[before + 1]?.body?.['description']).toBe(
      'Not met: checks fail; has conflicts',
    );
  });

  it('knows stacked pull requests and a merged base', async () => {
    const child =
      (
        await sys<{ id: string }>(
          `INSERT INTO pull_requests (workspace_id, project_id, connection_id, number, title, branch, base, opened_at, updated_at)
           VALUES ($1, $2, $3, 8, 'SHOP-1 Cart totals', 'feature/totals', 'feature/cart', now(), now()) RETURNING id`,
          [ada.workspaceId, project, pulls['conn']],
        )
      )[0]?.id ?? '';
    expect((await verdict(child)).body.stack).toEqual({
      parent: 7,
      parentMerged: null,
      children: [],
      depth: 1,
    });
    expect((await verdict(pulls['github'] ?? '')).body.stack.children).toEqual([8]);
    const queue = await t.call<
      {
        number: number;
        stackedOn: number | null;
        mergeable: string;
        repo: string;
        risk: { reasons: string[] };
        policy: { state: string } | null;
      }[]
    >(ada, 'GET', W('/projects/' + project + '/review-queue'));
    const gh = queue.body.filter((q) => q.repo === 'acme/shop' && q.mergeable !== 'clean');
    expect(gh.map((q) => [q.number, q.stackedOn, q.mergeable])).toEqual(
      expect.arrayContaining([
        [7, null, 'conflicts'],
        [8, 7, 'unknown'],
      ]),
    );
    expect(gh.find((q) => q.number === 7)?.risk.reasons).toContain('conflicts');
    expect(gh.find((q) => q.number === 7)?.policy?.state).toBe('failure');

    await sys("UPDATE pull_requests SET state = 'merged', merged_at = now() WHERE id = $1", [
      pulls['github'],
    ]);
    expect((await verdict(child)).body.stack).toMatchObject({ parent: null, parentMerged: 7 });
  });
});
