// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-118 | S15 | v0.1.0] Show and drive the lifecycle in the web app: stepper, stages, gate checklist and sign-off ──
// ── [PCODE-119 | S15 | v0.1.0] Add workspace lifecycle templates with an editor ──
//    Why:  the governed path made visible and usable: the phases as a stepper with the gates between them,
//          each phase's stages with their agent and owner, and each gate's checklist and sign-off. What the
//          server refuses, the screen already says (why a stage cannot start, what a gate still misses);
//          whatever anyone changes appears here at once.
import type { GateStatus, LifecycleState, StageStatus } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import type { EventHub } from './core/hub.js';
import { Icon } from './core/icons.js';
import { Card, EmptyState } from './shell.js';
import { localTime } from './views.js';

type Phase = LifecycleState['phases'][number];
type Gate = NonNullable<Phase['gate']>;

const STAGE_LABEL: Record<StageStatus, string> = {
  not_started: 'Not started',
  active: 'In progress',
  done: 'Done',
  skipped: 'Skipped',
};

export const GATE_LABEL: Record<GateStatus, string> = {
  locked: 'Waiting',
  open: 'Open',
  ready: 'Ready to sign',
  approved: 'Approved',
  rejected: 'Rejected',
};

/** May this workspace role sign a gate that asks for `signer`? (The server decides; this hides buttons.) */
export function maySign(role: string, signer: string): boolean {
  if (signer === 'owner') return role === 'owner';
  if (signer === 'admin') return role === 'owner' || role === 'admin';
  return role !== 'guest';
}

export function phaseState(p: Phase, current: string): 'done' | 'current' | 'waiting' {
  if (p.gate?.status === 'approved') return 'done';
  if (p.key === current) return 'current';
  if (!p.gate && p.stages.every((s) => s.status === 'done' || s.status === 'skipped'))
    return 'done';
  return p.stages.some((s) => s.blockedBy) ? 'waiting' : 'current';
}

