// ── [PCODE-325 | S15 | v0.1.0] T32.8b Leak scans of commits, traces and logs ──
// ── [PCODE-300 | S15 | v0.1.0] T31.2a Git history from the webhooks: commits, branches, tags; close on merge; revert detection ──
//    Why:  what the webhooks tell is kept as the repository's history: every commit (not only those naming
//          a task) with the files it changed when the host says, the branches and tags with their commit,
//          the default branch. Two things act on it, on the default branch only: closing words close their
//          tasks once merged, and a revert marks the work it took back on the tasks it served.
import { redactSecrets } from '@orqiva/shared'; // [PCODE-325 | S15 | v0.1.0]
import { branchName, closingNumbers, revertOf } from '@orqiva/shared';
import type { PoolClient } from 'pg';
import type { Actor } from '@orqiva/shared';
import { recordEvent } from '../events/outbox.js';
import type { Delivery } from './hosts.js';

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const SHA = /^[0-9a-f]{7,64}$/;
const ZERO = /^0+$/;

export interface HistoryConn {
  id: string;
  workspace_id: string;
  project_id: string;
  key: string;
  default_branch: string | null;
}

/** A commit's changed paths, when the host lists them (GitHub, Gitea, GitLab do in pushes). */
function filesOf(
  c: Record<string, unknown>,
): { added: string[]; modified: string[]; removed: string[] } | null {
  const list = (k: string): string[] =>
    arr(c[k])
      .map(str)
      .filter((p) => p && p.length <= 500)
      .slice(0, 300);
  if (!('added' in c) && !('modified' in c) && !('removed' in c)) return null;
  return { added: list('added'), modified: list('modified'), removed: list('removed') };
}

/** The default branch: what the delivery says, or what was learned before, or main. */
export function defaultOf(conn: HistoryConn, d: Delivery): string {
  const said = branchName(str(obj(d.payload['repository'])['default_branch']));
  return said || conn.default_branch || 'main';
}

export interface Recorded {
  /** commits pushed to the default branch now, newest last */
  onDefault: { sha: string; message: string }[];
}

/** Keeps a delivery's commits, branches and tags; learns the default branch. */
export async function recordHistory(
  c: PoolClient,
  conn: HistoryConn,
  d: Delivery,
): Promise<Recorded> {
  const out: Recorded = { onDefault: [] };
  const p = d.payload;
  const main = defaultOf(conn, d);
  if (main !== conn.default_branch) {
    await c.query('UPDATE git_connections SET default_branch = $2 WHERE id = $1', [conn.id, main]);
    conn.default_branch = main;
  }
  const ref = async (kind: 'branch' | 'tag', name: string, sha: string): Promise<void> => {
    if (!name) return;
    if (ZERO.test(sha)) {
      await c.query('DELETE FROM git_refs WHERE connection_id = $1 AND kind = $2 AND name = $3', [
        conn.id,
        kind,
        name,
      ]);
      return;
    }
    await c.query(
      `INSERT INTO git_refs (connection_id, kind, name, workspace_id, project_id, sha) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (connection_id, kind, name) DO UPDATE SET sha = CASE WHEN EXCLUDED.sha <> '' THEN EXCLUDED.sha ELSE git_refs.sha END, updated_at = now()`,
      [
        conn.id,
        kind,
        name.slice(0, 250),
        conn.workspace_id,
        conn.project_id,
        SHA.test(sha) ? sha : '',
      ],
    );
  };
  if (d.event === 'create') {
    const kind = str(p['ref_type']);
    if (kind === 'branch' || kind === 'tag')
      await ref(kind, str(p['ref']), str(p['sha']).toLowerCase());
    return out;
  }
  if (d.event !== 'push') return out;
  const full = str(p['ref']);
  const after = str(p['after']).toLowerCase();
  const deleted = p['deleted'] === true || (Boolean(after) && ZERO.test(after));
  if (full.startsWith('refs/tags/')) {
    await ref('tag', full.slice(10), deleted ? '0' : after);
    return out;
  }
  const branch = branchName(full);
  if (!branch) return out;
  await ref('branch', branch, deleted ? '0' : after);
  if (deleted) return out;
  for (const raw of arr(p['commits'])) {
    const cm = obj(raw);
    const sha = str(cm['id']).toLowerCase();
    if (!SHA.test(sha)) continue;
    // [PCODE-325 | S15 | v0.1.0] a secret in a message is kept by its kind only (the webhook reports it)
    const message = redactSecrets(str(cm['message']).slice(0, 10000)).text;
    const author = obj(cm['author']);
    const files = filesOf(cm);
    await c.query(
      `INSERT INTO git_commits (connection_id, sha, workspace_id, project_id, message, author, committed_at, url, branch, files)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (connection_id, sha) DO UPDATE SET files = coalesce(git_commits.files, EXCLUDED.files)`,
      [
        conn.id,
        sha,
        conn.workspace_id,
        conn.project_id,
        message,
        (str(author['username']) || str(author['name'])).slice(0, 200),
        str(cm['timestamp']) || new Date().toISOString(),
        str(cm['url']).slice(0, 500),
        branch.slice(0, 250),
        files ? JSON.stringify(files) : null,
      ],
    );
    if (branch === main) out.onDefault.push({ sha, message });
  }
  return out;
}

