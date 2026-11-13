// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-277 | S15 | v0.1.0] T28.6 PRD approval by named approvers, reopen on edit, promote to an epic with stories, client in ideation ──
// ── [PCODE-276 | S15 | v0.1.0] T28.5 Idea estimates: size, confidence range from estimate vs actual, basis from similar past tasks ──
// ── [PCODE-275 | S15 | v0.1.0] T28.4 PRD: templates per idea kind, citations per statement, version diff, MD, PDF and Word export ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-126 | S15 | v0.1.0] Show ideas, the interview, proposals and signing in the web app ──
// ── [PCODE-147 | S15 | v0.1.0] Show the traceability graph from idea to deploy ──
//    Why:  the front half as a person walks it: file an idea, answer the interviewer, read and edit the
//          proposal with its estimate, and sign it. Each stage is a card on one page, in order, with the
//          next step always the obvious button. Everything follows the live stream.
import { TracePanel } from './trace.js';
import {
  estimateOf,
  POINTS,
  proposalProblems,
  SIGN_CONSENT,
  type ProposalContent,
  type ProposalTask,
} from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import type { EventHub } from './core/hub.js';
import { Icon } from './core/icons.js';
import { Card, Dialog, EmptyState, Stat, follow } from './shell.js';
import { localTime } from './views.js';
import {
  CitationLine,
  CitedText,
  PrdDiff,
  PrdExports,
  SectionFields,
  sectionsFrom,
  SectionsView,
  EstimatePanel,
  useEstimate,
  usePrd,
  type IdeaEstimate,
  type PrdInfo,
} from './prdparts.js';
import { ReviewPanel, STATE_TEXT, useReview } from './prdreview.js'; // [PCODE-277 | S15 | v0.1.0] // [PCODE-275 | S15 | v0.1.0] [PCODE-276 | S15 | v0.1.0]

export interface Idea {
  id: string;
  projectId: string;
  number: number;
  ref: string;
  title: string;
  body: string;
  status: string;
  interviewDone: boolean;
  summary: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  promotedAt?: string | null; // [PCODE-277 | S15 | v0.1.0]
}

export interface Message {
  seq: number;
  role: 'agent' | 'owner';
  body: string;
  author: string | null;
  runId: string | null;
  at: string;
}

export interface Proposal {
  id: string;
  version: number;
  content: ProposalContent;
  estimate: { points: number; days: number };
  source: string;
  author: string | null;
  runId: string | null;
  createdAt: string;
}

export interface Decision {
  idea: Idea;
  signatures: {
    id: string;
    decision: string;
    version: number;
    typedName: string;
    signer: string;
    signerEmail: string;
    consent: string;
    contentSha256: string;
    note: string;
    signedAt: string;
  }[];
  plan: { id: string; ref: string; title: string; estimate: number | null }[];
}

const W = (workspaceId: string, path: string): string => '/api/workspaces/' + workspaceId + path;

const STATUS_TEXT: Record<string, string> = {
  new: 'New',
  interviewing: 'Interview',
  proposed: 'Proposed',
  in_review: 'In review', // [PCODE-277 | S15 | v0.1.0]
  approved: 'Approved',
  declined: 'Declined',
};

export function IdeaStatus(props: { status: string }): ReactNode {
  return (
    <span className={'pe-idea-status pe-idea-status--' + props.status}>
      {STATUS_TEXT[props.status] ?? props.status}
    </span>
  );
}

/** Which of the four stages an idea is in, for the stepper. */
export function ideaStage(idea: Pick<Idea, 'status' | 'interviewDone'>): number {
  if (idea.status === 'approved' || idea.status === 'declined') return 4;
  if (idea.status === 'proposed' || idea.status === 'in_review') return 3; // [PCODE-277 | S15 | v0.1.0]
  if (idea.interviewDone) return 2;
  return idea.status === 'interviewing' ? 1 : 0;
}

const STAGES = ['Idea', 'Interview', 'Proposal', 'Approval'];

