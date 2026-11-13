// ── [PCODE-358 | S15 | v0.1.0] T35.6 Accessibility to WCAG 2.2 AA ──
// ── [PCODE-252 | S15 | v0.1.0] T26.1 Estimation: units, async planning poker, suggestions from similar tasks, estimate vs actual ──
//    Why:  estimates in the project's unit wherever a task shows one; in the task drawer a suggestion from
//          similar finished tasks and a round of planning poker; in Reports, estimates against the hours
//          really logged.
import {
  asUnit,
  estimateText,
  POKER_DECKS,
  sizeOf,
  TSHIRT,
  type EstimateUnit,
} from '@orqiva/shared';
import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

/** The project's estimate unit, from its settings. */
export function useEstimateUnit(workspaceId: string, projectId: string): EstimateUnit {
  const [unit, setUnit] = useState<EstimateUnit>('points');
  useEffect(() => {
    void api<{ key: string; value: unknown }[]>(
      'GET',
      W(workspaceId, '/settings?projectId=' + projectId),
    ).then((r) => {
      if (r.ok) setUnit(asUnit(r.data.find((s) => s.key === 'planning.estimate_unit')?.value));
    });
  }, [workspaceId, projectId]);
  return unit;
}

/** The unit of the project on screen, for cards and lists deep in the page. */
export const UnitContext = createContext<EstimateUnit>('points');

export const UNIT_LABEL: Record<EstimateUnit, string> = {
  points: 'Points',
  hours: 'Hours',
  tshirt: 'Size',
};

/** The estimate as a number field, or a size picker for T-shirt sizes. */
export function EstimateField(props: {
  unit: EstimateUnit;
  value: number | null;
  disabled: boolean;
  onChange: (v: number | null) => void;
}): ReactNode {
  if (props.unit === 'tshirt')
    return (
      // [PCODE-358 | S15 | v0.1.0] the unit names the field
      <select
        aria-label={UNIT_LABEL[props.unit]}
        value={
          props.value === null
            ? ''
            : String(TSHIRT.find((t) => t.size === sizeOf(props.value ?? 0))?.points)
        }
        disabled={props.disabled}
        onChange={(e) => {
          props.onChange(e.target.value === '' ? null : Number(e.target.value));
        }}
      >
        <option value="">—</option>
        {TSHIRT.map((t) => (
          <option key={t.size} value={t.points}>
            {t.size}
          </option>
        ))}
      </select>
    );
  return (
    <input
      type="number"
      aria-label={UNIT_LABEL[props.unit]}
      min={0}
      max={1000}
      disabled={props.disabled}
      value={props.value ?? ''}
      onChange={(e) => {
        props.onChange(
          e.target.value === ''
            ? null
            : Math.max(0, Math.min(1000, Math.round(Number(e.target.value)))),
        );
      }}
    />
  );
}

interface Round {
  id: string;
  unit: string;
  deck: string[];
  status: string;
  startedBy: string | null;
  voters: { userId: string; name: string; card: string | null }[];
  myCard: string | null;
  summary: {
    votes: number;
    low: number | null;
    high: number | null;
    agreed: boolean;
    suggested: string | null;
  } | null;
  accepted: number | null;
}

interface Suggestion {
  unit: string;
  value: number | null;
  basis: string;
  similar: { ref: string; title: string; estimate: number | null; hours: number; score: number }[];
}

