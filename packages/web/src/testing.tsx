// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-190 | S15 | v0.1.0] Commit leftovers of B4.5–B6.1: classic pages removed, invite session with request ──
// ── [PCODE-138 | S15 | v0.1.0] Show tests, coverage and live runs in the web app ──
//    Why:  test management where the work is: a Tests page with the coverage of every requirement, the
//          cases and the runs; a run page that fills in live as a suite reports; a panel on each task with
//          its cases, and drafts from the Tester agent to accept or leave.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import type { EventHub } from './core/hub.js';
import { Icon } from './core/icons.js';
import { ProgressBar } from './progress.js';
import { Card, Dialog, EmptyState, Stat, follow } from './shell.js';
import { localTime } from './views.js';

export interface TestCase {
  id: string;
  itemId: string | null;
  itemRef: string | null;
  criterionId: string | null;
  key: string;
  title: string;
  steps: string;
  expected: string;
  source: string;
  lastStatus: string | null;
  lastAt: string | null;
}

export interface TestRun {
  id: string;
  projectId: string;
  name: string;
  source: string;
  status: string;
  startedBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  passed: number;
  failed: number;
  skipped: number;
  blocked: number;
}

export interface TestResultRow {
  caseId: string;
  title: string;
  key: string;
  itemRef: string | null;
  status: string;
  durationMs: number | null;
  message: string;
  at: string;
}

export interface Coverage {
  totals: { requirements: number; covered: number; passing: number; failing: number };
  items: {
    itemId: string;
    ref: string;
    title: string;
    requirements: { criterionId: string | null; text: string; cases: number; state: string }[];
    otherCases: number;
  }[];
}

const W = (workspaceId: string, path: string): string => '/api/workspaces/' + workspaceId + path;
const isTestEvent = (type: string, objectType: string): boolean =>
  type === 'orqiva.workspace.resync' || objectType === 'test_run';

const STATE_TEXT: Record<string, string> = {
  passed: 'Passed',
  failed: 'Failed',
  skipped: 'Skipped',
  blocked: 'Blocked',
  passing: 'Passing',
  failing: 'Failing',
  untested: 'Not run',
  uncovered: 'No test',
};

export function TestState(props: { state: string | null }): ReactNode {
  const s = props.state ?? 'untested';
  return <span className={'pe-test-state pe-test-state--' + s}>{STATE_TEXT[s] ?? s}</span>;
}

/** Every result of a run, counted. */
export const runTotal = (r: Pick<TestRun, 'passed' | 'failed' | 'skipped' | 'blocked'>): number =>
  r.passed + r.failed + r.skipped + r.blocked;

/** "12 passed, 1 failed" — only the counts that are not zero. */
export function runSummary(r: Pick<TestRun, 'passed' | 'failed' | 'skipped' | 'blocked'>): string {
  const parts = (['passed', 'failed', 'skipped', 'blocked'] as const)
    .filter((k) => r[k] > 0)
    .map((k) => String(r[k]) + ' ' + k);
  return parts.length ? parts.join(', ') : 'no results yet';
}

