// ── [PCODE-436 | S15 | v0.1.0] T37 low: Untangle the three folder import cycles ──
// ── [PCODE-301 | S15 | v0.1.0] T31.2b Git history backfill through the hosts' APIs; branches and tags in the Repositories screen ──
//    Why:  under the connected repositories, what Orqiva knows of each: its default branch, the branches and
//          tags with their last commit, and how many commits it keeps; an admin reads the past once through
//          the host's API (the connection needs its API token for that).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { localTime } from '../core/format.js';

interface Ref {
  name: string;
  sha: string;
  updatedAt: string;
  message: string | null;
  author: string | null;
  committedAt: string | null;
}
interface RepoRefs {
  connectionId: string;
  provider: string;
  repo: string;
  defaultBranch: string | null;
  lastBackfillAt: string | null;
  commits: number;
  branches: Ref[];
  tags: Ref[];
}

/** What a read of the past brought, in one line. */
/** A count with its noun: 1 tag, 2 tags. */
export const count = (n: number, one: string, many = one + 's'): string =>
  String(n) + ' ' + (n === 1 ? one : many);

export function backfillText(r: {
  commits: number;
  branches: number;
  tags: number;
  pullRequests: number;
  linked: number;
}): string {
  return (
    count(r.commits, 'commit') +
    ', ' +
    count(r.branches, 'branch', 'branches') +
    ', ' +
    count(r.tags, 'tag') +
    ' and ' +
    count(r.pullRequests, 'pull request') +
    ' read; ' +
    count(r.linked, 'link') +
    ' to tasks.'
  );
}

export function RepoHistory(props: {
  workspaceId: string;
  projectId: string;
  canAdmin: boolean;
  /** the connections with an API token */
  readable: ReadonlySet<string>;
}): ReactNode {
  const [repos, setRepos] = useState<RepoRefs[] | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const r = await api<RepoRefs[]>(
      'GET',
      '/api/workspaces/' + props.workspaceId + '/projects/' + props.projectId + '/git/refs',
    );
    if (r.ok) setRepos(r.data);
  }, [props.workspaceId, props.projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!repos?.length) return null;
  const fetchHistory = async (id: string): Promise<void> => {
    setBusy(id);
    const r = await api<{
      commits: number;
      branches: number;
      tags: number;
      pullRequests: number;
      linked: number;
    }>('POST', '/api/workspaces/' + props.workspaceId + '/git/' + id + '/backfill', {});
    setBusy('');
    setNote({ ...note, [id]: r.ok ? backfillText(r.data) : r.error.message });
    await load();
  };
  return (
    <section aria-label="Branches and tags" className="pe-repos">
      {repos.map((g) => (
        <details key={g.connectionId} className="pe-panel pe-repo-history">
          <summary>
            <span className="pe-mono">{g.repo}</span>{' '}
            <span className="pe-muted">
              {g.defaultBranch ? 'default ' + g.defaultBranch + ' · ' : ''}
              {count(g.branches.length, 'branch', 'branches')} · {count(g.tags.length, 'tag')} ·{' '}
              {count(g.commits, 'commit')} kept
              {g.lastBackfillAt ? ' · history read ' + localTime(g.lastBackfillAt) : ''}
            </span>
          </summary>
          {props.canAdmin ? (
            <p>
              <button
                type="button"
                className="pe-btn pe-btn--secondary"
                disabled={!props.readable.has(g.connectionId) || busy === g.connectionId}
                onClick={() => void fetchHistory(g.connectionId)}
              >
                {busy === g.connectionId
                  ? 'Reading…'
                  : g.lastBackfillAt
                    ? 'Read the history again'
                    : 'Read the history'}
              </button>{' '}
              <span className="pe-muted">
                {props.readable.has(g.connectionId)
                  ? 'The last 500 commits of the default branch, all branches and tags, the last 200 pull requests. Tasks are linked; nothing moves.'
                  : 'Give the connection an API token first: the history is read with it.'}
              </span>
            </p>
          ) : null}
          {note[g.connectionId] ? <p role="status">{note[g.connectionId]}</p> : null}
          {[
            ['Branches', g.branches],
            ['Tags', g.tags],
          ].map(([title, list]) =>
            (list as Ref[]).length ? (
              <div key={title as string}>
                <h3 className="pe-panel-title">{title as string}</h3>
                <ul className="pe-code-list">
                  {(list as Ref[]).slice(0, 100).map((r) => (
                    <li key={r.name}>
                      <span className="pe-mono">{r.name}</span>{' '}
                      {r.name === g.defaultBranch ? <span className="pe-pill">default</span> : null}{' '}
                      <span className="pe-mono pe-muted">{r.sha.slice(0, 7)}</span>{' '}
                      {r.message ? <span>{r.message}</span> : null}{' '}
                      <span className="pe-muted">
                        {r.author ? r.author + ' · ' : ''}
                        {localTime(r.committedAt ?? r.updatedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </details>
      ))}
    </section>
  );
}