/** In the task drawer: a suggestion from similar tasks, and planning poker. */
export function EstimatePanel(props: {
  workspaceId: string;
  itemId: string;
  unit: EstimateUnit;
  canEdit: boolean;
  onEstimate: (v: number) => void;
}): ReactNode {
  const [round, setRound] = useState<Round | null>(null);
  const [hint, setHint] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ round: Round | null }>(
      'GET',
      W(props.workspaceId, '/items/' + props.itemId + '/poker'),
    );
    if (r.ok) setRound(r.data.round);
  }, [props.workspaceId, props.itemId]);
  useEffect(() => {
    setHint(null);
    void load();
  }, [load]);
  const act = async (method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<void> => {
    setError(null);
    const r = await api<Round>(method, W(props.workspaceId, path), body);
    if (!r.ok) setError(r.error.message);
    await load();
  };
  const suggest = async (): Promise<void> => {
    const r = await api<Suggestion>(
      'GET',
      W(props.workspaceId, '/items/' + props.itemId + '/estimate-suggestion'),
    );
    if (r.ok) setHint(r.data);
    else setError(r.error.message);
  };
  const live = round && round.status !== 'closed' ? round : null;
  return (
    <div className="es-panel">
      <div className="v2-inline">
        <Button size="sm" kind="ghost" icon="sparkle" onClick={() => void suggest()}>
          Suggest from similar tasks
        </Button>
        {props.canEdit && !live ? (
          <Button
            size="sm"
            kind="ghost"
            onClick={() => void act('POST', '/items/' + props.itemId + '/poker')}
          >
            Planning poker
          </Button>
        ) : null}
      </div>
      {hint ? (
        <div className="es-hint pv-small">
          {hint.value === null ? (
            <span className="pv-muted">No finished task reads like this one yet.</span>
          ) : (
            <>
              <strong>{estimateText(hint.value, props.unit)}</strong>{' '}
              <span className="pv-muted">
                {hint.basis === 'actual'
                  ? 'from what similar tasks took'
                  : 'from the estimates of similar tasks'}
              </span>{' '}
              {props.canEdit ? (
                <button
                  type="button"
                  className="pv-link-btn"
                  onClick={() => {
                    if (hint.value !== null) props.onEstimate(hint.value);
                  }}
                >
                  Use it
                </button>
              ) : null}
            </>
          )}
          <ul className="es-similar">
            {hint.similar.map((s) => (
              <li key={s.ref}>
                <span className="pv-mono">{s.ref}</span> {s.title}{' '}
                <span className="pv-muted">
                  · {s.estimate === null ? 'no estimate' : estimateText(s.estimate, props.unit)}
                  {s.hours ? ' · ' + String(s.hours) + ' h logged' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {live ? (
        <div className="es-poker" aria-label="Planning poker">
          <div className="pv-small">
            <strong>Planning poker</strong>{' '}
            <span className="pv-muted">
              {live.status === 'open'
                ? String(live.voters.length) +
                  ' voted' +
                  (live.voters.length ? ': ' + live.voters.map((v) => v.name).join(', ') : '')
                : 'cards on the table'}
            </span>
          </div>
          {live.status === 'open' && props.canEdit ? (
            <div className="es-deck" role="group" aria-label="Your card">
              {POKER_DECKS[asUnit(live.unit)].map((card) => (
                <button
                  key={card}
                  type="button"
                  className={'es-card' + (live.myCard === card ? ' es-card--mine' : '')}
                  aria-pressed={live.myCard === card}
                  onClick={() => void act('POST', '/poker/' + live.id + '/vote', { card })}
                >
                  {card}
                </button>
              ))}
            </div>
          ) : null}
          {live.status === 'revealed' ? (
            <div className="es-deck">
              {live.voters.map((v) => (
                <span key={v.userId} className="es-card es-card--shown" title={v.name}>
                  {v.card}
                  <span className="es-who">{v.name}</span>
                </span>
              ))}
            </div>
          ) : null}
          {live.summary ? (
            <p className="pv-small">
              {live.summary.agreed ? (
                <Chip tone="success">agreed</Chip>
              ) : (
                <Chip tone="warning">
                  {'from ' +
                    estimateText(live.summary.low, asUnit(live.unit)) +
                    ' to ' +
                    estimateText(live.summary.high, asUnit(live.unit))}
                </Chip>
              )}{' '}
              {live.summary.agreed ? '' : 'Talk about the highest and lowest card, or accept.'}
            </p>
          ) : null}
          {props.canEdit ? (
            <div className="v2-inline">
              {live.status === 'open' ? (
                <Button
                  size="sm"
                  disabled={!live.voters.length}
                  onClick={() => void act('POST', '/poker/' + live.id + '/reveal')}
                >
                  Reveal
                </Button>
              ) : live.summary?.suggested ? (
                <Button
                  size="sm"
                  kind="primary"
                  onClick={() =>
                    void act('POST', '/poker/' + live.id + '/accept', {
                      card: live.summary?.suggested,
                    }).then(() => {
                      const v = live.summary?.suggested;
                      if (!v) return;
                      const n =
                        asUnit(live.unit) === 'tshirt'
                          ? (TSHIRT.find((t) => t.size === v)?.points ?? 0)
                          : Number(v);
                      props.onEstimate(n);
                    })
                  }
                >
                  Accept {live.summary.suggested}
                </Button>
              ) : null}
              <Button
                size="sm"
                kind="ghost"
                onClick={() => void act('DELETE', '/poker/' + live.id)}
              >
                Close the round
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface Versus {
  unit: string;
  hoursPerPoint: number;
  estimatedHours: number;
  actualHours: number;
  tasks: {
    itemId: string;
    ref: string;
    title: string;
    estimate: number | null;
    estimatedHours: number | null;
    actualHours: number;
    ratio: number | null;
  }[];
}

/** Reports: each task's estimate against the hours logged on it. */
export function EstimateVsActual(props: {
  workspaceId: string;
  projectId: string;
  sprintId: string | null;
}): ReactNode {
  const [d, setD] = useState<Versus | null>(null);
  useEffect(() => {
    void api<Versus>(
      'GET',
      W(
        props.workspaceId,
        '/projects/' +
          props.projectId +
          '/estimate-vs-actual' +
          (props.sprintId ? '?sprintId=' + props.sprintId : ''),
      ),
    ).then((r) => {
      if (r.ok) setD(r.data);
    });
  }, [props.workspaceId, props.projectId, props.sprintId]);
  if (!d) return null;
  const unit = asUnit(d.unit);
  return (
    <Card
      flush
      title="Estimate vs actual"
      action={
        <span className="pv-muted pv-small">
          {String(d.estimatedHours)} h estimated · {String(d.actualHours)} h logged
          {unit !== 'hours' ? ' · ' + String(d.hoursPerPoint) + ' h a point' : ''}
        </span>
      }
    >
      {d.tasks.length ? (
        <div className="pv-grid-scroll">
          <table className="pv-table">
            <thead>
              <tr>
                <th>Task</th>
                <th className="pv-num">Estimate</th>
                <th className="pv-num">Estimated h</th>
                <th className="pv-num">Logged h</th>
                <th className="pv-num">Actual / estimate</th>
              </tr>
            </thead>
            <tbody>
              {d.tasks.map((t) => (
                <tr key={t.itemId}>
                  <td>
                    <span className="pv-mono">{t.ref}</span> {t.title}
                  </td>
                  <td className="pv-num">{estimateText(t.estimate, unit) || '—'}</td>
                  <td className="pv-num">{t.estimatedHours ?? '—'}</td>
                  <td className="pv-num">{t.actualHours}</td>
                  <td
                    className={
                      'pv-num' + (t.ratio !== null && t.ratio > 1.25 ? ' pv-text-warning' : '')
                    }
                  >
                    {t.ratio === null ? '—' : String(Math.round(t.ratio * 100)) + ' %'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="pv-muted pv-small v2-pad">
          No estimated or logged tasks here yet. Time logged on a task (timer, VS Code or by hand)
          shows up here.
        </p>
      )}
    </Card>
  );
}
