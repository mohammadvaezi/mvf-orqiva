// ── [PCODE-333 | S15 | v0.1.0] T33.4b Sandbox per run with repo tools, pull requests by a bot Git identity ──
//    Why:  under a run's trace: the files it wrote into its sandbox, new or changed against the repository,
//          each with its diff, and the pull request it opened from them.
import { lineDiff } from '@orqiva/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

interface SandboxData {
  files: {
    path: string;
    state: 'new' | 'changed' | 'same';
    text: string;
    baseText: string | null;
    updatedAt: string;
  }[];
  pullRequest: string;
  branch: string;
}

/** "+12 −3" for a changed file, "+40" for a new one. */
export function changeCount(baseText: string | null, text: string): string {
  const d = lineDiff(baseText ?? '', text);
  const add = d.filter((l) => l.op === 'add').length;
  const del = baseText === null ? 0 : d.filter((l) => l.op === 'del').length;
  return '+' + String(add) + (del ? ' −' + String(del) : '');
}

export function SandboxFiles(props: { workspaceId: string; runId: string }): ReactNode {
  const [d, setD] = useState<SandboxData | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    void api<SandboxData>(
      'GET',
      W(props.workspaceId, '/agent-runs/' + props.runId + '/sandbox'),
    ).then((r) => {
      if (r.ok) setD(r.data);
    });
  }, [props.workspaceId, props.runId]);
  if (!d?.files.length) return null;
  const shown = d.files.find((f) => f.path === open);
  return (
    <div className="pv-sandbox">
      <span className="pv-small">
        <strong>Sandbox:</strong> {d.files.length} {d.files.length === 1 ? 'file' : 'files'}
        {d.pullRequest ? (
          <>
            {' · '}
            <a href={d.pullRequest} target="_blank" rel="noreferrer">
              pull request
            </a>{' '}
            on <span className="pv-mono">{d.branch}</span>
          </>
        ) : (
          ' · not in the repository'
        )}
      </span>
      <ul className="pv-sandbox-files">
        {d.files.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              className="pv-link-btn pv-mono"
              aria-expanded={open === f.path}
              onClick={() => {
                setOpen(open === f.path ? null : f.path);
              }}
            >
              {f.path}
            </button>{' '}
            <Chip tone={f.state === 'new' ? 'success' : f.state === 'changed' ? 'info' : 'neutral'}>
              {f.state}
            </Chip>{' '}
            <span className="pv-small pv-muted">{changeCount(f.baseText, f.text)}</span>
          </li>
        ))}
      </ul>
      {shown ? (
        <div className="pv-prompt">
          {lineDiff(shown.baseText ?? '', shown.text).map((l, i) => (
            <div key={i} className={l.op === 'add' ? 'pv-ins' : l.op === 'del' ? 'pv-del' : ''}>
              {l.text || ' '}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
