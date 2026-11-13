// ── [PCODE-277 | S15 | v0.1.0] T28.6 PRD approval by named approvers, reopen on edit, promote to an epic with stories, client in ideation ──
//    Why:  the review on the PRD page: who is named to approve (team members and the client's contacts),
//          what each decided on the latest version, asking them, signing as one of them (typed name,
//          consent, a note when asking for changes), and promoting the approved idea to an epic.
import { SIGN_CONSENT } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import type { EventHub } from './core/hub.js';

const W = (workspaceId: string, path: string): string => '/api/workspaces/' + workspaceId + path;

export interface Review {
  status: string;
  version: number | null;
  approvers: {
    userId: string;
    name: string;
    kind: string;
    decision: string | null;
    signedName: string;
    note: string;
    at: string | null;
  }[];
  versions: { version: number; state: string }[];
  mayDecide: boolean;
  promoted: { epicId: string | null; at: string } | null;
}

export const STATE_TEXT: Record<string, string> = {
  draft: 'draft',
  in_review: 'in review',
  approved: 'approved',
  changes_requested: 'changes requested',
  declined: 'declined',
  superseded: 'superseded',
};

/** "2 of 3 approved" and who is still to decide. */
export function reviewSummary(r: Pick<Review, 'approvers'>): string {
  const ok = r.approvers.filter((a) => a.decision === 'approved').length;
  const waiting = r.approvers.filter((a) => !a.decision).map((a) => a.name);
  return (
    String(ok) +
    ' of ' +
    String(r.approvers.length) +
    ' approved' +
    (waiting.length ? ' · waiting for ' + waiting.join(', ') : '')
  );
}

export function useReview(
  workspaceId: string,
  ideaId: string,
  hub: EventHub,
): [Review | null, () => Promise<void>] {
  const [r, setR] = useState<Review | null>(null);
  const load = useCallback(async () => {
    const x = await api<Review>('GET', W(workspaceId, '/ideas/' + ideaId + '/review'));
    if (x.ok) setR(x.data);
  }, [workspaceId, ideaId]);
  useEffect(() => {
    void load();
    return hub.on((e) => {
      if (e.data.object.id === ideaId) void load();
    });
  }, [load, hub, ideaId]);
  return [r, load];
}

