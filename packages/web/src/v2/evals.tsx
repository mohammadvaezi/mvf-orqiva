// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-331 | S15 | v0.1.0] T33.3b Evals: saved cases with checks, eval runs per model or prompt version, pass rates over time ──
//    Why:  the agents' Evals: sets of saved cases with what a good answer must and must not say, eval runs
//          with their pass rate side by side so a change to the prompt or model shows its effect, each
//          eval run's cases with their checks, and any run saved as a case from its trace.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { isEventOf } from '@orqiva/shared';
import { Bar, Button, Card, Chip } from '../preview/ui.js';
import { settingsText } from './playground.js';
import { euroCents } from './shell.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

interface Case {
  id: string;
  instruction: string;
  itemRef: string | null;
  mustContain: string[];
  mustNotContain: string[];
  minJudge: number | null;
}
interface RunSummary {
  id: string;
  label: string;
  settings: { model: string | null; promptVersion: number | null; temperature: number | null };
  createdAt: string;
  passRate: number | null;
  passed: number;
  failed: number;
  pending: number;
  judgeAvg: number | null;
  costCents: number;
}
interface EvalSet {
  id: string;
  name: string;
  projectId: string;
  agentId: string;
  agentName: string;
  cases: Case[];
  runs: RunSummary[];
}
interface EvalRun extends RunSummary {
  cases: {
    caseId: string | null;
    runId: string;
    instruction: string;
    status: string;
    answer: string;
    checks: { check: string; ok: boolean }[];
    judge: number | null;
    minJudge: number | null;
    result: 'pass' | 'fail' | 'running' | 'needs judge';
    costCents: number;
  }[];
}

/** "a, b , c" as a list without empties. */
export const phraseList = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** How a set's latest eval run compares with the one before: "+20 points", "−10 points", "same". */
export function trendText(runs: readonly { passRate: number | null }[]): string {
  const [now, before] = runs;
  if (!now || !before || now.passRate === null || before.passRate === null) return '';
  const d = Math.round((now.passRate - before.passRate) * 100);
  return d === 0 ? 'same as before' : (d > 0 ? '+' : '−') + String(Math.abs(d)) + ' points';
}

const RESULT_TONE = {
  pass: 'success',
  fail: 'danger',
  running: 'info',
  'needs judge': 'warning',
} as const;

export function Evals(props: {
  workspaceId: string;
  agents: { id: string; name: string; model: string }[];
  hub: EventHub;
  onOpenRun: (id: string) => void;
}): ReactNode {
  const [sets, setSets] = useState<EvalSet[] | null>(null);
  const [making, setMaking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<EvalSet[]>('GET', W(props.workspaceId, '/agent-eval-sets'));
    if (r.ok) setSets(r.data);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="pv-stack">
      <p className="pv-muted pv-small">
        An eval set keeps cases an agent should handle well. Run it after changing the prompt, the
        model or the temperature to see whether the agent got better. Cases run in the playground,
        so nothing is changed.
      </p>
      {open ? (
        <EvalRunView
          workspaceId={props.workspaceId}
          id={open}
          hub={props.hub}
          onOpenRun={props.onOpenRun}
          onClose={() => {
            setOpen(null);
            void load();
          }}
        />
      ) : null}
      {making ? (
        <NewSet
          workspaceId={props.workspaceId}
          agents={props.agents}
          onDone={() => {
            setMaking(false);
            void load();
          }}
        />
      ) : (
        <div className="pv-page-actions">
          <Button
            icon="plus"
            onClick={() => {
              setMaking(true);
            }}
          >
            New eval set
          </Button>
        </div>
      )}
      {!sets ? (
        <p className="pv-muted" role="status">
          Loading evals…
        </p>
      ) : null}
      {sets && !sets.length && !making ? <p className="pv-empty">No eval sets yet.</p> : null}
      {sets?.map((e) => (
        <SetCard
          key={e.id}
          workspaceId={props.workspaceId}
          set={e}
          onChange={() => void load()}
          onOpen={setOpen}
        />
      ))}
    </div>
  );
}

