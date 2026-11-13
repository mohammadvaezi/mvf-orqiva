// ── [PCODE-301 | S15 | v0.1.0] T31.2b Git history backfill through the hosts' APIs; branches and tags in the Repositories screen ──
// ── [PCODE-300 | S15 | v0.1.0] T31.2a Git history from the webhooks: commits, branches, tags; close on merge; revert detection ──
// ── [PCODE-299 | S15 | v0.1.0] T31.1 GitLab and Azure Repos: webhooks, secrets, setup, read into one shape ──
// ── [PCODE-288 | S15 | v0.1.0] T30.2 Design tokens exported as a pull request (GitHub, Gitea) ──
// ── [PCODE-271 | S15 | v0.1.0] Project tabs fixes from the deep UX check: handover double page, service accounts, lifecycle name, extraction duplicates, AI cases picker, webhook events, overdue sprint, tab overflow ──
// ── [PCODE-108 | S15 | v0.1.0] Integrate Git hosts: GitHub and Gitea webhooks, commits and PRs on items, live ──
// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
//    Why:  the Git side in the web app. A project's Repositories tab connects GitHub or Gitea repositories
//          (admins) and shows, once, what to paste into the host's webhook settings; an item lists the
//          commits and pull requests that name it. Pure views: the workspace shell feeds them.
import { useState, type ReactNode } from 'react';
import { localTime } from './views.js';

export interface GitConnection {
  id: string;
  provider: string;
  repo: string;
  webhookPath: string;
  createdAt: string;
  lastDeliveryAt: string | null;
  apiUrl?: string | null; // [PCODE-288 | S15 | v0.1.0]
  canWrite?: boolean;
}

// [PCODE-288 | S15 | v0.1.0] an API token lets the connection open pull requests (token exports)
function ApiAccess(props: {
  c: GitConnection;
  onSet: (token: string | null, apiUrl: string | null) => Promise<string | null>;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [url, setUrl] = useState(props.c.apiUrl ?? '');
  const [error, setError] = useState('');
  const gitea = props.c.provider === 'gitea';
  if (!open)
    return (
      <button
        type="button"
        className="pe-btn pe-btn--secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        {props.c.canWrite
          ? 'Change the API token'
          : gitea || props.c.provider === 'github'
            ? 'Give it an API token (history, pull requests)'
            : 'Give it an API token (history)'}
      </button>
    );
  return (
    <form
      className="pe-api-access"
      onSubmit={(e) => {
        e.preventDefault();
        void props.onSet(token.trim(), url.trim() || null).then((err) => {
          setError(err ?? '');
          if (!err) {
            setOpen(false);
            setToken('');
          }
        });
      }}
    >
      <p className="pe-muted">
        {gitea || props.c.provider === 'github'
          ? 'A token that may read the repository (for its history) and write contents and pull requests (for exports). '
          : 'A token that may read the repository, for its history. '}
        It is kept encrypted and never shown again.
      </p>
      <label>
        API token{' '}
        <input
          type="password"
          autoComplete="off"
          className="pe-input pe-mono"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
          }}
        />
      </label>
      <label>
        API address{' '}
        <input
          className="pe-input pe-mono"
          placeholder={
            gitea
              ? 'https://git.example.com/api/v1'
              : props.c.provider === 'gitlab'
                ? 'https://gitlab.com/api/v4 (or your server’s)'
                : props.c.provider === 'azure'
                  ? 'https://dev.azure.com'
                  : 'https://api.github.com'
          }
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
          }}
        />
      </label>
      <button type="submit" className="pe-btn pe-btn--primary" disabled={token.trim().length < 8}>
        Save
      </button>
      {props.c.canWrite ? (
        <button
          type="button"
          className="pe-btn pe-btn--secondary"
          onClick={() => {
            void props.onSet(null, null).then((err) => {
              setError(err ?? '');
              if (!err) setOpen(false);
            });
          }}
        >
          Remove the token
        </button>
      ) : null}
      <button
        type="button"
        className="pe-btn pe-btn--secondary"
        onClick={() => {
          setOpen(false);
        }}
      >
        Cancel
      </button>
      {error ? <p className="pe-error">{error}</p> : null}
    </form>
  );
}

export interface GitLink {
  kind: string;
  ref: string;
  title: string;
  url: string;
  author: string;
  state: string;
  at: string;
  provider: string;
  repo: string;
}

