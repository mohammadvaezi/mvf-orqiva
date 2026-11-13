// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-128 | S15 | v0.1.0] Add capacity, velocity and the sprint planning agent ──
//    Why:  planning a sprint in one dialog: who can give how many points, what is already committed, what
//          the team finished before, and the Planner agent's suggestion to accept, trim or ignore. Nothing
//          moves until a person presses Take into the sprint.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import { Icon } from './core/icons.js';
import { Dialog, Stat, follow } from './shell.js';

export interface Capacity {
  sprintId: string;
  members: { userId: string; name: string; points: number }[];
  capacity: number;
  committed: number;
  unestimated: number;
  velocity: number | null;
  velocitySprints: number;
}

export interface Suggestion {
  room: number;
  basis: string;
  items: { id: string; ref: string; title: string; estimate: number | null }[];
  points: number;
  reasons: string;
  dropped: { ref: string; why: string }[];
  runId: string;
}

const W = (workspaceId: string, path: string): string => '/api/workspaces/' + workspaceId + path;

/** "9 of 12 points" with the room left, the line the team reads first. */
export function loadText(c: Pick<Capacity, 'capacity' | 'committed' | 'velocity'>): string {
  const limit = c.capacity || Math.floor(c.velocity ?? 0);
  if (!limit) return String(c.committed) + ' points committed; set capacity to plan against it';
  const left = limit - c.committed;
  return (
    String(c.committed) +
    ' of ' +
    String(limit) +
    ' points committed' +
    (left >= 0 ? ', ' + String(left) + ' left' : ', ' + String(-left) + ' over')
  );
}

export function SprintPlanDialog(props: {
  workspaceId: string;
  sprintId: string;
  sprintName: string;
  onClose: () => void;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, sprintId } = props;
  const [cap, setCap] = useState<Capacity | null>(null);
  const [points, setPoints] = useState<Record<string, string>>({});
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const take = (c: Capacity): void => {
    setCap(c);
    setPoints(Object.fromEntries(c.members.map((m) => [m.userId, String(m.points)])));
  };
  const load = useCallback(async () => {
    const r = await api<Capacity>('GET', W(workspaceId, '/sprints/' + sprintId + '/capacity'));
    if (r.ok) take(r.data);
  }, [workspaceId, sprintId]);
  useEffect(() => {
    void load();
  }, [load]);

  const saveCapacity = async (): Promise<void> => {
    const r = await api<Capacity>('PUT', W(workspaceId, '/sprints/' + sprintId + '/capacity'), {
      entries: Object.entries(points).map(([userId, p]) => ({
        userId,
        points: Math.max(0, Math.min(1000, Math.round(Number(p) || 0))),
      })),
    });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    take(r.data);
  };
  const suggest = async (): Promise<void> => {
    setBusy(true);
    await saveCapacity();
    const r = await api<Suggestion>('POST', W(workspaceId, '/sprints/' + sprintId + '/plan/draft'));
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    setSuggestion(r.data);
    setChosen(new Set(r.data.items.map((x) => x.id)));
  };
  const apply = async (): Promise<void> => {
    const r = await api<Capacity>('POST', W(workspaceId, '/sprints/' + sprintId + '/plan/apply'), {
      itemIds: [...chosen],
    });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    take(r.data);
    setDone(String(chosen.size) + ' tasks taken into ' + props.sprintName + '.');
    setSuggestion(null);
  };
  const chosenPoints =
    suggestion?.items.filter((x) => chosen.has(x.id)).reduce((n, x) => n + (x.estimate ?? 0), 0) ??
    0;

  return (
    <Dialog
      title={'Plan ' + props.sprintName}
      onClose={props.onClose}
      footer={
        suggestion ? (
          <>
            <button
              type="button"
              className="pe-btn pe-btn--secondary"
              onClick={() => {
                setSuggestion(null);
              }}
            >
              Discard
            </button>
            <button
              type="button"
              className="pe-btn pe-btn--primary"
              disabled={chosen.size === 0}
              onClick={() => {
                void apply();
              }}
            >
              Take {chosen.size} into the sprint
            </button>
          </>
        ) : (
          <>
            <button type="button" className="pe-btn pe-btn--secondary" onClick={props.onClose}>
              Close
            </button>
            <button
              type="button"
              className="pe-btn pe-btn--secondary"
              onClick={() => {
                void saveCapacity();
              }}
            >
              Save capacity
            </button>
            <button
              type="button"
              className="pe-btn pe-btn--primary"
              disabled={busy}
              onClick={() => {
                void suggest();
              }}
            >
              <Icon name="agent" size={18} /> {busy ? 'The planner is thinking…' : 'Suggest tasks'}
            </button>
          </>
        )
      }
    >
      {!cap ? (
        <p className="pe-muted" role="status">
          Loading…
        </p>
      ) : (
        <div className="pe-stack pe-stack--tight">
          <div className="pe-stats pe-stats--compact">
            <Stat label="Capacity" value={cap.capacity} hint="points" />
            <Stat
              label="Committed"
              value={cap.committed}
              hint={cap.unestimated ? String(cap.unestimated) + ' without estimate' : 'points'}
            />
            <Stat
              label="Velocity"
              value={cap.velocity ?? '—'}
              hint={
                cap.velocitySprints
                  ? 'last ' + String(cap.velocitySprints) + ' sprints'
                  : 'no finished sprint yet'
              }
            />
          </div>
          <p className="pe-small">{loadText(cap)}</p>
          {suggestion ? (
            <div>
              <p className="pe-small pe-muted">
                Room {suggestion.room} points (from {suggestion.basis}) ·{' '}
                <a
                  href={'/runs/' + suggestion.runId}
                  onClick={follow('/runs/' + suggestion.runId, props.go)}
                >
                  the Planner agent’s run
                </a>
              </p>
              {suggestion.reasons ? <p>{suggestion.reasons}</p> : null}
              {suggestion.items.length === 0 ? (
                <p className="pe-muted">Nothing fits the room left.</p>
              ) : (
                <ul className="pe-plan-pick">
                  {suggestion.items.map((x) => (
                    <li key={x.id}>
                      <label className="pe-check">
                        <input
                          type="checkbox"
                          checked={chosen.has(x.id)}
                          onChange={(e) => {
                            const next = new Set(chosen);
                            if (e.target.checked) next.add(x.id);
                            else next.delete(x.id);
                            setChosen(next);
                          }}
                        />
                        <span>
                          <span className="pe-mono">{x.ref}</span> {x.title}
                        </span>
                      </label>
                      <span className="pe-badge">{x.estimate}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="pe-small">Chosen: {chosenPoints} points</p>
              {suggestion.dropped.length ? (
                <details className="pe-small pe-muted">
                  <summary>{suggestion.dropped.length} left out</summary>
                  <ul>
                    {suggestion.dropped.map((d) => (
                      <li key={d.ref}>
                        {d.ref}: {d.why}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : (
            <table className="pe-grid-table" aria-label="Capacity">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Points this sprint</th>
                </tr>
              </thead>
              <tbody>
                {cap.members.map((m) => (
                  <tr key={m.userId}>
                    <td>{m.name}</td>
                    <td>
                      <input
                        className="pe-input pe-input--narrow"
                        inputMode="numeric"
                        aria-label={'Capacity of ' + m.name}
                        value={points[m.userId] ?? '0'}
                        onChange={(e) => {
                          setPoints({ ...points, [m.userId]: e.target.value });
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {done ? (
            <div className="pe-ok" role="status">
              {done}
            </div>
          ) : null}
          {error ? (
            <div className="pe-field-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
