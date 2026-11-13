// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-329 | S15 | v0.1.0] T33.2 Agent playground: rerun with other settings, compare runs, A/B experiments ──
//    Why:  the agents' playground: experiments that run one instruction with a few variants and show per
//          variant what finished, succeeded, cost and took; runs compared side by side with how their
//          answers differ; and a run tried again with other settings. Playground runs never act.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { isEventOf } from '@orqiva/shared';
import { Button, Card, Chip } from '../preview/ui.js';
import { euroCents } from './shell.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
const TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral' | 'info'> = {
  queued: 'neutral',
  running: 'info',
  waiting: 'warning',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};
const secs = (ms: number | null): string =>
  ms === null ? '—' : (Math.round(ms / 100) / 10).toFixed(1).replace('.', ',') + ' s';

export interface VariantForm {
  label: string;
  model: string;
  promptVersion: string;
  temperature: string;
}

/** The variant as the API takes it: only what differs from the agent is sent. */
export function variantBody(v: VariantForm): Record<string, unknown> {
  const t = Number(v.temperature.replace(',', '.'));
  return {
    label: v.label.trim(),
    ...(v.model.trim() ? { model: v.model.trim() } : {}),
    ...(v.promptVersion ? { promptVersion: Number(v.promptVersion) } : {}),
    ...(v.temperature.trim() && Number.isFinite(t) ? { temperature: t } : {}),
  };
}

/** "claude-sonnet-5-5 · prompt v2 · temperature 0,7", or "as the agent is set". */
export function settingsText(v: {
  model: string | null;
  promptVersion: number | null;
  temperature: number | null;
}): string {
  const parts = [
    ...(v.model ? [v.model] : []),
    ...(v.promptVersion ? ['prompt v' + String(v.promptVersion)] : []),
    ...(v.temperature !== null ? ['temperature ' + String(v.temperature).replace('.', ',')] : []),
  ];
  return parts.length ? parts.join(' · ') : 'as the agent is set';
}

interface Experiment {
  id: string;
  name: string;
  agentName: string;
  instruction: string;
  repeats: number;
  createdAt: string;
  variants: {
    label: string;
    model: string | null;
    promptVersion: number | null;
    temperature: number | null;
    runs: number;
    finished: number;
    succeeded: number;
    avgCostCents: number | null;
    avgMs: number | null;
    avgTokens: number | null;
  }[];
  runs: { id: string; variant: string; status: string; costCents: number; answer: string }[];
}

export function Playground(props: {
  workspaceId: string;
  agents: { id: string; name: string; model: string; promptVersion?: number }[];
  hub: EventHub;
  onOpenRun: (id: string) => void;
}): ReactNode {
  const [list, setList] = useState<Experiment[] | null>(null);
  const [making, setMaking] = useState(false);
  const load = useCallback(async () => {
    const r = await api<Experiment[]>('GET', W(props.workspaceId, '/agent-experiments'));
    if (r.ok) setList(r.data);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (isEventOf(e.type, 'agent_run')) void load();
    });
  }, [load, props.hub]);
  return (
    <div className="pv-stack">
      <p className="pv-muted pv-small">
        Playground runs read what they need but never act: a change, a move or a comment is only
        recorded as what the agent would have done. They cost what their tokens cost.
      </p>
      {making ? (
        <NewExperiment
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
            New experiment
          </Button>
        </div>
      )}
      {!list ? (
        <p className="pv-muted" role="status">
          Loading experiments…
        </p>
      ) : null}
      {list && !list.length && !making ? (
        <p className="pv-empty">
          No experiments yet. Try one instruction with two models, prompt versions or temperatures.
        </p>
      ) : null}
      {list?.map((e) => (
        <ExperimentCard
          key={e.id}
          e={e}
          onOpenRun={props.onOpenRun}
          onRemove={async () => {
            const r = await api('DELETE', W(props.workspaceId, '/agent-experiments/' + e.id));
            if (r.ok) void load();
            return r.ok ? null : r.error.message;
          }}
        />
      ))}
    </div>
  );
}

