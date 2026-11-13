// ── [PCODE-306 | S15 | v0.1.0] T31.6 Versions from commits: conventional commits, tags and components per path ──
//    Why:  above the releases: the next version each component (or the repository) is due, from the commits
//          since its last tag, with the reason in words and the changelog, and one click to plan that
//          release. Admins name the components of a monorepo: a folder and its tag prefix.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface VersionPlan {
  componentId: string | null;
  name: string;
  folder: string;
  tagPrefix: string;
  connectionId: string;
  repo: string;
  lastTag: string | null;
  lastVersion: string | null;
  commits: number;
  unknownPaths: number;
  nonConventional: number;
  bump: 'major' | 'minor' | 'patch' | 'none';
  next: string | null;
  reason: string;
  changelog: string;
  planned: boolean;
}
interface Component {
  id: string;
  name: string;
  folder: string;
  tagPrefix: string;
  connectionId: string;
  repo: string;
}

const BUMP_TONE = { major: 'danger', minor: 'info', patch: 'neutral', none: 'neutral' } as const;

/** "1.2.0 → 2.0.0", or what the first version will be. */
export function stepText(p: Pick<VersionPlan, 'lastVersion' | 'next'>): string {
  if (!p.next) return p.lastVersion ? 'stays at ' + p.lastVersion : 'no version yet';
  return p.lastVersion ? p.lastVersion + ' → ' + p.next : 'first version ' + p.next;
}