export function ReviewPanel(props: {
  workspaceId: string;
  ideaId: string;
  review: Review;
  canEdit: boolean;
  myName: string;
  onChanged: () => Promise<void>;
  go: (p: string) => void;
}): ReactNode {
  const r = props.review;
  const [picking, setPicking] = useState(false);
  const [cands, setCands] = useState<{ userId: string; name: string; kind: string }[]>([]);
  const [chosen, setChosen] = useState<string[]>(r.approvers.map((a) => a.userId));
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const open = !r.promoted && r.status !== 'declined';
  useEffect(() => {
    if (!picking) return;
    void api<{ userId: string; name: string; kind: string }[]>(
      'GET',
      W(props.workspaceId, '/ideas/' + props.ideaId + '/approver-candidates'),
    ).then((x) => {
      if (x.ok) setCands(x.data);
    });
  }, [picking, props.workspaceId, props.ideaId]);
  const call = async (method: 'POST' | 'PUT', path: string, body?: unknown): Promise<boolean> => {
    setBusy(true);
    const x = await api(method, W(props.workspaceId, '/ideas/' + props.ideaId + path), body);
    setBusy(false);
    setError(x.ok ? '' : x.error.message);
    if (x.ok) await props.onChanged();
    return x.ok;
  };
  const decide = (decision: 'approve' | 'changes'): void => {
    if (r.version === null) return;
    void call('POST', '/review/decide', {
      version: r.version,
      decision,
      name,
      consent,
      ...(note.trim() ? { note: note.trim() } : {}),
    }).then((ok) => {
      if (ok) {
        setName('');
        setNote('');
        setConsent(false);
      }
    });
  };
  return (
    <div className="pe-review">
      {r.approvers.length ? (
        <>
          <p className="pe-small pe-muted">{reviewSummary(r)}</p>
          <ul className="pe-approvers">
            {r.approvers.map((a) => (
              <li
                key={a.userId}
                className={'pe-approver pe-approver--' + (a.decision ?? 'waiting')}
              >
                <strong>{a.name}</strong>
                {a.kind === 'client' ? <span className="pe-badge">client</span> : null}
                <span className="pe-small">
                  {a.decision === 'approved'
                    ? 'approved, signed “' + a.signedName + '”'
                    : a.decision === 'changes'
                      ? 'asked for changes'
                      : r.status === 'in_review'
                        ? 'to decide'
                        : 'not asked yet'}
                </span>
                {a.note ? <span className="pe-small pe-muted">“{a.note}”</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="pe-small pe-muted">
          No approvers named: the workspace owner signs alone. Name approvers to have the PRD
          reviewed by the team and the client.
        </p>
      )}
      {props.canEdit && open ? (
        <div className="pe-form-actions">
          <button
            type="button"
            className="pe-btn pe-btn--secondary"
            onClick={() => {
              setPicking((x) => !x);
              setChosen(r.approvers.map((a) => a.userId));
            }}
          >
            {r.approvers.length ? 'Change approvers' : 'Name approvers'}
          </button>
          {r.approvers.length && r.version !== null && r.status !== 'approved' ? (
            <button
              type="button"
              className="pe-btn pe-btn--primary"
              disabled={busy}
              onClick={() => void call('POST', '/review')}
            >
              {r.status === 'in_review' ? 'Ask them again' : 'Request review'}
            </button>
          ) : null}
          {r.status === 'approved' ? (
            <button
              type="button"
              className="pe-btn pe-btn--primary"
              disabled={busy}
              title="An epic with the stories (their scenarios as acceptance criteria) and the tasks under it; the PRD is frozen after"
              onClick={() => void call('POST', '/promote')}
            >
              Promote to an epic
            </button>
          ) : null}
        </div>
      ) : null}
      {picking ? (
        <fieldset className="pe-approver-pick">
          <legend>Approvers</legend>
          {cands.map((c) => (
            <label key={c.userId} className="pe-check">
              <input
                type="checkbox"
                checked={chosen.includes(c.userId)}
                onChange={(e) => {
                  setChosen((x) =>
                    e.target.checked ? [...x, c.userId] : x.filter((y) => y !== c.userId),
                  );
                }}
              />
              {c.name}
              {c.kind === 'client' ? <span className="pe-badge">client</span> : null}
            </label>
          ))}
          <div className="pe-form-actions">
            <button
              type="button"
              className="pe-btn pe-btn--primary"
              disabled={busy}
              onClick={() =>
                void call('PUT', '/approvers', { userIds: chosen }).then((ok) => {
                  if (ok) setPicking(false);
                })
              }
            >
              Save approvers
            </button>
          </div>
        </fieldset>
      ) : null}
      {r.mayDecide && r.version !== null ? (
        <div className="pe-decide">
          <h3 className="pe-subhead">Your decision on version {r.version}</h3>
          <label className="pe-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
              }}
            />
            {SIGN_CONSENT}
          </label>
          <div className="pe-field">
            <label htmlFor="pe-review-name">Type your full name ({props.myName})</label>
            <input
              id="pe-review-name"
              className="pe-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </div>
          <div className="pe-field">
            <label htmlFor="pe-review-note">Note (needed when asking for changes)</label>
            <textarea
              id="pe-review-note"
              className="pe-input pe-textarea"
              rows={2}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </div>
          <div className="pe-form-actions">
            <button
              type="button"
              className="pe-btn pe-btn--primary"
              disabled={busy || !consent || !name.trim()}
              onClick={() => {
                decide('approve');
              }}
            >
              Approve and sign
            </button>
            <button
              type="button"
              className="pe-btn pe-btn--secondary"
              disabled={busy || !consent || !name.trim() || !note.trim()}
              onClick={() => {
                decide('changes');
              }}
            >
              Ask for changes
            </button>
          </div>
        </div>
      ) : null}
      {r.promoted?.epicId ? (
        <p className="pe-small">
          Promoted to an epic:{' '}
          <a
            href={'/items/' + r.promoted.epicId}
            onClick={(e) => {
              e.preventDefault();
              props.go('/items/' + String(r.promoted?.epicId));
            }}
          >
            open it
          </a>
          . The PRD is frozen.
        </p>
      ) : null}
      {error ? (
        <div className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
