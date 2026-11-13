// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-419 | S15 | v0.1.0] T37 medium: A filed bug shows as a bug and carries the failing step note ──
// ── [PCODE-318 | S15 | v0.1.0] T32.4b Masking of personal data in test results and the test-data vault ──
// ── [PCODE-317 | S15 | v0.1.0] T32.4a AI triage of test failures and impacted tests first ──
// ── [PCODE-316 | S15 | v0.1.0] T32.3b Named run sign-off with a frozen snapshot, and a release gate on tests ──
// ── [PCODE-315 | S15 | v0.1.0] T32.3a Cypress and Allure import, defects in the trace, leakage and burndown ──
// ── [PCODE-314 | S15 | v0.1.0] T32.2 Runs: assignment and workload, keyboard entry, timers, reopen when the defect is done ──
// ── [PCODE-313 | S15 | v0.1.0] T32.1 Test repository: shared steps, parameters in the screen, structured BDD ──
// ── [PCODE-271 | S15 | v0.1.0] Project tabs fixes from the deep UX check: handover double page, service accounts, lifecycle name, extraction duplicates, AI cases picker, webhook events, overdue sprint, tab overflow ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-186 | S15 | v0.1.0] B7.2 Client portal live: roadmap, acceptance tests, approvals, releases with ratings, shared documents ──
// ── [PCODE-177 | S15 | v0.1.0] B4.3 Test tab live in the web app: runs with matrix, steps, evidence, defects, repository, coverage, flaky, AI cases ──
//    Why:  the Test tab of the approved design on the server's test lab. A run is planned once and made
//          per configuration, so the matrix shows every case on every configuration; a tester gives each
//          step its result, adds evidence and files a bug from a failure with all of it in one click. The
//          repository keeps cases in suites with versioned steps; coverage says what each requirement has;
//          flaky cases are found from their history and quarantined with a note; the Tester agent drafts
//          cases from a task's criteria.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Bar, Button, Card, Chip, Stat } from '../preview/ui.js';
import { sizeText, uploadFile } from './files.js';
// [PCODE-313 | S15 | v0.1.0]
import {
  FeatureImport,
  GherkinEditor,
  ParametersEditor,
  SharedStepsCard,
  paramsToRows,
  rowsToParams,
  type ParamRow,
  type SharedSet,
} from './testdesign.js';
// [PCODE-314 | S15 | v0.1.0]
import { TestWorkload, durationText, keyAction, nextStep, useElapsed } from './testruns.js';
import { ImportReport, TestQuality } from './testquality.js'; // [PCODE-315 | S15 | v0.1.0]
import { SignOffCard } from './testsignoff.js'; // [PCODE-316 | S15 | v0.1.0]
import { StepText, TestDataCard } from './testdata.js'; // [PCODE-318 | S15 | v0.1.0]
// [PCODE-317 | S15 | v0.1.0]
import {
  ImpactedPreview,
  TriageNote,
  TriageRunButton,
  useImpacted,
  useOpenPulls,
  type Triage,
} from './testtriage.js';
import { ago } from './inbox.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface Run {
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
  clientRound?: boolean; // [PCODE-186 | S15 | v0.1.0] shared with the client as an acceptance round
}
interface Step {
  action: string;
  expected: string;
  shared?: string; // [PCODE-313 | S15 | v0.1.0]
}
interface PlanCase {
  caseId: string;
  key: string;
  title: string;
  suite: string;
  kind: string;
  version: number;
  steps: Step[];
  status: string;
  stepResults: { status: string; note: string }[];
  message: string;
  ranVersion: number | null;
  assigneeId: string | null;
  assigneeName: string | null;
  defectId: string | null;
  defectRef: string | null;
  unblocked: boolean;
  evidence: number;
  // [PCODE-314 | S15 | v0.1.0]
  durationMs: number | null;
  reopenedBy: string | null;
  triage: Triage | null; // [PCODE-317 | S15 | v0.1.0]
  quarantined: boolean;
}
interface Plan {
  run: Run;
  config: Record<string, string>;
  charter: string;
  timeboxMinutes: number | null;
  notes: string;
  cases: PlanCase[];
}
interface Evidence {
  id: string;
  caseId: string;
  step: number | null;
  kind: string;
  note: string;
  fileName: string;
  mime: string;
  url: string;
  at: string;
}
export interface Case {
  id: string;
  itemId: string | null;
  itemRef: string | null;
  key: string;
  title: string;
  source: string;
  lastStatus: string | null;
  lastAt: string | null;
  suite: string;
  kind: string;
  version: number;
  quarantined: boolean;
}

type Tone = 'success' | 'danger' | 'warning' | 'neutral' | 'info' | 'primary';
export const RESULT_TONE: Record<string, Tone> = {
  passed: 'success',
  failed: 'danger',
  blocked: 'warning',
  skipped: 'neutral',
  untested: 'neutral',
  running: 'primary',
  done: 'success',
};

/** "Regression (chrome · windows)" belongs to the plan "Regression" started at the same minute. */
export function groupRuns(runs: readonly Run[]): { key: string; name: string; runs: Run[] }[] {
  const out = new Map<string, { key: string; name: string; runs: Run[] }>();
  for (const r of runs) {
    const name = r.name.replace(/ \([^()]*\)$/, '');
    const key = name + '@' + r.startedAt.slice(0, 16);
    const g = out.get(key) ?? { key, name, runs: [] };
    g.runs.push(r);
    out.set(key, g);
  }
  return [...out.values()];
}

/** The case's result from its steps; null while steps are still open and nothing failed. */
export function caseStatus(
  steps: readonly string[],
): 'passed' | 'failed' | 'blocked' | 'skipped' | null {
  if (steps.includes('failed')) return 'failed';
  if (steps.includes('blocked')) return 'blocked';
  if (!steps.length || steps.includes('untested')) return null;
  return steps.includes('passed') ? 'passed' : 'skipped';
}

/** "browser: chrome, os: windows" per line into configurations. */
export function parseConfigs(text: string): Record<string, string>[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) =>
      Object.fromEntries(
        l
          .split(',')
          .map((p) => p.split(':').map((x) => x.trim()))
          .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1]),
      ),
    )
    .filter((c) => Object.keys(c).length > 0);
}

const configLabel = (c: Record<string, string>): string =>
  Object.values(c).join(' · ') || 'Default';

type View = 'runs' | 'repo' | 'coverage' | 'flaky' | 'bugs' | 'ai' | 'quality';

export function TestPage(props: {
  workspaceId: string;
  projectId: string;
  hub: EventHub;
  canEdit: boolean;
  canTest: boolean;
  go: (p: string) => void;
}): ReactNode {
  const [view, setView] = useState<View>('runs');
  const views: { key: View; label: string; icon: PIconName }[] = [
    { key: 'runs', label: 'Runs', icon: 'play' },
    { key: 'repo', label: 'Repository', icon: 'documents' },
    { key: 'coverage', label: 'Coverage', icon: 'check' },
    { key: 'flaky', label: 'Flaky', icon: 'flag' },
    { key: 'bugs', label: 'Bugs', icon: 'incident' },
    { key: 'quality', label: 'Quality', icon: 'insights' }, // [PCODE-315 | S15 | v0.1.0]
    { key: 'ai', label: 'AI cases', icon: 'sparkle' },
  ];
  const base = {
    workspaceId: props.workspaceId,
    projectId: props.projectId,
    canEdit: props.canEdit,
  };
  return (
    <div className="pv-stack">
      <nav className="pv-subtabs" aria-label="Test view">
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            className="pv-subtab"
            aria-pressed={view === v.key}
            onClick={() => {
              setView(v.key);
            }}
          >
            <PIcon name={v.icon} size={14} />
            {v.label}
          </button>
        ))}
      </nav>
      {view === 'runs' ? (
        <Runs {...base} canTest={props.canTest} hub={props.hub} go={props.go} />
      ) : null}
      {view === 'repo' ? <Repository {...base} /> : null}
      {view === 'coverage' ? <Coverage {...base} go={props.go} /> : null}
      {view === 'flaky' ? <Flaky {...base} /> : null}
      {view === 'bugs' ? <Bugs {...base} go={props.go} /> : null}
      {view === 'quality' ? <TestQuality {...base} /> : null}
      {view === 'ai' ? <AiCases {...base} /> : null}
    </div>
  );
}

// ── runs ──

