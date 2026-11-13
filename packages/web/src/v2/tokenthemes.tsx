// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-288 | S15 | v0.1.0] T30.2 Design tokens exported as a pull request (GitHub, Gitea) ──
// ── [PCODE-287 | S15 | v0.1.0] T30.1 Design tokens: themes and modes, aliases, W3C import, iOS and Android export ──
//    Why:  the Tokens tab's new parts: the project's themes (each built on light or dark) to add and
//          remove, a W3C file previewed before it changes anything, and aliases that point at nothing
//          named where they are.
import { useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button } from '../preview/ui.js';

export interface Theme {
  id: string;
  name: string;
  base: string;
  description: string;
}
export interface AliasProblem {
  name: string;
  mode: string;
  target: string;
  problem: string;
}
interface ImportAnswer {
  added: string[];
  changed: string[];
  unchanged: number;
  themesAdded: string[];
  skipped: { name: string; reason: string }[];
}

/** What an import would do or did, in a sentence. */
export function importSummary(r: ImportAnswer, done: boolean): string {
  const n = (x: number, one: string): string => String(x) + ' ' + one + (x === 1 ? '' : 's');
  const parts = [
    n(r.added.length, 'new token'),
    n(r.changed.length, 'changed token'),
    String(r.unchanged) + ' unchanged',
  ];
  if (r.themesAdded.length) parts.push(n(r.themesAdded.length, 'new theme'));
  return (done ? 'Imported: ' : 'The file has ') + parts.join(', ') + '.';
}

