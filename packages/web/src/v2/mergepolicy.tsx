// ── [PCODE-304 | S15 | v0.1.0] T31.5a Conflicts, stacked pull requests, and merge policies the host enforces through a commit status ──
//    Why:  the project's merge policy above the review queue (an admin sets it), and on each pull request
//          its rules met or not in words, whether it merges cleanly, where it sits in its stack, and what
//          was posted to the host as the status orqiva/policy.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { ago } from './inbox.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
type Tone = 'success' | 'danger' | 'warning' | 'neutral' | 'info';

export interface MergePolicy {
  requireTask: boolean;
  requireFingerprints: boolean;
  requireApproval: boolean;
  requireChecks: boolean;
  requireSensitiveApproval: boolean;
  blockConflicts: boolean;
  postStatus: boolean;
}
interface PullPolicy {
  state: 'success' | 'failure' | 'pending';
  description: string;
  rules: { key: string; label: string; state: 'met' | 'failing' | 'pending'; why: string }[];
  mergeable: string;
  stack: { parent: number | null; parentMerged: number | null; children: number[]; depth: number };
  postStatus: boolean;
  posted: { state: string; at: string } | null;
  error: string;
}

const RULES: { key: keyof MergePolicy; label: string; hint: string }[] = [
  { key: 'requireTask', label: 'A task is linked', hint: 'The branch, title or text names a task' },
  {
    key: 'requireFingerprints',
    label: 'Every code file carries a fingerprint',
    hint: 'New code says which task it was written for',
  },
  { key: 'requireApproval', label: 'Approved by a reviewer', hint: 'On the host or in Orqiva' },
  { key: 'requireChecks', label: 'Checks pass', hint: 'The CI the host reports' },
  {
    key: 'requireSensitiveApproval',
    label: 'Sensitive paths approved',
    hint: 'Migrations, sign-in, payments, infrastructure',
  },
  { key: 'blockConflicts', label: 'No conflicts', hint: 'The host says it merges cleanly' },
];

export const verdictTone = (state: string): Tone =>
  state === 'success' ? 'success' : state === 'failure' ? 'danger' : 'warning';

export const VERDICT_TEXT: Record<string, string> = {
  success: 'policy met',
  failure: 'policy not met',
  pending: 'policy waiting',
};

/** "conflicts" and "behind" as chips; a clean or unknown state says nothing. */
export function mergeableChip(m: string): { tone: Tone; text: string } | null {
  if (m === 'conflicts') return { tone: 'danger', text: 'conflicts' };
  if (m === 'behind') return { tone: 'warning', text: 'behind its base' };
  return null;
}

const RULE_MARK = { met: '✓', failing: '✗', pending: '…' } as const;
const RULE_CLASS = { met: 'pv-text-success', failing: 'pv-text-danger', pending: 'pv-muted' };