function ExperimentCard(props: {
  e: Experiment;
  onOpenRun: (id: string) => void;
  onRemove: () => Promise<string | null>;
}): ReactNode {
  const { e } = props;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const best = [...e.variants]
    .filter((v) => v.finished > 0)
    .sort(
      (a, b) =>
        b.succeeded / b.finished - a.succeeded / a.finished ||
        (a.avgCostCents ?? 0) - (b.avgCostCents ?? 0),
    )[0];
  return (
    <Card
      flush
      title={e.name + ' · ' + e.agentName}
      action={
        <span className="pv-page-actions">
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setOpen(!open);
            }}
          >
            {open ? 'Hide answers' : 'Answers'}
          </Button>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              void props.onRemove().then(setError);
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
      <p className="pv-muted pv-small pv-pad">{e.instruction.slice(0, 300)}</p>
      <table className="pv-table">
        <thead>
          <tr>
            <th>Variant</th>
            <th>Settings</th>
            <th className="pv-num">Finished</th>
            <th className="pv-num">Succeeded</th>
            <th className="pv-num">Cost per run</th>
            <th className="pv-num">Time</th>
            <th className="pv-num">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {e.variants.map((v) => (
            <tr key={v.label} className={best?.label === v.label ? 'pv-row-sel' : ''}>
              <td className="pv-strong">{v.label}</td>
              <td className="pv-muted">{settingsText(v)}</td>
              <td className="pv-num">
                {v.finished}/{v.runs}
              </td>
              <td className="pv-num">{v.succeeded}</td>
              <td className="pv-num">
                {v.avgCostCents === null ? '—' : euroCents(v.avgCostCents)}
              </td>
              <td className="pv-num">{secs(v.avgMs)}</td>
              <td className="pv-num">
                {v.avgTokens === null ? '—' : v.avgTokens.toLocaleString(fmtLocale())}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open ? (
        <div className="pv-play-answers">
          {e.runs.map((r) => (
            <div key={r.id} className="pv-play-answer">
              <span className="pv-page-actions">
                <strong>{r.variant}</strong>
                <Chip tone={TONE[r.status] ?? 'neutral'}>{r.status}</Chip>
                <span className="pv-muted pv-small">{euroCents(r.costCents)}</span>
                <button
                  type="button"
                  className="pv-link-btn"
                  onClick={() => {
                    props.onOpenRun(r.id);
                  }}
                >
                  Trace
                </button>
              </span>
              <p className="pv-small">{r.answer || '—'}</p>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

const blank = (label: string): VariantForm => ({
  label,
  model: '',
  promptVersion: '',
  temperature: '',
});

function NewExperiment(props: {
  workspaceId: string;
  agents: { id: string; name: string; model: string }[];
  onDone: () => void;
}): ReactNode {
  const [agent, setAgent] = useState(props.agents[0]?.id ?? '');
  const [projects, setProjects] = useState<{ id: string; key: string; name: string }[]>([]);
  const [project, setProject] = useState('');
  const [versions, setVersions] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [repeats, setRepeats] = useState(1);
  const [variants, setVariants] = useState<VariantForm[]>([blank('A'), blank('B')]);
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
  useEffect(() => {
    if (!agent) return;
    void api<{ version: number }[]>(
      'GET',
      W(props.workspaceId, '/agents/' + agent + '/prompts'),
    ).then((r) => {
      setVersions(r.ok ? r.data.map((v) => v.version) : []);
    });
  }, [agent, props.workspaceId]);
  const set = (i: number, patch: Partial<VariantForm>): void => {
    setVariants(variants.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  };
  const go = async (): Promise<void> => {
    const r = await api(
      'POST',
      W(props.workspaceId, '/projects/' + project + '/agent-experiments'),
      {
        name: name.trim() || 'Experiment',
        agentId: agent,
        instruction: text.trim(),
        variants: variants.map(variantBody),
        repeats,
      },
    );
    if (!r.ok) setError(r.error.message);
    else props.onDone();
  };
  const model = props.agents.find((a) => a.id === agent)?.model ?? '';
  return (
    <Card title="New experiment">
      <form
        className="pv-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (project && agent && text.trim()) void go();
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
            placeholder="Name, e.g. Sonnet against Haiku"
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
        <textarea
          className="v2-input"
          rows={3}
          aria-label="Instruction"
          placeholder="The instruction every variant gets"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        <table className="pv-table pv-play-variants">
          <thead>
            <tr>
              <th>Variant</th>
              <th>Model</th>
              <th>Prompt version</th>
              <th>Temperature</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {variants.map((v, i) => (
              <tr key={i}>
                <td>
                  <input
                    className="v2-input v2-input--sm"
                    aria-label={'Variant ' + String(i + 1) + ' name'}
                    maxLength={40}
                    value={v.label}
                    onChange={(e) => {
                      set(i, { label: e.target.value });
                    }}
                  />
                </td>
                <td>
                  <input
                    className="v2-input v2-input--sm v2-mono"
                    aria-label={'Variant ' + String(i + 1) + ' model'}
                    placeholder={model}
                    value={v.model}
                    onChange={(e) => {
                      set(i, { model: e.target.value });
                    }}
                  />
                </td>
                <td>
                  <select
                    className="v2-input v2-input--sm"
                    aria-label={'Variant ' + String(i + 1) + ' prompt version'}
                    value={v.promptVersion}
                    onChange={(e) => {
                      set(i, { promptVersion: e.target.value });
                    }}
                  >
                    <option value="">live</option>
                    {versions.map((n) => (
                      <option key={n} value={String(n)}>
                        v{n}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="v2-input v2-input--sm"
                    aria-label={'Variant ' + String(i + 1) + ' temperature'}
                    inputMode="decimal"
                    placeholder="agent's"
                    value={v.temperature}
                    onChange={(e) => {
                      set(i, { temperature: e.target.value });
                    }}
                  />
                </td>
                <td>
                  {variants.length > 2 ? (
                    <Button
                      size="sm"
                      kind="ghost"
                      onClick={() => {
                        setVariants(variants.filter((_, j) => j !== i));
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pv-page-actions">
          {variants.length < 4 ? (
            <Button
              size="sm"
              kind="ghost"
              icon="plus"
              onClick={() => {
                setVariants([...variants, blank(String.fromCharCode(65 + variants.length))]);
              }}
            >
              Add a variant
            </Button>
          ) : null}
          <label className="pv-small">
            Runs per variant{' '}
            <select
              className="v2-input v2-input--sm"
              aria-label="Runs per variant"
              value={repeats}
              onChange={(e) => {
                setRepeats(Number(e.target.value));
              }}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="pv-page-actions">
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!project || !agent || !text.trim()}
          >
            Run {variants.length * repeats} runs
          </button>
          <Button size="sm" kind="ghost" onClick={props.onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

interface Compared {
  run: {
    id: string;
    agentName: string;
    model: string;
    promptVersion: number;
    status: string;
    tokensIn: number;
    tokensOut: number;
    playground: boolean;
  };
  temperature: number;
  costCents: number;
  durationMs: number | null;
  steps: number;
  tools: string[];
  recorded: number;
  answer: string;
  diff: { op: 'same' | 'add' | 'del'; text: string }[];
}

/** Two or three runs side by side; each answer after the first shows how it differs from it. */
export function CompareRuns(props: {
  workspaceId: string;
  ids: string[];
  onClose: () => void;
}): ReactNode {
  const [rows, setRows] = useState<Compared[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = props.ids.join(',');
  useEffect(() => {
    void api<Compared[]>('GET', W(props.workspaceId, '/agent-runs-compare?ids=' + key)).then(
      (r) => {
        if (r.ok) setRows(r.data);
        else setError(r.error.message);
      },
    );
  }, [props.workspaceId, key]);
  return (
    <Card
      title="Compare runs"
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
      {!rows && !error ? (
        <p className="pv-muted" role="status">
          Loading…
        </p>
      ) : null}
      {rows ? (
        <div className="pv-compare">
          {rows.map((r, i) => (
            <div key={r.run.id} className="pv-compare-col">
              <strong>
                {r.run.agentName} {r.run.playground ? <Chip tone="info">playground</Chip> : null}
              </strong>
              <span className="pv-muted pv-small">
                {settingsText({
                  model: r.run.model,
                  promptVersion: r.run.promptVersion,
                  temperature: r.temperature,
                })}
              </span>
              <span className="pv-page-actions">
                <Chip tone={TONE[r.run.status] ?? 'neutral'}>{r.run.status}</Chip>
                <span className="pv-small">{euroCents(r.costCents)}</span>
                <span className="pv-small">{secs(r.durationMs)}</span>
                <span className="pv-small pv-muted">
                  {(r.run.tokensIn + r.run.tokensOut).toLocaleString(fmtLocale())} tokens ·{' '}
                  {r.steps} steps
                </span>
              </span>
              <span className="pv-small pv-muted">
                Tools: {r.tools.length ? r.tools.join(', ') : 'none'}
                {r.recorded ? ' · ' + String(r.recorded) + ' actions only recorded' : ''}
              </span>
              <div className="pv-prompt">
                {i === 0 || !r.diff.length
                  ? (r.answer || '—').split('\n').map((l, j) => <div key={j}>{l || ' '}</div>)
                  : r.diff.map((l, j) => (
                      <div
                        key={j}
                        className={l.op === 'add' ? 'pv-ins' : l.op === 'del' ? 'pv-del' : ''}
                      >
                        {l.text || ' '}
                      </div>
                    ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/** "Rerun in the playground": as it was, or with another model, prompt version or temperature. */
export function RerunForm(props: {
  workspaceId: string;
  runId: string;
  model: string;
  onDone: (newRunId: string | null) => void;
}): ReactNode {
  const [v, setV] = useState<VariantForm>(blank('rerun'));
  const [error, setError] = useState<string | null>(null);
  const go = async (): Promise<void> => {
    const body = Object.fromEntries(Object.entries(variantBody(v)).filter(([k]) => k !== 'label'));
    const r = await api<{ id: string }>(
      'POST',
      W(props.workspaceId, '/agent-runs/' + props.runId + '/rerun'),
      body,
    );
    if (!r.ok) setError(r.error.message);
    else props.onDone(r.data.id);
  };
  return (
    <form
      className="pv-page-actions"
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
        className="v2-input v2-input--sm v2-mono"
        aria-label="Model"
        placeholder={props.model}
        value={v.model}
        onChange={(e) => {
          setV({ ...v, model: e.target.value });
        }}
      />
      <input
        className="v2-input v2-input--sm"
        aria-label="Prompt version"
        inputMode="numeric"
        placeholder="prompt version"
        value={v.promptVersion}
        onChange={(e) => {
          setV({ ...v, promptVersion: e.target.value.replace(/\D/g, '') });
        }}
      />
      <input
        className="v2-input v2-input--sm"
        aria-label="Temperature"
        inputMode="decimal"
        placeholder="temperature"
        value={v.temperature}
        onChange={(e) => {
          setV({ ...v, temperature: e.target.value });
        }}
      />
      <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm">
        Rerun
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
