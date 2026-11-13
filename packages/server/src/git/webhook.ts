// ── [PCODE-325 | S15 | v0.1.0] T32.8b Leak scans of commits, traces and logs ──
// ── [PCODE-304 | S15 | v0.1.0] T31.5a Conflicts, stacked pull requests, and merge policies the host enforces through a commit status ──
// ── [PCODE-301 | S15 | v0.1.0] T31.2b Git history backfill through the hosts' APIs; branches and tags in the Repositories screen ──
// ── [PCODE-300 | S15 | v0.1.0] T31.2a Git history from the webhooks: commits, branches, tags; close on merge; revert detection ──
// ── [PCODE-299 | S15 | v0.1.0] T31.1 GitLab and Azure Repos: webhooks, secrets, setup, read into one shape ──
// ── [PCODE-255 | S15 | v0.1.0] T26.4 Planning details: keys, bulk edit, undo, shared views, item history, Git moves, bug SLAs ──
// ── [PCODE-246 | S15 | v0.1.0] T25.1 Agent triggers act: assignment, label, mention, CI failure, schedule, webhook ──
// ── [PCODE-175 | S15 | v0.1.0] B4.1 Test and Versions on the server: suites, steps, configs, evidence, flaky, Playwright, pull requests, releases, notes, flags, DORA ──
// ── [PCODE-108 | S15 | v0.1.0] Integrate Git hosts: GitHub and Gitea webhooks, commits and PRs on items, live ──
//    Why:  the Git host tells us about pushes and pull requests; we never poll it and need no token of
//          it. A delivery is believed only with a valid HMAC-SHA256 signature over the exact bytes received
//          (compared in constant time), for the repository the connection names. Every task reference of the
//          project in a commit message, a PR title or its branch links that commit or PR to the item, and a
//          new link (or a PR that changed state) records one event, so open screens show it within moments.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool, PoolClient } from 'pg';
import { inSystem, inWorkspace } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { recordPulls } from './pulls.js';
import { gitMove } from '../api/details.js'; // [PCODE-255 | S15 | v0.1.0]
// [PCODE-299 | S15 | v0.1.0] four hosts: GitLab's and Azure's deliveries are read into GitHub's shape
import {
  HOST_NAME,
  eventOf,
  normalize,
  tokenValid,
  type Delivery,
  type Provider,
} from './hosts.js';
import { closeOnMerge, markReverts, recordHistory } from './history.js'; // [PCODE-300 | S15 | v0.1.0]
import { scanForLeaks } from '../security/leaks.js'; // [PCODE-325 | S15 | v0.1.0]

export type { Provider };
const MAX_BODY = 10 * 1024 * 1024;

export interface GitChange {
  // [PCODE-255 | S15 | v0.1.0] a new branch moves its tasks too
  kind: 'commit' | 'pull_request' | 'branch';
  ref: string;
  title: string;
  url: string;
  author: string;
  state: string;
  at: string;
  /** every text that may name a task: message, title, branch */
  text: string;
}