/** The project's merge policy; an admin changes it, others read it. */
export function PolicySettings(props: { workspaceId: string; projectId: string }): ReactNode {
  const [policy, setPolicy] = useState<MergePolicy | null>(null);
  const [saved, setSaved] = useState<MergePolicy | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const path = W(props.workspaceId, '/projects/' + props.projectId + '/merge-policy');
  useEffect(() => {
    void api<MergePolicy>('GET', path).then((r) => {
      if (r.ok) {
        setPolicy(r.data);
        setSaved(r.data);
      }
    });
  }, [path]);
  if (!policy || !saved) return null;
  const on = RULES.filter((r) => saved[r.key]).length;
  const changed =
    RULES.some((r) => policy[r.key] !== saved[r.key]) || policy.postStatus !== saved.postStatus;
  const save = async (): Promise<void> => {
    const r = await api<MergePolicy>('PUT', path, {
      requireTask: policy.requireTask,
      requireFingerprints: policy.requireFingerprints,
      requireApproval: policy.requireApproval,
      requireChecks: policy.requireChecks,
      requireSensitiveApproval: policy.requireSensitiveApproval,
      blockConflicts: policy.blockConflicts,
      postStatus: policy.postStatus,
    });
    if (r.ok) {
      setSaved(r.data);
      setNote({ ok: true, text: 'Saved.' });
    } else setNote({ ok: false, text: r.error.message });
  };
  return (
    <details className="pv-card v2-policy">
      <summary>
        <strong>Merge policy</strong>{' '}
        <span className="pv-small pv-muted">
          {on ? String(on) + ' rule' + (on === 1 ? '' : 's') : 'no rules'}
          {saved.postStatus ? ' · posted to the host as orqiva/policy' : ''}
        </span>
      </summary>
      <fieldset className="v2-policy-rules">
        <legend className="pv-small">A pull request may merge when</legend>
        {RULES.map((r) => (
          <label key={r.key} className="pv-switch">
            <input
              type="checkbox"
              checked={policy[r.key]}
              onChange={(e) => {
                setPolicy({ ...policy, [r.key]: e.target.checked });
              }}
            />
            <span>
              {r.label} <span className="pv-small pv-muted">· {r.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="pv-switch">
        <input
          type="checkbox"
          checked={policy.postStatus}
          onChange={(e) => {
            setPolicy({ ...policy, postStatus: e.target.checked });
          }}
        />
        <span>
          Post the verdict to the host as the status <span className="pv-mono">orqiva/policy</span>{' '}
          <span className="pv-small pv-muted">
            · require it in the host’s branch protection to block merging
          </span>
        </span>
      </label>
      <div className="pv-page-actions">
        <Button size="sm" kind="primary" disabled={!changed} onClick={() => void save()}>
          Save the policy
        </Button>
        {note ? (
          <span
            className={'pv-small ' + (note.ok ? 'pv-text-success' : 'pv-text-danger')}
            role={note.ok ? 'status' : 'alert'}
          >
            {note.text}
          </span>
        ) : null}
      </div>
    </details>
  );
}

/** A pull request's rules, conflicts and stack, with "Check again". */
export function PullPolicyCard(props: { workspaceId: string; pullId: string }): ReactNode {
  const [p, setP] = useState<PullPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = W(props.workspaceId, '/pull-requests/' + props.pullId + '/policy');
  const load = useCallback(() => {
    void api<PullPolicy>('GET', base).then((r) => {
      if (r.ok) setP(r.data);
    });
  }, [base]);
  useEffect(load, [load]);
  if (!p) return null;
  const again = async (): Promise<void> => {
    setBusy(true);
    const r = await api<PullPolicy>('POST', base + '/check');
    setBusy(false);
    if (r.ok) {
      setP(r.data);
      setError(null);
    } else setError(r.error.message);
  };
  const chip = mergeableChip(p.mergeable);
  return (
    <Card
      title="Merge policy"
      action={
        <Button size="sm" disabled={busy} onClick={() => void again()}>
          {busy ? 'Asking the host…' : 'Check again'}
        </Button>
      }
    >
      <p className="pv-small">
        <Chip tone={verdictTone(p.state)}>{VERDICT_TEXT[p.state] ?? p.state}</Chip>{' '}
        {chip ? <Chip tone={chip.tone}>{chip.text}</Chip> : null}{' '}
        {p.mergeable === 'clean'
          ? 'Merges cleanly.'
          : p.mergeable === 'unknown'
            ? 'Not known yet whether it merges cleanly.'
            : null}
      </p>
      {p.rules.length ? (
        <ul className="v2-policy-list pv-small">
          {p.rules.map((r) => (
            <li key={r.key}>
              <span className={RULE_CLASS[r.state]} aria-hidden="true">
                {RULE_MARK[r.state]}
              </span>{' '}
              {r.label}
              {r.state !== 'met' ? <span className="pv-muted"> · {r.why}</span> : null}
              <span className="pe-visually-hidden"> ({r.state})</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pv-small pv-muted">The project has no merge rules.</p>
      )}
      {p.stack.parent !== null || p.stack.children.length || p.stack.parentMerged !== null ? (
        <p className="pv-small">
          {p.stack.parent !== null ? (
            <>
              Stacked on <span className="pv-mono">#{p.stack.parent}</span>
              {p.stack.depth > 1 ? ' (' + String(p.stack.depth) + ' deep)' : ''}: merge that
              first.{' '}
            </>
          ) : null}
          {p.stack.parentMerged !== null ? (
            <span className="pv-text-warning">
              Its base <span className="pv-mono">#{p.stack.parentMerged}</span> was merged: retarget
              it.{' '}
            </span>
          ) : null}
          {p.stack.children.length ? (
            <>Stacked on this: {p.stack.children.map((n) => '#' + String(n)).join(', ')}.</>
          ) : null}
        </p>
      ) : null}
      <p className="pv-small pv-muted">
        {p.postStatus
          ? p.posted
            ? 'Posted to the host as orqiva/policy (' +
              p.posted.state +
              ') ' +
              ago(p.posted.at) +
              ' ago.'
            : 'Not posted to the host yet.'
          : 'The verdict is not posted to the host (the policy does not ask for it).'}
      </p>
      {p.error || error ? (
        <p className="pv-text-danger pv-small" role="alert">
          {error ?? 'The host refused the status: ' + p.error}
        </p>
      ) : null}
    </Card>
  );
}
