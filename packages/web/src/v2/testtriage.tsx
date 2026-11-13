// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-317 | S15 | v0.1.0] T32.4a AI triage of test failures and impacted tests first ──
//    Why:  the Tester agent's view next to a failure (what it most likely is, how sure, what to do next),
//          a button that triages a whole run, and the cases a pull request touches when a run is planned.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface Triage {
  category: string;
  confidence: number;
  reason: string;
  next: string;
}

export const CATEGORY_TEXT: Record<string, string> = {
  product_bug: 'Product bug',
  test_bug: 'Test bug',
  environment: 'Environment',
  flaky: 'Flaky',
};
const CATEGORY_TONE: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  product_bug: 'danger',
  test_bug: 'warning',
  environment: 'info',
  flaky: 'warning',
};

/** The agent's triage of a failed result, or the button that asks for it. */
export function TriageNote(props: {
  workspaceId: string;
  runId: string;
  caseId: string;
  triage: Triage | null;
  canAsk: boolean;
  onChange: () => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const r = await api(
      'POST',
      W(props.workspaceId, '/test-runs/' + props.runId + '/cases/' + props.caseId + '/triage'),
    );
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else props.onChange();
  };
  const t = props.triage;
  return (
    <section className="v2-tt-note" aria-label="Triage">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {t ? (
        <>
          <div className="v2-inline">
            <Chip tone={CATEGORY_TONE[t.category] ?? 'neutral'} icon="sparkle">
              {CATEGORY_TEXT[t.category] ?? t.category}
            </Chip>
            <span className="pv-small pv-muted">
              Tester agent · {String(Math.round(t.confidence * 100))} % sure
            </span>
          </div>
          <p className="pv-small">{t.reason}</p>
          {t.next ? <p className="pv-small pv-muted">Next: {t.next}</p> : null}
        </>
      ) : props.canAsk ? (
        <Button size="sm" kind="ghost" icon="sparkle" disabled={busy} onClick={() => void ask()}>
          {busy ? 'The Tester agent reads it…' : 'Ask the Tester agent what this is'}
        </Button>
      ) : null}
    </section>
  );
}

/** Triage every failure of a run that has none yet. */
export function TriageRunButton(props: {
  workspaceId: string;
  runIds: string[];
  waiting: number;
  onDone: (said: string) => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  if (!props.waiting) return null;
  const go = async (): Promise<void> => {
    setBusy(true);
    const counts: Record<string, number> = {};
    let failed = '';
    for (const id of props.runIds) {
      const r = await api<{ counts: Record<string, number> }>(
        'POST',
        W(props.workspaceId, '/test-runs/' + id + '/triage'),
      );
      if (!r.ok) failed = r.error.message;
      else for (const [k, n] of Object.entries(r.data.counts)) counts[k] = (counts[k] ?? 0) + n;
    }
    setBusy(false);
    props.onDone(failed || triageSummary(counts));
  };
  return (
    <Button icon="sparkle" disabled={busy} onClick={() => void go()}>
      {busy
        ? 'Triaging…'
        : 'Triage ' + String(props.waiting) + ' failure' + (props.waiting === 1 ? '' : 's')}
    </Button>
  );
}

/** What a run's triage found, in words. */
export function triageSummary(counts: Readonly<Record<string, number>>): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([k, n]) => String(n) + ' ' + (CATEGORY_TEXT[k] ?? k).toLowerCase() + (n === 1 ? '' : 's'),
    );
  return parts.length ? 'Triaged: ' + parts.join(', ') + '.' : 'Nothing left to triage.';
}

export interface ImpactedCase {
  caseId: string;
  title: string;
  score: number;
  reasons: string[];
}

/** The cases a pull request touches, for planning a run. */
export function useImpacted(
  workspaceId: string,
  projectId: string,
  pullRequestId: string | null,
): { cases: ImpactedCase[] | null; error: string | null } {
  const [cases, setCases] = useState<ImpactedCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setCases(null);
    setError(null);
    if (!pullRequestId) return;
    void api<{ cases: ImpactedCase[] }>(
      'POST',
      W(workspaceId, '/projects/' + projectId + '/test-cases/impacted'),
      { pullRequestId },
    ).then((r) => {
      if (r.ok) setCases(r.data.cases);
      else setError(r.error.message);
    });
  }, [workspaceId, projectId, pullRequestId]);
  return { cases, error };
}

/** The open pull requests to pick from. */
export function useOpenPulls(
  workspaceId: string,
  projectId: string,
): { id: string; number: number; title: string }[] {
  const [pulls, setPulls] = useState<{ id: string; number: number; title: string }[]>([]);
  useEffect(() => {
    void api<{ id: string; number: number; title: string }[]>(
      'GET',
      W(workspaceId, '/projects/' + projectId + '/review-queue'),
    ).then((r) => {
      if (r.ok) setPulls(r.data);
    });
  }, [workspaceId, projectId]);
  return pulls;
}

/** The impacted cases under the plan form: how many, and why the first ones. */
export function ImpactedPreview(props: {
  cases: ImpactedCase[] | null;
  error: string | null;
}): ReactNode {
  if (props.error)
    return (
      <p className="v2-error" role="alert">
        {props.error}
      </p>
    );
  if (!props.cases) return <p className="pv-small pv-muted">Reading the changed files…</p>;
  if (!props.cases.length)
    return <p className="pv-small pv-muted">No case covers the files this pull request changes.</p>;
  return (
    <ul className="v2-tt-impact">
      {props.cases.slice(0, 6).map((c) => (
        <li key={c.caseId} className="pv-small">
          <strong>{c.title}</strong> <span className="pv-muted">· {c.reasons.join('; ')}</span>
        </li>
      ))}
      {props.cases.length > 6 ? (
        <li className="pv-small pv-muted">and {String(props.cases.length - 6)} more</li>
      ) : null}
    </ul>
  );
}
