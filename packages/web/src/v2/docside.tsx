// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-358 | S15 | v0.1.0] T35.6 Accessibility to WCAG 2.2 AA ──
// ── [PCODE-284 | S15 | v0.1.0] T29.6 Documents: tree drag and drop, files, image annotation, read analytics, per-task knowledge, checked citations ──
//    Why:  what a page has besides its text: its files (uploaded here, inserted into the text, opened,
//          taken off), who read which version, the tasks whose agents may read it; where a page dragged in
//          the tree lands; and drawing on an image of the page (boxes, arrows, labels) to keep the result
//          as a new image in its place.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button } from '../preview/ui.js';
import { imageMarkdown } from './blockedit.js';
import { uploadFile } from './files.js';
import { useDialog } from './dialog.js'; // [PCODE-358 | S15 | v0.1.0]
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

// ── where a dragged page lands ──
export interface TreeNode {
  id: string;
  parentId: string | null;
  kind: string;
  rank: number;
}

/**
 * Dropping page `drag` on `over`: inside it (it becomes the parent, the page goes last) or just before it
 * (same parent, between it and the one before). Null when it would land inside itself.
 */
export function dropTarget(
  nodes: readonly TreeNode[],
  drag: string,
  over: string,
  place: 'inside' | 'before',
): { parentId: string | null; rank: number } | null {
  if (drag === over) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const target = byId.get(over);
  if (!target) return null;
  const parent = place === 'inside' ? target.id : target.parentId;
  // never under itself or one of its own pages
  for (let p: string | null = parent; p; p = byId.get(p)?.parentId ?? null)
    if (p === drag) return null;
  const siblings = nodes
    .filter((n) => n.parentId === parent && n.id !== drag)
    .sort((a, b) => a.rank - b.rank);
  if (place === 'inside') return { parentId: parent, rank: (siblings.at(-1)?.rank ?? 0) + 1 };
  const i = siblings.findIndex((n) => n.id === over);
  const before = i > 0 ? (siblings[i - 1]?.rank ?? target.rank - 2) : target.rank - 2;
  return { parentId: parent, rank: (before + target.rank) / 2 };
}

// ── files ──
interface PageFile {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  url: string;
}

