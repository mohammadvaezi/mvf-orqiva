// ── [PCODE-299 | S15 | v0.1.0] T31.1 GitLab and Azure Repos: webhooks, secrets, setup, read into one shape ──
//    Why:  recorded deliveries of GitLab and Azure DevOps against the real server: believed only with the
//          connection's secret, for its repository; pushes, new branches, merge and pull requests with drafts,
//          approvals and votes, pipelines and builds read into the shape the other hosts have, so tasks are
//          linked and pull requests listed the same way. An Azure build is trusted once the repository's id
//          is known from a push or pull request.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  azureRepoName,
  azureVerdict,
  isoTime,
  normalize,
  repoProblem,
} from '../../src/git/hosts.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL('../fixtures/git/' + name, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;

describe('reading GitLab and Azure deliveries', () => {
  it('reads names, times and verdicts', () => {
    expect(repoProblem('gitlab', 'acme/web/shop')).toBeNull();
    expect(repoProblem('gitlab', 'shop')).not.toBeNull();
    expect(repoProblem('azure', 'contoso/Shop App/shop-web')).toBeNull();
    expect(repoProblem('azure', 'contoso/shop')).not.toBeNull();
    expect(repoProblem('github', 'acme/web/shop')).not.toBeNull();
    expect(isoTime('2026-10-12 07:20:00 UTC')).toBe('2026-10-12T07:20:00.000Z');
    expect(isoTime('2026-10-12T09:15:31+02:00')).toBe('2026-10-12T07:15:31.000Z');
    expect(azureRepoName('https://contoso@dev.azure.com/contoso/Shop%20App/_git/shop-web')).toBe(
      'contoso/Shop App/shop-web',
    );
    expect(azureRepoName('https://contoso.visualstudio.com/Shop/_git/shop-web')).toBe(
      'contoso/Shop/shop-web',
    );
    expect(azureVerdict([{ vote: 10 }, { vote: -5 }])).toBe('approved');
    expect(azureVerdict([{ vote: 10 }, { vote: -10 }])).toBe('changes_requested');
    expect(azureVerdict([{ vote: 0 }])).toBeNull();
  });

  it('turns a new GitLab branch into a create and a push, a draft merge request into a pull request', () => {
    const push = normalize('gitlab', 'Push Hook', fixture('gitlab-push.json'));
    expect(push.map((d) => d.event)).toEqual(['create', 'push']);
    expect(push[0]?.payload).toMatchObject({ ref: 'feature/shop-1-cart', ref_type: 'branch' });
    const mr = normalize('gitlab', 'Merge Request Hook', fixture('gitlab-merge-request.json'));
    expect(mr[0]?.payload['pull_request']).toMatchObject({
      number: 42,
      state: 'open',
      merged: false,
      draft: true,
      head: { ref: 'feature/shop-1-cart' },
      created_at: '2026-10-12T07:20:00.000Z',
    });
  });
});

