// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-308 | S15 | v0.1.0] T31.8a Code map by feature, sprint and version, and its time-lapse ──
//    Why:  two views of the Code map. "By work": each feature, sprint or version with its files, lines and
//          tasks; picking one colours the folder map by how much of each folder it makes up. "Over time":
//          the folder map week by week, coloured by what changed, with the sprint that ran, a slider and a
//          play button.
import { intensity } from '@orqiva/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { treemap } from '../preview/codemap.js';
import { Button, Card, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface WorkGroup {
  key: string;
  label: string;
  files: number;
  lines: number;
  tasks: number;
  folders: { path: string; lines: number }[];
  shares: { path: string; share: number }[];
  paths: string[];
}
interface Timeline {
  folders: { path: string; lines: number }[];
  frames: {
    start: string;
    commits: number;
    changes: { path: string; files: number }[];
    sprint: string | null;
  }[];
  withoutFiles: number;
}
type By = 'feature' | 'sprint' | 'version';

const kLines = (n: number): string =>
  (n >= 1000 ? (Math.round(n / 100) / 10).toFixed(1).replace('.', ',') + 'k' : String(n)) +
  ' lines';

/** The treemap of folders, each coloured in steps 0–4. */
function FolderMap(props: {
  folders: { path: string; lines: number }[];
  step: (path: string) => number;
  label: string;
  title: (path: string) => string;
}): ReactNode {
  const shown = props.folders.slice(0, 40);
  const rects = treemap(
    shown.map((f) => Math.max(1, f.lines)),
    0,
    0,
    800,
    320,
  );
  return (
    <svg className="pv-treemap" viewBox="0 0 800 320" role="img" aria-label={props.label}>
      {rects.map((r) => {
        const f = shown[r.i];
        if (!f) return null;
        return (
          <g key={f.path} className="pv-tm-cell">
            <title>{props.title(f.path)}</title>
            <rect
              className={'pv-tm pv-tm--agent' + String(props.step(f.path))}
              x={r.x + 2}
              y={r.y + 2}
              width={Math.max(0, r.w - 4)}
              height={Math.max(0, r.h - 4)}
              rx="6"
            />
            {r.w > 60 && r.h > 28 ? (
              <text className="pv-tm-label" x={r.x + 12} y={r.y + 24}>
                {f.path.split('/').pop()}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function ByWork(props: { workspaceId: string; projectId: string }): ReactNode {
  const [by, setBy] = useState<By>('feature');
  const [groups, setGroups] = useState<WorkGroup[] | null>(null);
  const [folders, setFolders] = useState<{ path: string; lines: number }[]>([]);
  const [sel, setSel] = useState(0);
  useEffect(() => {
    setGroups(null);
    setSel(0);
    void api<WorkGroup[]>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/code-map/work?by=' + by + '&depth=2'),
    ).then((r) => {
      if (r.ok) setGroups(r.data);
    });
  }, [by, props.workspaceId, props.projectId]);
  useEffect(() => {
    void api<Timeline>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/code-map/timeline?weeks=2&depth=2'),
    ).then((r) => {
      if (r.ok) setFolders(r.data.folders);
    });
  }, [props.workspaceId, props.projectId]);
  const g = groups?.[sel];
  const share = useMemo(() => new Map(g?.shares.map((x) => [x.path, x.share]) ?? []), [g]);
  const max = Math.max(1, ...(groups ?? []).map((x) => x.lines));
  return (
    <div className="pv-split">
      <Card
        title="Code by work"
        action={
          <span className="pv-segmented" role="radiogroup" aria-label="Group by">
            {(
              [
                ['feature', 'Feature'],
                ['sprint', 'Sprint'],
                ['version', 'Version'],
              ] as [By, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={by === k}
                className="pv-seg"
                onClick={() => {
                  setBy(k);
                }}
              >
                {l}
              </button>
            ))}
          </span>
        }
      >
        {!groups ? (
          <p className="pv-muted" role="status">
            Loading…
          </p>
        ) : groups.length ? (
          <ul className="v2-cw-list">
            {groups.map((x, i) => (
              <li key={x.key + x.label}>
                <button
                  type="button"
                  className="v2-cw-row"
                  aria-pressed={i === sel}
                  onClick={() => {
                    setSel(i);
                  }}
                >
                  <span className="v2-cw-label">{x.label}</span>
                  <span className="pv-small pv-muted">
                    {kLines(x.lines)} · {x.files} file{x.files === 1 ? '' : 's'}
                    {x.tasks ? ' · ' + String(x.tasks) + ' task' + (x.tasks === 1 ? '' : 's') : ''}
                  </span>
                  <span className="v2-cw-bar" aria-hidden="true">
                    <span
                      className={'v2-cw-fill v2-cw-w' + String(Math.round((x.lines / max) * 10))}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pv-empty">No code scan yet: run orq docs scan.</p>
        )}
      </Card>
      <Card title={g ? g.label : 'Where it lives'}>
        {g ? (
          <>
            <FolderMap
              folders={folders}
              step={(p) => intensity(share.get(p) ?? 0, 1)}
              label={'Folders coloured by how much of them ' + g.label + ' makes up'}
              title={(p) => p + ' · ' + String(Math.round((share.get(p) ?? 0) * 100)) + ' % of it'}
            />
            <p className="pv-small">
              Mostly in{' '}
              {g.folders.map((f, i) => (
                <span key={f.path}>
                  {i ? ', ' : ''}
                  <span className="pv-mono">{f.path}</span> ({kLines(f.lines)})
                </span>
              ))}
              .
            </p>
          </>
        ) : null}
      </Card>
    </div>
  );
}

export function OverTime(props: { workspaceId: string; projectId: string }): ReactNode {
  const [weeks, setWeeks] = useState(12);
  const [data, setData] = useState<Timeline | null>(null);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    void api<Timeline>(
      'GET',
      W(
        props.workspaceId,
        '/projects/' + props.projectId + '/code-map/timeline?weeks=' + String(weeks) + '&depth=2',
      ),
    ).then((r) => {
      if (r.ok) {
        setData(r.data);
        setAt(r.data.frames.length - 1);
      }
    });
  }, [weeks, props.workspaceId, props.projectId]);
  useEffect(() => {
    if (!playing || !data) return;
    const t = window.setInterval(() => {
      setAt((k) => {
        if (k >= data.frames.length - 1) {
          setPlaying(false);
          return k;
        }
        return k + 1;
      });
    }, 900);
    return () => {
      window.clearInterval(t);
    };
  }, [playing, data]);
  if (!data)
    return (
      <p className="pv-muted" role="status">
        Loading the history…
      </p>
    );
  const frame = data.frames[at];
  const changes = new Map(frame?.changes.map((c) => [c.path, c.files]) ?? []);
  const max = Math.max(1, ...data.frames.flatMap((f) => f.changes.map((c) => c.files)));
  const busiest = [...(frame?.changes ?? [])].sort((x, y) => y.files - x.files).slice(0, 4);
  return (
    <Card
      title="The code over time"
      action={
        <span className="pv-page-actions">
          <select
            className="v2-input v2-input--sm"
            aria-label="Weeks"
            value={String(weeks)}
            onChange={(e) => {
              setWeeks(Number(e.target.value));
            }}
          >
            {[8, 12, 26, 52].map((n) => (
              <option key={n} value={String(n)}>
                {n} weeks
              </option>
            ))}
          </select>
          <Button
            size="sm"
            icon={playing ? 'pause' : 'play'}
            onClick={() => {
              if (!playing && at >= data.frames.length - 1) setAt(0);
              setPlaying(!playing);
            }}
          >
            {playing ? 'Pause' : 'Play'}
          </Button>
        </span>
      }
    >
      <div className="v2-cw-frame">
        <input
          type="range"
          min={0}
          max={Math.max(0, data.frames.length - 1)}
          value={at}
          aria-label="Week"
          aria-valuetext={frame ? 'Week of ' + frame.start : ''}
          onChange={(e) => {
            setPlaying(false);
            setAt(Number(e.target.value));
          }}
        />
        <p className="pv-small" role="status">
          Week of <strong>{frame?.start}</strong>
          {frame?.sprint ? (
            <>
              {' '}
              · <Chip tone="info">{frame.sprint}</Chip>
            </>
          ) : null}{' '}
          · {frame?.commits ?? 0} commit{frame?.commits === 1 ? '' : 's'}
          {busiest.length
            ? ' · busiest: ' + busiest.map((b) => b.path + ' (' + String(b.files) + ')').join(', ')
            : ' · nothing changed'}
        </p>
      </div>
      <FolderMap
        folders={data.folders}
        step={(p) => intensity(changes.get(p) ?? 0, max)}
        label="Folders coloured by how many files changed that week"
        title={(p) => p + ' · ' + String(changes.get(p) ?? 0) + ' changed files'}
      />
      <p className="pv-small pv-muted">
        The darker a folder, the more of its files changed that week; the darkest is {max} changed
        file{max === 1 ? '' : 's'} in one week of these {data.frames.length}.
      </p>
      {data.withoutFiles ? (
        <p className="pv-small pv-muted">
          {data.withoutFiles} commit{data.withoutFiles === 1 ? '' : 's'} came without a file list
          from the host and are counted, not placed.
        </p>
      ) : null}
    </Card>
  );
}