function NewSet(props: {
  workspaceId: string;
  agents: { id: string; name: string }[];
  onDone: () => void;
}): ReactNode {
  const [agent, setAgent] = useState(props.agents[0]?.id ?? '');
  const [projects, setProjects] = useState<{ id: string; key: string; name: string }[]>([]);
  const [project, setProject] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<{ id: string; key: string; name: string; archivedAt: string | null }[]>(
      'GET',
      W(props.workspaceId, '/projects'),
    ).then((r) => {
      if (r.ok) {
        const live = r.data.filter((p) => !p.archivedAt);
        setProjects(live);
        setProject((x) => x || (live[0]?.id ?? ''));
      }
    });
  }, [props.workspaceId]);
  const go = async (): Promise<void> => {
    const r = await api('POST', W(props.workspaceId, '/projects/' + project + '/agent-eval-sets'), {
      agentId: agent,
      name: name.trim(),
    });
    if (!r.ok) setError(r.error.message);
    else props.onDone();
  };
  return (
    <Card title="New eval set">
      <form
        className="pv-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (agent && project && name.trim()) void go();
        }}
      >
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="v2-form">
          <input
            className="v2-input"
            aria-label="Name"
            placeholder="Name, e.g. Analyst: bug summaries"
            maxLength={120}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <select
            className="v2-input"
            aria-label="Agent"
            value={agent}
            onChange={(e) => {
              setAgent(e.target.value);
            }}
          >
            {props.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            className="v2-input"
            aria-label="Project"
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="pv-page-actions">
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!agent || !project || !name.trim()}
          >
            Create
          </button>
          <Button size="sm" kind="ghost" onClick={props.onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SetCard(props: {
  workspaceId: string;
  set: EvalSet;
  onChange: () => void;
  onOpen: (evalRunId: string) => void;
}): ReactNode {
  const e = props.set;
  const S = W(props.workspaceId, '/agent-eval-sets/' + e.id);
  const [adding, setAdding] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trend = trendText(e.runs);
  return (
    <Card
      flush
      title={e.name + ' · ' + e.agentName}
      action={
        <span className="pv-page-actions">
          {trend ? <span className="pv-small pv-muted">{trend}</span> : null}
          <Button
            size="sm"
            disabled={!e.cases.length}
            onClick={() => {
              setRunning(!running);
            }}
          >
            Run eval
          </Button>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              void api('DELETE', S).then((r) => {
                if (r.ok) props.onChange();
                else setError(r.error.message);
              });
            }}
          >
            Remove
          </Button>
        </span>
      }
    >
      {error ? (
        <p className="v2-error pv-pad" role="alert">
          {error}
        </p>
      ) : null}
      {running ? (
        <RunEvalForm
          workspaceId={props.workspaceId}
          setId={e.id}
          onDone={(id) => {
            setRunning(false);
            props.onChange();
            if (id) props.onOpen(id);
          }}
        />
      ) : null}
      <table className="pv-table">
        <thead>
          <tr>
            <th>Case</th>
            <th>Must say</th>
            <th>Must not say</th>
            <th className="pv-num">Judge at least</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {e.cases.map((k) => (
            <tr key={k.id}>
              <td className="pv-cell-grow">
                {k.itemRef ? <span className="pv-mono">{k.itemRef} </span> : null}
                {k.instruction.slice(0, 160)}
              </td>
              <td className="pv-small">{k.mustContain.join(', ') || '—'}</td>
              <td className="pv-small">{k.mustNotContain.join(', ') || '—'}</td>
              <td className="pv-num">{k.minJudge ?? '—'}</td>
              <td>
                <Button
                  size="sm"
                  kind="ghost"
                  onClick={() => {
                    void api('DELETE', S + '/cases/' + k.id).then(() => {
                      props.onChange();
                    });
                  }}
                >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {adding ? (
        <AddCase
          base={S}
          onDone={() => {
            setAdding(false);
            props.onChange();
          }}
        />
      ) : (
        <div className="pv-page-actions pv-pad">
          <Button
            size="sm"
            kind="ghost"
            icon="plus"
            onClick={() => {
              setAdding(true);
            }}
          >
            Add a case
          </Button>
        </div>
      )}
      {e.runs.length ? (
        <table className="pv-table">
          <thead>
            <tr>
              <th>Eval run</th>
              <th>Settings</th>
              <th>Passes</th>
              <th className="pv-num">Passed</th>
              <th className="pv-num">Failed</th>
              <th className="pv-num">Judge</th>
              <th className="pv-num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {e.runs.map((r) => (
              <tr
                key={r.id}
                className="pv-click-row"
                onClick={() => {
                  props.onOpen(r.id);
                }}
              >
                <td>
                  {new Date(r.createdAt).toLocaleString(fmtLocale(), {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                  {r.label ? ' · ' + r.label : ''}
                </td>
                <td className="pv-muted pv-small">{settingsText(r.settings)}</td>
                <td className="pv-cell-bar">
                  {r.passRate === null ? (
                    <span className="pv-muted">{r.pending ? 'running…' : '—'}</span>
                  ) : (
                    <span className="pv-eval-rate">
                      <Bar
                        value={r.passRate * 100}
                        max={100}
                        tone={
                          r.passRate >= 0.8 ? 'success' : r.passRate >= 0.5 ? 'warning' : 'danger'
                        }
                        label={String(Math.round(r.passRate * 100)) + ' %'}
                      />
                      <span className="pv-small">{String(Math.round(r.passRate * 100))} %</span>
                    </span>
                  )}
                </td>
                <td className="pv-num">{r.passed}</td>
                <td className="pv-num">{r.failed}</td>
                <td className="pv-num">
                  {r.judgeAvg === null ? '—' : String(r.judgeAvg).replace('.', ',')}
                </td>
                <td className="pv-num">{euroCents(r.costCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Card>
  );
}

function AddCase(props: { base: string; onDone: () => void }): ReactNode {
  const [instruction, setInstruction] = useState('');
  const [must, setMust] = useState('');
  const [mustNot, setMustNot] = useState('');
  const [minJudge, setMinJudge] = useState('');
  const [error, setError] = useState<string | null>(null);
  const go = async (): Promise<void> => {
    const r = await api('POST', props.base + '/cases', {
      instruction: instruction.trim(),
      mustContain: phraseList(must),
      mustNotContain: phraseList(mustNot),
      ...(minJudge ? { minJudge: Number(minJudge) } : {}),
    });
    if (!r.ok) setError(r.error.message);
    else props.onDone();
  };
  return (
    <form
      className="pv-stack pv-pad"
      onSubmit={(e) => {
        e.preventDefault();
        if (instruction.trim()) void go();
      }}
    >
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <textarea
        className="v2-input"
        rows={2}
        aria-label="Instruction"
        placeholder="The instruction the agent gets"
        value={instruction}
        onChange={(e) => {
          setInstruction(e.target.value);
        }}
      />
      <div className="v2-form">
        <input
          className="v2-input"
          aria-label="Must say"
          placeholder="Must say (comma between phrases)"
          value={must}
          onChange={(e) => {
            setMust(e.target.value);
          }}
        />
        <input
          className="v2-input"
          aria-label="Must not say"
          placeholder="Must not say"
          value={mustNot}
          onChange={(e) => {
            setMustNot(e.target.value);
          }}
        />
        <select
          className="v2-input"
          aria-label="Judge at least"
          value={minJudge}
          onChange={(e) => {
            setMinJudge(e.target.value);
          }}
        >
          <option value="">No judge needed</option>
          {[2, 3, 4, 5].map((n) => (
            <option key={n} value={String(n)}>
              Judge at least {n}
            </option>
          ))}
        </select>
      </div>
      <div className="pv-page-actions">
        <button
          type="submit"
          className="pv-btn pv-btn--primary pv-btn--sm"
          disabled={!instruction.trim()}
        >
          Add
        </button>
        <Button size="sm" kind="ghost" onClick={props.onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RunEvalForm(props: {
  workspaceId: string;
  setId: string;
  onDone: (evalRunId: string | null) => void;
}): ReactNode {
  const [label, setLabel] = useState('');
  const [model, setModel] = useState('');
  const [version, setVersion] = useState('');
  const [temp, setTemp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const go = async (): Promise<void> => {
    const t = Number(temp.replace(',', '.'));
    const r = await api<{ id: string }>(
      'POST',
      W(props.workspaceId, '/agent-eval-sets/' + props.setId + '/runs'),
      {
        label: label.trim(),
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(version ? { promptVersion: Number(version) } : {}),
        ...(temp.trim() && Number.isFinite(t) ? { temperature: t } : {}),
      },
    );
    if (!r.ok) setError(r.error.message);
    else props.onDone(r.data.id);
  };
  return (
    <form
      className="pv-page-actions pv-pad"
      onSubmit={(e) => {
        e.preventDefault();
        void go();
      }}
    >
      {error ? (
        <span className="v2-error" role="alert">
          {error}
        </span>
      ) : null}
      <input
        className="v2-input v2-input--sm"
        aria-label="Label"
        placeholder="Label, e.g. prompt v4"
        maxLength={60}
        value={label}
        onChange={(e) => {
          setLabel(e.target.value);
        }}
      />
      <input
        className="v2-input v2-input--sm v2-mono"
        aria-label="Model"
        placeholder="model (agent's)"
        value={model}
        onChange={(e) => {
          setModel(e.target.value);
        }}
      />
      <input
        className="v2-input v2-input--sm"
        aria-label="Prompt version"
        inputMode="numeric"
        placeholder="prompt version"
        value={version}
        onChange={(e) => {
          setVersion(e.target.value.replace(/\D/g, ''));
        }}
      />
      <input
        className="v2-input v2-input--sm"
        aria-label="Temperature"
        inputMode="decimal"
        placeholder="temperature"
        value={temp}
        onChange={(e) => {
          setTemp(e.target.value);
        }}
      />
      <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm">
        Run every case
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
    </form>
  );
}

function EvalRunView(props: {
  workspaceId: string;
  id: string;
  hub: EventHub;
  onOpenRun: (id: string) => void;
  onClose: () => void;
}): ReactNode {
  const R = W(props.workspaceId, '/agent-eval-runs/' + props.id);
  const [d, setD] = useState<EvalRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<EvalRun>('GET', R);
    if (r.ok) setD(r.data);
  }, [R]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (isEventOf(e.type, 'agent_run')) void load();
    });
  }, [load, props.hub]);
  const judge = async (): Promise<void> => {
    setBusy(true);
    const r = await api<EvalRun>('POST', R + '/judge');
    setBusy(false);
    if (r.ok) {
      setD(r.data);
      setError(null);
    } else setError(r.error.message);
  };
  if (!d) return null;
  const unjudged = d.cases.some(
    (k) => k.judge === null && (k.status === 'succeeded' || k.status === 'failed'),
  );
  return (
    <Card
      flush
      title={
        'Eval run' +
        (d.label ? ' · ' + d.label : '') +
        ' · ' +
        (d.passRate === null ? 'running' : String(Math.round(d.passRate * 100)) + ' % pass')
      }
      action={
        <span className="pv-page-actions">
          {unjudged ? (
            <Button size="sm" disabled={busy} onClick={() => void judge()}>
              {busy ? 'Judging…' : 'Judge the cases'}
            </Button>
          ) : null}
          <Button size="sm" kind="ghost" onClick={props.onClose}>
            Close
          </Button>
        </span>
      }
    >
      {error ? (
        <p className="v2-error pv-pad" role="alert">
          {error}
        </p>
      ) : null}
      <p className="pv-muted pv-small pv-pad">
        {settingsText(d.settings)} · {d.passed} passed, {d.failed} failed
        {d.pending ? ', ' + String(d.pending) + ' waiting' : ''} · {euroCents(d.costCents)}
      </p>
      <div className="pv-eval-cases">
        {d.cases.map((k) => (
          <div key={k.runId} className="pv-eval-case">
            <span className="pv-page-actions">
              <Chip tone={RESULT_TONE[k.result]}>{k.result}</Chip>
              <strong className="pv-small">{k.instruction.slice(0, 140)}</strong>
              {k.judge !== null ? (
                <span className="pv-small pv-muted">
                  judge {k.judge}
                  {k.minJudge ? ' (needs ' + String(k.minJudge) + ')' : ''}
                </span>
              ) : null}
              <button
                type="button"
                className="pv-link-btn"
                onClick={() => {
                  props.onOpenRun(k.runId);
                }}
              >
                Trace
              </button>
            </span>
            {k.checks.length ? (
              <ul className="pv-eval-checks">
                {k.checks.map((c, i) => (
                  <li key={i} className={c.ok ? 'pv-eval-ok' : 'pv-eval-bad'}>
                    {c.ok ? '✓ ' : '✗ '}
                    {c.check}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="pv-small pv-muted">{k.answer || '—'}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** "Save as eval case" under a run: into one of the agent's sets. */
export function SaveAsCase(props: {
  workspaceId: string;
  runId: string;
  agentId: string;
}): ReactNode {
  const [sets, setSets] = useState<{ id: string; name: string }[] | null>(null);
  const [pick, setPick] = useState('');
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    void api<EvalSet[]>(
      'GET',
      W(props.workspaceId, '/agent-eval-sets?agentId=' + props.agentId),
    ).then((r) => {
      const list = r.ok ? r.data.map((e) => ({ id: e.id, name: e.name })) : [];
      setSets(list);
      setPick(list[0]?.id ?? '');
    });
  }, [props.workspaceId, props.agentId]);
  if (!sets?.length) return null;
  const save = async (): Promise<void> => {
    const r = await api('POST', W(props.workspaceId, '/agent-eval-sets/' + pick + '/cases'), {
      fromRunId: props.runId,
    });
    setDone(r.ok ? 'Saved as a case.' : r.error.message);
  };
  return (
    <span className="pv-page-actions">
      <select
        className="v2-input v2-input--sm"
        aria-label="Eval set"
        value={pick}
        onChange={(e) => {
          setPick(e.target.value);
        }}
      >
        {sets.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <Button size="sm" kind="ghost" onClick={() => void save()}>
        Save as eval case
      </Button>
      {done ? <span className="pv-small pv-muted">{done}</span> : null}
    </span>
  );
}