/** Moves tasks of the project to its first done state; answers how many moved. */
export async function closeTasks(
  c: PoolClient,
  conn: HistoryConn,
  numbers: readonly number[],
  actor: Actor,
  why: string,
): Promise<number> {
  if (!numbers.length) return 0;
  const done = (
    await c.query<{ id: string; name: string }>(
      "SELECT id, name FROM project_states WHERE project_id = $1 AND grp = 'completed' ORDER BY position LIMIT 1",
      [conn.project_id],
    )
  ).rows[0];
  if (!done) return 0;
  let n = 0;
  for (const seq of numbers) {
    const it = (
      await c.query<{ id: string; title: string; grp: string; state: string }>(
        `SELECT i.id, i.title, st.grp, st.name AS state FROM items i JOIN project_states st ON st.id = i.state_id
          WHERE i.project_id = $1 AND i.sequence = $2`,
        [conn.project_id, seq],
      )
    ).rows[0];
    // done or cancelled already: nothing to do
    if (!it || it.grp === 'completed' || it.grp === 'cancelled') continue;
    await c.query(
      'UPDATE items SET state_id = $2, version = version + 1, updated_at = now() WHERE id = $1',
      [it.id, done.id],
    );
    await recordEvent(
      c,
      conn.workspace_id,
      {
        actor,
        verb: 'moved',
        object: { type: 'item', id: it.id, label: conn.key + '-' + String(seq) + ' ' + it.title },
        parent: { type: 'project', id: conn.project_id, label: conn.key },
        changes: { state: { from: it.state, to: done.name }, closedBy: { from: null, to: why } },
      },
      { projectId: conn.project_id },
    );
    n += 1;
  }
  return n;
}

/** Closing words in a merged pull request or in commits pushed to the default branch. */
export async function closeOnMerge(
  c: PoolClient,
  conn: HistoryConn,
  d: Delivery,
  rec: Recorded,
  actor: Actor,
): Promise<number> {
  if (d.event === 'pull_request') {
    const pr = obj(d.payload['pull_request']);
    const base = str(obj(pr['base'])['ref']);
    if (pr['merged'] !== true || base !== defaultOf(conn, d)) return 0;
    const text = str(pr['title']) + '\n' + str(pr['body']);
    return closeTasks(
      c,
      conn,
      closingNumbers(conn.key, text),
      actor,
      'pull request #' + str(pr['number']) + ' merged',
    );
  }
  let n = 0;
  for (const cm of rec.onDefault)
    n += await closeTasks(
      c,
      conn,
      closingNumbers(conn.key, cm.message),
      actor,
      'commit ' + cm.sha.slice(0, 7),
    );
  return n;
}

/** Reverts on the default branch: the commit taken back, and the tasks it served, are marked. */
export async function markReverts(
  c: PoolClient,
  conn: HistoryConn,
  rec: Recorded,
  actor: Actor,
): Promise<number> {
  let n = 0;
  for (const cm of rec.onDefault) {
    const rv = revertOf(cm.message);
    if (!rv?.sha) continue;
    const like = rv.sha + '%';
    await c.query('UPDATE git_commits SET reverts = $3 WHERE connection_id = $1 AND sha = $2', [
      conn.id,
      cm.sha,
      rv.sha.length === 40 ? rv.sha : null,
    ]);
    await c.query(
      'UPDATE git_commits SET reverted_by = $3 WHERE connection_id = $1 AND sha LIKE $2',
      [conn.id, like, cm.sha],
    );
    const items = (
      await c.query<{ item_id: string; title: string; sequence: number; item_title: string }>(
        `UPDATE item_git_links l SET state = 'reverted' FROM items i
          WHERE l.connection_id = $1 AND l.kind = 'commit' AND l.ref LIKE $2 AND i.id = l.item_id
          RETURNING l.item_id, l.title, i.sequence, i.title AS item_title`,
        [conn.id, like],
      )
    ).rows;
    for (const it of items) {
      await recordEvent(
        c,
        conn.workspace_id,
        {
          actor,
          verb: 'updated',
          object: {
            type: 'item',
            id: it.item_id,
            label: conn.key + '-' + String(it.sequence) + ' ' + it.item_title,
          },
          parent: { type: 'project', id: conn.project_id, label: conn.key },
          changes: {
            reverted: { from: rv.sha.slice(0, 7) + ' ' + it.title, to: cm.sha.slice(0, 7) },
          },
        },
        { projectId: conn.project_id },
      );
      n += 1;
    }
  }
  return n;
}
