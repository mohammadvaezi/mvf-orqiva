// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-285 | S15 | v0.1.0] T29.7 Documents import (Markdown, Notion, Confluence) and export (Markdown, HTML, PDF, ZIP) ──
//    Why:  bringing a wiki in (a ZIP of Markdown files, a Notion or a Confluence export, or one file) under
//          a chosen folder, and taking pages out: a page as Markdown, HTML or PDF (printed from the page), a
//          folder or the whole wiki as a ZIP.
import { useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button } from '../preview/ui.js';
import { uploadFile } from './files.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface ImportResult {
  kind: string;
  pages: number;
  folders: number;
  files: number;
  skipped: string[];
  firstPageId: string | null;
}

/** What an import did, in a sentence. */
export function importText(r: ImportResult): string {
  const kind =
    r.kind === 'notion'
      ? 'Notion export'
      : r.kind === 'confluence'
        ? 'Confluence export'
        : 'Markdown';
  const n = (x: number, one: string, many: string): string =>
    String(x) + ' ' + (x === 1 ? one : many);
  return (
    'Imported ' +
    kind +
    ': ' +
    [
      n(r.pages, 'page', 'pages'),
      r.folders ? n(r.folders, 'folder', 'folders') : '',
      r.files ? n(r.files, 'file', 'files') : '',
    ]
      .filter(Boolean)
      .join(', ') +
    '.' +
    (r.skipped.length
      ? ' Not read: ' + r.skipped.slice(0, 5).join(', ') + (r.skipped.length > 5 ? ' …' : '.')
      : '')
  );
}

export function ImportPanel(props: {
  workspaceId: string;
  projectId: string;
  folders: { id: string; title: string }[];
  onDone: (firstPageId: string | null) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState('auto');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const run = async (): Promise<void> => {
    if (!file) return;
    setBusy(true);
    setError('');
    const up = await uploadFile(props.workspaceId, props.projectId, file);
    if (!up.ok) {
      setBusy(false);
      setError(up.error.message);
      return;
    }
    const r = await api<ImportResult>(
      'POST',
      W(props.workspaceId, '/projects/' + props.projectId + '/docs/import'),
      {
        fileId: up.data.id,
        kind,
        ...(parent ? { parentId: parent } : {}),
      },
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setMsg(importText(r.data));
    setFile(null);
    props.onDone(r.data.firstPageId);
  };
  return (
    <div className="v2-import">
      <Button
        size="sm"
        kind="ghost"
        icon="plus"
        onClick={() => {
          setOpen((x) => !x);
          setMsg('');
        }}
      >
        Import
      </Button>
      {open ? (
        <div className="v2-import-panel">
          <p className="pv-small pv-muted">
            A ZIP of Markdown files (folders become folders), a Notion export (Markdown &amp; CSV)
            or a Confluence space exported as HTML; or one Markdown or HTML file. Images come along
            as files of their pages.
          </p>
          <div className="v2-inline">
            <label className="pv-btn pv-btn--secondary pv-btn--sm v2-file-pick">
              {file ? file.name : 'Choose a file'}
              <input
                type="file"
                accept=".zip,.md,.markdown,.txt,.html,.htm"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                }}
              />
            </label>
            <select
              className="pv-select"
              aria-label="Kind"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
              }}
            >
              <option value="auto">Recognise the kind</option>
              <option value="markdown">Markdown</option>
              <option value="notion">Notion export</option>
              <option value="confluence">Confluence export</option>
            </select>
            <select
              className="pv-select"
              aria-label="Into"
              value={parent}
              onChange={(e) => {
                setParent(e.target.value);
              }}
            >
              <option value="">At the top of the wiki</option>
              {props.folders.map((f) => (
                <option key={f.id} value={f.id}>
                  Into {f.title}
                </option>
              ))}
            </select>
            <Button size="sm" kind="primary" disabled={!file || busy} onClick={() => void run()}>
              {busy ? 'Importing…' : 'Import'}
            </Button>
          </div>
          {msg ? (
            <p className="pv-small" role="status">
              {msg}
            </p>
          ) : null}
          {error ? (
            <p className="v2-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Prints only the page: the browser's dialog saves it as PDF. */
export function printPage(): void {
  document.body.classList.add('v2-print-doc');
  const done = (): void => {
    document.body.classList.remove('v2-print-doc');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

export function PageExports(props: { workspaceId: string; pageId: string }): ReactNode {
  const href = (f: string): string =>
    W(props.workspaceId, '/docs/' + props.pageId + '/export?format=' + f);
  return (
    <span className="v2-inline v2-exports" role="group" aria-label="Export the page">
      <span className="pv-small pv-muted">Export</span>
      <a className="pv-link pv-small" href={href('md')} download>
        Markdown
      </a>
      <a className="pv-link pv-small" href={href('html')} download>
        HTML
      </a>
      <button
        type="button"
        className="pv-link pv-small"
        onClick={printPage}
        title="Print, or save as PDF"
      >
        PDF
      </button>
    </span>
  );
}

export const zipHref = (workspaceId: string, projectId: string, folderId?: string): string =>
  W(
    workspaceId,
    '/projects/' + projectId + '/docs/export' + (folderId ? '?folder=' + folderId : ''),
  );