describe.skipIf(!hasDatabase)('GitLab and Azure Repos webhooks (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  const items: Record<number, string> = {};
  const conns: Record<string, { path: string; secret: string }> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;

  const send = async (
    provider: 'gitlab' | 'azure',
    payload: unknown,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const res = await fetch(t.base + (conns[provider]?.path ?? ''), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const gitlab = (event: string, payload: unknown, token = conns['gitlab']?.secret ?? '') =>
    send('gitlab', payload, { 'x-gitlab-event': event, 'x-gitlab-token': token });
  const azure = (payload: unknown, secret = conns['azure']?.secret ?? '', basic = false) =>
    send(
      'azure',
      payload,
      basic
        ? { authorization: 'Basic ' + Buffer.from('orqiva:' + secret).toString('base64') }
        : { 'x-orqiva-secret': secret },
    );

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    for (const n of [1, 2])
      items[n] = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
          title: 'Item ' + String(n),
        })
      ).body.id;
    for (const [provider, repo] of [
      ['gitlab', 'acme/web/shop'],
      ['azure', 'contoso/Shop/shop-web'],
    ] as const) {
      const r = await t.call<{ connection: { webhookPath: string }; secret: string }>(
        ada,
        'POST',
        W('/projects/' + project + '/git'),
        { provider, repo },
      );
      expect(r.status).toBe(201);
      conns[provider] = { path: r.body.connection.webhookPath, secret: r.body.secret };
    }
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('refuses a wrong repository name for the host', async () => {
    const r = await t.call(ada, 'POST', W('/projects/' + project + '/git'), {
      provider: 'azure',
      repo: 'contoso/shop',
    });
    expect(r.status).toBe(400);
  });

  it('believes GitLab with its secret token and links pushes, merge requests and pipelines', async () => {
    expect((await gitlab('Push Hook', fixture('gitlab-push.json'), 'wrong-token')).status).toBe(
      401,
    );
    const other = {
      ...fixture('gitlab-push.json'),
      project: { path_with_namespace: 'acme/other' },
    };
    expect((await gitlab('Push Hook', other)).status).toBe(400);
    const push = await gitlab('Push Hook', fixture('gitlab-push.json'));
    expect(push.status).toBe(200);
    expect(push.body['linked']).toBeGreaterThanOrEqual(1);
    expect((await gitlab('Merge Request Hook', fixture('gitlab-merge-request.json'))).status).toBe(
      200,
    );
    expect((await gitlab('Pipeline Hook', fixture('gitlab-pipeline.json'))).status).toBe(200);
    // an approval: a review of the same merge request
    const approved = fixture('gitlab-merge-request.json');
    const attrs = approved['object_attributes'] as Record<string, unknown>;
    approved['object_attributes'] = {
      ...attrs,
      action: 'approved',
      draft: false,
      work_in_progress: false,
    };
    expect((await gitlab('Merge Request Hook', approved)).status).toBe(200);

    const links = (
      await t.call<{ kind: string; ref: string; provider: string }[]>(
        ada,
        'GET',
        W('/items/' + (items[1] ?? '') + '/git'),
      )
    ).body;
    expect(links.map((l) => l.kind + ':' + l.ref + ':' + l.provider).sort()).toEqual([
      'commit:c5feabde2d8cd023215af4d2ceeb7a64839fc428:gitlab',
      'pull_request:42:gitlab',
    ]);
    const prs = (
      await t.call<
        {
          number: number;
          repo: string;
          draft: boolean;
          reviewState: string;
          checksState: string;
          itemRef: string;
          url: string;
        }[]
      >(ada, 'GET', W('/projects/' + project + '/pull-requests?state=all'))
    ).body;
    expect(prs.find((p) => p.repo === 'acme/web/shop')).toMatchObject({
      number: 42,
      draft: false,
      reviewState: 'approved',
      checksState: 'failing',
      itemRef: 'SHOP-1',
      url: 'https://gitlab.example.com/acme/web/shop/-/merge_requests/42',
    });
  });

  it('believes Azure with its secret (header or basic authentication) and learns the repository for builds', async () => {
    expect((await azure(fixture('azure-push.json'), 'wrong-secret')).status).toBe(401);
    // a build before the repository is known cannot be told apart from another repository's
    expect((await azure(fixture('azure-build.json'))).status).toBe(400);
    expect((await azure(fixture('azure-push.json'), undefined, true)).status).toBe(200);
    // the pull request opens, its build passes, then it is completed (merged)
    const merged = fixture('azure-pull-request.json');
    const opened = {
      ...merged,
      eventType: 'git.pullrequest.created',
      resource: {
        ...(merged['resource'] as Record<string, unknown>),
        status: 'active',
        reviewers: [],
      },
    };
    expect((await azure(opened)).status).toBe(200);
    expect((await azure(fixture('azure-build.json'))).status).toBe(200);
    expect((await azure(merged)).status).toBe(200);
    const prs = (
      await t.call<
        {
          number: number;
          repo: string;
          state: string;
          reviewState: string;
          checksState: string;
          itemRef: string;
          url: string;
          branch: string;
        }[]
      >(ada, 'GET', W('/projects/' + project + '/pull-requests?state=all'))
    ).body;
    expect(prs.find((p) => p.repo === 'contoso/Shop/shop-web')).toMatchObject({
      number: 7,
      state: 'merged',
      branch: 'feature/shop-2-checkout',
      reviewState: 'approved',
      checksState: 'passing',
      itemRef: 'SHOP-2',
      url: 'https://dev.azure.com/contoso/Shop/_git/shop-web/pullrequest/7',
    });
    const links = (
      await t.call<{ kind: string; url: string }[]>(
        ada,
        'GET',
        W('/items/' + (items[2] ?? '') + '/git'),
      )
    ).body;
    expect(links.find((l) => l.kind === 'commit')?.url).toBe(
      'https://dev.azure.com/contoso/Shop/_git/shop-web/commit/33b55f7cb7e7e245323987634f960cf4a6e6bc74',
    );
  });
});