export function IdeaStepper(props: { idea: Pick<Idea, 'status' | 'interviewDone'> }): ReactNode {
  const at = ideaStage(props.idea);
  return (
    <ol className="pe-idea-steps" aria-label="Stages">
      {STAGES.map((label, i) => {
        const state = i < at ? 'done' : i === at ? 'current' : 'next';
        return (
          <li
            key={label}
            className={'pe-idea-step pe-idea-step--' + state}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="pe-idea-step-dot" aria-hidden="true">
              {state === 'done' ? <Icon name="task" size={14} /> : String(i + 1)}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

// ── the inbox ──

export function IdeasInbox(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, projectId } = props;
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<Idea[]>('GET', W(workspaceId, '/projects/' + projectId + '/ideas'));
    if (r.ok) setIdeas(r.data);
  }, [workspaceId, projectId]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (e.type === 'orqiva.workspace.resync' || e.data.object.type === 'idea') void load();
    });
  }, [load, props.hub]);

  const file = async (): Promise<void> => {
    const r = await api<Idea>('POST', W(workspaceId, '/projects/' + projectId + '/ideas'), {
      title: title.trim(),
      body: body.trim(),
    });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setTitle('');
    setBody('');
    setError('');
    props.go('/ideas/' + r.data.id);
  };
  return (
    <div className="pe-stack">
      {props.canEdit ? (
        <Card
          title="File an idea"
          subtitle="A few lines are enough: the Interviewer agent asks for the rest."
        >
          <form
            className="pe-form-grid pe-form-grid--wide"
            onSubmit={(e) => {
              e.preventDefault();
              void file();
            }}
          >
            <div className="pe-field">
              <label htmlFor="idea-title">Idea</label>
              <input
                id="idea-title"
                className="pe-input"
                placeholder="e.g. Let finance export the monthly report as CSV"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
              />
            </div>
            <div className="pe-field">
              <label htmlFor="idea-body">Details (optional)</label>
              <textarea
                id="idea-body"
                className="pe-input pe-textarea"
                rows={3}
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                }}
              />
            </div>
            <div className="pe-form-actions">
              <button type="submit" className="pe-btn pe-btn--primary" disabled={!title.trim()}>
                File the idea
              </button>
            </div>
            {error ? (
              <div className="pe-field-error" role="alert">
                {error}
              </div>
            ) : null}
          </form>
        </Card>
      ) : null}
      <Card title="Inbox" subtitle="Every idea, where it stands, newest first.">
        {!ideas ? (
          <p className="pe-muted" role="status">
            Loading…
          </p>
        ) : ideas.length === 0 ? (
          <EmptyState icon="idea" title="No ideas yet">
            File the first one above.
          </EmptyState>
        ) : (
          <table className="pe-grid-table" aria-label="Ideas">
            <thead>
              <tr>
                <th scope="col">Ref</th>
                <th scope="col">Idea</th>
                <th scope="col">Stage</th>
                <th scope="col">Filed by</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {ideas.map((i) => (
                <tr key={i.id}>
                  <td className="pe-mono">{i.ref}</td>
                  <td>
                    <a href={'/ideas/' + i.id} onClick={follow('/ideas/' + i.id, props.go)}>
                      {i.title}
                    </a>
                  </td>
                  <td>
                    <IdeaStatus status={i.status} />
                  </td>
                  <td className="pe-muted">{i.createdBy ?? '—'}</td>
                  <td className="pe-muted">{localTime(i.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ── one idea ──

export function IdeaPage(props: {
  workspaceId: string;
  ideaId: string;
  role: string;
  myName: string;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, ideaId } = props;
  const canEdit = props.role !== 'guest';
  const [thread, setThread] = useState<{ idea: Idea; messages: Message[] } | null | 'missing'>(
    null,
  );
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState<'' | 'interview' | 'draft'>('');
  const [error, setError] = useState('');
  const [shown, setShown] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [signing, setSigning] = useState<'approve' | 'decline' | null>(null);
  const [against, setAgainst] = useState<number | null>(null); // [PCODE-275 | S15 | v0.1.0] the version compared with
  const shownVersion =
    (proposals.find((p) => p.version === shown) ?? proposals[0])?.version ?? null;
  const prd = usePrd(workspaceId, ideaId, shownVersion);
  const estimate = useEstimate(workspaceId, ideaId, shownVersion);
  const [review, reloadReview] = useReview(workspaceId, ideaId, props.hub); // [PCODE-277 | S15 | v0.1.0] // [PCODE-276 | S15 | v0.1.0]

  const load = useCallback(async () => {
    const [t, p, d] = await Promise.all([
      api<{ idea: Idea; messages: Message[] }>('GET', W(workspaceId, '/ideas/' + ideaId)),
      api<Proposal[]>('GET', W(workspaceId, '/ideas/' + ideaId + '/proposals')),
      api<Decision>('GET', W(workspaceId, '/ideas/' + ideaId + '/decision')),
    ]);
    setThread(t.ok ? t.data : 'missing');
    if (p.ok) setProposals(p.data);
    if (d.ok) setDecision(d.data);
  }, [workspaceId, ideaId]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (e.type === 'orqiva.workspace.resync' || e.data.object.id === ideaId) void load();
    });
  }, [load, props.hub, ideaId]);

  if (thread === 'missing')
    return (
      <div className="pe-page">
        <EmptyState icon="idea" title="This idea does not exist or you cannot see it" />
      </div>
    );
  if (!thread) return <div className="pe-page pe-muted">Loading…</div>;
  const { idea, messages } = thread;
  const open = idea.status !== 'approved' && idea.status !== 'declined';
  // [PCODE-277 | S15 | v0.1.0] the PRD takes new versions until declined or promoted; an edit after approval reopens it
  const editablePrd = idea.status !== 'declined' && !idea.promotedAt;
  const lastAgent = messages[messages.length - 1]?.role === 'agent';
  const latest = proposals[0];
  const proposal = proposals.find((p) => p.version === shown) ?? latest;

  const interview = async (): Promise<void> => {
    setBusy('interview');
    const r = await api<{ idea: Idea; messages: Message[] }>(
      'POST',
      W(workspaceId, '/ideas/' + ideaId + '/interview'),
      answer.trim() ? { answer: answer.trim() } : {},
    );
    setBusy('');
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    setAnswer('');
    setThread(r.data);
  };
  const draft = async (): Promise<void> => {
    setBusy('draft');
    const r = await api<Proposal>('POST', W(workspaceId, '/ideas/' + ideaId + '/proposals/draft'));
    setBusy('');
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    setShown(null);
    await load();
  };

  return (
    <div className="pe-page">
      <header className="pe-page-header">
        <div className="pe-page-header-row">
          <div className="pe-page-titles">
            <div className="pe-eyebrow">
              <a
                href={'/projects/' + idea.projectId + '/ideas'}
                onClick={follow('/projects/' + idea.projectId + '/ideas', props.go)}
              >
                Ideas
              </a>{' '}
              · {idea.ref}
            </div>
            <h1 className="pe-page-title">{idea.title}</h1>
            <p className="pe-page-subtitle">
              Filed by {idea.createdBy ?? 'someone'} · {localTime(idea.createdAt)}
            </p>
          </div>
          <div className="pe-page-actions">
            <IdeaStatus status={idea.status} />
          </div>
        </div>
      </header>
      <div className="pe-stack">
        <IdeaStepper idea={idea} />
        {error ? (
          <div className="pe-field-error" role="alert">
            {error}
          </div>
        ) : null}
        {idea.body ? (
          <Card title="The idea">
            <p className="pe-pre-wrap">{idea.body}</p>
          </Card>
        ) : null}

        <Card
          title="Owner interview"
          subtitle="The Interviewer agent asks one question at a time until it can sum up."
        >
          {messages.length === 0 ? (
            <p className="pe-muted">Not started yet.</p>
          ) : (
            <ol className="pe-chat" aria-label="Interview">
              {messages.map((m) => (
                <li key={m.seq} className={'pe-chat-msg pe-chat-msg--' + m.role}>
                  <div className="pe-chat-who">
                    {m.role === 'agent' ? (
                      m.runId ? (
                        <a href={'/runs/' + m.runId} onClick={follow('/runs/' + m.runId, props.go)}>
                          Interviewer agent
                        </a>
                      ) : (
                        'Interviewer agent'
                      )
                    ) : (
                      (m.author ?? 'Owner')
                    )}
                  </div>
                  <div className="pe-chat-body">{m.body}</div>
                </li>
              ))}
            </ol>
          )}
          {idea.interviewDone ? (
            <div className="pe-ok" role="status">
              Interview complete: the summary above is what the proposal is written from.
            </div>
          ) : null}
          {canEdit && open ? (
            messages.length === 0 ? (
              <button
                type="button"
                className="pe-btn pe-btn--primary"
                disabled={busy !== ''}
                onClick={() => {
                  void interview();
                }}
              >
                <Icon name="agent" size={18} />{' '}
                {busy === 'interview' ? 'The interviewer is thinking…' : 'Start the interview'}
              </button>
            ) : lastAgent && !idea.interviewDone ? (
              <form
                className="pe-inline-form pe-chat-answer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void interview();
                }}
              >
                <textarea
                  className="pe-input pe-textarea"
                  aria-label="Your answer"
                  placeholder="Your answer"
                  rows={2}
                  value={answer}
                  onChange={(e) => {
                    setAnswer(e.target.value);
                  }}
                />
                <button
                  type="submit"
                  className="pe-btn pe-btn--primary"
                  disabled={!answer.trim() || busy !== ''}
                >
                  {busy === 'interview' ? 'Thinking…' : 'Answer'}
                </button>
              </form>
            ) : null
          ) : null}
        </Card>

        <Card
          title="Proposal"
          subtitle="Written by the Architect agent from the interview; the estimate is computed from the tasks."
          actions={
            proposal && canEdit && editablePrd && !editing ? (
              <button
                type="button"
                className="pe-btn pe-btn--secondary"
                onClick={() => {
                  setShown(null);
                  setEditing(true);
                }}
              >
                Edit
              </button>
            ) : null
          }
        >
          {editing && latest ? (
            <ProposalEditor
              initial={latest.content}
              template={prd?.template ?? []}
              onCancel={() => {
                setEditing(false);
              }}
              onSave={async (content) => {
                const r = await api<Proposal>(
                  'POST',
                  W(workspaceId, '/ideas/' + ideaId + '/proposals'),
                  { content },
                );
                if (!r.ok) return r.error.details[0]?.message ?? r.error.message;
                setEditing(false);
                setShown(null);
                await load();
                return null;
              }}
            />
          ) : proposal ? (
            <>
              {proposals.length > 1 ? (
                <div className="pe-inline-form">
                  <label htmlFor="proposal-version" className="pe-small pe-muted">
                    Version
                  </label>
                  <select
                    id="proposal-version"
                    className="pe-select"
                    value={proposal.version}
                    onChange={(e) => {
                      setShown(Number(e.target.value));
                    }}
                  >
                    {proposals.map((p) => {
                      const state = review?.versions.find((v) => v.version === p.version)?.state;
                      return (
                        <option key={p.version} value={p.version}>
                          {'Version ' +
                            String(p.version) +
                            (p === latest ? ' (latest)' : '') +
                            (state && state !== 'draft'
                              ? ' · ' + (STATE_TEXT[state] ?? state)
                              : '')}
                        </option>
                      );
                    })}
                  </select>
                  {/* [PCODE-275 | S15 | v0.1.0] compare with another version */}
                  <label htmlFor="proposal-against" className="pe-small pe-muted">
                    compared with
                  </label>
                  <select
                    id="proposal-against"
                    className="pe-select"
                    value={against ?? ''}
                    onChange={(e) => {
                      setAgainst(e.target.value ? Number(e.target.value) : null);
                    }}
                  >
                    <option value="">nothing</option>
                    {proposals
                      .filter((p) => p.version !== proposal.version)
                      .map((p) => (
                        <option key={p.version} value={p.version}>
                          {'Version ' + String(p.version)}
                        </option>
                      ))}
                  </select>
                </div>
              ) : null}
              <PrdExports workspaceId={workspaceId} ideaId={ideaId} version={proposal.version} />
              {(() => {
                const other = proposals.find(
                  (p) => p.version === against && p.version !== proposal.version,
                );
                if (!other) return null;
                const [from, to] =
                  other.version < proposal.version ? [other, proposal] : [proposal, other];
                return <PrdDiff from={from} to={to} />;
              })()}
              <ProposalView proposal={proposal} go={props.go} prd={prd} estimate={estimate} />
            </>
          ) : idea.interviewDone && canEdit && editablePrd ? (
            <button
              type="button"
              className="pe-btn pe-btn--primary"
              disabled={busy !== ''}
              onClick={() => {
                void draft();
              }}
            >
              <Icon name="agent" size={18} />{' '}
              {busy === 'draft' ? 'The architect is writing…' : 'Draft the proposal'}
            </button>
          ) : (
            <p className="pe-muted">Comes after the interview.</p>
          )}
          {proposal && idea.interviewDone && canEdit && editablePrd && !editing ? (
            <p className="pe-small">
              <button
                type="button"
                className="pe-btn pe-btn--text"
                disabled={busy !== ''}
                onClick={() => {
                  void draft();
                }}
              >
                {busy === 'draft'
                  ? 'The architect is writing…'
                  : 'Let the architect write a new draft'}
              </button>
            </p>
          ) : null}
        </Card>

        <Card
          title="Approval"
          subtitle="Named approvers sign the latest version; without them, the workspace owner signs."
        >
          {review ? (
            <ReviewPanel
              workspaceId={workspaceId}
              ideaId={ideaId}
              review={review}
              canEdit={canEdit}
              myName={props.myName}
              onChanged={async () => {
                await Promise.all([load(), reloadReview()]);
              }}
              go={props.go}
            />
          ) : null}
          {decision?.signatures.length ? (
            <ul className="pe-signatures">
              {decision.signatures.map((s) => (
                <li key={s.id} className={'pe-signature pe-signature--' + s.decision}>
                  <div className="pe-signature-head">
                    <strong>{s.decision === 'approved' ? 'Approved' : 'Declined'}</strong> version{' '}
                    {s.version} · signed “{s.typedName}” by {s.signer} ({s.signerEmail}) ·{' '}
                    {localTime(s.signedAt)}
                  </div>
                  {s.note ? <div>{s.note}</div> : null}
                  <div className="pe-small pe-muted pe-mono" title={s.contentSha256}>
                    SHA-256 {s.contentSha256.slice(0, 16)}…
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {idea.status === 'proposed' && latest && !review?.approvers.length ? (
            props.role === 'owner' ? (
              <div className="pe-form-actions">
                <button
                  type="button"
                  className="pe-btn pe-btn--primary"
                  onClick={() => {
                    setSigning('approve');
                  }}
                >
                  Approve and sign
                </button>
                <button
                  type="button"
                  className="pe-btn pe-btn--secondary"
                  onClick={() => {
                    setSigning('decline');
                  }}
                >
                  Decline
                </button>
              </div>
            ) : (
              <p className="pe-muted">Waiting for the workspace owner to sign.</p>
            )
          ) : !decision?.signatures.length && !review?.approvers.length ? (
            <p className="pe-muted">Comes after the proposal.</p>
          ) : null}
          {decision?.plan.length ? (
            <>
              <h3 className="pe-subhead">
                {/* ideas approved before promotion existed have flat tasks, no epic */}
                {review?.promoted
                  ? 'The epic and its ' +
                    String(decision.plan.length - 1) +
                    (decision.plan.length === 2 ? ' item' : ' items') +
                    ' in the backlog'
                  : 'The plan: ' + String(decision.plan.length) + ' tasks in the backlog'}
              </h3>
              <ul className="pe-plan-list">
                {decision.plan.map((p) => (
                  <li key={p.id}>
                    <a href={'/items/' + p.id} onClick={follow('/items/' + p.id, props.go)}>
                      <span className="pe-mono">{p.ref}</span> {p.title}
                    </a>
                    {p.estimate !== null ? <span className="pe-badge">{p.estimate}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>
      </div>
      {/* [PCODE-147 | S15 | v0.1.0] once approved, the chain from this idea to its deploys */}
      {idea.status === 'approved' ? (
        <div className="pe-stack pe-stack--after">
          <TracePanel workspaceId={workspaceId} ideaId={ideaId} go={props.go} />
        </div>
      ) : null}
      {signing && latest ? (
        <SignDialog
          decision={signing}
          version={latest.version}
          estimate={latest.estimate}
          myName={props.myName}
          onClose={() => {
            setSigning(null);
          }}
          onSign={async (name, consent, note) => {
            const r = await api<Decision>('POST', W(workspaceId, '/ideas/' + ideaId + '/sign'), {
              version: latest.version,
              decision: signing,
              name,
              consent,
              note,
            });
            if (!r.ok) return r.error.message;
            setSigning(null);
            setDecision(r.data);
            await load();
            return null;
          }}
        />
      ) : null}
    </div>
  );
}

export function ProposalView(props: {
  proposal: Proposal;
  go: (p: string) => void;
  prd?: PrdInfo | null; // [PCODE-275 | S15 | v0.1.0] citations, sections, stories
  estimate?: IdeaEstimate | null; // [PCODE-276 | S15 | v0.1.0] size, range, basis
}): ReactNode {
  const { content, estimate } = props.proposal;
  const refs = props.prd?.refs;
  const list = (title: string, lines: string[]): ReactNode =>
    lines.length ? (
      <div>
        <h3 className="pe-subhead">{title}</h3>
        <ul className="pe-bullets">
          {lines.map((l, i) => (
            <li key={i}>
              <CitedText text={l} refs={refs} />
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="pe-proposal">
      <div className="pe-stats">
        <Stat icon="chart" label="Story points" value={estimate.points} />
        <Stat icon="pulse" label="Working days" value={estimate.days} hint="at 5 points a day" />
        <Stat icon="task" label="Tasks" value={content.tasks.length} />
      </div>
      <p className="pe-small pe-muted">
        Version {props.proposal.version} ·{' '}
        {props.proposal.source === 'agent' ? (
          props.proposal.runId ? (
            <a
              href={'/runs/' + props.proposal.runId}
              onClick={follow('/runs/' + props.proposal.runId, props.go)}
            >
              written by the Architect agent
            </a>
          ) : (
            'written by the Architect agent'
          )
        ) : (
          'edited by ' + (props.proposal.author ?? 'someone')
        )}{' '}
        · {localTime(props.proposal.createdAt)}
      </p>
      {props.estimate ? <EstimatePanel estimate={props.estimate} /> : null}
      {props.prd ? <CitationLine report={props.prd.report} /> : null}
      <h3 className="pe-subhead">Summary</h3>
      <p className="pe-pre-wrap">
        <CitedText text={content.summary} refs={refs} />
      </p>
      <h3 className="pe-subhead">Problem</h3>
      <p className="pe-pre-wrap">
        <CitedText text={content.problem} refs={refs} />
      </p>
      <div className="pe-proposal-lists">
        {list('Goals', content.goals)}
        {list('In scope', content.scopeIn)}
        {list('Out of scope', content.scopeOut)}
        {list('Risks and open questions', content.risks)}
      </div>
      <SectionsView sections={content.sections} refs={refs} />
      {props.prd?.stories.length ? (
        <>
          <h3 className="pe-subhead">Stories</h3>
          <ul className="pe-bullets">
            {props.prd.stories.map((s) => (
              <li key={s.code}>
                <span className="pe-mono pe-muted">{s.code}</span> {s.text}
                {s.scenarios.length ? (
                  <span className="pe-small pe-muted">
                    {' '}
                    · {s.scenarios.length} {s.scenarios.length === 1 ? 'scenario' : 'scenarios'}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h3 className="pe-subhead">Tasks</h3>
      <table className="pe-grid-table" aria-label="Tasks">
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Points</th>
          </tr>
        </thead>
        <tbody>
          {content.tasks.map((t, i) => (
            <tr key={i}>
              <td>
                {t.title}
                {t.description ? <div className="pe-small pe-muted">{t.description}</div> : null}
              </td>
              <td>{t.estimate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const toLines = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

export function ProposalEditor(props: {
  initial: ProposalContent;
  /** [PCODE-275 | S15 | v0.1.0] the sections of the idea's kind */
  template?: readonly { key: string; title: string; hint: string }[];
  onSave: (content: ProposalContent) => Promise<string | null>;
  onCancel: () => void;
}): ReactNode {
  const i = props.initial;
  const [sections, setSections] = useState<Record<string, string>>(() =>
    Object.fromEntries((i.sections ?? []).map((s) => [s.key, s.body])),
  );
  const template = props.template ?? [];
  const [summary, setSummary] = useState(i.summary);
  const [problem, setProblem] = useState(i.problem);
  const [goals, setGoals] = useState(i.goals.join('\n'));
  const [scopeIn, setScopeIn] = useState(i.scopeIn.join('\n'));
  const [scopeOut, setScopeOut] = useState(i.scopeOut.join('\n'));
  const [risks, setRisks] = useState(i.risks.join('\n'));
  const [tasks, setTasks] = useState<ProposalTask[]>(i.tasks);
  const [error, setError] = useState('');
  const content: ProposalContent = {
    summary,
    problem,
    goals: toLines(goals),
    scopeIn: toLines(scopeIn),
    scopeOut: toLines(scopeOut),
    risks: toLines(risks),
    tasks,
    ...(template.length || i.sections
      ? { sections: sectionsFrom(template, sections, i.sections) }
      : {}),
  };
  const problems = proposalProblems(content);
  const est = estimateOf(tasks);
  const setTask = (n: number, change: Partial<ProposalTask>): void => {
    setTasks((ts) => ts.map((t, k) => (k === n ? { ...t, ...change } : t)));
  };
  const area = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    rows = 3,
  ): ReactNode => (
    <div className="pe-field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className="pe-input pe-textarea"
        rows={rows}
        value={value}
        onChange={(e) => {
          set(e.target.value);
        }}
      />
    </div>
  );
  return (
    <form
      className="pe-form-grid pe-form-grid--wide"
      onSubmit={(e) => {
        e.preventDefault();
        void props.onSave(content).then((err) => {
          setError(err ?? '');
        });
      }}
    >
      {area('p-summary', 'Summary', summary, setSummary)}
      {area('p-problem', 'Problem', problem, setProblem)}
      {area('p-goals', 'Goals, one per line', goals, setGoals)}
      {area('p-in', 'In scope, one per line', scopeIn, setScopeIn)}
      {area('p-out', 'Out of scope, one per line', scopeOut, setScopeOut)}
      {area('p-risks', 'Risks and open questions, one per line', risks, setRisks)}
      <SectionFields
        template={template}
        value={sections}
        onChange={(key, body) => {
          setSections((x) => ({ ...x, [key]: body }));
        }}
      />
      <fieldset className="pe-task-editor">
        <legend>
          Tasks · {est.points} points, {est.days} days
        </legend>
        {tasks.map((t, n) => (
          <div key={n} className="pe-task-row">
            <input
              className="pe-input"
              aria-label={'Task ' + String(n + 1) + ' title'}
              value={t.title}
              onChange={(e) => {
                setTask(n, { title: e.target.value });
              }}
            />
            <select
              className="pe-select"
              aria-label={'Task ' + String(n + 1) + ' points'}
              value={t.estimate}
              onChange={(e) => {
                setTask(n, { estimate: Number(e.target.value) });
              }}
            >
              {POINTS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="pe-icon-btn pe-icon-btn--sm"
              aria-label={'Remove task ' + String(n + 1)}
              onClick={() => {
                setTasks((ts) => ts.filter((_, k) => k !== n));
              }}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="pe-btn pe-btn--text"
          onClick={() => {
            setTasks((ts) => [...ts, { title: '', estimate: 1, description: '' }]);
          }}
        >
          <Icon name="plus" size={16} /> Add a task
        </button>
      </fieldset>
      {problems.length ? <div className="pe-small pe-muted">{problems[0]}</div> : null}
      {error ? (
        <div className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="pe-form-actions">
        <button type="submit" className="pe-btn pe-btn--primary" disabled={problems.length > 0}>
          Save as a new version
        </button>
        <button type="button" className="pe-btn pe-btn--secondary" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function SignDialog(props: {
  decision: 'approve' | 'decline';
  version: number;
  estimate: { points: number; days: number };
  myName: string;
  onSign: (name: string, consent: boolean, note: string) => Promise<string | null>;
  onClose: () => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const approve = props.decision === 'approve';
  return (
    <Dialog
      title={(approve ? 'Approve' : 'Decline') + ' version ' + String(props.version)}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="pe-btn pe-btn--secondary" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="pe-btn pe-btn--primary"
            disabled={!consent || !name.trim()}
            onClick={() => {
              void props.onSign(name, consent, note.trim()).then((err) => {
                setError(err ?? '');
              });
            }}
          >
            {approve ? 'Sign and approve' : 'Sign and decline'}
          </button>
        </>
      }
    >
      <div className="pe-form-grid">
        {approve ? (
          <p>
            Approving creates the proposal’s tasks in the backlog: {props.estimate.points} points,
            about {props.estimate.days} working days.
          </p>
        ) : (
          <p>Declining closes the idea; nothing is created.</p>
        )}
        <label className="pe-check">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
            }}
          />{' '}
          {SIGN_CONSENT}
        </label>
        <div className="pe-field">
          <label htmlFor="sign-name">Type your full name: {props.myName}</label>
          <input
            id="sign-name"
            className="pe-input pe-signature-input"
            autoComplete="off"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
        <div className="pe-field">
          <label htmlFor="sign-note">Note (optional)</label>
          <input
            id="sign-note"
            className="pe-input"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </div>
        {error ? (
          <div className="pe-field-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