export function sign(secret: string, body: Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** The signature header as the host sends it: GitHub prefixes "sha256=", Gitea does not. */
export function signatureValid(
  provider: Provider,
  secret: string,
  body: Buffer,
  headers: IncomingMessage['headers'],
): boolean {
  // [PCODE-299 | S15 | v0.1.0] GitLab and Azure prove themselves with the secret itself
  if (provider === 'gitlab' || provider === 'azure') return tokenValid(provider, secret, headers);
  const raw = provider === 'github' ? headers['x-hub-signature-256'] : headers['x-gitea-signature'];
  const given = String(Array.isArray(raw) ? raw[0] : (raw ?? '')).replace(/^sha256=/, '');
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const want = Buffer.from(sign(secret, body), 'hex');
  return timingSafeEqual(want, Buffer.from(given.toLowerCase(), 'hex'));
}

export function eventName(provider: Provider, headers: IncomingMessage['headers']): string {
  const raw = provider === 'github' ? headers['x-github-event'] : headers['x-gitea-event'];
  return String(Array.isArray(raw) ? raw[0] : (raw ?? ''));
}

/** The task numbers of `key` a text names: "PCODE-12 fix", "pcode-12-branch" → [12]. */
export function taskNumbers(key: string, text: string): number[] {
  const re = new RegExp('(?:^|[^A-Za-z0-9])' + key + '-(\\d{1,9})(?![A-Za-z0-9])', 'gi');
  const out = new Set<number>();
  for (const m of text.matchAll(re)) out.add(Number(m[1]));
  return [...out];
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** The repository a payload is about, "owner/name". */
export const repoOf = (payload: unknown): string =>
  str(obj(obj(payload)['repository'])['full_name']);

/** What a push or pull request delivery says, in one shape for both hosts. */
export function changesOf(event: string, payload: unknown): GitChange[] {
  const p = obj(payload);
  // [PCODE-255 | S15 | v0.1.0] a branch was made: its name names the tasks
  if (event === 'create' && str(p['ref_type']) === 'branch') {
    const branch = str(p['ref']).slice(0, 200);
    return [
      {
        kind: 'branch',
        ref: branch,
        title: branch,
        url: '',
        author: str(obj(p['sender'])['login']).slice(0, 200),
        state: 'created',
        at: new Date().toISOString(),
        text: branch,
      },
    ];
  }
  if (event === 'push') {
    const branch = str(p['ref']).replace(/^refs\/heads\//, '');
    const commits = Array.isArray(p['commits']) ? p['commits'] : [];
    return commits
      .map((raw) => {
        const c = obj(raw);
        const author = obj(c['author']);
        const message = str(c['message']);
        return {
          kind: 'commit' as const,
          ref: str(c['id']).slice(0, 64),
          title: message.split('\n')[0]?.slice(0, 300) ?? '',
          url: str(c['url']).slice(0, 500),
          author: (str(author['username']) || str(author['name'])).slice(0, 200),
          state: branch.slice(0, 200),
          at: str(c['timestamp']) || new Date().toISOString(),
          text: message + '\n' + branch,
        };
      })
      .filter((c) => /^[0-9a-f]{7,64}$/i.test(c.ref));
  }
  if (event === 'pull_request') {
    const pr = obj(p['pull_request']);
    const number = str(pr['number'] ?? p['number']);
    if (!number) return [];
    const merged = pr['merged'] === true;
    const state = merged ? 'merged' : str(pr['state']) === 'closed' ? 'closed' : 'open';
    const title = str(pr['title']);
    const branch = str(obj(pr['head'])['ref']);
    return [
      {
        kind: 'pull_request',
        ref: number,
        title: title.slice(0, 300),
        url: str(pr['html_url']).slice(0, 500),
        author: str(obj(pr['user'])['login']).slice(0, 200),
        state,
        at: str(pr['updated_at']) || new Date().toISOString(),
        text: title + '\n' + branch + '\n' + str(pr['body']).slice(0, 5000),
      },
    ];
  }
  return [];
}

interface Connection {
  id: string;
  workspace_id: string;
  project_id: string;
  provider: Provider;
  repo: string;
  secret: string;
  key: string;
  host_repo_id: string | null; // [PCODE-299 | S15 | v0.1.0]
  default_branch: string | null; // [PCODE-300 | S15 | v0.1.0]
}

/** Links the changes to their items; returns how many links are new or changed (each one an event). */
export async function applyChanges(
  c: PoolClient,
  conn: Connection,
  changes: GitChange[],
  // [PCODE-301 | S15 | v0.1.0] quiet: the past read once links tasks, but moves nothing and records no events
  opts: { quiet?: boolean } = {},
): Promise<number> {
  let n = 0;
  for (const ch of changes) {
    for (const seq of taskNumbers(conn.key, ch.text)) {
      const item = (
        await c.query<{ id: string; title: string }>(
          'SELECT id, title FROM items WHERE project_id = $1 AND sequence = $2',
          [conn.project_id, seq],
        )
      ).rows[0];
      if (!item) continue;
      // [PCODE-255 | S15 | v0.1.0] the news moves the task forward to the state the project names for it
      const actor = {
        kind: 'integration' as const,
        id: conn.provider,
        name: ch.author ? ch.author + ' via ' + HOST_NAME[conn.provider] : HOST_NAME[conn.provider],
      };
      const news =
        ch.kind === 'branch' || ch.kind === 'commit'
          ? 'branch'
          : ch.state === 'merged'
            ? 'merged'
            : ch.state === 'open'
              ? 'opened'
              : null;
      if (
        news &&
        !opts.quiet &&
        (await gitMove(c, conn.workspace_id, conn.project_id, item.id, news, actor))
      )
        n++;
      if (ch.kind === 'branch') continue;
      const before = (
        await c.query<{ state: string }>(
          'SELECT state FROM item_git_links WHERE item_id = $1 AND connection_id = $2 AND kind = $3 AND ref = $4',
          [item.id, conn.id, ch.kind, ch.ref],
        )
      ).rows[0];
      await c.query(
        `INSERT INTO item_git_links (workspace_id, item_id, connection_id, kind, ref, title, url, author, state, at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (item_id, connection_id, kind, ref)
         DO UPDATE SET title = EXCLUDED.title, url = EXCLUDED.url, state = EXCLUDED.state, at = EXCLUDED.at`,
        [
          conn.workspace_id,
          item.id,
          conn.id,
          ch.kind,
          ch.ref,
          ch.title,
          ch.url,
          ch.author,
          ch.state,
          ch.at,
        ],
      );
      // a commit pushed again to another branch is not news; a PR that was merged or closed is
      if (before && (ch.kind === 'commit' || before.state === ch.state)) continue;
      if (opts.quiet) {
        n++;
        continue;
      }
      const host = HOST_NAME[conn.provider];
      await recordEvent(
        c,
        conn.workspace_id,
        {
          actor: {
            kind: 'integration',
            id: conn.provider,
            name: ch.author ? ch.author + ' via ' + host : host,
          },
          verb: 'progressed',
          object: {
            type: 'item',
            id: item.id,
            label: conn.key + '-' + String(seq) + ' ' + item.title,
          },
          parent: { type: 'project', id: conn.project_id, label: conn.key },
          changes:
            ch.kind === 'commit'
              ? { commit: { from: null, to: ch.ref } }
              : {
                  pullRequest: {
                    from: before?.state ?? null,
                    to: { number: ch.ref, state: ch.state, title: ch.title },
                  },
                },
        },
        { projectId: conn.project_id },
      );
      n++;
    }
  }
  return n;
}

// [PCODE-246 | S15 | v0.1.0] shared with the agents' webhooks
export function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (d: Buffer) => {
      size += d.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
        return;
      }
      parts.push(d);
    });
    req.on('end', () => {
      resolve(Buffer.concat(parts));
    });
    req.on('error', () => {
      resolve(null);
    });
  });
}

