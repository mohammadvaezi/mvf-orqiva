// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-295 | S15 | v0.1.0] T30.8b Visual regression: baselines, pixel diff, orq visual check, the Visual tab ──
//    Why:  the screens under visual checks, failing ones first: the baseline against the latest screenshot
//          (side by side, overlay, swipe, difference, or the server's diff image with what changed in red),
//          approve when the change is meant, how much a screen may change, and the mockup it is built
//          from to hold the screenshot against the design.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { CompareImages, type CompareMode } from './overlay.js';

interface Run {
  id: string;
  name: string;
  status: string;
  reason: string;
  imageUrl: string;
  diffUrl: string | null;
  width: number;
  height: number;
  changed: number;
  ratio: number;
  commit: string;
  author: string | null;
  createdAt: string;
}
interface Baseline {
  id: string;
  imageUrl: string;
  width: number;
  height: number;
  maxDiff: number;
  mockupId: string | null;
  mockupTitle: string | null;
  mockupImageUrl: string | null;
  approvedBy: string | null;
  approvedAt: string;
}
interface Screen {
  name: string;
  baseline: Baseline | null;
  latest: Run | null;
  checks: number;
}

export const STATUS_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  pass: 'success',
  fail: 'danger',
  new: 'warning',
  approved: 'neutral',
};
export const statusText = (s: string): string =>
  s === 'pass'
    ? 'as approved'
    : s === 'fail'
      ? 'changed'
      : s === 'new'
        ? 'waits for a baseline'
        : 'approved';

/** A share as a percent with two decimals: 0.0012 → "0.12 %". */
export const percent = (x: number): string => (x * 100).toFixed(2) + ' %';

/** A moment in the viewer's own time: 2026-10-12 21:37. */
export const when = (iso: string): string => {
  const d = new Date(iso);
  const two = (n: number): string => String(n).padStart(2, '0');
  return (
    String(d.getFullYear()) +
    '-' +
    two(d.getMonth() + 1) +
    '-' +
    two(d.getDate()) +
    ' ' +
    two(d.getHours()) +
    ':' +
    two(d.getMinutes())
  );
};

type Look = CompareMode | 'diff' | 'design';

