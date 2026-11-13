// ── [PCODE-266 | S15 | v0.1.0] Canvas fixes from the T27 browser walkthrough: drop jump-back, grid start width, Enter above a summary, picture menu closing ──
// ── [PCODE-264 | S15 | v0.1.0] T27.6 Canvas pictures and sharing: PNG and PDF with page fitting, read-only share link with iCal subscription ──
//    Why:  the Canvas hands its plan to people outside the app: a picture (PNG for slides, a PDF fitted to A4
//          or A3), a read-only link anyone can open without an account, and the same link as a calendar
//          subscription. The shared page shows the Gantt and the timeline and nothing private.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';
import type { PlanData } from './canvas.js';
import { TimelineV2 } from './canvasviews.js';
import { GanttV2, ZOOMS, type Zoom } from './gantt.js';
import {
  downloadPng,
  fitPages,
  ganttSvg,
  printPdf,
  type Fit,
  type Orientation,
  type Paper,
} from './ganttpicture.js';

/** PNG and PDF of the Gantt as shown. */
export function PictureMenu(props: {
  plan: PlanData;
  zoom: Zoom;
  critical: boolean;
  title: string;
  onError: (m: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [paper, setPaper] = useState<Paper>('a4');
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [fit, setFit] = useState<Fit>('page');
  // [PCODE-266 | S15 | v0.1.0] a click outside the menu, or Escape, closes it; its own controls keep it open
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  const pic = (): ReturnType<typeof ganttSvg> =>
    ganttSvg(props.plan, { zoom: props.zoom, title: props.title, critical: props.critical });
  const fileBase =
    props.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'plan';
  const sizes = open ? pic() : null;
  const f = sizes ? fitPages(sizes.width, sizes.height, paper, orientation, fit) : null;
  return (
    <span className="pv-menu-wrap" ref={wrap}>
      <Button
        size="sm"
        kind="ghost"
        icon="documents"
        onClick={() => {
          setOpen(!open);
        }}
      >
        Picture
      </Button>
      {open ? (
        <span className="pv-menu pv-menu--wide" role="dialog" aria-label="Picture of the Gantt">
          <button
            type="button"
            className="pv-menu-item"
            onClick={() => {
              void downloadPng(pic(), fileBase + '-gantt.png').catch((e: unknown) => {
                props.onError(e instanceof Error ? e.message : 'The picture could not be made');
              });
              setOpen(false);
            }}
          >
            PNG picture
          </button>
          <span className="pv-menu-group">
            <span className="pv-small pv-muted">PDF</span>
            <select
              className="v2-input v2-input--sm"
              aria-label="Paper"
              value={paper}
              onChange={(e) => {
                setPaper(e.target.value as Paper);
              }}
            >
              <option value="a4">A4</option>
              <option value="a3">A3</option>
            </select>
            <select
              className="v2-input v2-input--sm"
              aria-label="Orientation"
              value={orientation}
              onChange={(e) => {
                setOrientation(e.target.value as Orientation);
              }}
            >
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
            <select
              className="v2-input v2-input--sm"
              aria-label="Fit"
              value={fit}
              onChange={(e) => {
                setFit(e.target.value as Fit);
              }}
            >
              <option value="page">On one page</option>
              <option value="width">Page wide, pages down</option>
            </select>
          </span>
          {f ? (
            <span className="pv-small pv-muted">
              {String(Math.round(f.scale * 100))} % · {f.pages} {f.pages === 1 ? 'page' : 'pages'}
            </span>
          ) : null}
          <button
            type="button"
            className="pv-menu-item"
            onClick={() => {
              setOpen(false);
              printPdf(pic(), paper, orientation, fit);
            }}
          >
            Print or save as PDF
          </button>
        </span>
      ) : null}
    </span>
  );
}

interface Share {
  id: string;
  label: string;
  createdAt: string;
  createdBy: string | null;
  expiresOn: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  active: boolean;
}

/** The links of a plan for a page and for a calendar. */
export const shareUrls = (origin: string, token: string): { page: string; calendar: string } => ({
  page: origin + '/share/plan/' + token,
  calendar: origin.replace(/^https?:/, 'webcal:') + '/api/share/plan/' + token + '/ics',
});

export function SharePanel(props: {
  workspaceId: string;
  projectId: string;
  onClose: () => void;
}): ReactNode {
  const P =
    '/api/workspaces/' + props.workspaceId + '/projects/' + props.projectId + '/plan/shares';
  const [list, setList] = useState<Share[]>([]);
  const [label, setLabel] = useState('');
  const [until, setUntil] = useState('');
  const [fresh, setFresh] = useState<{ page: string; calendar: string } | null>(null);
  const [error, setError] = useState('');
  const load = async (): Promise<void> => {
    const r = await api<Share[]>('GET', P);
    if (r.ok) setList(r.data);
    else setError(r.error.message);
  };
  useEffect(() => {
    void load();
  }, [props.projectId]);
  const copy = (text: string): void => {
    void navigator.clipboard.writeText(text).catch(() => undefined);
  };
  return (
    <Card
      title="Share the plan read-only"
      action={
        <Button size="sm" kind="ghost" onClick={props.onClose}>
          Close
        </Button>
      }
    >
      <p className="pv-small pv-muted">
        Anyone with the link sees the Gantt and the timeline without signing in: tasks, dates, links
        and progress, no people, comments or code. The same link works as a calendar subscription.
      </p>
      <form
        className="v2-inline"
        onSubmit={(e) => {
          e.preventDefault();
          void api<{ token: string }>('POST', P, {
            label: label.trim(),
            ...(until ? { expiresOn: until } : {}),
          }).then((r) => {
            if (!r.ok) {
              setError(r.error.message);
              return;
            }
            setFresh(shareUrls(window.location.origin, r.data.token));
            setLabel('');
            setUntil('');
            void load();
          });
        }}
      >
        <input
          className="v2-input v2-input--sm"
          aria-label="Name of the link"
          placeholder="For whom, e.g. Steering board"
          maxLength={80}
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
          }}
        />
        <span className="pv-small pv-muted">ends on</span>
        <input
          type="date"
          className="v2-input v2-input--sm"
          aria-label="Ends on"
          value={until}
          onChange={(e) => {
            setUntil(e.target.value);
          }}
        />
        <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm">
          Make a link
        </button>
      </form>
      {fresh ? (
        <div className="pv-share-fresh" role="status">
          <p className="pv-small">Copy the link now; it is shown only once.</p>
          <span className="v2-inline">
            <input
              className="v2-input v2-input--sm pv-mono"
              readOnly
              aria-label="Link to the plan"
              value={fresh.page}
            />
            <Button
              size="sm"
              onClick={() => {
                copy(fresh.page);
              }}
            >
              Copy link
            </Button>
          </span>
          <span className="v2-inline">
            <input
              className="v2-input v2-input--sm pv-mono"
              readOnly
              aria-label="Calendar address"
              value={fresh.calendar}
            />
            <Button
              size="sm"
              onClick={() => {
                copy(fresh.calendar);
              }}
            >
              Copy calendar address
            </Button>
          </span>
        </div>
      ) : null}
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {list.length ? (
        <ul className="pv-rows pv-rows--tight">
          {list.map((s) => (
            <li key={s.id} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">
                  {s.label || 'Read-only link'}{' '}
                  {s.active ? (
                    <Chip tone="success">active</Chip>
                  ) : (
                    <Chip>{s.revokedAt ? 'withdrawn' : 'ended'}</Chip>
                  )}
                </span>
                <span className="pv-row-sub">
                  {'made ' +
                    s.createdAt.slice(0, 10) +
                    (s.createdBy ? ' by ' + s.createdBy : '') +
                    (s.expiresOn ? ' · ends ' + s.expiresOn : '') +
                    (s.lastUsedAt
                      ? ' · last opened ' + s.lastUsedAt.slice(0, 10)
                      : ' · not opened yet')}
                </span>
              </span>
              {s.active ? (
                <Button
                  size="sm"
                  kind="ghost"
                  onClick={() => {
                    void api(
                      'DELETE',
                      '/api/workspaces/' + props.workspaceId + '/plan-shares/' + s.id,
                    ).then(() => {
                      void load();
                    });
                  }}
                >
                  Withdraw
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

interface SharedPlan {
  project: { name: string; key: string };
  today: string;
  workingDays: string[];
  start: string;
  finish: string;
  tasks: {
    id: string;
    ref: string;
    title: string;
    kind: string;
    stateGroup: string;
    parentId: string | null;
  }[];
  schedule: PlanData['schedule'];
  dependencies: PlanData['dependencies'];
}

/** The token in /share/plan/<token>, if the path is one. */
export const shareToken = (path: string): string | null =>
  /^\/share\/plan\/([A-Za-z0-9_-]{20,100})\/?$/.exec(path)?.[1] ?? null;

/** The plan behind a share link, for anyone holding it. */
export function SharedPlanPage(props: { token: string }): ReactNode {
  const [data, setData] = useState<SharedPlan | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'gantt' | 'timeline'>('gantt');
  const [zoom, setZoom] = useState<Zoom>('week');
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    void api<SharedPlan>('GET', '/api/share/plan/' + props.token).then((r) => {
      if (r.ok) {
        setData(r.data);
        document.title = r.data.project.name + ' · plan';
      } else setError(r.error.message);
    });
  }, [props.token]);
  if (error)
    return (
      <main className="pe-auth">
        <p>{error}</p>
        <p className="pe-muted">Ask whoever sent it for a new link.</p>
      </main>
    );
  if (!data) return <main className="pe-auth pe-muted">Loading…</main>;
  const plan: PlanData = {
    today: data.today,
    workingDays: data.workingDays,
    start: data.start,
    finish: data.finish,
    tasks: data.tasks.map((t) => ({
      ...t,
      assigneeId: null,
      estimate: null,
      sprintId: null,
      startDate: null,
      dueDate: null,
      durationDays: null,
      scheduleMode: 'auto',
    })),
    schedule: data.schedule,
    dependencies: data.dependencies,
    cycle: [],
    ignored: [],
    baseline: null,
    scenario: null,
  };
  const urls = shareUrls(window.location.origin, props.token);
  return (
    <div className="pv-app v2-part">
      <div className="pv-page pv-page--full pv-shared">
        <header className="pv-shared-head">
          <span>
            <span className="pv-mono pv-muted">{data.project.key}</span>{' '}
            <strong>{data.project.name}</strong>
            <span className="pv-muted pv-small"> · read-only plan, shared from Orqiva</span>
          </span>
          <a className="pv-btn pv-btn--sm" href={urls.calendar}>
            Subscribe in a calendar
          </a>
        </header>
        <div className="pv-toolbar">
          <div className="pv-segmented" role="radiogroup" aria-label="View">
            {(['gantt', 'timeline'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                className="pv-seg"
                onClick={() => {
                  setView(v);
                }}
              >
                {v === 'gantt' ? 'Gantt' : 'Timeline'}
              </button>
            ))}
          </div>
          {view === 'gantt' ? (
            <div className="pv-segmented" role="radiogroup" aria-label="Zoom">
              {ZOOMS.map((z) => (
                <button
                  key={z.key}
                  type="button"
                  role="radio"
                  aria-checked={zoom === z.key}
                  className="pv-seg"
                  onClick={() => {
                    setZoom(z.key);
                  }}
                >
                  {z.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {view === 'gantt' ? (
          <Card flush>
            <GanttV2
              plan={plan}
              zoom={zoom}
              critical
              selected={selected}
              name={() => ''}
              onSelect={setSelected}
            />
          </Card>
        ) : (
          <TimelineV2 plan={plan} onSelect={setSelected} />
        )}
        <p className="pv-muted pv-small">
          Dates are working days of the team; the plan changes as the team works. Today is{' '}
          {data.today}.
        </p>
      </div>
    </div>
  );
}