const PATH = /^\/hooks\/git\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function answer(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/** The webhook endpoint, outside the JSON router because the signature needs the raw bytes. */
export function gitWebhooks(
  pool: Pool,
  log: (msg: string, data?: Record<string, unknown>) => void = () => undefined,
  // [PCODE-304 | S15 | v0.1.0] after pull requests changed: the merge policy's verdicts, posted to the host
  afterPulls?: (
    workspaceId: string,
    connectionId: string,
    deliveries: readonly Delivery[],
  ) => Promise<void>,
) {
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const m = PATH.exec(path);
    if (!m) return false;
    if (req.method !== 'POST') {
      answer(res, 405, { error: { code: 'method_not_allowed', message: 'Use POST' } });
      return true;
    }
    const id = m[1] ?? '';
    void (async () => {
      const body = await readBody(req);
      if (!body) {
        answer(res, 413, {
          error: { code: 'too_large', message: 'The delivery is too large' },
        });
        return;
      }
      const conn = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<Connection>(
              `SELECT g.id, g.workspace_id, g.project_id, g.provider, g.repo, g.secret, g.host_repo_id, g.default_branch, p.key
             FROM git_connections g JOIN projects p ON p.id = g.project_id WHERE g.id = $1`,
              [id],
            )
          ).rows[0],
      );
      if (!conn) {
        answer(res, 404, { error: { code: 'not_found', message: 'No such connection' } });
        return;
      }
      if (!signatureValid(conn.provider, conn.secret, body, req.headers)) {
        answer(res, 401, {
          error: { code: 'unauthorized', message: 'The signature does not match' },
        });
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        answer(res, 400, {
          error: {
            code: 'invalid_request',
            message: 'The delivery is not JSON (choose application/json)',
          },
        });
        return;
      }
      // [PCODE-299 | S15 | v0.1.0] the event, from the header or (Azure) the body; then the delivery in one shape
      const event = eventOf(conn.provider, req.headers, payload);
      if (event === 'ping') {
        answer(res, 200, { ok: true });
        return;
      }
      const deliveries = normalize(conn.provider, event, payload);
      // an Azure build names its repository by id only: the id learned from a push or pull request
      let learnedId: string | null = null;
      for (const d of deliveries) {
        const name = repoOf(d.payload).toLowerCase();
        const repo = d.payload['repository'];
        const rawId =
          typeof repo === 'object' && repo !== null ? (repo as { id?: unknown }).id : undefined;
        const id = typeof rawId === 'string' ? rawId : '';
        const ours = name
          ? name === conn.repo.toLowerCase()
          : conn.provider === 'azure' && Boolean(id) && id === conn.host_repo_id;
        if (!ours) {
          answer(res, 400, {
            error: { code: 'invalid_request', message: 'The delivery is for another repository' },
          });
          return;
        }
        if (conn.provider === 'azure' && name && id && id !== conn.host_repo_id) learnedId = id;
      }
      const { linked, pullRequests } = await inWorkspace(pool, conn.workspace_id, async (c) => {
        await c.query(
          'UPDATE git_connections SET last_delivery_at = now(), host_repo_id = coalesce($2, host_repo_id) WHERE id = $1',
          [conn.id, learnedId],
        );
        let pulls = 0;
        let links = 0;
        const actor = {
          kind: 'integration' as const,
          id: conn.provider,
          name: HOST_NAME[conn.provider],
        };
        for (const d of deliveries) {
          // [PCODE-300 | S15 | v0.1.0] the history first: commits, branches, tags, the default branch
          const rec = await recordHistory(c, conn, d);
          // [PCODE-175 | S15 | v0.1.0] pull requests, their reviews and checks, for the Versions tab
          pulls += await recordPulls(c, conn, d.event, d.payload);
          links += await applyChanges(c, conn, changesOf(d.event, d.payload));
          // [PCODE-300 | S15 | v0.1.0] then what the default branch now says: closing words, reverts
          links += await closeOnMerge(c, conn, d, rec, actor);
          links += await markReverts(c, conn, rec, actor);
        }
        return { linked: links, pullRequests: pulls };
      });
      answer(res, 200, { ok: true, event, linked, pullRequests });
      // [PCODE-325 | S15 | v0.1.0] secrets in the pushed commits' messages: tokens revoked, others reported
      for (const d of deliveries) {
        if (d.event !== 'push') continue;
        const commits = Array.isArray(d.payload['commits']) ? d.payload['commits'] : [];
        for (const raw of commits) {
          const cm =
            typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
          const sha = typeof cm['id'] === 'string' ? cm['id'].slice(0, 7) : '';
          const message = typeof cm['message'] === 'string' ? cm['message'] : '';
          if (sha && message)
            await scanForLeaks(pool, conn.workspace_id, conn.project_id, [message], {
              foundIn: 'commit',
              location: 'commit ' + sha + ' of ' + conn.repo,
            });
        }
      }
      // [PCODE-304 | S15 | v0.1.0] the host is not kept waiting for what we post back to it
      if (pullRequests && afterPulls) await afterPulls(conn.workspace_id, conn.id, deliveries);
    })().catch((err: unknown) => {
      log('git webhook failed', { error: err instanceof Error ? err.stack : String(err) });
      if (!res.headersSent)
        answer(res, 500, {
          error: { code: 'internal', message: 'Something went wrong on our side' },
        });
    });
    return true;
  };
}
