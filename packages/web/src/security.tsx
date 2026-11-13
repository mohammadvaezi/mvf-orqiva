// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-190 | S15 | v0.1.0] Commit leftovers of B4.5–B6.1: classic pages removed, invite session with request ──
// ── [PCODE-142 | S15 | v0.1.0] Show security findings in the web app with Security agent triage ──
//    Why:  the security stage for people: what is open by severity, why the quality gate is blocked, each
//          finding with its place in the code and its task, the Security agent's triage, and the decisions
//          (accepted risk, false positive) with the reason that was given.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import type { EventHub } from './core/hub.js';
import { Icon } from './core/icons.js';
import { Card, EmptyState, follow } from './shell.js';
import { localTime } from './views.js';

export interface Finding {
  id: string;
  projectId: string;
  tool: string;
  rule: string;
  severity: string;
  title: string;
  message: string;
  file: string;
  line: number | null;
  status: string;
  reason: string;
  decidedBy: string | null;
  itemId: string | null;
  itemRef: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  triage: string;
  triageRunId: string | null;
  triagedAt: string | null;
}

const W = (workspaceId: string, path: string): string => '/api/workspaces/' + workspaceId + path;
const STATUS_TEXT: Record<string, string> = {
  open: 'Open',
  fixed: 'Fixed',
  accepted: 'Risk accepted',
  false_positive: 'False positive',
};

export function SeverityChip(props: { severity: string }): ReactNode {
  return <span className={'pe-severity pe-severity--' + props.severity}>{props.severity}</span>;
}

/** "src/a.ts:12", or nothing. */
export const whereText = (f: Pick<Finding, 'file' | 'line'>): string =>
  f.file ? f.file + (f.line ? ':' + String(f.line) : '') : '';

/** Whether the open findings hold the quality gate shut, and how many do. */
export function gateBlock(findings: Pick<Finding, 'severity' | 'status'>[]): number {
  return findings.filter(
    (f) => f.status === 'open' && (f.severity === 'critical' || f.severity === 'high'),
  ).length;
}