// [PCODE-299 | S15 | v0.1.0] four hosts, each with its own repository name and webhook setup
export type HostKind = 'github' | 'gitea' | 'gitlab' | 'azure';
const HOST: Record<string, string> = {
  github: 'GitHub',
  gitea: 'Gitea',
  gitlab: 'GitLab',
  azure: 'Azure Repos',
};
export const REPO_HINT: Record<HostKind, { placeholder: string; pattern: RegExp }> = {
  github: { placeholder: 'owner/name', pattern: /^[\w.-]+\/[\w.-]+$/ },
  gitea: { placeholder: 'owner/name', pattern: /^[\w.-]+\/[\w.-]+$/ },
  gitlab: {
    placeholder: 'group/project or group/subgroup/project',
    pattern: /^[\w.-]+(\/[\w.-]+){1,19}$/,
  },
  azure: {
    placeholder: 'organisation/project/repository',
    pattern: /^[\w.-]+\/[\w. -]+\/[\w. -]+$/,
  },
};

/** Where and how each host takes the webhook. */
export function webhookSteps(provider: string): {
  where: string;
  secretLabel: string;
  secretNote: string;
  events: string;
} {
  if (provider === 'gitlab')
    return {
      where: "In GitLab, open the project's Settings → Webhooks, add a new webhook and enter:",
      secretLabel: 'Secret token',
      secretNote: 'GitLab sends it in the X-Gitlab-Token header.',
      events: 'Push events, Tag push events, Merge request events and Pipeline events',
    };
  if (provider === 'azure')
    return {
      where:
        "In Azure DevOps, open the project's Project settings → Service hooks, add a Web Hooks subscription for each event below and enter:",
      secretLabel: 'HTTP header',
      secretNote:
        'Put it as one header line, X-Orqiva-Secret: followed by the secret (or use it as the basic authentication password). Send all resource details.',
      events:
        'Code pushed, Pull request created, Pull request updated, Pull request merge attempted and Build completed',
    };
  return {
    where:
      'In ' +
      (HOST[provider] ?? provider) +
      ", open the repository's settings, add a webhook and enter:",
    secretLabel: 'Secret',
    secretNote: '',
    events: 'Pushes, pull requests, and branch or tag creation',
  };
}