// ── one run, live ──
export function TestRunPage(props: {
  workspaceId: string;
  runId: string;
  canEdit: boolean;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, runId } = props;
  const [data, setData] = useState<{ run: TestRun; results: TestResultRow[] } | null | 'missing'>(
    null,
  );
  const [cases, setCases] = useState<TestCase[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ run: TestRun; results: TestResultRow[] }>(
      'GET',
      W(workspaceId, '/test-runs/' + runId),
    );
    setData(r.ok ? r.data : 'missing');
    if (r.ok && r.data.run.source === 'manual' && r.data.run.status === 'running') {
      const cs = await api<TestCase[]>(
        'GET',
        W(workspaceId, '/projects/' + r.data.run.projectId + '/test-cases'),
      );
      if (cs.ok) setCases(cs.data);
    }
  }, [workspaceId, runId]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (e.type === 'orqiva.workspace.resync' || e.data.object.id === runId) void load();
    });
  }, [load, props.hub, runId]);

  if (data === 'missing')
    return (
      <div className="pe-page">
        <EmptyState icon="flask" title="This test run does not exist or you cannot see it" />
      </div>
    );
  if (!data) return <div className="pe-page pe-muted">Loading…</div>;
  const { run, results } = data;
  const running = run.status === 'running';
  const record = async (caseId: string, status: string): Promise<void> => {
    const r = await api('POST', W(workspaceId, '/test-runs/' + runId + '/results'), {
      results: [{ caseId, status }],
    });
    if (!r.ok) setError(r.error.message);
    else void load();
  };
  const recorded = new Map(results.map((r) => [r.caseId, r.status]));
  return (
    <div className="pe-page">
      <header className="pe-page-header">
        <div className="pe-page-header-row">
          <div className="pe-page-titles">
            <div className="pe-eyebrow">
              <a
                href={'/projects/' + run.projectId + '/tests'}
                onClick={follow('/projects/' + run.projectId + '/tests', props.go)}
              >
                Tests
              </a>
            </div>
            <h1 className="pe-page-title">{run.name}</h1>
            <p className="pe-page-subtitle">
              {run.source === 'stream'
                ? 'Streamed by a suite'
                : run.source === 'junit'
                  ? 'Imported JUnit report'
                  : 'Manual run'}{' '}
              · {run.startedBy ?? 'someone'} · {localTime(run.startedAt)}
            </p>
          </div>
          <div className="pe-page-actions">
            {running ? <span className="pe-pill">running</span> : null}
            {running && props.canEdit ? (
              <button
                type="button"
                className="pe-btn pe-btn--secondary"
                onClick={() => {
                  void api('POST', W(workspaceId, '/test-runs/' + runId + '/finish')).then(
                    () => void load(),
                  );
                }}
              >
                Finish the run
              </button>
            ) : null}
          </div>
        </div>
      </header>
      <div className="pe-stack">
        <div className="pe-stats">
          <Stat icon="chart" label="Passed" value={run.passed} />
          <Stat icon="pulse" label="Failed" value={run.failed} />
          <Stat icon="flask" label="Skipped" value={run.skipped} />
          <Stat icon="task" label="Blocked" value={run.blocked} />
        </div>
        <ProgressBar done={run.passed} total={runTotal(run)} label={runSummary(run)} />
        {error ? (
          <div className="pe-field-error" role="alert">
            {error}
          </div>
        ) : null}
        {run.source === 'manual' && running && props.canEdit ? (
          <Card title="Record results" subtitle="Run each case and say how it went.">
            {cases.length === 0 ? (
              <p className="pe-muted">The project has no test cases yet.</p>
            ) : (
              <ul className="pe-case-list">
                {cases.map((c) => (
                  <li key={c.id}>
                    <TestState state={recorded.get(c.id) ?? null} />
                    <span className="pe-case-title">{c.title}</span>
                    <span className="pe-case-actions">
                      {(['passed', 'failed', 'skipped', 'blocked'] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          className="pe-btn pe-btn--text"
                          onClick={() => {
                            void record(c.id, s);
                          }}
                        >
                          {STATE_TEXT[s]}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
        <Card
          title="Results"
          subtitle={
            running ? 'Live: results appear as the suite reports them.' : 'Every result of the run.'
          }
        >
          {results.length === 0 ? (
            <p className="pe-muted">{running ? 'Waiting for the first result…' : 'No results.'}</p>
          ) : (
            <ol className="pe-result-list" aria-label="Results">
              {results.map((r) => (
                <li key={r.caseId} className={'pe-result pe-result--' + r.status}>
                  <TestState state={r.status} />
                  <div className="pe-result-body">
                    <div>
                      {r.key ? <span className="pe-mono">{r.key}</span> : r.title}
                      {r.itemRef ? <span className="pe-small pe-muted"> · {r.itemRef}</span> : null}
                      {r.durationMs !== null ? (
                        <span className="pe-small pe-muted"> · {String(r.durationMs)} ms</span>
                      ) : null}
                    </div>
                    {r.message ? <pre className="pe-run-pre">{r.message}</pre> : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── a task's tests ──

interface Draft {
  criterionId: string | null;
  title: string;
  steps: string;
  expected: string;
}

export function ItemTests(props: {
  workspaceId: string;
  projectId: string;
  itemId: string;
  canEdit: boolean;
  hub: EventHub;
}): ReactNode {
  const { workspaceId, itemId } = props;
  const [cases, setCases] = useState<TestCase[]>([]);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<TestCase[]>(
      'GET',
      W(workspaceId, '/projects/' + props.projectId + '/test-cases?itemId=' + itemId),
    );
    if (r.ok) setCases(r.data);
  }, [workspaceId, props.projectId, itemId]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (isTestEvent(e.type, e.data.object.type)) void load();
    });
  }, [load, props.hub]);

  const fromCriteria = async (): Promise<void> => {
    const r = await api<TestCase[]>(
      'POST',
      W(workspaceId, '/items/' + itemId + '/test-cases/from-criteria'),
    );
    if (!r.ok) setError(r.error.message);
    else {
      setError('');
      setCases(r.data);
    }
  };
  const draft = async (): Promise<void> => {
    setBusy(true);
    const r = await api<{ cases: Draft[] }>(
      'POST',
      W(workspaceId, '/items/' + itemId + '/test-cases/draft'),
    );
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else {
      setError('');
      setDrafts(r.data.cases);
    }
  };
  return (
    <section aria-label="Tests" className="pe-panel">
      <div className="pe-panel-head">
        <h2 className="pe-panel-title">Tests</h2>
        {props.canEdit ? (
          <div className="pe-panel-actions">
            <button
              type="button"
              className="pe-btn pe-btn--text"
              onClick={() => {
                void fromCriteria();
              }}
            >
              Cases from criteria
            </button>
            <button
              type="button"
              className="pe-btn pe-btn--secondary"
              disabled={busy}
              onClick={() => {
                void draft();
              }}
            >
              <Icon name="agent" size={18} />{' '}
              {busy ? 'The tester is writing…' : 'Draft with the Tester agent'}
            </button>
          </div>
        ) : null}
      </div>
      {cases.length === 0 ? (
        <p className="pe-muted">No tests for this task yet.</p>
      ) : (
        <ul className="pe-case-list">
          {cases.map((c) => (
            <li key={c.id}>
              <TestState state={c.lastStatus} />
              <span className="pe-case-title">{c.title}</span>
              {c.lastAt ? <span className="pe-small pe-muted">{localTime(c.lastAt)}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <div className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
      {drafts ? (
        <DraftDialog
          drafts={drafts}
          onClose={() => {
            setDrafts(null);
          }}
          onAccept={async (chosen) => {
            for (const d of chosen) {
              const r = await api(
                'POST',
                W(workspaceId, '/projects/' + props.projectId + '/test-cases'),
                {
                  title: d.title,
                  steps: d.steps,
                  expected: d.expected,
                  itemId,
                  ...(d.criterionId ? { criterionId: d.criterionId } : {}),
                },
              );
              if (!r.ok) return r.error.message;
            }
            setDrafts(null);
            await load();
            return null;
          }}
        />
      ) : null}
    </section>
  );
}

export function DraftDialog(props: {
  drafts: Draft[];
  onAccept: (chosen: Draft[]) => Promise<string | null>;
  onClose: () => void;
}): ReactNode {
  const [chosen, setChosen] = useState<Set<number>>(new Set(props.drafts.map((_, i) => i)));
  const [error, setError] = useState('');
  return (
    <Dialog
      title="The Tester agent’s drafts"
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="pe-btn pe-btn--secondary" onClick={props.onClose}>
            Leave them
          </button>
          <button
            type="button"
            className="pe-btn pe-btn--primary"
            disabled={chosen.size === 0}
            onClick={() => {
              void props.onAccept(props.drafts.filter((_, i) => chosen.has(i))).then((e) => {
                setError(e ?? '');
              });
            }}
          >
            Add {chosen.size} test cases
          </button>
        </>
      }
    >
      {props.drafts.length === 0 ? (
        <p className="pe-muted">The agent wrote no cases.</p>
      ) : (
        <ul className="pe-draft-list">
          {props.drafts.map((d, i) => (
            <li key={i}>
              <label className="pe-check">
                <input
                  type="checkbox"
                  checked={chosen.has(i)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(i);
                    else next.delete(i);
                    setChosen(next);
                  }}
                />
                <span>
                  <strong>{d.title}</strong>
                  {d.steps ? <pre className="pe-run-pre">{d.steps}</pre> : null}
                  {d.expected ? (
                    <span className="pe-small pe-muted">Expected: {d.expected}</span>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <div className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
    </Dialog>
  );
}
