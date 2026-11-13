// ── [PCODE-263 | S15 | v0.1.0] T27.5 Plan files: MS Project XML and CSV export and import, iCal of the plan ──
//    Why:  the Canvas toolbar takes a plan out to MS Project, Excel or a calendar, and brings one in: the file
//          is read on the server first and shown (what it would make, under which parent, for whom, what is
//          skipped), and only then made.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';

interface Preview {
  tasks: {
    title: string;
    level: number;
    parent: string | null;
    kind: string;
    start: string | null;
    durationDays: number | null;
    resource: string | null;
    person: string | null;
    links: number;
  }[];
  problems: string[];
  created: number;
  linked: number;
}

/** The file's format by its name or its first characters. */
export function formatOf(name: string, text: string): 'msproject' | 'csv' | null {
  if (/\.xml$/i.test(name) || /^\s*(<\?xml|<Project)/.test(text)) return 'msproject';
  if (/\.(csv|txt|tsv)$/i.test(name)) return 'csv';
  return null;
}

export function ExportMenu(props: { workspaceId: string; projectId: string }): ReactNode {
  const [open, setOpen] = useState(false);
  // a click anywhere else, or Escape, closes the menu
  useEffect(() => {
    if (!open) return;
    const close = (): void => {
      setOpen(false);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const t = window.setTimeout(() => {
      window.addEventListener('click', close);
    }, 0);
    window.addEventListener('keydown', key);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  const href = (f: string): string =>
    '/api/workspaces/' +
    props.workspaceId +
    '/projects/' +
    props.projectId +
    '/plan/export?format=' +
    f;
  return (
    <span className="pv-menu-wrap">
      <Button
        size="sm"
        kind="ghost"
        icon="external"
        onClick={() => {
          setOpen(!open);
        }}
      >
        Export
      </Button>
      {open ? (
        <span className="pv-menu" role="menu">
          <a role="menuitem" className="pv-menu-item" href={href('msproject')} download>
            MS Project XML
          </a>
          <a role="menuitem" className="pv-menu-item" href={href('csv')} download>
            CSV for Excel
          </a>
          <a role="menuitem" className="pv-menu-item" href={href('ics')} download>
            Calendar (iCal)
          </a>
        </span>
      ) : null}
    </span>
  );
}

export function ImportCard(props: {
  workspaceId: string;
  projectId: string;
  onDone: () => void;
  onClose: () => void;
}): ReactNode {
  const [file, setFile] = useState<{
    name: string;
    text: string;
    format: 'msproject' | 'csv';
  } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const path =
    '/api/workspaces/' + props.workspaceId + '/projects/' + props.projectId + '/plan/import';
  const send = async (
    f: { text: string; format: 'msproject' | 'csv' },
    apply: boolean,
  ): Promise<void> => {
    setBusy(true);
    const r = await api<Preview>('POST', path, { format: f.format, text: f.text, apply });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setPreview(r.data);
    if (apply) props.onDone();
  };
  return (
    <Card
      title="Import a plan"
      action={
        <Button size="sm" kind="ghost" onClick={props.onClose}>
          Close
        </Button>
      }
    >
      <p className="pv-small pv-muted">
        MS Project XML (Save as → XML in MS Project, ProjectLibre or GanttProject) or a CSV from
        Excel with a Name column. You see what it would make before anything is made.
      </p>
      <input
        type="file"
        accept=".xml,.csv,.txt,text/csv,application/xml,text/xml"
        aria-label="Plan file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          setError('');
          setPreview(null);
          if (!f) return;
          if (f.size > 900_000) {
            setError('The file is larger than 900 KB.');
            return;
          }
          void f.text().then((text) => {
            const format = formatOf(f.name, text);
            if (!format) {
              setError('Choose an .xml file from MS Project or a .csv file.');
              return;
            }
            const next = { name: f.name, text, format };
            setFile(next);
            void send(next, false);
          });
        }}
      />
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {preview && file ? (
        <>
          {preview.created ? (
            <p className="pv-text-success" role="status">
              Made {preview.created} tasks and {preview.linked} links from {file.name}.
            </p>
          ) : (
            <p className="pv-small">
              {file.name}: {preview.tasks.length} tasks would be made.
            </p>
          )}
          {preview.problems.length ? (
            <ul className="pv-small pv-text-warning">
              {preview.problems.slice(0, 12).map((p) => (
                <li key={p}>{p}</li>
              ))}
              {preview.problems.length > 12 ? (
                <li>and {preview.problems.length - 12} more</li>
              ) : null}
            </ul>
          ) : null}
          {!preview.created ? (
            <>
              <div className="pv-grid-scroll pv-import-preview">
                <table className="pv-table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Kind</th>
                      <th>Start</th>
                      <th className="pv-num">Duration</th>
                      <th>Who</th>
                      <th className="pv-num">Links</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.tasks.slice(0, 200).map((t, i) => (
                      <tr key={i}>
                        <td className={'pv-indent-' + String(Math.min(3, t.level - 1))}>
                          {t.title}
                        </td>
                        <td>
                          <Chip>{t.kind}</Chip>
                        </td>
                        <td>{t.start ?? '—'}</td>
                        <td className="pv-num">
                          {t.durationDays === null ? '—' : String(t.durationDays) + ' d'}
                        </td>
                        <td>
                          {t.person ??
                            (t.resource ? <span className="pv-muted">{t.resource}?</span> : '—')}
                        </td>
                        <td className="pv-num">{t.links || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                size="sm"
                kind="primary"
                disabled={busy || !preview.tasks.length}
                onClick={() => void send(file, true)}
              >
                Make {preview.tasks.length} tasks
              </Button>
            </>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