function Runs(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
  canTest: boolean;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, projectId } = props;
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<'run' | 'plan' | 'import' | 'compare' | 'workload'>('run');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Run[]>('GET', W(workspaceId, '/projects/' + projectId + '/test-runs'));
    if (r.ok) setRuns(r.data);
    else setError(r.error.message);
  }, [workspaceId, projectId]);
  useEffect(() => {
    void load();
    let timer: number | null = null;
    const off = props.hub.on((e) => {
      if (e.projectid !== projectId && e.type !== 'orqiva.workspace.resync') return;
      if (!e.type.includes('test_run') && e.type !== 'orqiva.workspace.resync') return;
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void load();
      }, 500);
    });
    return () => {
      off();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [load, props.hub, projectId]);
  const groups = useMemo(() => groupRuns(runs ?? []), [runs]);
  const current = groups.find((g) => g.key === sel) ?? groups[0] ?? null;
  if (!runs) return <p className="pv-muted">{error ?? 'Loading runs…'}</p>;
  return (
    <div className="pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pv-page-actions">
        <select
          className="v2-input"
          aria-label="Run"
          value={current?.key ?? ''}
          onChange={(e) => {
            setSel(e.target.value);
            setMode('run');
          }}
        >
          {groups.length ? null : <option value="">No runs yet</option>}
          {groups.map((g) => (
            <option key={g.key} value={g.key}>
              {g.name} · {g.runs.length > 1 ? String(g.runs.length) + ' configurations · ' : ''}
              {ago(g.runs[0]?.startedAt ?? new Date().toISOString())} ago
            </option>
          ))}
        </select>
        {props.canEdit ? (
          <>
            <Button
              size="sm"
              kind="primary"
              icon="plus"
              onClick={() => {
                setMode('plan');
              }}
            >
              Plan a run
            </Button>
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                setMode('import');
              }}
            >
              Import a report
            </Button>
          </>
        ) : null}
        {runs.length > 1 ? (
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setMode('compare');
            }}
          >
            Compare runs
          </Button>
        ) : null}
        {/* [PCODE-314 | S15 | v0.1.0] who has what left in the running runs */}
        <Button
          size="sm"
          kind="ghost"
          icon="people"
          onClick={() => {
            setMode('workload');
          }}
        >
          Workload
        </Button>
      </div>
      {mode === 'workload' ? (
        <TestWorkload workspaceId={workspaceId} projectId={projectId} />
      ) : null}
      {mode === 'plan' ? (
        <PlanRun
          workspaceId={workspaceId}
          projectId={projectId}
          onDone={(key) => {
            setMode('run');
            void load().then(() => {
              if (key) setSel(key);
            });
          }}
        />
      ) : null}
      {mode === 'import' ? (
        <ImportReport
          workspaceId={workspaceId}
          projectId={projectId}
          onDone={() => {
            setMode('run');
            setSel(null);
            void load();
          }}
        />
      ) : null}
      {mode === 'compare' ? <CompareRuns workspaceId={workspaceId} runs={runs} /> : null}
      {mode === 'run' && current ? (
        <RunGroup
          key={current.key}
          workspaceId={workspaceId}
          projectId={projectId}
          name={current.name}
          runs={current.runs}
          canEdit={props.canEdit}
          canTest={props.canTest}
          hub={props.hub}
          go={props.go}
          reload={() => void load()}
        />
      ) : null}
      {mode === 'run' && !current ? (
        <Card>
          <p className="pv-empty">
            No runs yet. Plan one over a suite and the configurations you test on, or import a
            Playwright report.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function RunGroup(props: {
  workspaceId: string;
  projectId: string;
  name: string;
  runs: Run[];
  canEdit: boolean;
  canTest: boolean;
  hub: EventHub;
  go: (p: string) => void;
  reload: () => void;
}): ReactNode {
  const { workspaceId } = props;
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [cell, setCell] = useState<[string, string] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // [PCODE-314 | S15 | v0.1.0] the people a case can be given to
  const [members, setMembers] = useState<{ userId: string; name: string }[]>([]);
  useEffect(() => {
    void api<{ userId: string; name: string; role: string; service?: boolean }[]>(
      'GET',
      W(workspaceId, '/members'),
    ).then((r) => {
      // [PCODE-316 | S15 | v0.1.0] people only: no guests, no service accounts
      if (r.ok) setMembers(r.data.filter((m) => m.role !== 'guest' && !m.service));
    });
  }, [workspaceId]);
  const ids = props.runs.map((r) => r.id).join(',');
  const load = useCallback(async () => {
    const all = await Promise.all(
      ids.split(',').map((id) => api<Plan>('GET', W(workspaceId, '/test-runs/' + id + '/plan'))),
    );
    for (const r of all) if (!r.ok) setError(r.error.message);
    setPlans(all.flatMap((r) => (r.ok ? [r.data] : [])));
  }, [workspaceId, ids]);
  useEffect(() => {
    void load();
    const off = props.hub.on((e) => {
      if (ids.includes(e.subject)) void load();
    });
    return off;
  }, [load, props.hub, ids]);
  if (!plans) return <p className="pv-muted">{error ?? 'Loading the run…'}</p>;
  const cases: PlanCase[] = [];
  for (const p of plans)
    for (const c of p.cases) if (!cases.some((x) => x.caseId === c.caseId)) cases.push(c);
  const cellOf = (runId: string, caseId: string): PlanCase | undefined =>
    plans.find((p) => p.run.id === runId)?.cases.find((c) => c.caseId === caseId);
  const total = plans.reduce((n, p) => n + p.cases.length, 0);
  // [PCODE-317 | S15 | v0.1.0] failures the Tester agent has not looked at yet
  const untriaged = plans.reduce(
    (n, p) =>
      n +
      p.cases.filter((c) => (c.status === 'failed' || c.status === 'blocked') && !c.triage).length,
    0,
  );
  const passed = plans.reduce((n, p) => n + p.cases.filter((c) => c.status === 'passed').length, 0);
  const running = plans.filter((p) => p.run.status === 'running');
  const first = plans[0];
  const chosen = cell ?? (first?.cases[0] ? [first.run.id, first.cases[0].caseId] : null);
  const chosenPlan = chosen ? plans.find((p) => p.run.id === chosen[0]) : undefined;
  const chosenCase = chosen ? cellOf(chosen[0], chosen[1]) : undefined;
  // [PCODE-314 | S15 | v0.1.0] J and K walk the matrix: case by case, configuration by configuration
  const order = cases.flatMap((c) =>
    plans
      .filter((p) => cellOf(p.run.id, c.caseId))
      .map((p): [string, string] => [p.run.id, c.caseId]),
  );
  const move = (by: 1 | -1): void => {
    const at = order.findIndex((x) => x[0] === chosen?.[0] && x[1] === chosen[1]);
    const next = order[Math.min(order.length - 1, Math.max(0, at + by))];
    if (next) setCell(next);
  };
  const finish = async (): Promise<void> => {
    for (const p of running) {
      const r = await api('POST', W(workspaceId, '/test-runs/' + p.run.id + '/finish'));
      if (!r.ok) setError(r.error.message);
    }
    props.reload();
    void load();
  };
  // [PCODE-186 | S15 | v0.1.0]
  const share = async (shared: boolean): Promise<void> => {
    if (!first) return;
    const r = await api('PUT', W(workspaceId, '/test-runs/' + first.run.id + '/client-round'), {
      shared,
    });
    if (!r.ok) setError(r.error.message);
    props.reload();
    void load();
  };
  return (
    <div className="pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <Card>
        <div className="pv-sprint-row">
          <div>
            <div className="pv-sprint-title">
              <strong className="pv-run-title">{props.name}</strong>
              <Chip tone={running.length ? 'primary' : 'success'}>
                {running.length ? 'in progress' : 'finished'}
              </Chip>
              {first?.charter ? <Chip tone="info">exploratory</Chip> : null}
            </div>
            <div className="pv-muted pv-small pv-mt-4">
              Started {ago(first?.run.startedAt ?? new Date().toISOString())} ago
              {first?.run.startedBy ? ' by ' + first.run.startedBy : ''} · {plans.length}{' '}
              configuration{plans.length === 1 ? '' : 's'} · {first?.run.source ?? ''}
            </div>
          </div>
          <div className="pv-sprint-figures">
            <div>
              <span className="pv-muted pv-small">Passed</span>
              <strong className="pv-num">
                {passed} / {total}
              </strong>
            </div>
            {/* [PCODE-186 | S15 | v0.1.0] an acceptance round: the client's testers test it in their portal */}
            {props.canEdit && first ? (
              <Button
                icon="clients"
                onClick={() => void share(!first.run.clientRound)}
                title="Client testers mark each case in their portal; an approver accepts the round"
              >
                {first.run.clientRound ? 'Shared with the client · stop' : 'Share with the client'}
              </Button>
            ) : null}
            {props.canTest ? (
              <TriageRunButton
                workspaceId={workspaceId}
                runIds={plans.map((p) => p.run.id)}
                waiting={untriaged}
                onDone={(said) => {
                  setError(said.startsWith('Triaged') || said.startsWith('Nothing') ? null : said);
                  void load();
                }}
              />
            ) : null}
            {running.length && props.canEdit ? (
              <Button kind="primary" icon="signoff" onClick={() => void finish()}>
                Finish the run
              </Button>
            ) : null}
          </div>
        </div>
        <Bar value={passed} max={Math.max(1, total)} tone="success" />
      </Card>

      {/* [PCODE-316 | S15 | v0.1.0] who signs each configuration's run off, and the frozen results */}
      <SignOffCard
        workspaceId={workspaceId}
        runs={plans.map((p) => ({
          id: p.run.id,
          label: configLabel(p.config),
          finished: p.run.status !== 'running',
        }))}
        members={members}
        canEdit={props.canEdit}
      />
      {first?.charter ? (
        <Session
          workspaceId={workspaceId}
          plan={first}
          canTest={props.canTest && first.run.status === 'running'}
        />
      ) : null}

      {cases.length ? (
        <Card flush title="Matrix">
          <div className="pv-grid-scroll">
            <table className="pv-table pv-matrix-table">
              <thead>
                <tr>
                  <th>Case</th>
                  {plans.map((p) => (
                    <th key={p.run.id} className="pv-center">
                      {configLabel(p.config)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.caseId}>
                    <td>
                      {c.key ? <span className="pv-mono pv-muted">{c.key}</span> : null} {c.title}
                      {c.quarantined ? <Chip tone="warning">quarantined</Chip> : null}
                    </td>
                    {plans.map((p) => {
                      const x = cellOf(p.run.id, c.caseId);
                      const status = x?.unblocked ? 'retest' : (x?.status ?? 'untested');
                      const on = chosen?.[0] === p.run.id && chosen[1] === c.caseId;
                      return (
                        <td key={p.run.id} className="pv-center">
                          {x ? (
                            <button
                              type="button"
                              className={
                                'pv-result pv-result--' + status + (on ? ' pv-result--sel' : '')
                              }
                              title={c.title + ' on ' + configLabel(p.config)}
                              onClick={() => {
                                setCell([p.run.id, c.caseId]);
                              }}
                            >
                              {status}
                            </button>
                          ) : (
                            <span className="pv-muted">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {chosenPlan && chosenCase ? (
        <CaseRunner
          key={chosenPlan.run.id + chosenCase.caseId}
          workspaceId={workspaceId}
          projectId={props.projectId}
          plan={chosenPlan}
          c={chosenCase}
          canTest={props.canTest && chosenPlan.run.status === 'running'}
          canEdit={props.canEdit}
          members={members}
          onMove={move}
          go={props.go}
          onChange={() => {
            void load();
            props.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function CaseRunner(props: {
  workspaceId: string;
  projectId: string;
  plan: Plan;
  c: PlanCase;
  canTest: boolean;
  canEdit: boolean;
  members: { userId: string; name: string }[];
  onMove: (by: 1 | -1) => void;
  go: (p: string) => void;
  onChange: () => void;
}): ReactNode {
  const { workspaceId, plan, c } = props;
  // [PCODE-314 | S15 | v0.1.0] the time on this case: what earlier results brought, and since it opened
  const [spentBefore] = useState(c.durationMs ?? 0);
  const elapsed = useElapsed(props.canTest);
  const runPath = W(workspaceId, '/test-runs/' + plan.run.id);
  const [steps, setSteps] = useState<string[]>(
    c.steps.map((_, i) => c.stepResults[i]?.status ?? 'untested'),
  );
  const [message, setMessage] = useState(c.message);
  // [PCODE-419 | S15 | v0.1.0] what happened at a step that failed or was blocked: it goes into the bug
  const [notes, setNotes] = useState<string[]>(c.steps.map((_, i) => c.stepResults[i]?.note ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (
    status: 'passed' | 'failed' | 'blocked' | 'skipped',
    list = steps,
  ): Promise<void> => {
    setBusy(true);
    const r = await api('PUT', runPath + '/cases/' + c.caseId, {
      status,
      durationMs: spentBefore + elapsed,
      ...(c.steps.length
        ? { steps: list.map((s, i) => ({ status: s, note: (notes[i] ?? '').trim() })) }
        : {}),
      ...(message.trim() ? { message: message.trim() } : {}),
    });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else props.onChange();
  };
  const setStep = (i: number, s: string): void => {
    const next = steps.map((x, j) => (j === i ? s : x));
    setSteps(next);
    const overall = caseStatus(next);
    if (overall) void save(overall, next);
  };
  // [PCODE-314 | S15 | v0.1.0] P, F, B and S set the next step (or the case); J and K move on
  useEffect(() => {
    if (!props.canTest) return;
    const onKey = (e: KeyboardEvent): void => {
      const act = keyAction({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        target: e.target instanceof HTMLElement ? e.target : null,
      });
      if (!act || busy) return;
      e.preventDefault();
      if (act.kind === 'move') props.onMove(act.by);
      else if (c.steps.length) setStep(nextStep(steps), act.status);
      else void save(act.status);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });
  const assign = async (userId: string): Promise<void> => {
    const r = await api('PUT', runPath + '/assign', { caseId: c.caseId, userId: userId || null });
    if (!r.ok) setError(r.error.message);
    else props.onChange();
  };
  const fileBug = async (): Promise<void> => {
    setBusy(true);
    const r = await api<{ ref: string }>('POST', runPath + '/cases/' + c.caseId + '/defect', {
      ...(c.status === 'blocked' ? { blocked: true } : {}),
    });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else props.onChange();
  };
  return (
    <div className="pv-split">
      <Card
        title={
          <>
            {c.key ? <span className="pv-mono pv-muted">{c.key}</span> : null} {c.title}{' '}
            <span className="pv-muted pv-small">
              · {configLabel(plan.config)} · case v{c.version}
              {c.ranVersion !== null && c.ranVersion !== c.version
                ? ' (ran on v' + String(c.ranVersion) + ')'
                : ''}
            </span>
          </>
        }
        action={
          <span className="pv-page-actions">
            {/* [PCODE-314 | S15 | v0.1.0] who runs it, and the time on it */}
            {props.canEdit && plan.run.status === 'running' ? (
              <select
                className="v2-input v2-input--sm"
                aria-label="Tester"
                value={c.assigneeId ?? ''}
                onChange={(e) => void assign(e.target.value)}
              >
                <option value="">Nobody</option>
                {props.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : c.assigneeName ? (
              <Chip icon="user">{c.assigneeName}</Chip>
            ) : null}
            {props.canTest || c.durationMs ? (
              <Chip icon="clock">
                {durationText(props.canTest ? spentBefore + elapsed : (c.durationMs ?? 0))}
              </Chip>
            ) : null}
            <Chip tone={RESULT_TONE[c.status] ?? 'neutral'}>{c.status}</Chip>
          </span>
        }
      >
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
        {c.reopenedBy ? (
          <p role="status" className="pv-small">
            <Chip tone="info" icon="incident">
              {c.reopenedBy} is done
            </Chip>{' '}
            It blocked this case; run it again.
          </p>
        ) : null}
        {props.canTest ? (
          <p className="pv-small pv-muted">
            Keys: <kbd>P</kbd> pass, <kbd>F</kbd> fail, <kbd>B</kbd> block, <kbd>S</kbd> skip the
            next step · <kbd>J</kbd> / <kbd>K</kbd> next or previous case
          </p>
        ) : null}
        {c.steps.length ? (
          <ol className="pv-steps">
            {c.steps.map((s, i) => {
              const r = steps[i] ?? 'untested';
              return (
                <li
                  key={String(i) + s.action}
                  className={'pv-step' + (r === 'failed' ? ' pv-step--failed' : '')}
                >
                  <span className="pv-step-num">{i + 1}</span>
                  <div className="pv-step-body">
                    {/* [PCODE-318 | S15 | v0.1.0] {{data:name}} as a button that reveals the value */}
                    <strong>
                      <StepText
                        workspaceId={workspaceId}
                        projectId={props.projectId}
                        text={s.action}
                      />
                    </strong>
                    {s.expected ? (
                      <span className="pv-muted pv-small">
                        Expected:{' '}
                        <StepText
                          workspaceId={workspaceId}
                          projectId={props.projectId}
                          text={s.expected}
                        />
                      </span>
                    ) : null}
                    {(r === 'failed' || r === 'blocked') && props.canTest ? (
                      <input
                        className="v2-input v2-input--sm"
                        aria-label={'What happened at step ' + String(i + 1)}
                        placeholder="What happened at this step"
                        maxLength={2000}
                        value={notes[i] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setNotes((all) => all.map((x, j) => (j === i ? v : x)));
                        }}
                        onBlur={() => {
                          const overall = caseStatus(steps);
                          if (overall && (notes[i] ?? '') !== (c.stepResults[i]?.note ?? ''))
                            void save(overall);
                        }}
                      />
                    ) : c.stepResults[i]?.note ? (
                      <span className="pv-text-danger pv-small">
                        Actual: {c.stepResults[i].note}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className="pv-step-results"
                    role="group"
                    aria-label={'Result of step ' + String(i + 1)}
                  >
                    {(['passed', 'failed', 'blocked', 'skipped'] as const).map((x) => (
                      <button
                        key={x}
                        type="button"
                        className={'pv-step-btn pv-step-btn--' + x}
                        aria-pressed={r === x}
                        disabled={!props.canTest || busy}
                        onClick={() => {
                          setStep(i, x);
                        }}
                      >
                        {x === 'passed'
                          ? 'Pass'
                          : x === 'failed'
                            ? 'Fail'
                            : x === 'blocked'
                              ? 'Block'
                              : 'Skip'}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="pv-stack">
            <p className="pv-muted pv-small">
              This case has no steps; give the whole case its result.
            </p>
            <div className="pv-step-results" role="group" aria-label="Result of the case">
              {(['passed', 'failed', 'blocked', 'skipped'] as const).map((x) => (
                <button
                  key={x}
                  type="button"
                  className={'pv-step-btn pv-step-btn--' + x}
                  aria-pressed={c.status === x}
                  disabled={!props.canTest || busy}
                  onClick={() => void save(x)}
                >
                  {x === 'passed'
                    ? 'Pass'
                    : x === 'failed'
                      ? 'Fail'
                      : x === 'blocked'
                        ? 'Block'
                        : 'Skip'}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* [PCODE-317 | S15 | v0.1.0] the Tester agent's view of a failure */}
        {c.status === 'failed' || c.status === 'blocked' ? (
          <TriageNote
            workspaceId={workspaceId}
            runId={plan.run.id}
            caseId={c.caseId}
            triage={c.triage}
            canAsk={props.canTest || props.canEdit}
            onChange={props.onChange}
          />
        ) : null}
        <label className="v2-field">
          <span className="pv-muted pv-small">What happened (goes into the bug)</span>
          <textarea
            className="v2-input"
            rows={3}
            value={message}
            disabled={!props.canTest}
            onChange={(e) => {
              setMessage(e.target.value);
            }}
            onBlur={() => {
              const overall = c.steps.length
                ? caseStatus(steps)
                : c.status === 'untested'
                  ? null
                  : c.status;
              if (overall && message.trim() !== c.message && overall !== 'running')
                void save(overall as 'passed' | 'failed' | 'blocked' | 'skipped');
            }}
          />
        </label>
      </Card>
      <div className="pv-stack">
        <EvidenceCard
          workspaceId={workspaceId}
          projectId={props.projectId}
          runId={plan.run.id}
          c={c}
          canTest={props.canTest}
          onChange={props.onChange}
        />
        <Card title="Bug">
          {c.defectRef && c.defectId ? (
            <div className="pv-page-actions">
              <Chip tone={c.unblocked ? 'success' : 'danger'} icon="incident">
                {c.defectRef}
                {c.unblocked ? ' is done: run the case again' : ' filed from this result'}
              </Chip>
              <Button
                size="sm"
                kind="ghost"
                onClick={() => {
                  props.go('/items/' + (c.defectId ?? ''));
                }}
              >
                Open
              </Button>
            </div>
          ) : c.status === 'failed' || c.status === 'blocked' ? (
            <div className="pv-stack">
              <p className="pv-muted pv-small">
                The bug gets the steps, what happened, the configuration and every piece of
                evidence.
              </p>
              {props.canTest ? (
                <Button kind="primary" icon="plus" disabled={busy} onClick={() => void fileBug()}>
                  File bug with all evidence
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="pv-muted pv-small">A failed or blocked result can become a bug here.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function EvidenceCard(props: {
  workspaceId: string;
  projectId: string;
  runId: string;
  c: PlanCase;
  canTest: boolean;
  onChange: () => void;
}): ReactNode {
  const [list, setList] = useState<Evidence[]>([]);
  const [kind, setKind] = useState('screenshot');
  const [step, setStep] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = W(props.workspaceId, '/test-runs/' + props.runId);
  const load = useCallback(async () => {
    const r = await api<Evidence[]>('GET', path + '/evidence');
    if (r.ok) setList(r.data.filter((e) => e.caseId === props.c.caseId));
  }, [path, props.c.caseId]);
  useEffect(() => {
    void load();
  }, [load]);
  const add = async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    const up = await uploadFile(props.workspaceId, props.projectId, file);
    if (!up.ok) {
      setError(up.error.message);
      setBusy(false);
      return;
    }
    const r = await api('POST', path + '/cases/' + props.c.caseId + '/evidence', {
      fileId: up.data.id,
      kind,
      ...(step ? { step: Number(step) } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else {
      setNote('');
      void load();
      props.onChange();
    }
  };
  return (
    <Card title={'Evidence · ' + String(list.length)}>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {list.length ? (
        <ul className="pv-rows">
          {list.map((e) => (
            <li key={e.id} className="pv-row pv-row--static">
              {e.mime.startsWith('image/') ? (
                <img className="v2-thumb" src={e.url} alt={e.note || e.fileName} />
              ) : (
                <PIcon
                  name={
                    e.kind === 'recording' ? 'play' : e.kind === 'voice' ? 'mention' : 'documents'
                  }
                  size={16}
                />
              )}
              <span className="pv-row-main">
                <a className="pv-row-title pv-link" href={e.url} target="_blank" rel="noreferrer">
                  {e.fileName}
                </a>
                <span className="pv-row-sub">
                  {e.kind}
                  {e.step ? ' · step ' + String(e.step) : ''}
                  {e.note ? ' · ' + e.note : ''} · {ago(e.at)} ago
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pv-muted pv-small">No evidence yet.</p>
      )}
      {props.canTest ? (
        <div className="v2-form">
          <select
            className="v2-input v2-input--sm"
            aria-label="Kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
            }}
          >
            {['screenshot', 'recording', 'console', 'network', 'voice', 'document'].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          {props.c.steps.length ? (
            <select
              className="v2-input v2-input--sm"
              aria-label="Step"
              value={step}
              onChange={(e) => {
                setStep(e.target.value);
              }}
            >
              <option value="">Whole case</option>
              {props.c.steps.map((_, i) => (
                <option key={i} value={String(i + 1)}>
                  Step {i + 1}
                </option>
              ))}
            </select>
          ) : null}
          <input
            className="v2-input v2-input--sm"
            aria-label="Note"
            placeholder="Note"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
          <input
            type="file"
            aria-label="Evidence file"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void add(f);
              e.target.value = '';
            }}
          />
          <span className="pv-muted pv-small">
            {busy ? 'Uploading…' : 'Up to ' + sizeText(25 * 1024 * 1024)}
          </span>
        </div>
      ) : null}
    </Card>
  );
}

function Session(props: { workspaceId: string; plan: Plan; canTest: boolean }): ReactNode {
  const [notes, setNotes] = useState(props.plan.notes);
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const started = new Date(props.plan.run.startedAt).getTime();
  const used = Math.round(
    ((props.plan.run.finishedAt ? new Date(props.plan.run.finishedAt).getTime() : Date.now()) -
      started) /
      60_000,
  );
  const save = async (): Promise<void> => {
    const r = await api(
      'PATCH',
      W(props.workspaceId, '/test-runs/' + props.plan.run.id + '/session'),
      { notes },
    );
    if (r.ok) setSaved(true);
    else setError(r.error.message);
  };
  return (
    <Card
      title="Exploratory session"
      action={
        props.plan.timeboxMinutes ? (
          <Chip tone={used > props.plan.timeboxMinutes ? 'warning' : 'neutral'} icon="clock">
            {used} of {props.plan.timeboxMinutes} min
          </Chip>
        ) : null
      }
    >
      <p>
        <strong>Charter:</strong> {props.plan.charter}
      </p>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <textarea
        className="v2-input"
        rows={6}
        aria-label="Session notes"
        placeholder="What you tried, what you saw, questions, bugs"
        value={notes}
        disabled={!props.canTest}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        onBlur={() => {
          if (!saved) void save();
        }}
      />
      <span className="pv-muted pv-small">
        {saved ? 'Saved' : 'Saved when you leave the field'}
      </span>
    </Card>
  );
}

const ALL = '*all*';

function PlanRun(props: {
  workspaceId: string;
  projectId: string;
  onDone: (key: string | null) => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [suites, setSuites] = useState<{ suite: string; cases: number }[]>([]);
  const [suite, setSuite] = useState(ALL);
  const [configs, setConfigs] = useState(
    'browser: chrome, os: windows\nbrowser: firefox, os: windows',
  );
  const [exploratory, setExploratory] = useState(false);
  const [charter, setCharter] = useState('');
  const [timebox, setTimebox] = useState('60');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // [PCODE-317 | S15 | v0.1.0] a suite, all cases, or the cases a pull request touches ("pr:<id>")
  const pulls = useOpenPulls(props.workspaceId, props.projectId);
  const pullId = suite.startsWith('pr:') ? suite.slice(3) : null;
  const impacted = useImpacted(props.workspaceId, props.projectId, pullId);
  useEffect(() => {
    void api<{ suite: string; cases: number }[]>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/test-suites'),
    ).then((r) => {
      if (r.ok) setSuites(r.data);
    });
  }, [props.workspaceId, props.projectId]);
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const list = parseConfigs(configs);
    // [PCODE-177 | S15 | v0.1.0] "All cases" names every case: the server plans named cases or a suite
    let caseIds: string[] = [];
    if (!exploratory && pullId) {
      caseIds = (impacted.cases ?? []).map((c) => c.caseId);
      if (!caseIds.length) {
        setBusy(false);
        setError('No case covers the files this pull request changes.');
        return;
      }
    } else if (!exploratory && suite === ALL) {
      const all = await api<Case[]>(
        'GET',
        W(props.workspaceId, '/projects/' + props.projectId + '/test-cases'),
      );
      caseIds = all.ok ? all.data.map((c) => c.id).slice(0, 2000) : [];
      if (!caseIds.length) {
        setBusy(false);
        setError('There are no cases yet: add some in the repository first.');
        return;
      }
    }
    const r = await api<Run[]>(
      'POST',
      W(props.workspaceId, '/projects/' + props.projectId + '/test-runs/plan'),
      {
        name: name.trim(),
        ...(list.length ? { configs: list } : {}),
        ...(exploratory
          ? { charter: charter.trim(), timeboxMinutes: Math.max(1, Number(timebox) || 60) }
          : suite === ALL || pullId
            ? { caseIds }
            : { suite }),
      },
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    const g = groupRuns(r.data)[0];
    props.onDone(g?.key ?? null);
  };
  return (
    <Card title="Plan a run">
      <form
        className="pv-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void submit();
        }}
      >
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
        <input
          className="v2-input"
          aria-label="Name"
          placeholder="Name, e.g. Release 1.4 regression"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <label className="v2-switch">
          <input
            type="checkbox"
            checked={exploratory}
            onChange={(e) => {
              setExploratory(e.target.checked);
            }}
          />
          <span>Exploratory session with a charter</span>
        </label>
        {exploratory ? (
          <>
            <textarea
              className="v2-input"
              rows={3}
              aria-label="Charter"
              placeholder="Explore … with … to discover …"
              value={charter}
              onChange={(e) => {
                setCharter(e.target.value);
              }}
            />
            <input
              className="v2-input v2-input--sm"
              type="number"
              min={1}
              max={600}
              aria-label="Timebox in minutes"
              value={timebox}
              onChange={(e) => {
                setTimebox(e.target.value);
              }}
            />
          </>
        ) : (
          <select
            className="v2-input"
            aria-label="Suite"
            value={suite}
            onChange={(e) => {
              setSuite(e.target.value);
            }}
          >
            <option value={ALL}>All cases</option>
            {suites.map((s) => (
              <option key={s.suite} value={s.suite}>
                {s.suite || 'No suite'} · {s.cases} cases
              </option>
            ))}
            {pulls.length ? (
              <optgroup label="Impacted by a pull request">
                {pulls.map((p) => (
                  <option key={p.id} value={'pr:' + p.id}>
                    #{p.number} {p.title}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        )}
        {!exploratory && pullId ? <ImpactedPreview {...impacted} /> : null}
        <label className="v2-field">
          <span className="pv-muted pv-small">
            Configurations, one per line (a run is made for each)
          </span>
          <textarea
            className="v2-input v2-mono"
            rows={3}
            value={configs}
            onChange={(e) => {
              setConfigs(e.target.value);
            }}
          />
        </label>
        <div className="pv-page-actions">
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={busy || !name.trim() || (exploratory && !charter.trim())}
          >
            {busy ? 'Planning…' : 'Plan the run'}
          </button>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              props.onDone(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CompareRuns(props: { workspaceId: string; runs: Run[] }): ReactNode {
  const [a, setA] = useState(props.runs[1]?.id ?? '');
  const [b, setB] = useState(props.runs[0]?.id ?? '');
  const [res, setRes] = useState<{
    changes: { caseId: string; title: string; from: string | null; to: string | null }[];
    broken: number;
    fixed: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!a || !b || a === b) return;
    void api<NonNullable<typeof res>>(
      'GET',
      W(props.workspaceId, '/test-run-comparison?a=' + a + '&b=' + b),
    ).then((r) => {
      if (r.ok) {
        setRes(r.data);
        setError(null);
      } else setError(r.error.message);
    });
  }, [a, b, props.workspaceId]);
  const pick = (v: string, set: (x: string) => void, label: string): ReactNode => (
    <select
      className="v2-input"
      aria-label={label}
      value={v}
      onChange={(e) => {
        set(e.target.value);
      }}
    >
      {props.runs.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name} · {ago(r.startedAt)} ago
        </option>
      ))}
    </select>
  );
  return (
    <Card
      title="Compare two runs"
      action={
        res ? (
          <span className="pv-muted pv-small">
            {res.broken} broke · {res.fixed} fixed
          </span>
        ) : null
      }
    >
      <div className="pv-page-actions">
        {pick(a, setA, 'Before')}
        <span aria-hidden="true">→</span>
        {pick(b, setB, 'After')}
      </div>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {res && a !== b ? (
        res.changes.length ? (
          <table className="pv-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Before</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {res.changes.map((c) => (
                <tr key={c.caseId}>
                  <td className="pv-cell-grow">{c.title}</td>
                  <td>
                    <Chip tone={RESULT_TONE[c.from ?? 'untested'] ?? 'neutral'}>
                      {c.from ?? 'not run'}
                    </Chip>
                  </td>
                  <td>
                    <Chip tone={RESULT_TONE[c.to ?? 'untested'] ?? 'neutral'}>
                      {c.to ?? 'not run'}
                    </Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pv-muted">Both runs have the same results.</p>
        )
      ) : null}
    </Card>
  );
}

// ── repository ──

function Repository(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
}): ReactNode {
  const [cases, setCases] = useState<Case[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loads, setLoads] = useState(0); // [PCODE-313 | S15 | v0.1.0] the shared steps' counts follow
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Case[]>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/test-cases'),
    );
    if (r.ok) {
      setCases(r.data);
      setLoads((n) => n + 1);
    } else setError(r.error.message);
  }, [props.workspaceId, props.projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!cases) return <p className="pv-muted">{error ?? 'Loading cases…'}</p>;
  const suites = [...new Set(cases.map((c) => c.suite))].sort();
  const add = async (): Promise<void> => {
    const r = await api<Case>(
      'POST',
      W(props.workspaceId, '/projects/' + props.projectId + '/test-cases'),
      { title: title.trim() },
    );
    if (!r.ok) setError(r.error.message);
    else {
      setTitle('');
      setOpen(r.data.id);
      void load();
    }
  };
  return (
    <div className="pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {open ? (
        <CaseEditor
          key={open}
          workspaceId={props.workspaceId}
          projectId={props.projectId}
          caseId={open}
          canEdit={props.canEdit}
          onClose={() => {
            setOpen(null);
            void load();
          }}
        />
      ) : null}
      <Card
        flush
        title={'Test cases · ' + String(cases.length)}
        action={
          props.canEdit ? (
            <form
              className="v2-inline"
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim()) void add();
              }}
            >
              <input
                className="v2-input v2-input--sm"
                aria-label="New case"
                placeholder="New case title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
              />
              <button
                type="submit"
                className="pv-btn pv-btn--secondary pv-btn--sm"
                disabled={!title.trim()}
              >
                Add
              </button>
            </form>
          ) : null
        }
      >
        {cases.length ? (
          <table className="pv-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Type</th>
                <th>Requirement</th>
                <th className="pv-num">Version</th>
                <th>Last result</th>
              </tr>
            </thead>
            {suites.map((s) => (
              <tbody key={s}>
                <tr className="pv-group-row">
                  <td colSpan={5}>{s || 'No suite'}</td>
                </tr>
                {cases
                  .filter((c) => c.suite === s)
                  .map((c) => (
                    <tr key={c.id}>
                      <td>
                        <button
                          type="button"
                          className="pv-link-btn"
                          onClick={() => {
                            setOpen(c.id);
                          }}
                        >
                          {c.key ? <span className="pv-mono pv-muted">{c.key}</span> : null}{' '}
                          {c.title}
                        </button>
                      </td>
                      <td>
                        <Chip tone={c.kind === 'automated' ? 'agent' : 'neutral'}>
                          {c.kind === 'bdd' ? 'Given/When/Then' : c.kind}
                        </Chip>
                      </td>
                      <td className="pv-mono">{c.itemRef ?? '—'}</td>
                      <td className="pv-num">v{c.version}</td>
                      <td>
                        <Chip tone={RESULT_TONE[c.lastStatus ?? 'untested'] ?? 'neutral'}>
                          {c.lastStatus ?? 'not run'}
                        </Chip>
                        {c.quarantined ? <Chip tone="warning">quarantined</Chip> : null}
                      </td>
                    </tr>
                  ))}
              </tbody>
            ))}
          </table>
        ) : (
          <p className="pv-empty">
            No cases yet. Add one, draft them with the Tester agent, or import a Playwright report.
          </p>
        )}
      </Card>
      {/* [PCODE-313 | S15 | v0.1.0] steps many cases share, and Gherkin feature files */}
      <SharedStepsCard
        key={loads}
        workspaceId={props.workspaceId}
        projectId={props.projectId}
        canEdit={props.canEdit}
      />
      <TestDataCard
        workspaceId={props.workspaceId}
        projectId={props.projectId}
        canEdit={props.canEdit}
      />
      {props.canEdit ? (
        <FeatureImport
          workspaceId={props.workspaceId}
          projectId={props.projectId}
          onDone={() => void load()}
        />
      ) : null}
    </div>
  );
}

interface Design {
  id: string;
  key: string;
  title: string;
  suite: string;
  kind: string;
  steps: Step[];
  version: number;
  quarantined: boolean;
  quarantineNote: string;
  // [PCODE-313 | S15 | v0.1.0]
  parameters: Record<string, string[]>;
  gherkin: string;
  shown: { action: string; expected: string; from?: { id: string; name: string } }[];
}

function CaseEditor(props: {
  workspaceId: string;
  projectId: string;
  caseId: string;
  canEdit: boolean;
  onClose: () => void;
}): ReactNode {
  const [d, setD] = useState<Design | null>(null);
  const [history, setHistory] = useState<
    { runId: string; runName: string; status: string; version: number | null; at: string }[]
  >([]);
  const [suite, setSuite] = useState('');
  const [kind, setKind] = useState('manual');
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);
  // [PCODE-313 | S15 | v0.1.0] parameters, Gherkin and the project's shared steps to pick from
  const [params, setParams] = useState<ParamRow[]>([]);
  const [gherkin, setGherkin] = useState('');
  const [sets, setSets] = useState<SharedSet[]>([]);
  const path = W(props.workspaceId, '/test-cases/' + props.caseId + '/design');
  useEffect(() => {
    // [PCODE-313 | S15 | v0.1.0] the server sends the case under design, beside its history
    void api<{ design: Design; history: typeof history }>('GET', path).then((r) => {
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      const x = r.data.design;
      setD(x);
      setHistory(r.data.history);
      setSuite(x.suite);
      setKind(x.kind);
      setSteps(x.steps);
      setParams(paramsToRows(x.parameters));
      setGherkin(x.gherkin);
    });
  }, [path]);
  useEffect(() => {
    if (!props.projectId) return;
    void api<SharedSet[]>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/test-shared-steps'),
    ).then((r) => {
      if (r.ok) setSets(r.data);
    });
  }, [props.workspaceId, props.projectId]);
  if (!d) return <p className="pv-muted">{error ?? 'Loading the case…'}</p>;
  const save = async (): Promise<void> => {
    // [PCODE-313 | S15 | v0.1.0] Gherkin makes the steps of a BDD case; the others send theirs
    const p = rowsToParams(params);
    if (!p.ok) {
      setError(p.error);
      return;
    }
    const bdd = kind === 'bdd' && gherkin.trim();
    const r = await api<Design>('PATCH', path, {
      suite: suite.trim(),
      kind,
      ...(bdd
        ? { gherkin }
        : { steps: steps.filter((s) => s.shared ?? s.action.trim()), parameters: p.value }),
    });
    if (!r.ok)
      setError(
        r.error.message +
          (r.error.details.length ? ': ' + r.error.details.map((x) => x.message).join('; ') : ''),
      );
    else props.onClose();
  };
  const setOf = (id: string): SharedSet | undefined => sets.find((x) => x.id === id);
  // a BDD case's steps come from its Gherkin and are shown, not edited
  const fromGherkin = kind === 'bdd' && Boolean(gherkin.trim());
  const setStep = (i: number, k: keyof Step, v: string): void => {
    setSteps((all) => all.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  };
  return (
    <Card
      title={
        <>
          {d.key ? <span className="pv-mono pv-muted">{d.key}</span> : null} {d.title}{' '}
          <span className="pv-muted pv-small">· v{d.version}</span>
        </>
      }
      action={
        <Button size="sm" kind="ghost" onClick={props.onClose}>
          Close
        </Button>
      }
    >
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="v2-form">
        <input
          className="v2-input"
          aria-label="Suite"
          placeholder="Suite, e.g. Tracking / Map"
          value={suite}
          disabled={!props.canEdit}
          onChange={(e) => {
            setSuite(e.target.value);
          }}
        />
        <select
          className="v2-input v2-input--sm"
          aria-label="Type"
          value={kind}
          disabled={!props.canEdit}
          onChange={(e) => {
            setKind(e.target.value);
          }}
        >
          {['manual', 'bdd', 'exploratory', 'automated'].map((k) => (
            <option key={k} value={k}>
              {k === 'bdd' ? 'Given/When/Then' : k}
            </option>
          ))}
        </select>
      </div>
      {/* [PCODE-313 | S15 | v0.1.0] a BDD case is its Gherkin; its steps are shown as made from it */}
      {kind === 'bdd' ? (
        <GherkinEditor value={gherkin} onChange={setGherkin} disabled={!props.canEdit} />
      ) : null}
      <ol className="pv-steps">
        {steps.map((s, i) => (
          <li key={i} className="pv-step">
            <span className="pv-step-num">{i + 1}</span>
            {s.shared ? (
              <div className="pv-step-body v2-grow">
                <span className="v2-inline">
                  <Chip tone="info">shared</Chip>
                  <strong>{setOf(s.shared)?.name ?? 'removed'}</strong>
                </span>
                <ol className="pv-small pv-muted">
                  {(setOf(s.shared)?.steps ?? []).map((x, j) => (
                    <li key={j}>
                      {x.action}
                      {x.expected ? ' → ' + x.expected : ''}
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <div className="pv-step-body v2-grow">
                <input
                  className="v2-input v2-input--sm"
                  aria-label={'Action of step ' + String(i + 1)}
                  placeholder="Action"
                  value={s.action}
                  disabled={!props.canEdit || fromGherkin}
                  onChange={(e) => {
                    setStep(i, 'action', e.target.value);
                  }}
                />
                <input
                  className="v2-input v2-input--sm"
                  aria-label={'Expected result of step ' + String(i + 1)}
                  placeholder="Expected"
                  value={s.expected}
                  disabled={!props.canEdit || fromGherkin}
                  onChange={(e) => {
                    setStep(i, 'expected', e.target.value);
                  }}
                />
              </div>
            )}
            {props.canEdit && !(kind === 'bdd' && gherkin.trim()) ? (
              <button
                type="button"
                className="pv-mini-btn"
                aria-label={'Remove step ' + String(i + 1)}
                onClick={() => {
                  setSteps((all) => all.filter((_, j) => j !== i));
                }}
              >
                <PIcon name="x" size={12} />
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      {props.canEdit ? (
        <div className="pv-page-actions">
          {kind === 'bdd' && gherkin.trim() ? null : (
            <>
              <Button
                size="sm"
                kind="ghost"
                icon="plus"
                onClick={() => {
                  setSteps((all) => [...all, { action: '', expected: '' }]);
                }}
              >
                Step
              </Button>
              {sets.length ? (
                <select
                  className="v2-input v2-input--sm"
                  aria-label="Add shared steps"
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id) setSteps((all) => [...all, { action: '', expected: '', shared: id }]);
                  }}
                >
                  <option value="">Add shared steps…</option>
                  {sets.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </>
          )}
          <Button size="sm" kind="primary" onClick={() => void save()}>
            Save
            {steps.length !== d.steps.length || JSON.stringify(steps) !== JSON.stringify(d.steps)
              ? ' as v' + String(d.version + 1)
              : ''}
          </Button>
        </div>
      ) : null}
      {kind === 'bdd' && gherkin.trim() ? null : (
        <ParametersEditor rows={params} onChange={setParams} disabled={!props.canEdit} />
      )}
      {history.length ? (
        <>
          <h3 className="v2-h3">History</h3>
          <span className="pv-runs">
            {history.map((h) => (
              <span
                key={h.runId}
                title={h.runName + ' · ' + h.status + (h.version ? ' · v' + String(h.version) : '')}
                className={'pv-run-dot pv-run-dot--' + (h.status === 'passed' ? 'ok' : 'bad')}
              />
            ))}
          </span>
        </>
      ) : null}
    </Card>
  );
}

// ── coverage ──

interface CoverageData {
  totals: { requirements: number; covered: number; passing: number; failing: number };
  items: {
    itemId: string;
    ref: string;
    title: string;
    requirements: { criterionId: string | null; text: string; cases: number; state: string }[];
    otherCases: number;
  }[];
}
interface Health {
  flaky: {
    caseId: string;
    key: string;
    title: string;
    flips: number;
    passRate: number;
    quarantined: boolean;
  }[];
  quarantined: { caseId: string; title: string; note: string }[];
  failing: { caseId: string; title: string; itemRef: string | null; since: string }[];
  sprint: {
    name: string;
    tasks: number;
    withTests: number;
    passing: number;
    failing: number;
    untested: number;
  } | null;
}

function Coverage(props: {
  workspaceId: string;
  projectId: string;
  go: (p: string) => void;
}): ReactNode {
  const [cov, setCov] = useState<CoverageData | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const P = W(props.workspaceId, '/projects/' + props.projectId);
    void Promise.all([
      api<CoverageData>('GET', P + '/coverage'),
      api<Health>('GET', P + '/test-health'),
    ]).then(([c, h]) => {
      if (c.ok) setCov(c.data);
      else setError(c.error.message);
      if (h.ok) setHealth(h.data);
    });
  }, [props.workspaceId, props.projectId]);
  if (!cov) return <p className="pv-muted">{error ?? 'Loading coverage…'}</p>;
  const t = cov.totals;
  const tone = (s: string): Tone =>
    s === 'passing'
      ? 'success'
      : s === 'failing'
        ? 'danger'
        : s === 'uncovered'
          ? 'danger'
          : 'neutral';
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat
          label="Requirements with tests"
          value={String(t.covered) + ' / ' + String(t.requirements)}
          sub={
            !t.requirements
              ? 'no acceptance criteria yet'
              : t.requirements - t.covered
                ? String(t.requirements - t.covered) + ' without a test'
                : 'all covered'
          }
          tone={!t.requirements ? undefined : t.covered < t.requirements ? 'warning' : 'success'}
          icon="check"
        />
        <Stat
          label="Passing"
          value={String(t.passing)}
          sub="requirements whose cases pass"
          tone={t.passing ? 'success' : undefined}
          icon="check"
        />
        <Stat
          label="Failing"
          value={String(t.failing)}
          sub="requirements with a failing case"
          tone={t.failing ? 'danger' : undefined}
          icon="incident"
        />
        {health?.sprint ? (
          <Stat
            label={
              /^sprint /i.test(health.sprint.name)
                ? health.sprint.name
                : 'Sprint ' + health.sprint.name
            }
            value={String(health.sprint.withTests) + ' / ' + String(health.sprint.tasks)}
            sub={'tasks with tests · ' + String(health.sprint.failing) + ' failing'}
            icon="planning"
          />
        ) : null}
      </div>
      <Card flush title="Coverage per requirement">
        {cov.items.length ? (
          <table className="pv-table">
            <thead>
              <tr>
                <th>Requirement</th>
                <th className="pv-num">Cases</th>
                <th>State</th>
              </tr>
            </thead>
            {cov.items.map((i) => (
              <tbody key={i.itemId}>
                <tr className="pv-group-row">
                  <td colSpan={3}>
                    <button
                      type="button"
                      className="pv-link-btn"
                      onClick={() => {
                        props.go('/items/' + i.itemId);
                      }}
                    >
                      <span className="pv-mono">{i.ref}</span> {i.title}
                    </button>
                    {i.otherCases ? (
                      <span className="pv-muted pv-small">
                        {' '}
                        · {i.otherCases} more cases on the task
                      </span>
                    ) : null}
                  </td>
                </tr>
                {i.requirements.map((r, k) => (
                  <tr key={r.criterionId ?? String(k)}>
                    <td className="pv-cell-grow">{r.text}</td>
                    <td className="pv-num">{r.cases}</td>
                    <td>
                      <Chip tone={tone(r.state)}>
                        {r.state === 'uncovered' ? 'no tests' : r.state}
                      </Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        ) : (
          <p className="pv-empty">No requirements yet: tasks with acceptance criteria show here.</p>
        )}
      </Card>
    </div>
  );
}

// ── flaky ──

function Flaky(props: { workspaceId: string; projectId: string; canEdit: boolean }): ReactNode {
  const [h, setH] = useState<Health | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Health>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/test-health'),
    );
    if (r.ok) setH(r.data);
    else setError(r.error.message);
  }, [props.workspaceId, props.projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  const toggle = async (caseId: string, on: boolean, why = ''): Promise<void> => {
    const r = await api('POST', W(props.workspaceId, '/test-cases/' + caseId + '/quarantine'), {
      on,
      ...(why ? { note: why } : {}),
    });
    if (!r.ok) setError(r.error.message);
    setAsking(null);
    setNote('');
    void load();
  };
  if (!h) return <p className="pv-muted">{error ?? 'Loading…'}</p>;
  const notes = new Map(h.quarantined.map((q) => [q.caseId, q.note]));
  return (
    <div className="pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <Card
        flush
        title="Flaky tests"
        action={
          <span className="pv-muted pv-small">
            A test is flaky when it changes result between runs without a fix in between
          </span>
        }
      >
        {h.flaky.length ? (
          <table className="pv-table">
            <thead>
              <tr>
                <th>Case</th>
                <th className="pv-num">Flips</th>
                <th className="pv-num">Pass rate</th>
                <th>Quarantine</th>
              </tr>
            </thead>
            <tbody>
              {h.flaky.map((f) => (
                <tr key={f.caseId}>
                  <td className="pv-cell-grow">
                    {f.key ? <span className="pv-mono pv-muted">{f.key}</span> : null} {f.title}
                    {notes.get(f.caseId) ? (
                      <span className="pv-muted pv-small"> · {notes.get(f.caseId)}</span>
                    ) : null}
                  </td>
                  <td className="pv-num">{f.flips}</td>
                  <td className="pv-num">{f.passRate} %</td>
                  <td>
                    {asking === f.caseId ? (
                      <form
                        className="v2-inline"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (note.trim()) void toggle(f.caseId, true, note.trim());
                        }}
                      >
                        <input
                          className="v2-input v2-input--sm"
                          aria-label="Why"
                          placeholder="Why, and who fixes it"
                          value={note}
                          onChange={(e) => {
                            setNote(e.target.value);
                          }}
                        />
                        <button
                          type="submit"
                          className="pv-btn pv-btn--primary pv-btn--sm"
                          disabled={!note.trim()}
                        >
                          Quarantine
                        </button>
                      </form>
                    ) : (
                      <label className="pv-switch">
                        <input
                          type="checkbox"
                          checked={f.quarantined}
                          disabled={!props.canEdit}
                          onChange={(e) => {
                            if (e.target.checked) setAsking(f.caseId);
                            else void toggle(f.caseId, false);
                          }}
                        />
                        <span>{f.quarantined ? 'does not block the gate' : 'blocks the gate'}</span>
                      </label>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pv-empty">No flaky tests: every case kept its result over its last runs.</p>
        )}
      </Card>
      {h.failing.length ? (
        <Card flush title="Failing now">
          <ul className="pv-rows">
            {h.failing.map((f) => (
              <li key={f.caseId} className="pv-row pv-row--static">
                <span className="pv-row-main">
                  <span className="pv-row-title">{f.title}</span>
                  <span className="pv-row-sub">
                    {f.itemRef ? f.itemRef + ' · ' : ''}failing for {ago(f.since)}
                  </span>
                </span>
                <Chip tone="danger">failed</Chip>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

// ── bugs ──

interface Defect {
  itemId: string;
  ref: string;
  title: string;
  priority: string;
  stateName: string;
  stateGroup: string;
  runName: string;
  caseTitle: string;
  result: string;
  at: string;
}

function Bugs(props: {
  workspaceId: string;
  projectId: string;
  go: (p: string) => void;
}): ReactNode {
  const [list, setList] = useState<Defect[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<Defect[]>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/test-defects'),
    ).then((r) => {
      if (r.ok) setList(r.data);
      else setError(r.error.message);
    });
  }, [props.workspaceId, props.projectId]);
  if (!list) return <p className="pv-muted">{error ?? 'Loading…'}</p>;
  const tone = (p: string): Tone =>
    p === 'urgent' || p === 'high' ? 'danger' : p === 'medium' ? 'warning' : 'neutral';
  return (
    <Card flush title={'Bugs from testing · ' + String(list.length)}>
      {list.length ? (
        <ul className="pv-rows">
          {list.map((d) => (
            <li key={d.itemId + d.at}>
              <button
                type="button"
                className="pv-row v2-row-btn"
                onClick={() => {
                  props.go('/items/' + d.itemId);
                }}
              >
                <span
                  className={
                    'pv-kind pv-kind--' +
                    (d.priority === 'urgent' || d.priority === 'high' ? 'incident' : 'request')
                  }
                >
                  <PIcon name="incident" size={15} />
                </span>
                <span className="pv-row-main">
                  <span className="pv-row-title">
                    <span className="pv-mono pv-muted">{d.ref}</span> {d.title}
                  </span>
                  <span className="pv-row-sub">
                    From {d.runName} · {d.caseTitle} ({d.result}) · {ago(d.at)} ago
                  </span>
                </span>
                <Chip tone={tone(d.priority)}>{d.priority}</Chip>
                <Chip tone={d.stateGroup === 'completed' ? 'success' : 'neutral'}>
                  {d.stateName}
                </Chip>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pv-empty">No bugs filed from runs yet.</p>
      )}
    </Card>
  );
}

// ── AI cases ──

interface Draft {
  criterionId: string | null;
  title: string;
  steps: string;
  expected: string;
}

function AiCases(props: { workspaceId: string; projectId: string; canEdit: boolean }): ReactNode {
  const [tasks, setTasks] = useState<{ id: string; ref: string; title: string }[]>([]);
  const [item, setItem] = useState('');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // [PCODE-271 | S15 | v0.1.0] cases are drafted from criteria: tasks with them first, the rest shown but not chosen
  const [withCriteria, setWithCriteria] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    void Promise.all([
      api<{ id: string; ref: string; title: string }[]>(
        'GET',
        W(props.workspaceId, '/projects/' + props.projectId + '/items'),
      ),
      api<{ items: { itemId: string; requirements: { criterionId: string | null }[] }[] }>(
        'GET',
        W(props.workspaceId, '/projects/' + props.projectId + '/coverage'),
      ),
    ]).then(([r, cov]) => {
      if (!r.ok) return;
      const has = new Set(
        cov.ok
          ? cov.data.items
              .filter((i) => i.requirements.some((q) => q.criterionId))
              .map((i) => i.itemId)
          : [],
      );
      setWithCriteria(has);
      const list = [...r.data.slice(0, 300)].sort(
        (a, b) => Number(has.has(b.id)) - Number(has.has(a.id)),
      );
      setTasks(list);
      setItem((x) => x || (list.find((t) => has.has(t.id))?.id ?? ''));
    });
  }, [props.workspaceId, props.projectId]);
  const draft = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setDone(null);
    const r = await api<{ cases: Draft[] }>(
      'POST',
      W(props.workspaceId, '/items/' + item + '/test-cases/draft'),
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setDrafts(r.data.cases);
    setChosen(new Set(r.data.cases.map((_, i) => i)));
  };
  const accept = async (): Promise<void> => {
    if (!drafts) return;
    setBusy(true);
    let n = 0;
    for (const [i, d] of drafts.entries()) {
      if (!chosen.has(i)) continue;
      const r = await api(
        'POST',
        W(props.workspaceId, '/projects/' + props.projectId + '/test-cases'),
        {
          title: d.title,
          itemId: item,
          ...(d.criterionId ? { criterionId: d.criterionId } : {}),
          steps: d.steps,
          expected: d.expected,
        },
      );
      if (r.ok) n += 1;
      else setError(r.error.message);
    }
    setBusy(false);
    setDrafts(null);
    setDone(n);
  };
  return (
    <Card title={<span className="pv-who">Draft cases with the Tester agent</span>}>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pv-ask">
        <select
          className="pv-select"
          aria-label="From task"
          value={item}
          onChange={(e) => {
            setItem(e.target.value);
            setDrafts(null);
          }}
        >
          {!withCriteria.size ? (
            <option value="">No task has acceptance criteria yet</option>
          ) : null}
          {tasks.map((t) => (
            <option key={t.id} value={t.id} disabled={!withCriteria.has(t.id)}>
              From {t.ref} {t.title}
              {withCriteria.has(t.id) ? '' : ' (no acceptance criteria)'}
            </option>
          ))}
        </select>
        <Button
          kind="primary"
          icon="sparkle"
          disabled={!item || busy || !props.canEdit}
          onClick={() => void draft()}
        >
          {busy && !drafts ? 'The tester is writing…' : 'Draft cases'}
        </Button>
      </div>
      {done !== null ? (
        <Chip tone="success" icon="check">
          {done} case{done === 1 ? '' : 's'} added to the repository
        </Chip>
      ) : null}
      {drafts ? (
        <ul className="pv-draft">
          {drafts.map((d, i) => (
            <li
              key={String(i) + d.title}
              className={'pv-draft-row' + (chosen.has(i) ? ' pv-draft-row--on' : '')}
            >
              <label className="pv-draft-check">
                <input
                  type="checkbox"
                  aria-label={'Keep ' + d.title}
                  checked={chosen.has(i)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(i);
                    else next.delete(i);
                    setChosen(next);
                  }}
                />
              </label>
              <span className="pv-row-main">
                <span className="pv-row-title">{d.title}</span>
                {d.expected ? <span className="pv-row-sub">Expected: {d.expected}</span> : null}
              </span>
            </li>
          ))}
          <li className="pv-draft-foot">
            <Button
              kind="primary"
              icon="check"
              disabled={!chosen.size || busy}
              onClick={() => void accept()}
            >
              Add {chosen.size} case{chosen.size === 1 ? '' : 's'} to the repository
            </Button>
          </li>
        </ul>
      ) : done === null ? (
        <p className="pv-muted pv-small">
          The agent reads the task’s acceptance criteria and description and proposes cases you
          accept one by one.
        </p>
      ) : null}
    </Card>
  );
}