export function VisualChecks(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
}): ReactNode {
  const W = '/api/workspaces/' + props.workspaceId;
  const P = W + '/projects/' + props.projectId;
  const [screens, setScreens] = useState<Screen[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<Screen[]>('GET', P + '/visual');
    if (r.ok) setScreens(r.data);
  }, [P]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!screens)
    return (
      <p className="pv-muted" role="status">
        Loading…
      </p>
    );
  const shown = screens.find((x) => x.name === open) ?? null;
  const failing = screens.filter((x) => x.latest?.status === 'fail').length;
  const waiting = screens.filter((x) => x.latest?.status === 'new').length;
  return (
    <div className="pv-stack">
      {!screens.length ? (
        <Card title="Visual checks">
          <p className="pv-small">
            No screen is checked yet. In CI, after the screenshots are taken, run{' '}
            <code className="v2-mono">orq visual check shots/*.png</code>: each PNG is compared with
            its screen’s approved look, and the step fails when a screen changed more than it may.
          </p>
        </Card>
      ) : (
        <Card
          flush
          title={
            String(screens.length) +
            ' screens' +
            (failing ? ' · ' + String(failing) + ' changed' : '') +
            (waiting ? ' · ' + String(waiting) + ' waiting' : '')
          }
        >
          <table className="pv-table">
            <thead>
              <tr>
                <th>Screen</th>
                <th>State</th>
                <th>Last check</th>
                <th>Allowed</th>
              </tr>
            </thead>
            <tbody>
              {screens.map((x) => (
                <tr key={x.name} aria-selected={x.name === open}>
                  <td className="pv-cell-grow">
                    <button
                      type="button"
                      className="pv-link-btn pv-strong"
                      onClick={() => {
                        setOpen(open === x.name ? null : x.name);
                      }}
                    >
                      {x.name}
                    </button>
                    {x.latest ? (
                      <span className="pv-muted pv-block pv-small">{x.latest.reason}</span>
                    ) : null}
                  </td>
                  <td>
                    {x.latest ? (
                      <Chip tone={STATUS_TONE[x.latest.status] ?? 'neutral'}>
                        {statusText(x.latest.status)}
                      </Chip>
                    ) : (
                      <Chip>no check</Chip>
                    )}
                  </td>
                  <td className="pv-muted pv-small v2-nowrap">
                    {x.latest ? when(x.latest.createdAt) : '–'}
                    {x.latest?.commit ? (
                      <span className="v2-mono"> · {x.latest.commit.slice(0, 7)}</span>
                    ) : null}
                  </td>
                  <td className="pv-small v2-nowrap">
                    {x.baseline ? percent(x.baseline.maxDiff) : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {shown ? (
        <ScreenDetail
          key={shown.name}
          W={W}
          P={P}
          screen={shown}
          canEdit={props.canEdit}
          onChanged={() => void load()}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function ScreenDetail(props: {
  W: string;
  P: string;
  screen: Screen;
  canEdit: boolean;
  onChanged: () => void;
  onError: (m: string) => void;
}): ReactNode {
  const { screen } = props;
  const b = screen.baseline;
  const r = screen.latest;
  const [look, setLook] = useState<Look>(r?.diffUrl ? 'diff' : 'side');
  const [runs, setRuns] = useState<Run[]>([]);
  const [mockups, setMockups] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    void api<Run[]>('GET', props.P + '/visual/runs?name=' + encodeURIComponent(screen.name)).then(
      (x) => {
        if (x.ok) setRuns(x.data);
      },
    );
    void api<{ id: string; title: string }[]>('GET', props.P + '/mockups').then((x) => {
      if (x.ok) setMockups(x.data);
    });
  }, [props.P, screen.name, screen.latest?.id]);
  const act = async (
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<void> => {
    const x = await api(method, props.W + path, body);
    if (!x.ok) props.onError(x.error.message);
    else props.onError('');
    props.onChanged();
  };
  const looks: { key: Look; label: string; ok: boolean }[] = [
    { key: 'diff', label: 'Diff image', ok: Boolean(r?.diffUrl) },
    { key: 'side', label: 'Side by side', ok: Boolean(b && r) },
    { key: 'overlay', label: 'Overlay', ok: Boolean(b && r) },
    { key: 'swipe', label: 'Swipe', ok: Boolean(b && r) },
    { key: 'difference', label: 'Difference', ok: Boolean(b && r) },
    { key: 'design', label: 'Against the design', ok: Boolean(b?.mockupImageUrl && r) },
  ];
  return (
    <Card
      title={screen.name}
      action={
        <span className="pv-page-actions">
          {props.canEdit && r && (r.status === 'fail' || r.status === 'new') ? (
            <Button
              size="sm"
              kind="primary"
              icon="check"
              onClick={() => void act('POST', '/visual-runs/' + r.id + '/approve', {})}
            >
              {r.status === 'new' ? 'Approve as the baseline' : 'Approve the change'}
            </Button>
          ) : null}
        </span>
      }
    >
      <div className="v2-inline" role="group" aria-label="How to look">
        {looks
          .filter((x) => x.ok)
          .map((x) => (
            <button
              key={x.key}
              type="button"
              className="pv-subtab"
              aria-pressed={look === x.key}
              onClick={() => {
                setLook(x.key);
              }}
            >
              {x.label}
            </button>
          ))}
      </div>
      <div className="v2-mt">
        {!b && r ? (
          <figure className="v2-pinned">
            <img
              className="v2-visual-img"
              src={r.imageUrl}
              alt={screen.name + ', latest screenshot'}
            />
            <figcaption className="pv-small pv-muted">
              The first screenshot: approve it to compare the next ones with it.
            </figcaption>
          </figure>
        ) : look === 'diff' && r?.diffUrl ? (
          <figure className="v2-pinned">
            <img
              className="v2-visual-img"
              src={r.diffUrl}
              alt={screen.name + ', what changed in red'}
            />
            <figcaption className="pv-small pv-muted">{r.reason}. Red is what changed.</figcaption>
          </figure>
        ) : b && r && look === 'side' ? (
          <div className="v2-compare">
            <figure className="v2-pinned">
              <img className="v2-visual-img" src={b.imageUrl} alt={screen.name + ', baseline'} />
              <figcaption className="pv-small pv-muted">
                Baseline, approved by {b.approvedBy ?? 'someone'}
              </figcaption>
            </figure>
            <figure className="v2-pinned">
              <img className="v2-visual-img" src={r.imageUrl} alt={screen.name + ', latest'} />
              <figcaption className="pv-small pv-muted">Latest, {when(r.createdAt)}</figcaption>
            </figure>
          </div>
        ) : b && r && look === 'design' && b.mockupImageUrl ? (
          <CompareImages
            mode="overlay"
            base={{ url: b.mockupImageUrl, label: 'Design' }}
            top={{ url: r.imageUrl, label: 'Screenshot' }}
          />
        ) : b && r && (look === 'overlay' || look === 'swipe' || look === 'difference') ? (
          <CompareImages
            mode={look}
            base={{ url: b.imageUrl, label: 'Baseline' }}
            top={{ url: r.imageUrl, label: 'Latest' }}
          />
        ) : null}
      </div>
      {b ? (
        <div className="v2-inline v2-mt">
          <label className="v2-field">
            <span>Allowed change, %</span>
            <input
              className="v2-input v2-handoff-num"
              type="number"
              min={0}
              max={100}
              step={0.01}
              disabled={!props.canEdit}
              defaultValue={(b.maxDiff * 100).toFixed(2)}
              onBlur={(e) => {
                const v = Number(e.target.value) / 100;
                if (Number.isFinite(v) && v >= 0 && v <= 1 && Math.abs(v - b.maxDiff) > 1e-7)
                  void act('PATCH', '/visual-baselines/' + b.id, { maxDiff: v });
              }}
            />
          </label>
          <label className="v2-field">
            <span>Built from the mockup</span>
            <select
              className="pv-select"
              disabled={!props.canEdit}
              value={b.mockupId ?? ''}
              onChange={(e) =>
                void act('PATCH', '/visual-baselines/' + b.id, { mockupId: e.target.value || null })
              }
            >
              <option value="">None</option>
              {mockups.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
          {props.canEdit ? (
            <button
              type="button"
              className="pv-link-btn pv-small"
              onClick={() => void act('DELETE', '/visual-baselines/' + b.id)}
            >
              Stop checking this screen
            </button>
          ) : null}
        </div>
      ) : null}
      {runs.length ? (
        <ul className="pv-rows pv-rows--tight v2-mt">
          {runs.slice(0, 12).map((x) => (
            <li key={x.id} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">
                  <Chip tone={STATUS_TONE[x.status] ?? 'neutral'}>{statusText(x.status)}</Chip>{' '}
                  {x.reason}
                </span>
                <span className="pv-row-sub">
                  {when(x.createdAt)} · {x.author ?? 'someone'}
                  {x.commit ? ' · ' + x.commit.slice(0, 7) : ''} · {x.width} × {x.height}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
