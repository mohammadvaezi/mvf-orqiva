// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-316 | S15 | v0.1.0] T32.3b Named run sign-off with a frozen snapshot, and a release gate on tests ──
//    Why:  each configuration's run names who signs it off; once the run is finished, that person signs
//          with a note, and the card then shows who signed when, the totals and the results as they stood.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface SignOff {
  approverId: string | null;
  approverName: string | null;
  signedBy: string | null;
  signedAt: string | null;
  note: string;
  snapshot: {
    totals: {
      planned: number;
      passed: number;
      failed: number;
      blocked: number;
      skipped: number;
      untested: number;
    };
    results: {
      key: string;
      title: string;
      version: number | null;
      status: string;
      message: string;
      defect: string | null;
    }[];
  } | null;
}

/** The totals of a frozen run in words. */
export function totalsText(t: NonNullable<SignOff['snapshot']>['totals']): string {
  return [
    String(t.passed) + ' passed',
    t.failed ? String(t.failed) + ' failed' : '',
    t.blocked ? String(t.blocked) + ' blocked' : '',
    t.skipped ? String(t.skipped) + ' skipped' : '',
    t.untested ? String(t.untested) + ' not run' : '',
  ]
    .filter(Boolean)
    .join(', ');
}

function RunSignOff(props: {
  workspaceId: string;
  runId: string;
  label: string;
  finished: boolean;
  members: { userId: string; name: string }[];
  canEdit: boolean;
}): ReactNode {
  const path = W(props.workspaceId, '/test-runs/' + props.runId);
  const [s, setS] = useState<SignOff | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<SignOff>('GET', path + '/signoff');
    if (r.ok) setS(r.data);
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!s) return null;
  const name = async (userId: string): Promise<void> => {
    setError(null);
    const r = await api<SignOff>('PUT', path + '/approver', { userId: userId || null });
    if (r.ok) setS(r.data);
    else setError(r.error.message);
  };
  const sign = async (): Promise<void> => {
    setError(null);
    const r = await api<SignOff>('POST', path + '/signoff', note.trim() ? { note } : {});
    if (r.ok) setS(r.data);
    else setError(r.error.message);
  };
  return (
    <li className="v2-so-run">
      <div className="v2-inline">
        <strong>{props.label}</strong>
        {s.signedAt ? (
          <Chip tone="success" icon="signoff">
            Signed off by {s.signedBy ?? 'someone'} on {s.signedAt.slice(0, 10)}
          </Chip>
        ) : props.canEdit ? (
          <select
            className="v2-input v2-input--sm"
            aria-label={'Approver of ' + props.label}
            value={s.approverId ?? ''}
            onChange={(e) => void name(e.target.value)}
          >
            <option value="">An admin signs off</option>
            {props.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name} signs off
              </option>
            ))}
          </select>
        ) : (
          <span className="pv-small pv-muted">
            {s.approverName ? s.approverName + ' signs off' : 'An admin signs off'}
          </span>
        )}
      </div>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {s.signedAt && s.snapshot ? (
        <details className="v2-so-snap">
          <summary>
            {totalsText(s.snapshot.totals)}
            {s.note ? ' · “' + s.note + '”' : ''}
          </summary>
          <table className="pv-table">
            <tbody>
              {s.snapshot.results.map((r, i) => (
                <tr key={i}>
                  <td>
                    {r.key ? <span className="pv-mono pv-muted">{r.key}</span> : null} {r.title}
                    {r.version ? <span className="pv-small pv-muted"> · v{r.version}</span> : null}
                  </td>
                  <td>
                    <Chip
                      tone={
                        r.status === 'passed'
                          ? 'success'
                          : r.status === 'skipped'
                            ? 'neutral'
                            : 'danger'
                      }
                    >
                      {r.status}
                    </Chip>
                    {r.defect ? <span className="pv-mono pv-small"> {r.defect}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : props.finished ? (
        <div className="v2-inline">
          <input
            className="v2-input v2-input--sm v2-grow"
            aria-label={'Sign-off note for ' + props.label}
            placeholder="A note with the sign-off (optional)"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
          <Button size="sm" kind="primary" icon="signoff" onClick={() => void sign()}>
            Sign off
          </Button>
        </div>
      ) : (
        <p className="pv-small pv-muted">Signed off once the run is finished.</p>
      )}
    </li>
  );
}

/** The sign-off of each configuration's run in a group. */
export function SignOffCard(props: {
  workspaceId: string;
  runs: { id: string; label: string; finished: boolean }[];
  members: { userId: string; name: string }[];
  canEdit: boolean;
}): ReactNode {
  return (
    <Card title="Sign-off">
      <ul className="v2-so-list">
        {props.runs.map((r) => (
          <RunSignOff
            key={r.id + (r.finished ? ':done' : '')}
            workspaceId={props.workspaceId}
            runId={r.id}
            label={r.label}
            finished={r.finished}
            members={props.members}
            canEdit={props.canEdit}
          />
        ))}
      </ul>
    </Card>
  );
}