export function RepositoriesView(props: {
  connections: GitConnection[];
  canAdmin: boolean;
  origin: string;
  projectKey: string;
  onConnect: (
    provider: HostKind,
    repo: string,
  ) => Promise<{ secret: string; connection: GitConnection } | string>;
  onRemove: (id: string) => Promise<string | null>;
  onSetToken?: (id: string, token: string | null, apiUrl: string | null) => Promise<string | null>; // [PCODE-288 | S15 | v0.1.0]
}): ReactNode {
  const [provider, setProvider] = useState<HostKind>('github');
  const [repo, setRepo] = useState('');
  const [error, setError] = useState('');
  const [made, setMade] = useState<{ secret: string; connection: GitConnection } | null>(null);
  return (
    <section aria-label="Repositories" className="pe-repos">
      <p className="pe-muted">
        Commits and pull requests that name a task ({props.projectKey}-12 in a message, a title or a
        branch) appear on it as they happen.
      </p>
      {props.connections.length === 0 ? (
        <p className="pe-muted">No repository is connected yet.</p>
      ) : null}
      <ul className="pe-code-list">
        {props.connections.map((c) => (
          <li key={c.id}>
            <span className="pe-mono">{c.repo}</span>{' '}
            <span className="pe-muted">on {HOST[c.provider] ?? c.provider}</span>{' '}
            <span className="pe-muted">
              ·{' '}
              {c.lastDeliveryAt
                ? 'last delivery ' + localTime(c.lastDeliveryAt)
                : 'no delivery yet'}
              {c.canWrite ? ' · opens pull requests' : ''}
            </span>{' '}
            {/* [PCODE-301 | S15 | v0.1.0] every host takes a token now: it reads the history (pull requests: GitHub, Gitea) */}
            {props.canAdmin && props.onSetToken ? (
              <ApiAccess
                c={c}
                onSet={(tk, u) => props.onSetToken?.(c.id, tk, u) ?? Promise.resolve(null)}
              />
            ) : null}{' '}
            {props.canAdmin ? (
              <button
                type="button"
                className="pe-btn pe-btn--secondary"
                onClick={() => {
                  void props.onRemove(c.id).then((err) => {
                    setError(err ?? '');
                  });
                }}
              >
                Disconnect
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {made ? (
        <div className="pe-notice-ok" role="status">
          <p>
            <strong>{made.connection.repo}</strong> is connected.{' '}
            {webhookSteps(made.connection.provider).where}
          </p>
          <dl className="pe-defs">
            <dt>
              {made.connection.provider === 'gitlab' || made.connection.provider === 'azure'
                ? 'URL'
                : 'Payload URL'}
            </dt>
            <dd className="pe-mono">{props.origin + made.connection.webhookPath}</dd>
            <dt>Content type</dt>
            <dd className="pe-mono">application/json</dd>
            <dt>{webhookSteps(made.connection.provider).secretLabel}</dt>
            <dd className="pe-mono">
              {made.connection.provider === 'azure'
                ? 'X-Orqiva-Secret: ' + made.secret
                : made.secret}
            </dd>
            <dt>Events</dt>
            {/* [PCODE-271 | S15 | v0.1.0] branch creation too: Git moves start a task when its branch is made */}
            <dd>{webhookSteps(made.connection.provider).events}</dd>
          </dl>
          {webhookSteps(made.connection.provider).secretNote ? (
            <p className="pe-muted">{webhookSteps(made.connection.provider).secretNote}</p>
          ) : null}
          <p className="pe-muted">
            The secret is shown only now. If it is lost, disconnect and connect again.
          </p>
        </div>
      ) : null}
      {props.canAdmin ? (
        <form
          className="pe-repo-form"
          onSubmit={(e) => {
            e.preventDefault();
            void props.onConnect(provider, repo.trim()).then((r) => {
              if (typeof r === 'string') setError(r);
              else {
                setError('');
                setRepo('');
                setMade(r);
              }
            });
          }}
        >
          <label htmlFor="repo-provider">Host</label>
          <select
            id="repo-provider"
            className="pe-input pe-input--small"
            value={provider}
            onChange={(e) => {
              const v = e.target.value;
              setProvider(v === 'gitea' || v === 'gitlab' || v === 'azure' ? v : 'github');
            }}
          >
            <option value="github">GitHub</option>
            <option value="gitea">Gitea</option>
            <option value="gitlab">GitLab</option>
            <option value="azure">Azure Repos</option>
          </select>
          <label htmlFor="repo-name">Repository</label>
          <input
            id="repo-name"
            className="pe-input"
            placeholder={REPO_HINT[provider].placeholder}
            value={repo}
            onChange={(e) => {
              setRepo(e.target.value);
            }}
          />
          <button
            className="pe-btn pe-btn--primary"
            type="submit"
            disabled={!REPO_HINT[provider].pattern.test(repo.trim())}
          >
            Connect repository
          </button>
        </form>
      ) : (
        <p className="pe-muted">Workspace admins connect repositories.</p>
      )}
      {error ? (
        <div className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
    </section>
  );
}

const PR_STATE: Record<string, string> = { open: 'open', merged: 'merged', closed: 'closed' };

/** The commits and pull requests on an item; nothing at all when there are none. */
export function GitLinks(props: { links: GitLink[] }): ReactNode {
  if (props.links.length === 0) return null;
  return (
    <section aria-label="Commits and pull requests" className="pe-panel">
      <div className="pe-panel-head">
        <h2 className="pe-panel-title">Commits and pull requests</h2>
      </div>
      <ul className="pe-code-list">
        {props.links.map((l) => (
          <li key={l.provider + l.repo + l.kind + l.ref}>
            {l.kind === 'pull_request' ? (
              <span className="pe-pill">
                PR #{l.ref} · {PR_STATE[l.state] ?? l.state}
              </span>
            ) : (
              <span className="pe-mono">{l.ref.slice(0, 7)}</span>
            )}{' '}
            {/* [PCODE-300 | S15 | v0.1.0] work taken back by a revert on the default branch */}
            {l.kind === 'commit' && l.state === 'reverted' ? (
              <span className="pe-pill pe-pill--warn">reverted</span>
            ) : null}{' '}
            {l.url ? (
              <a href={l.url} target="_blank" rel="noopener noreferrer">
                {l.title || l.ref}
              </a>
            ) : (
              <span>{l.title || l.ref}</span>
            )}{' '}
            <span className="pe-muted">
              {l.author ? l.author + ' · ' : ''}
              {l.repo} · {localTime(l.at)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
