// ── [PCODE-300 | S15 | v0.1.0] T31.2a Git history from the webhooks: commits, branches, tags; close on merge; revert detection ──
//    Why:  the history kept from real-shaped deliveries: every commit with its files, branches and tags that
//          follow pushes and deletions, the default branch; closing words close tasks only once merged into
//          the default branch; a revert there marks the reverted commit and its task.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { sign } from '../../src/git/webhook.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const sha = (c: string): string => c.repeat(40);
const ZERO = '0'.repeat(40);

describe.skipIf(!hasDatabase)('Git history from the webhooks (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  const items: Record<number, string> = {};
  const conn = { id: '', path: '', secret: '' };
  const lab = { path: '', secret: '' };
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
  const push = (
    ref: string,
    commits: { id: string; message: string; added?: string[] }[],
    after?: string,
  ) =>
    github('push', {
      ref,
      after: after ?? commits.at(-1)?.id ?? ZERO,
      commits: commits.map((c) => ({
        ...c,
        url: 'https://github.com/acme/shop/commit/' + c.id,
        timestamp: '2026-10-12T10:00:00Z',
        author: { name: 'Ada', username: 'ada' },
        added: c.added ?? [],
        modified: [],
        removed: [],
      })),
    });
  const pr = (number: number, body: string, base: string) =>
    github('pull_request', {
      action: 'closed',
      pull_request: {
        number,
        title: 'Work ' + String(number),
        body,
        state: 'closed',
        merged: true,
        head: { ref: 'feature/' + String(number), sha: sha('e') },
        base: { ref: base },
        html_url: 'https://github.com/acme/shop/pull/' + String(number),
        user: { login: 'ada' },
      },
    });
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  const stateOf = async (n: number): Promise<string> =>
    (
      await sys<{ grp: string }>(
        'SELECT st.grp FROM items i JOIN project_states st ON st.id = i.state_id WHERE i.id = $1',
        [items[n]],
      )
    )[0]?.grp ?? '';

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    for (const n of [1, 2, 3])
      items[n] = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
          title: 'Item ' + String(n),
        })
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
    const g = await t.call<{ connection: { webhookPath: string }; secret: string }>(
      ada,
      'POST',
      W('/projects/' + project + '/git'),
      { provider: 'gitlab', repo: 'acme/web/shop' },
    );
    Object.assign(lab, { path: g.body.connection.webhookPath, secret: g.body.secret });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps every commit with its files, and branches and tags as they move', async () => {
    await push('refs/heads/feature/cart', [
      { id: sha('a'), message: 'SHOP-1 Cart keeps items', added: ['src/cart.ts'] },
      { id: sha('b'), message: 'Tidy the styles' }, // names no task: kept all the same
    ]);
    const commits = await sys<{ sha: string; branch: string; files: { added: string[] } | null }>(
      'SELECT sha, branch, files FROM git_commits WHERE connection_id = $1 ORDER BY sha',
      [conn.id],
    );
    expect(commits.map((c) => [c.sha[0], c.branch, c.files?.added])).toEqual([
      ['a', 'feature/cart', ['src/cart.ts']],
      ['b', 'feature/cart', []],
    ]);
    await github('create', { ref: 'v1.0.0', ref_type: 'tag' });
    await github('push', { ref: 'refs/tags/v1.0.0', after: sha('b'), commits: [] });
    await push('refs/heads/feature/old', [], sha('c'));
    await github('push', {
      ref: 'refs/heads/feature/old',
      after: ZERO,
      deleted: true,
      commits: [],
    });
    const refs = await sys<{ kind: string; name: string; sha: string }>(
      'SELECT kind, name, sha FROM git_refs WHERE connection_id = $1 ORDER BY kind, name',
      [conn.id],
    );
    expect(refs.map((r) => r.kind + ' ' + r.name + ' ' + r.sha.slice(0, 1))).toEqual([
      'branch feature/cart b',
      'tag v1.0.0 b',
    ]);
    const def = await sys<{ default_branch: string }>(
      'SELECT default_branch FROM git_connections WHERE id = $1',
      [conn.id],
    );
    expect(def[0]?.default_branch).toBe('main');
  });

  it('closes tasks when the closing words are merged into the default branch', async () => {
    await pr(5, 'Closes SHOP-1. Also touches SHOP-3.', 'develop'); // not the default branch
    expect(await stateOf(1)).not.toBe('completed');
    await pr(6, 'Closes SHOP-1. Also touches SHOP-3.', 'main');
    expect(await stateOf(1)).toBe('completed');
    expect(await stateOf(3)).not.toBe('completed'); // named, not closed
    await push('refs/heads/main', [
      { id: sha('c'), message: 'Fixes SHOP-2: totals round to cents' },
    ]);
    expect(await stateOf(2)).toBe('completed');
    const moved = await sys<{ changes: { closedBy?: { to: string } } }>(
      "SELECT envelope->'data'->'changes' AS changes FROM activity_events WHERE object_id = $1 AND envelope->'data'->'changes' ? 'closedBy' ORDER BY sequence DESC LIMIT 1",
      [items[1]],
    );
    expect(moved[0]?.changes.closedBy?.to).toBe('pull request #6 merged');
  });

  it('marks a reverted commit and the task it served', async () => {
    await push('refs/heads/main', [
      {
        id: sha('d'),
        message: 'Revert "SHOP-1 Cart keeps items"\n\nThis reverts commit ' + sha('a') + '.',
      },
    ]);
    const links = await sys<{ ref: string; state: string }>(
      "SELECT ref, state FROM item_git_links WHERE item_id = $1 AND kind = 'commit' ORDER BY ref",
      [items[1]],
    );
    expect(links.find((l) => l.ref === sha('a'))?.state).toBe('reverted');
    const c = await sys<{ reverted_by: string }>(
      'SELECT reverted_by FROM git_commits WHERE connection_id = $1 AND sha = $2',
      [conn.id, sha('a')],
    );
    expect(c[0]?.reverted_by).toBe(sha('d'));
    const ev = await sys<{ changes: { reverted?: { from: string; to: string } } }>(
      "SELECT envelope->'data'->'changes' AS changes FROM activity_events WHERE object_id = $1 AND envelope->'data'->'changes' ? 'reverted'",
      [items[1]],
    );
    expect(ev[0]?.changes.reverted).toEqual({
      from: 'aaaaaaa SHOP-1 Cart keeps items',
      to: 'ddddddd',
    });
  });

  it('keeps GitLab tags and deletions the same way', async () => {
    const send = (payload: unknown, event: string) =>
      fetch(t.base + lab.path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-gitlab-event': event,
          'x-gitlab-token': lab.secret,
        },
        body: JSON.stringify(payload),
      });
    const project = { path_with_namespace: 'acme/web/shop', default_branch: 'trunk' };
    expect(
      (
        await send(
          {
            object_kind: 'tag_push',
            ref: 'refs/tags/v2.0.0',
            before: ZERO,
            after: sha('f'),
            project,
          },
          'Tag Push Hook',
        )
      ).status,
    ).toBe(200);
    const tags = await sys<{ name: string; sha: string }>(
      "SELECT r.name, r.sha FROM git_refs r JOIN git_connections g ON g.id = r.connection_id WHERE g.provider = 'gitlab' AND r.kind = 'tag'",
    );
    expect(tags).toEqual([{ name: 'v2.0.0', sha: sha('f') }]);
    expect(
      (
        await send(
          {
            object_kind: 'tag_push',
            ref: 'refs/tags/v2.0.0',
            before: sha('f'),
            after: ZERO,
            project,
          },
          'Tag Push Hook',
        )
      ).status,
    ).toBe(200);
    expect(
      await sys(
        "SELECT 1 FROM git_refs r JOIN git_connections g ON g.id = r.connection_id WHERE g.provider = 'gitlab'",
      ),
    ).toEqual([]);
    const def = await sys<{ default_branch: string }>(
      "SELECT default_branch FROM git_connections WHERE provider = 'gitlab'",
    );
    expect(def[0]?.default_branch).toBe('trunk');
  });
});