export function Stepper(props: { life: LifecycleState }): ReactNode {
  return (
    <ol className="pe-stepper" aria-label="Phases">
      {props.life.phases.map((p, i) => {
        const state = phaseState(p, props.life.currentPhase);
        const done = p.stages.filter((s) => s.status === 'done' || s.status === 'skipped').length;
        return (
          <li key={p.key} className="pe-step-wrap">
            <a
              className={'pe-step pe-step--' + state}
              href={'#phase-' + p.key}
              aria-current={p.key === props.life.currentPhase ? 'step' : undefined}
            >
              <span className="pe-step-index">
                {state === 'done' ? <Icon name="task" size={16} /> : i + 1}
              </span>
              <span>
                <span className="pe-step-name">{p.name}</span>
                <span className="pe-step-meta">
                  {done} of {p.stages.length} stages
                </span>
              </span>
            </a>
            {p.gate ? (
              <span
                className={'pe-gate-pill pe-gate--' + p.gate.status}
                title={p.gate.name + ': ' + GATE_LABEL[p.gate.status]}
              >
                {p.gate.key.toUpperCase()} · {GATE_LABEL[p.gate.status]}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function StageCard(props: {
  stage: Phase['stages'][number];
  locked: boolean;
  canEdit: boolean;
  onStatus: (status: StageStatus) => void;
}): ReactNode {
  const s = props.stage;
  const reason = s.blockedBy ?? (props.locked ? 'The gate of this phase is approved' : null);
  const can = props.canEdit && !reason;
  const button = (status: StageStatus, label: string, primary = false): ReactNode =>
    s.status === status ? null : (
      <button
        type="button"
        className={
          primary ? 'pe-btn pe-btn--primary pe-btn--small' : 'pe-btn pe-btn--text pe-btn--small'
        }
        disabled={!can}
        title={reason ?? undefined}
        onClick={() => {
          props.onStatus(status);
        }}
      >
        {label}
      </button>
    );
  return (
    <li className={'pe-stage pe-stage--' + s.status}>
      <div className="pe-stage-head">
        <span className="pe-stage-name">{s.name}</span>
        <span className={'pe-stage-status pe-stage-status--' + s.status}>
          {STAGE_LABEL[s.status]}
        </span>
      </div>
      <div className="pe-stage-meta">
        <span>
          <Icon name="bolt" size={14} /> {s.agent === 'none' ? 'No agent' : s.agent}
        </span>
        <span>
          <Icon name="person" size={14} /> {s.owner}
        </span>
      </div>
      {s.note ? <p className="pe-stage-note">{s.note}</p> : null}
      {s.finishedAt ? (
        <div className="pe-small pe-muted">Finished {localTime(s.finishedAt)}</div>
      ) : null}
      {reason ? <div className="pe-small pe-muted">{reason}</div> : null}
      {props.canEdit ? (
        <div className="pe-stage-actions">
          {s.status === 'not_started' ? button('active', 'Start', true) : null}
          {s.status === 'active' ? button('done', 'Mark done', true) : null}
          {s.status !== 'skipped' && s.status !== 'done' ? button('skipped', 'Skip') : null}
          {s.status !== 'not_started' ? button('not_started', 'Reset') : null}
        </div>
      ) : null}
    </li>
  );
}

function GatePanel(props: {
  gate: Gate;
  role: string;
  canEdit: boolean;
  canAdmin: boolean;
  onCriterion: (id: string, met: boolean, evidence: string) => void;
  onDecision: (decision: 'approve' | 'reject' | 'reopen', note: string) => void;
}): ReactNode {
  const g = props.gate;
  const [note, setNote] = useState('');
  const editable = props.canEdit && g.status !== 'approved' && g.status !== 'locked';
  const signer = maySign(props.role, g.signer);
  return (
    <section className={'pe-gate pe-gate-panel--' + g.status} aria-label={g.name}>
      <div className="pe-gate-head">
        <span className="pe-gate-icon" aria-hidden="true">
          <Icon name="key" size={20} />
        </span>
        <div>
          <h3 className="pe-gate-title">{g.name}</h3>
          <div className="pe-small pe-muted">
            Signed by{' '}
            {g.signer === 'owner'
              ? 'an owner'
              : g.signer === 'admin'
                ? 'an admin or owner'
                : 'any member'}
          </div>
        </div>
        <span className={'pe-gate-pill pe-gate--' + g.status}>{GATE_LABEL[g.status]}</span>
      </div>
      <ul className="pe-criteria">
        {g.criteria.map((c) => (
          <Criterion
            key={c.id + c.evidence}
            criterion={c}
            editable={editable}
            onSave={props.onCriterion}
          />
        ))}
      </ul>
      {g.status !== 'approved' && g.missing.length ? (
        <div className="pe-gate-missing">
          <strong>Before it can be approved</strong>
          <ul>
            {g.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {(g.status !== 'locked' && g.status !== 'approved' && signer) ||
      (g.status === 'approved' && props.canAdmin) ? (
        <div className="pe-signoff">
          <label htmlFor={'note-' + g.key} className="pe-small pe-muted">
            Note with the decision
          </label>
          <textarea
            id={'note-' + g.key}
            className="pe-input pe-textarea"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
          <div className="pe-form-actions">
            {g.status !== 'approved' && signer ? (
              <>
                <button
                  type="button"
                  className="pe-btn pe-btn--primary"
                  disabled={g.missing.length > 0}
                  title={g.missing.length ? 'Complete the list above first' : undefined}
                  onClick={() => {
                    props.onDecision('approve', note);
                    setNote('');
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="pe-btn pe-btn--secondary"
                  onClick={() => {
                    props.onDecision('reject', note);
                    setNote('');
                  }}
                >
                  Reject
                </button>
              </>
            ) : null}
            {g.status === 'approved' && props.canAdmin ? (
              <button
                type="button"
                className="pe-btn pe-btn--secondary"
                onClick={() => {
                  props.onDecision('reopen', note);
                  setNote('');
                }}
              >
                Reopen
              </button>
            ) : null}
          </div>
        </div>
      ) : g.status !== 'locked' && g.status !== 'approved' && !signer ? (
        <p className="pe-small pe-muted">
          {g.signer === 'owner' ? 'An owner' : 'An admin'} signs this gate.
        </p>
      ) : null}
      {g.signoffs.length ? (
        <ol className="pe-signoffs" aria-label="Decisions">
          {[...g.signoffs].reverse().map((s, i) => (
            <li key={i}>
              <span className={'pe-decision pe-decision--' + s.decision}>
                {s.decision === 'approve'
                  ? 'Approved'
                  : s.decision === 'reject'
                    ? 'Rejected'
                    : 'Reopened'}
              </span>{' '}
              by <strong>{s.by}</strong> <span className="pe-muted">{localTime(s.at)}</span>
              {s.note ? <div className="pe-signoff-note">{s.note}</div> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function Criterion(props: {
  criterion: Gate['criteria'][number];
  editable: boolean;
  onSave: (id: string, met: boolean, evidence: string) => void;
}): ReactNode {
  const c = props.criterion;
  const [evidence, setEvidence] = useState(c.evidence);
  return (
    <li className={'pe-criterion' + (c.met ? ' pe-criterion--met' : '')}>
      <label className="pe-toggle">
        <input
          type="checkbox"
          checked={c.met}
          disabled={!props.editable}
          onChange={(e) => {
            props.onSave(c.id, e.target.checked, evidence);
          }}
        />
        <span>
          <span className="pe-criterion-text">{c.text}</span>
          {c.met && c.metBy ? (
            <span className="pe-small pe-muted pe-block">
              Met · {c.metBy}
              {c.metAt ? ', ' + localTime(c.metAt) : ''}
            </span>
          ) : null}
        </span>
      </label>
      <input
        className="pe-input pe-criterion-evidence"
        aria-label={'Evidence for: ' + c.text}
        placeholder="Evidence: a link or a short note"
        value={evidence}
        disabled={!props.editable}
        onChange={(e) => {
          setEvidence(e.target.value);
        }}
        onBlur={() => {
          if (evidence !== c.evidence) props.onSave(c.id, c.met, evidence);
        }}
      />
    </li>
  );
}

export function LifecycleView(props: {
  life: LifecycleState;
  role: string;
  canEdit: boolean;
  canAdmin: boolean;
  onStage: (stageId: string, status: StageStatus) => void;
  onCriterion: (id: string, met: boolean, evidence: string) => void;
  onDecision: (gateKey: string, decision: 'approve' | 'reject' | 'reopen', note: string) => void;
}): ReactNode {
  const { life } = props;
  return (
    <>
      <Card
        title="Lifecycle"
        subtitle={life.templateName + ' · started ' + localTime(life.startedAt)}
      >
        <Stepper life={life} />
      </Card>
      {life.phases.map((p) => (
        <section
          key={p.key}
          id={'phase-' + p.key}
          className={'pe-phase pe-phase--' + phaseState(p, life.currentPhase)}
          aria-label={p.name}
        >
          <div className="pe-panel">
            <div className="pe-panel-head">
              <div>
                <h2 className="pe-panel-title">{p.name}</h2>
                <p className="pe-panel-subtitle">
                  {p.stages.filter((s) => s.status === 'done' || s.status === 'skipped').length} of{' '}
                  {p.stages.length} stages finished
                </p>
              </div>
            </div>
            <ol className="pe-stages">
              {p.stages.map((s) => (
                <StageCard
                  key={s.key}
                  stage={s}
                  locked={p.gate?.status === 'approved'}
                  canEdit={props.canEdit}
                  onStatus={(status) => {
                    props.onStage(s.id, status);
                  }}
                />
              ))}
            </ol>
            {p.gate ? (
              <GatePanel
                gate={p.gate}
                role={props.role}
                canEdit={props.canEdit}
                canAdmin={props.canAdmin}
                onCriterion={props.onCriterion}
                onDecision={(d, note) => {
                  props.onDecision(p.gate?.key ?? '', d, note);
                }}
              />
            ) : null}
          </div>
        </section>
      ))}
    </>
  );
}

const W = (workspaceId: string, path: string): string => '/api/workspaces/' + workspaceId + path;

/** The project's Lifecycle page: loads, follows the live stream, and sends every action to the server. */
export function LifecyclePage(props: {
  workspaceId: string;
  projectId: string;
  role: string;
  hub: EventHub;
  /** [PCODE-119] the template chooser, for starting a lifecycle */
  templates?: { id: string; name: string }[];
}): ReactNode {
  const [life, setLife] = useState<LifecycleState | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [template, setTemplate] = useState('');
  // [PCODE-119 | S15 | v0.1.0] the workspace's templates, offered when the lifecycle starts
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>(props.templates ?? []);
  useEffect(() => {
    if (props.templates || life !== null) return;
    void api<{ templates: { id: string; name: string }[] }>(
      'GET',
      W(props.workspaceId, '/lifecycle/templates'),
    ).then((r) => {
      if (r.ok) setTemplates(r.data.templates);
    });
  }, [props.templates, props.workspaceId, life]);
  const base = W(props.workspaceId, '/projects/' + props.projectId + '/lifecycle');
  const load = useCallback(async () => {
    const r = await api<{ lifecycle: LifecycleState | null }>('GET', base);
    if (r.ok) setLife(r.data.lifecycle);
  }, [base]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      const t = e.data.object.type;
      if (
        e.type === 'orqiva.workspace.resync' ||
        (e.projectid === props.projectId && (t === 'stage' || t === 'gate'))
      )
        void load();
    });
  }, [load, props.hub, props.projectId]);
  const send = (path: string, body: unknown): void => {
    void api<{ lifecycle: LifecycleState }>('POST', base + path, body).then((r) => {
      if (r.ok) {
        setLife(r.data.lifecycle);
        setError('');
      } else setError(r.error.message);
    });
  };
  const canEdit = props.role !== 'guest';
  const canAdmin = props.role === 'admin' || props.role === 'owner';
  if (life === undefined)
    return (
      <p className="pe-muted" role="status">
        Loading…
      </p>
    );
  if (life === null)
    return (
      <Card>
        <EmptyState icon="backlog" title="No lifecycle yet">
          A lifecycle walks the project from idea to handover: phases, stages and gates that need a
          sign-off.
        </EmptyState>
        {canAdmin ? (
          <div className="pe-form-actions pe-center">
            {templates.length ? (
              <select
                className="pe-select"
                aria-label="Template"
                value={template}
                onChange={(e) => {
                  setTemplate(e.target.value);
                }}
              >
                <option value="">Orqiva default</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              className="pe-btn pe-btn--primary"
              onClick={() => {
                send('', template ? { templateId: template } : {});
              }}
            >
              Start the lifecycle
            </button>
          </div>
        ) : (
          <p className="pe-muted pe-center">An admin starts it.</p>
        )}
        {error ? (
          <div className="pe-field-error" role="alert">
            {error}
          </div>
        ) : null}
      </Card>
    );
  return (
    <>
      {error ? (
        <div className="pe-banner" role="alert">
          {error}
        </div>
      ) : null}
      <LifecycleView
        life={life}
        role={props.role}
        canEdit={canEdit}
        canAdmin={canAdmin}
        onStage={(id, status) => {
          send('/stages/' + id, { status });
        }}
        onCriterion={(id, met, evidence) => {
          send('/criteria/' + id, { met, evidence });
        }}
        onDecision={(gate, decision, note) => {
          send('/gates/' + gate, { decision, ...(note.trim() ? { note: note.trim() } : {}) });
        }}
      />
    </>
  );
}