export function FindingPage(props: {
  workspaceId: string;
  findingId: string;
  role: string;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, findingId } = props;
  const [f, setF] = useState<Finding | null | 'missing'>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isAdmin = props.role === 'admin' || props.role === 'owner';
  const load = useCallback(async () => {
    const r = await api<Finding>('GET', W(workspaceId, '/findings/' + findingId));
    setF(r.ok ? r.data : 'missing');
  }, [workspaceId, findingId]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (e.type === 'orqiva.workspace.resync' || e.data.object.type === 'finding') void load();
    });
  }, [load, props.hub]);
  if (f === 'missing')
    return (
      <div className="pe-page">
        <EmptyState icon="shield" title="This finding does not exist or you cannot see it" />
      </div>
    );
  if (!f) return <div className="pe-page pe-muted">Loading…</div>;

  const decide = async (status: string): Promise<void> => {
    const r = await api<Finding>('POST', W(workspaceId, '/findings/' + findingId + '/decision'), {
      status,
      ...(status === 'open' ? {} : { reason }),
    });
    if (!r.ok) {
      setError(
        r.error.details[0]?.message
          ? r.error.message + ': ' + r.error.details[0].message
          : r.error.message,
      );
      return;
    }
    setError('');
    setReason('');
    setF(r.data);
  };
  const triage = async (): Promise<void> => {
    setBusy(true);
    const r = await api<Finding>('POST', W(workspaceId, '/findings/' + findingId + '/triage'));
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setF(r.data);
  };
  return (
    <div className="pe-page">
      <header className="pe-page-header">
        <div className="pe-page-header-row">
          <div className="pe-page-titles">
            <div className="pe-eyebrow">
              <a
                href={'/projects/' + f.projectId + '/security'}
                onClick={follow('/projects/' + f.projectId + '/security', props.go)}
              >
                Security
              </a>{' '}
              · {f.tool}
            </div>
            <h1 className="pe-page-title">{f.title}</h1>
            <p className="pe-page-subtitle">
              {f.rule}
              {whereText(f) ? ' · ' + whereText(f) : ''} · first seen {localTime(f.firstSeenAt)},
              last {localTime(f.lastSeenAt)}
            </p>
          </div>
          <div className="pe-page-actions">
            <SeverityChip severity={f.severity} />
            <span className="pe-pill">{STATUS_TEXT[f.status] ?? f.status}</span>
          </div>
        </div>
      </header>
      <div className="pe-stack">
        {error ? (
          <div className="pe-field-error" role="alert">
            {error}
          </div>
        ) : null}
        <Card title="What was found">
          <pre className="pe-run-pre">{f.message}</pre>
          {f.itemId ? (
            <p>
              Task:{' '}
              <a href={'/items/' + f.itemId} onClick={follow('/items/' + f.itemId, props.go)}>
                {f.itemRef}
              </a>
            </p>
          ) : null}
        </Card>
        <Card
          title="Security agent"
          subtitle="Its view on severity, exploitability and the fix; a note for people, not a decision."
          actions={
            props.role !== 'guest' ? (
              <button
                type="button"
                className="pe-btn pe-btn--secondary"
                disabled={busy}
                onClick={() => {
                  void triage();
                }}
              >
                <Icon name="agent" size={18} />{' '}
                {busy ? 'Looking at it…' : f.triage ? 'Triage again' : 'Triage'}
              </button>
            ) : null
          }
        >
          {f.triage ? (
            <>
              <p className="pe-pre-wrap">{f.triage}</p>
              <p className="pe-small pe-muted">
                {f.triagedAt ? localTime(f.triagedAt) : ''}
                {f.triageRunId ? (
                  <>
                    {' · '}
                    <a
                      href={'/runs/' + f.triageRunId}
                      onClick={follow('/runs/' + f.triageRunId, props.go)}
                    >
                      the agent’s run
                    </a>
                  </>
                ) : null}
              </p>
            </>
          ) : (
            <p className="pe-muted">Not triaged yet.</p>
          )}
        </Card>
        <Card
          title="Decision"
          subtitle="Only an admin decides, and always with a reason that stays with the finding."
        >
          {f.status !== 'open' && f.status !== 'fixed' ? (
            <p>
              <strong>{STATUS_TEXT[f.status]}</strong> by {f.decidedBy ?? 'someone'}: {f.reason}
            </p>
          ) : f.status === 'fixed' ? (
            <p className="pe-muted">{f.reason || 'Fixed.'}</p>
          ) : null}
          {isAdmin ? (
            f.status === 'open' ? (
              <div className="pe-form-grid pe-form-grid--wide">
                <div className="pe-field">
                  <label htmlFor="finding-reason">Reason</label>
                  <textarea
                    id="finding-reason"
                    className="pe-input pe-textarea"
                    rows={2}
                    placeholder="Why this is acceptable, or why it is not a real problem"
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                    }}
                  />
                </div>
                <div className="pe-form-actions">
                  <button
                    type="button"
                    className="pe-btn pe-btn--secondary"
                    disabled={reason.trim().length < 10}
                    onClick={() => {
                      void decide('accepted');
                    }}
                  >
                    Accept the risk
                  </button>
                  <button
                    type="button"
                    className="pe-btn pe-btn--secondary"
                    disabled={reason.trim().length < 10}
                    onClick={() => {
                      void decide('false_positive');
                    }}
                  >
                    False positive
                  </button>
                </div>
              </div>
            ) : f.status !== 'fixed' ? (
              <button
                type="button"
                className="pe-btn pe-btn--text"
                onClick={() => {
                  void decide('open');
                }}
              >
                Open it again
              </button>
            ) : null
          ) : f.status === 'open' ? (
            <p className="pe-muted">An admin decides on open findings.</p>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