export function PageFiles(props: {
  workspaceId: string;
  projectId: string;
  pageId: string;
  canEdit: boolean;
  /** puts Markdown at the end of the page (a new version) */
  onInsert: (md: string) => void;
  onChanged: () => void;
}): ReactNode {
  const D = (p: string): string => W(props.workspaceId, '/docs/' + props.pageId + '/files' + p);
  const [files, setFiles] = useState<PageFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<PageFile[]>('GET', D('')).then((r) => {
      if (r.ok) setFiles(r.data);
    });
  }, [props.workspaceId, props.pageId]);
  const add = async (list: FileList | null): Promise<void> => {
    if (!list?.length) return;
    setBusy(true);
    for (const f of [...list]) {
      const up = await uploadFile(props.workspaceId, props.projectId, f);
      if (!up.ok) {
        setError(up.error.message);
        continue;
      }
      const r = await api<PageFile[]>('POST', D(''), { fileId: up.data.id });
      if (r.ok) setFiles(r.data);
    }
    setBusy(false);
    props.onChanged();
  };
  return (
    <div className="pv-stack">
      <ul className="pv-rows pv-rows--tight">
        {files.map((f) => (
          <li key={f.id} className="pv-row pv-row--static">
            <span className="pv-row-main">
              <a className="pv-row-title" href={f.url} target="_blank" rel="noreferrer">
                {f.name}
              </a>
              <span className="pv-row-sub">
                {f.mime} · {Math.max(1, Math.round(f.sizeBytes / 1024))} KB
              </span>
            </span>
            {props.canEdit ? (
              <>
                <button
                  type="button"
                  className="pv-link pv-small"
                  title="Add it at the end of the page"
                  onClick={() => {
                    props.onInsert(
                      f.mime.startsWith('image/')
                        ? imageMarkdown(props.workspaceId, f.id, f.name)
                        : '[' + f.name + '](' + f.url + ')',
                    );
                  }}
                >
                  Insert
                </button>
                <button
                  type="button"
                  className="pv-mini-btn"
                  aria-label={'Take ' + f.name + ' off the page'}
                  onClick={() =>
                    void api<PageFile[]>('DELETE', D('/' + f.id)).then((r) => {
                      if (r.ok) setFiles(r.data);
                      props.onChanged();
                    })
                  }
                >
                  ×
                </button>
              </>
            ) : null}
          </li>
        ))}
        {!files.length ? (
          <li className="pv-muted pv-small v2-pad">No files on this page.</li>
        ) : null}
      </ul>
      {props.canEdit ? (
        <label className="pv-btn pv-btn--secondary pv-btn--sm v2-file-pick">
          {busy ? 'Uploading…' : 'Add files'}
          <input
            type="file"
            multiple
            disabled={busy}
            onChange={(e) => {
              void add(e.target.files).then(() => {
                e.target.value = '';
              });
            }}
          />
        </label>
      ) : null}
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ── readers ──
interface Readers {
  version: number;
  readers: {
    userId: string;
    name: string;
    version: number;
    reads: number;
    lastAt: string;
    latest: boolean;
  }[];
  unreadWatchers: { userId: string; name: string }[];
}

export function PageReaders(props: {
  workspaceId: string;
  pageId: string;
  version: number;
}): ReactNode {
  const [r, setR] = useState<Readers | null>(null);
  useEffect(() => {
    void api<Readers>('GET', W(props.workspaceId, '/docs/' + props.pageId + '/readers')).then(
      (x) => {
        if (x.ok) setR(x.data);
      },
    );
  }, [props.workspaceId, props.pageId, props.version]);
  if (!r)
    return (
      <p className="pv-muted" role="status">
        Loading…
      </p>
    );
  return (
    <div className="pv-stack">
      {r.unreadWatchers.length ? (
        <p className="pv-small v2-live-clash">
          Not read version {r.version} yet: {r.unreadWatchers.map((w) => w.name).join(', ')}
        </p>
      ) : null}
      <ul className="pv-rows pv-rows--tight">
        {r.readers.map((x) => (
          <li key={x.userId} className="pv-row pv-row--static">
            <span className="pv-row-main">
              <span className="pv-row-title">{x.name}</span>
              <span className="pv-row-sub">
                {x.latest ? 'read the latest version' : 'last read version ' + String(x.version)} ·{' '}
                {x.reads} {x.reads === 1 ? 'time' : 'times'} ·{' '}
                {new Date(x.lastAt).toLocaleString(fmtLocale(), {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </span>
            </span>
          </li>
        ))}
        {!r.readers.length ? (
          <li className="pv-muted pv-small v2-pad">Nobody has opened it yet.</li>
        ) : null}
      </ul>
    </div>
  );
}

// ── tasks whose agents may read the page ──
export function TaskKnowledge(props: {
  workspaceId: string;
  pageId: string;
  canEdit: boolean;
}): ReactNode {
  const D = (p: string): string => W(props.workspaceId, '/docs/' + props.pageId + '/tasks' + p);
  const [tasks, setTasks] = useState<{ itemId: string; ref: string; title: string }[]>([]);
  const [ref, setRef] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void api<typeof tasks>('GET', D('')).then((r) => {
      if (r.ok) setTasks(r.data);
    });
  }, [props.workspaceId, props.pageId]);
  return (
    <div className="v2-task-knowledge">
      <div className="pv-small pv-muted">
        Agents working on these tasks may read this page (and the pages under it):
      </div>
      <ul className="v2-inline">
        {tasks.map((t) => (
          <li key={t.itemId} className="pv-chip" title={t.title}>
            {t.ref}
            {props.canEdit ? (
              <button
                type="button"
                className="pv-mini-btn"
                aria-label={'Close the page to ' + t.ref}
                onClick={() =>
                  void api<typeof tasks>('DELETE', D('/' + t.itemId)).then((r) => {
                    if (r.ok) setTasks(r.data);
                  })
                }
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
        {!tasks.length ? <li className="pv-muted pv-small">none</li> : null}
      </ul>
      {props.canEdit ? (
        <form
          className="v2-inline"
          onSubmit={(e) => {
            e.preventDefault();
            void api<typeof tasks>('POST', D(''), { ref }).then((r) => {
              setError(r.ok ? '' : r.error.message);
              if (r.ok) {
                setTasks(r.data);
                setRef('');
              }
            });
          }}
        >
          <input
            className="v2-input"
            aria-label="Task reference"
            placeholder="e.g. APP-12"
            value={ref}
            onChange={(e) => {
              setRef(e.target.value);
            }}
          />
          <button type="submit" className="pv-btn pv-btn--sm" disabled={ref.trim().length < 3}>
            Open to its agents
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ── drawing on an image ──
export interface Mark {
  tool: 'box' | 'arrow' | 'text';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  text: string;
}

/** Draws the marks onto a 2D canvas in image pixels. */
export function drawMarks(
  g: CanvasRenderingContext2D,
  marks: readonly Mark[],
  scale: number,
): void {
  g.strokeStyle = '#e5484d';
  g.fillStyle = '#e5484d';
  g.lineWidth = Math.max(2, 3 * scale);
  g.font = 'bold ' + String(Math.round(18 * scale)) + 'px system-ui, sans-serif';
  for (const m of marks) {
    if (m.tool === 'box') g.strokeRect(m.x1, m.y1, m.x2 - m.x1, m.y2 - m.y1);
    else if (m.tool === 'arrow') {
      g.beginPath();
      g.moveTo(m.x1, m.y1);
      g.lineTo(m.x2, m.y2);
      g.stroke();
      const a = Math.atan2(m.y2 - m.y1, m.x2 - m.x1);
      const h = 14 * scale;
      g.beginPath();
      g.moveTo(m.x2, m.y2);
      g.lineTo(m.x2 - h * Math.cos(a - 0.45), m.y2 - h * Math.sin(a - 0.45));
      g.lineTo(m.x2 - h * Math.cos(a + 0.45), m.y2 - h * Math.sin(a + 0.45));
      g.closePath();
      g.fill();
    } else if (m.text) {
      const w = g.measureText(m.text).width;
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillRect(m.x1 - 4 * scale, m.y1 - 20 * scale, w + 8 * scale, 26 * scale);
      g.fillStyle = '#e5484d';
      g.fillText(m.text, m.x1, m.y1);
    }
  }
}

export function AnnotateDialog(props: {
  workspaceId: string;
  projectId: string;
  src: string;
  alt: string;
  onSaved: (newMarkdownSrc: string) => void;
  onClose: () => void;
}): ReactNode {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const dialog = useDialog<HTMLDivElement>(props.onClose); // [PCODE-358 | S15 | v0.1.0]
  const [tool, setTool] = useState<Mark['tool']>('box');
  const [marks, setMarks] = useState<Mark[]>([]);
  const [drag, setDrag] = useState<Mark | null>(null);
  // a label waits for its text where it was clicked
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const redraw = (list: readonly Mark[]): void => {
    const c = canvas.current;
    const i = img.current;
    const g = c?.getContext('2d');
    if (!c || !i || !g) return;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(i, 0, 0);
    drawMarks(g, list, Math.max(1, c.width / 900));
  };
  useEffect(() => {
    redraw(drag ? [...marks, drag] : marks);
  });
  const at = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const c = canvas.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  };
  const save = (): void => {
    const c = canvas.current;
    if (!c) return;
    setBusy(true);
    c.toBlob((blob) => {
      if (!blob) {
        setBusy(false);
        setError('The picture could not be made');
        return;
      }
      const name = (props.alt || 'image').replace(/\.\w+$/, '') + ' (annotated).png';
      void uploadFile(
        props.workspaceId,
        props.projectId,
        new File([blob], name, { type: 'image/png' }),
      ).then((r) => {
        setBusy(false);
        if (!r.ok) {
          setError(r.error.message);
          return;
        }
        props.onSaved(imageMarkdown(props.workspaceId, r.data.id, name));
      });
    }, 'image/png');
  };
  return (
    <div
      ref={dialog}
      className="v2-diff-panel v2-annotate"
      role="dialog"
      aria-label="Annotate the image"
    >
      <div className="v2-diff-head">
        <strong>Annotate</strong>
        <div className="pv-segmented" role="radiogroup" aria-label="Tool">
          {(
            [
              ['box', 'Box'],
              ['arrow', 'Arrow'],
              ['text', 'Label'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={tool === k}
              className="pv-seg"
              onClick={() => {
                setTool(k);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          kind="ghost"
          disabled={!marks.length}
          onClick={() => {
            setMarks((m) => m.slice(0, -1));
          }}
        >
          Undo
        </Button>
        <Button size="sm" kind="primary" disabled={busy || !marks.length} onClick={save}>
          {busy ? 'Saving…' : 'Save as a new image'}
        </Button>
        <button type="button" className="pv-link" onClick={props.onClose}>
          Close
        </button>
      </div>
      {pending ? (
        <form
          className="v2-inline v2-annotate-label"
          onSubmit={(e) => {
            e.preventDefault();
            const text = label.trim();
            if (text)
              setMarks((m) => [
                ...m,
                { tool: 'text', x1: pending.x, y1: pending.y, x2: pending.x, y2: pending.y, text },
              ]);
            setPending(null);
          }}
        >
          <input
            className="v2-input"
            aria-label="Label text"
            placeholder="The label"
            value={label}
            autoFocus
            onChange={(e) => {
              setLabel(e.target.value);
            }}
          />
          <button type="submit" className="pv-btn pv-btn--sm">
            Place
          </button>
        </form>
      ) : null}
      <img
        ref={img}
        src={props.src}
        alt=""
        className="v2-annotate-src"
        onLoad={(e) => {
          const c = canvas.current;
          if (!c) return;
          c.width = e.currentTarget.naturalWidth;
          c.height = e.currentTarget.naturalHeight;
          redraw(marks);
        }}
      />
      <canvas
        ref={canvas}
        className="v2-annotate-canvas"
        aria-label={'Drawing on ' + props.alt}
        onPointerDown={(e) => {
          const p = at(e);
          if (tool === 'text') {
            setPending(p);
            setLabel('');
            return;
          }
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // a pointer the browser does not track (a pen lifted early): drawing still works inside the image
          }
          setDrag({ tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, text: '' });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const p = at(e);
          setDrag({ ...drag, x2: p.x, y2: p.y });
        }}
        onPointerUp={() => {
          if (drag && (Math.abs(drag.x2 - drag.x1) > 4 || Math.abs(drag.y2 - drag.y1) > 4))
            setMarks((m) => [...m, drag]);
          setDrag(null);
        }}
      />
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