export function VersionPlans(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
  isAdmin: boolean;
  /** a release was planned: show it */
  planned: (releaseId: string) => void;
}): ReactNode {
  const [plans, setPlans] = useState<VersionPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = W(props.workspaceId, '/projects/' + props.projectId);
  const load = useCallback(() => {
    void api<VersionPlan[]>('GET', base + '/version-plan').then((r) => {
      if (r.ok) setPlans(r.data);
    });
  }, [base]);
  useEffect(load, [load]);
  if (!plans || (!plans.length && !props.isAdmin)) return null;
  const plan = async (p: VersionPlan): Promise<void> => {
    const r = await api<{ id: string }>('POST', base + '/version-plan/release', {
      connectionId: p.connectionId,
      componentId: p.componentId,
    });
    if (r.ok) {
      setError(null);
      load();
      props.planned(r.data.id);
    } else setError(r.error.message);
  };
  return (
    <Card title="Next versions from commits">
      {plans.length ? (
        <ul className="v2-vp-list">
          {plans.map((p) => (
            <li key={(p.componentId ?? '') + p.connectionId} className="v2-vp-item">
              <div className="v2-vp-head">
                <span>
                  <strong>{p.name || p.repo}</strong>{' '}
                  {p.name ? (
                    <span className="pv-small pv-muted pv-mono">
                      {p.repo}/{p.folder}
                    </span>
                  ) : null}
                </span>
                <span className="pv-mono">{stepText(p)}</span>
                {p.bump !== 'none' ? <Chip tone={BUMP_TONE[p.bump]}>{p.bump}</Chip> : null}
                {p.next && props.canEdit ? (
                  p.planned ? (
                    <span className="pv-small pv-muted">planned</span>
                  ) : (
                    <Button size="sm" kind="primary" onClick={() => void plan(p)}>
                      Plan {p.next}
                    </Button>
                  )
                ) : null}
              </div>
              <p className="pv-small">
                {p.reason} · {p.commits} commit{p.commits === 1 ? '' : 's'} since{' '}
                {p.lastTag ? <span className="pv-mono">{p.lastTag}</span> : 'the start'}
                {p.unknownPaths
                  ? ' · ' + String(p.unknownPaths) + ' without a file list from the host (counted)'
                  : ''}
              </p>
              {p.changelog ? (
                <details>
                  <summary className="pv-small">Changelog</summary>
                  <pre className="v2-vp-log">{p.changelog}</pre>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pv-small pv-muted">Connect a repository to plan versions from its commits.</p>
      )}
      {error ? (
        <p className="pv-text-danger pv-small" role="alert">
          {error}
        </p>
      ) : null}
      {props.isAdmin ? (
        <Components workspaceId={props.workspaceId} projectId={props.projectId} changed={load} />
      ) : null}
    </Card>
  );
}

function Components(props: {
  workspaceId: string;
  projectId: string;
  changed: () => void;
}): ReactNode {
  const [list, setList] = useState<Component[]>([]);
  const [repos, setRepos] = useState<{ id: string; repo: string }[]>([]);
  const [form, setForm] = useState({ connectionId: '', name: '', folder: '', tagPrefix: '' });
  const [error, setError] = useState<string | null>(null);
  const base = W(props.workspaceId, '/projects/' + props.projectId);
  const load = useCallback(() => {
    void api<Component[]>('GET', base + '/version-components').then((r) => {
      if (r.ok) setList(r.data);
    });
    void api<{ id: string; repo: string }[]>('GET', base + '/git').then((r) => {
      if (r.ok) setRepos(r.data);
    });
  }, [base]);
  useEffect(load, [load]);
  const add = async (): Promise<void> => {
    const r = await api('POST', base + '/version-components', {
      connectionId: form.connectionId || repos[0]?.id,
      name: form.name.trim(),
      folder: form.folder.trim(),
      tagPrefix: form.tagPrefix.trim() || form.name.trim() + '-v',
    });
    if (r.ok) {
      setForm({ connectionId: form.connectionId, name: '', folder: '', tagPrefix: '' });
      setError(null);
      load();
      props.changed();
    } else setError(r.error.message);
  };
  const remove = async (id: string): Promise<void> => {
    await api('DELETE', W(props.workspaceId, '/version-components/' + id));
    load();
    props.changed();
  };
  if (!repos.length) return null;
  return (
    <details className="v2-vp-components">
      <summary className="pv-small">
        Components (
        {list.length ? String(list.length) : 'none: the whole repository is one version'})
      </summary>
      {list.length ? (
        <ul className="pv-small v2-vp-clist">
          {list.map((c) => (
            <li key={c.id}>
              <strong>{c.name}</strong> · <span className="pv-mono">{c.folder || '(all)'}</span> ·
              tags <span className="pv-mono">{c.tagPrefix}1.2.3</span>{' '}
              <button type="button" className="pv-link-btn" onClick={() => void remove(c.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="v2-inline v2-vp-form"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        {repos.length > 1 ? (
          <select
            className="v2-input v2-input--sm"
            aria-label="Repository"
            value={form.connectionId}
            onChange={(e) => {
              setForm({ ...form, connectionId: e.target.value });
            }}
          >
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.repo}
              </option>
            ))}
          </select>
        ) : null}
        <input
          className="v2-input v2-input--sm"
          aria-label="Component name"
          placeholder="Name, e.g. web"
          value={form.name}
          onChange={(e) => {
            setForm({ ...form, name: e.target.value });
          }}
        />
        <input
          className="v2-input v2-input--sm v2-mono"
          aria-label="Folder"
          placeholder="Folder, e.g. packages/web"
          value={form.folder}
          onChange={(e) => {
            setForm({ ...form, folder: e.target.value });
          }}
        />
        <input
          className="v2-input v2-input--sm v2-mono"
          aria-label="Tag prefix"
          placeholder={(form.name.trim() || 'web') + '-v'}
          value={form.tagPrefix}
          onChange={(e) => {
            setForm({ ...form, tagPrefix: e.target.value });
          }}
        />
        <button
          type="submit"
          className="pv-btn pv-btn--secondary pv-btn--sm"
          disabled={!form.name.trim()}
        >
          Add component
        </button>
      </form>
      {error ? (
        <p className="pv-text-danger pv-small" role="alert">
          {error}
        </p>
      ) : null}
    </details>
  );
}
