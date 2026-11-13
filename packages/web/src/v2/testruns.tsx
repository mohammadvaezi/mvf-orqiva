// ── [PCODE-314 | S15 | v0.1.0] T32.2 Runs: assignment and workload, keyboard entry, timers, reopen when the defect is done ──
//    Why:  running tests quickly and fairly. The keys record a result without the mouse (the next step that
//          has none), a timer counts the time spent on the case and goes with its result, and the workload
//          shows who has what left in the running runs and what nobody has yet.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Bar, Card, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export type KeyAction =
  | { kind: 'result'; status: 'passed' | 'failed' | 'blocked' | 'skipped' }
  | { kind: 'move'; by: 1 | -1 };

/** What a key does in the case runner; nothing while a field has the focus or with a modifier. */
export function keyAction(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
}): KeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const tag = e.target?.tagName ?? '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable)
    return null;
  switch (e.key.toLowerCase()) {
    case 'p':
      return { kind: 'result', status: 'passed' };
    case 'f':
      return { kind: 'result', status: 'failed' };
    case 'b':
      return { kind: 'result', status: 'blocked' };
    case 's':
      return { kind: 'result', status: 'skipped' };
    case 'j':
      return { kind: 'move', by: 1 };
    case 'k':
      return { kind: 'move', by: -1 };
    default:
      return null;
  }
}

/** The step a key sets: the first without a result, or the last one when all have one. */
export const nextStep = (steps: readonly string[]): number => {
  const i = steps.findIndex((s) => s === 'untested');
  return i < 0 ? steps.length - 1 : i;
};

/** A duration as people read it: 45 s, 3 min 05 s, 1 h 02 min. */
export function durationText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return String(s) + ' s';
  const m = Math.floor(s / 60);
  if (m < 60) return String(m) + ' min ' + String(s % 60).padStart(2, '0') + ' s';
  return String(Math.floor(m / 60)) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
}

/** Milliseconds since the case was opened, ticking each second while it runs. */
export function useElapsed(running: boolean): number {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(t);
    };
  }, [running]);
  return now - start;
}

interface Workload {
  people: {
    userId: string;
    name: string;
    assigned: number;
    done: number;
    failing: number;
    left: number;
    runs: number;
    spentMs: number;
  }[];
  unassigned: number;
  runs: number;
}

/** Who has what to test in the project's running runs. */
export function TestWorkload(props: { workspaceId: string; projectId: string }): ReactNode {
  const [w, setW] = useState<Workload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<Workload>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/test-workload'),
    ).then((r) => {
      if (r.ok) setW(r.data);
      else setError(r.error.message);
    });
  }, [props.workspaceId, props.projectId]);
  if (!w) return <p className="pv-muted">{error ?? 'Loading the workload…'}</p>;
  return (
    <Card
      flush
      title={
        'Workload · ' +
        String(w.runs) +
        ' running run' +
        (w.runs === 1 ? '' : 's') +
        (w.unassigned
          ? ' · ' + String(w.unassigned) + (w.unassigned === 1 ? ' case' : ' cases') + ' nobody has'
          : '')
      }
    >
      {w.people.length ? (
        <table className="pv-table">
          <thead>
            <tr>
              <th>Person</th>
              <th className="pv-num">Assigned</th>
              <th className="pv-num">Done</th>
              <th className="pv-num">Failing</th>
              <th className="pv-num">Left</th>
              <th>Progress</th>
              <th className="pv-num">Time spent</th>
            </tr>
          </thead>
          <tbody>
            {w.people.map((p) => (
              <tr key={p.userId}>
                <td>
                  {p.name}{' '}
                  <span className="pv-small pv-muted">
                    · {p.runs} run{p.runs === 1 ? '' : 's'}
                  </span>
                </td>
                <td className="pv-num">{p.assigned}</td>
                <td className="pv-num">{p.done}</td>
                <td className="pv-num">{p.failing ? <Chip tone="danger">{p.failing}</Chip> : 0}</td>
                <td className="pv-num">{p.left}</td>
                <td className="v2-tr-bar">
                  <Bar value={p.done} max={Math.max(1, p.assigned)} tone="success" />
                </td>
                <td className="pv-num">{p.spentMs ? durationText(p.spentMs) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="pv-empty">Nobody has cases yet. Open a run and give each case to a person.</p>
      )}
    </Card>
  );
}