export function ThemeBar(props: {
  base: string;
  themes: Theme[];
  canEdit: boolean;
  onChanged: () => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [base, setBase] = useState('light');
  const [error, setError] = useState('');
  const add = async (): Promise<void> => {
    const r = await api('POST', props.base + '/token-themes', { name: name.trim(), base });
    setError(r.ok ? '' : r.error.message);
    if (r.ok) {
      setName('');
      props.onChanged();
    }
  };
  return (
    <div className="v2-theme-bar">
      <span className="pv-small pv-muted">Themes</span>
      <span className="pv-chip">light</span>
      <span className="pv-chip">dark</span>
      {props.themes.map((t) => (
        <span key={t.id} className="pv-chip v2-theme-chip">
          {t.name}
          <span className="pv-muted"> on {t.base}</span>
          {props.canEdit ? (
            <button
              type="button"
              className="pv-mini-btn"
              aria-label={'Remove the theme ' + t.name}
              title="Remove the theme and its values"
              onClick={() =>
                void api('DELETE', props.base + '/token-themes/' + encodeURIComponent(t.name)).then(
                  props.onChanged,
                )
              }
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
      {props.canEdit ? (
        <form
          className="v2-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void add();
          }}
        >
          <input
            className="v2-input v2-input--sm v2-mono"
            aria-label="Theme name"
            placeholder="new theme"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <select
            className="v2-input v2-input--sm"
            aria-label="Built on"
            value={base}
            onChange={(e) => {
              setBase(e.target.value);
            }}
          >
            <option value="light">on light</option>
            <option value="dark">on dark</option>
          </select>
          <button type="submit" className="pv-btn pv-btn--ghost pv-btn--sm" disabled={!name.trim()}>
            Add a theme
          </button>
        </form>
      ) : null}
      {error ? (
        <span className="v2-error pv-small" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function ImportTokens(props: { base: string; onDone: () => void }): ReactNode {
  const [text, setText] = useState('');
  const [file, setFile] = useState('');
  const [preview, setPreview] = useState<ImportAnswer | null>(null);
  const [done, setDone] = useState<ImportAnswer | null>(null);
  const [error, setError] = useState('');
  const send = async (src: string, dryRun: boolean): Promise<void> => {
    const r = await api<ImportAnswer>('POST', props.base + '/tokens/import', {
      text: src,
      dryRun,
    });
    if (!r.ok) {
      setError(r.error.message);
      setPreview(null);
      return;
    }
    setError('');
    if (dryRun) setPreview(r.data);
    else {
      setPreview(null);
      setDone(r.data);
      props.onDone();
    }
  };
  const shown = preview ?? done;
  return (
    <div className="v2-token-import">
      <label className="pv-btn pv-btn--ghost pv-btn--sm v2-file-pick">
        Import W3C tokens
        <input
          type="file"
          accept=".json,application/json"
          aria-label="W3C tokens file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFile(f.name);
            setDone(null);
            void f.text().then((t) => {
              setText(t);
              return send(t, true);
            });
            e.target.value = '';
          }}
        />
      </label>
      {shown ? (
        <div className="v2-token-import-result" role="status">
          <p className="pv-small">
            <strong>{file}</strong> · {importSummary(shown, Boolean(done && !preview))}
          </p>
          {shown.added.length || shown.changed.length ? (
            <p className="pv-small pv-mono pv-muted">
              {[...shown.added.map((x) => '+ ' + x), ...shown.changed.map((x) => '~ ' + x)]
                .slice(0, 12)
                .join('   ')}
              {shown.added.length + shown.changed.length > 12 ? '   …' : ''}
            </p>
          ) : null}
          {shown.skipped.length ? (
            <details className="pv-small">
              <summary>{String(shown.skipped.length)} not imported</summary>
              <ul>
                {shown.skipped.map((s) => (
                  <li key={s.name}>
                    <span className="pv-mono">{s.name || '(file)'}</span>: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {preview ? (
            <span className="v2-inline">
              <Button
                size="sm"
                kind="primary"
                disabled={!preview.added.length && !preview.changed.length}
                onClick={() => void send(text, false)}
              >
                Import
              </Button>
              <Button
                size="sm"
                kind="ghost"
                onClick={() => {
                  setPreview(null);
                }}
              >
                Cancel
              </Button>
            </span>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="v2-error pv-small" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function AliasWarnings(props: { problems: AliasProblem[] }): ReactNode {
  if (!props.problems.length) return null;
  return (
    <div className="v2-callout v2-callout--warning pv-small" role="alert">
      {props.problems.map((p) => (
        <div key={p.name + p.mode}>
          <span className="pv-mono">{p.name}</span>{' '}
          {p.problem === 'loop' ? 'points in a circle through ' : 'points at '}
          <span className="pv-mono">{'{' + p.target + '}'}</span>
          {p.problem === 'loop' ? '' : ', which does not exist'}
          {p.mode === 'light' ? '' : ' (in ' + p.mode + ')'}.
        </div>
      ))}
    </div>
  );
}

// [PCODE-288 | S15 | v0.1.0] the tokens as a pull request to a connected repository
interface Repo {
  id: string;
  provider: string;
  repo: string;
  canWrite?: boolean;
}
interface TokenPull {
  id: string;
  repo: string;
  branch: string;
  pullNumber: number | null;
  pullUrl: string;
  files: string[];
  by: string | null;
  createdAt: string;
}
export const PR_FORMATS = [
  ['css', 'CSS'],
  ['tailwind', 'Tailwind'],
  ['ts', 'TypeScript'],
  ['w3c', 'W3C'],
  ['ios', 'iOS'],
  ['android', 'Android'],
] as const;

export function TokenPullRequest(props: { base: string }): ReactNode {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [pulls, setPulls] = useState<TokenPull[]>([]);
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState('');
  const [formats, setFormats] = useState<string[]>(['css', 'ts', 'w3c']);
  const [folder, setFolder] = useState('design-tokens');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const load = async (): Promise<void> => {
    const [r, p] = await Promise.all([
      api<Repo[]>('GET', props.base + '/git'),
      api<TokenPull[]>('GET', props.base + '/tokens/pull-requests'),
    ]);
    if (r.ok) {
      setRepos(r.data);
      const first = r.data.find((x) => x.canWrite);
      if (first) setRepo((now) => now || first.id);
    }
    if (p.ok) setPulls(p.data);
  };
  const run = async (): Promise<void> => {
    setBusy(true);
    setError('');
    setMsg('');
    const r = await api<{ unchanged: boolean; export: TokenPull | null }>(
      'POST',
      props.base + '/tokens/pull-request',
      { connectionId: repo, formats, folder: folder.trim() },
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setMsg(
      r.data.unchanged || !r.data.export
        ? 'Nothing changed: the repository already has these tokens.'
        : 'Opened pull request #' +
            String(r.data.export.pullNumber ?? '') +
            ' with ' +
            String(r.data.export.files.length) +
            (r.data.export.files.length === 1 ? ' file.' : ' files.'),
    );
    await load();
  };
  const writable = (repos ?? []).filter((x) => x.canWrite);
  return (
    <div className="v2-token-pr">
      <Button
        size="sm"
        kind="ghost"
        icon="git"
        onClick={() => {
          setOpen((x) => !x);
          if (!repos) void load();
        }}
      >
        Open a pull request
      </Button>
      {open ? (
        <div className="v2-token-import-result">
          {repos && !writable.length ? (
            <p className="pv-small pv-muted">
              {repos.length
                ? 'No connected repository can open pull requests yet. An admin gives one an API token on the project’s Repositories page.'
                : 'Connect a repository first (the project’s Repositories page), and give it an API token.'}
            </p>
          ) : (
            <div className="v2-inline v2-token-pr-form">
              <select
                className="v2-input v2-input--sm"
                aria-label="Repository"
                value={repo}
                onChange={(e) => {
                  setRepo(e.target.value);
                }}
              >
                {writable.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.repo} ({x.provider})
                  </option>
                ))}
              </select>
              <input
                className="v2-input v2-input--sm v2-mono"
                aria-label="Folder"
                value={folder}
                onChange={(e) => {
                  setFolder(e.target.value);
                }}
              />
              {PR_FORMATS.map(([f, label]) => (
                <label key={f} className="pv-small v2-token-check">
                  <input
                    type="checkbox"
                    checked={formats.includes(f)}
                    onChange={(e) => {
                      setFormats((now) =>
                        e.target.checked ? [...now, f] : now.filter((x) => x !== f),
                      );
                    }}
                  />{' '}
                  {label}
                </label>
              ))}
              <Button
                size="sm"
                kind="primary"
                disabled={busy || !repo || !formats.length}
                onClick={() => void run()}
              >
                {busy ? 'Opening…' : 'Open the pull request'}
              </Button>
            </div>
          )}
          {msg ? (
            <p className="pv-small" role="status">
              {msg}
            </p>
          ) : null}
          {error ? (
            <p className="v2-error pv-small" role="alert">
              {error}
            </p>
          ) : null}
          {pulls.length ? (
            <ul className="pv-small v2-token-pulls">
              {pulls.slice(0, 5).map((p) => (
                <li key={p.id}>
                  <a className="pv-link" href={p.pullUrl} target="_blank" rel="noreferrer">
                    {p.repo} #{String(p.pullNumber ?? '')}
                  </a>{' '}
                  <span className="pv-muted">
                    {String(p.files.length)} files · {p.by ?? 'someone'} ·{' '}
                    {new Date(p.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
