// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-274 | S15 | v0.1.0] T28.3 Stories with Given/When/Then and personas; value/effort matrix, evidence library, compare ──
// ── [PCODE-273 | S15 | v0.1.0] T28.2 Interview steered by coverage; handed-over questions notify their owner ──
// ── [PCODE-272 | S15 | v0.1.0] T28.1 Ideation intake: links read on the server, sources from the CLI and VS Code ──
// ── [PCODE-242 | S15 | v0.1.0] T24.3 AI providers and file reading in the web app ──
// ── [PCODE-170 | S15 | v0.1.0] B3.3 Ideation live in the web app: ideas list, interview with coverage, sources, requirements, questions, risks, priority, decisions ──
//    Why:  the Ideation tab of the approved design on the server's ideation workspace. An idea collects
//          its sources, the Analyst extracts requirements that cite their passages, questions go to named
//          people with a date, risks and assumptions are kept in view, several people score it and see how
//          far apart they are, and the project's decisions and glossary sit next to it. The interview, the
//          PRD and the sign-off are the flows built before; this tab leads into them.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Bar, Button, Card, Chip, Ring } from '../preview/ui.js';
import { labelsText, linkText, readText, sizeText, uploadFile } from './files.js';
import {
  Compare,
  EvidenceLibrary,
  IdeaMatrix,
  Personas,
  RequestLinks,
  Stories,
  storiesByPersona,
  type LinkedRequest,
  type PersonaJson,
} from './ideaviews.js'; // [PCODE-274 | S15 | v0.1.0]
import { LiveAvatar } from './shell.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface IdeaSummary {
  id: string;
  ref: string;
  title: string;
  body: string;
  status: string;
  interviewDone: boolean;
  summary: string;
  createdBy: string | null;
  createdAt: string;
  messageCount: number;
  kind: string;
  rejectedReason: string;
  mergedIntoId: string | null;
  lastActivityAt: string;
}
interface Source {
  id: string;
  label: string;
  kind: string;
  fileId: string | null;
  fileName: string | null;
  url: string;
  title: string;
  body: string;
  saidBy: string;
  textLength: number;
  read: { status: string; error: string } | null; // [PCODE-242 | S15 | v0.1.0]
  link: { status: string; error: string; readAt: string | null } | null; // [PCODE-272 | S15 | v0.1.0]
}
interface Requirement {
  id: string;
  code: string;
  kind: string;
  area: string;
  text: string;
  sourceId: string | null;
  passage: string;
  status: string;
  priority: string;
  // [PCODE-274 | S15 | v0.1.0] a story's persona and scenarios
  personaId?: string | null;
  personaName?: string | null;
  scenarios?: { given: string; when: string; then: string }[];
}
interface Question {
  id: string;
  text: string;
  area: string;
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  answer: string;
  status: string;
}
interface Risk {
  id: string;
  text: string;
  likelihood: number;
  impact: number;
  exposure: number;
  mitigation: string;
  ownerName: string | null;
  status: string;
}
interface Assumption {
  id: string;
  text: string;
  validateHow: string;
  ownerName: string | null;
  status: string;
}
interface ScoreSummary {
  method: string;
  count: number;
  mean: number;
  min: number;
  max: number;
  spread: number;
  mine: { inputs: Record<string, unknown>; score: number; note: string } | null;
  scorers: { name: string; score: number }[];
}
export interface IdeaWorkspace {
  idea: IdeaSummary;
  sources: Source[];
  requirements: Requirement[];
  questions: Question[];
  risks: Risk[];
  assumptions: Assumption[];
  scores: ScoreSummary[];
  coverage: Record<string, number>;
  decisions: { id: string; code: string; title: string; status: string }[];
  personas?: PersonaJson[]; // [PCODE-274 | S15 | v0.1.0] the project's
  requests?: LinkedRequest[];
}
interface Message {
  seq: number;
  role: string;
  body: string;
  author: string | null;
  area?: string | null; // [PCODE-273 | S15 | v0.1.0] the area an interviewer question is about
}
interface Person {
  id: string;
  name: string;
}

export const AREA_LABEL: Record<string, string> = {
  problem: 'Problem',
  users: 'Users',
  scope: 'Scope',
  non_goals: 'Non-goals',
  non_functional: 'Non-functional',
  data: 'Data',
  integrations: 'Integrations',
  security: 'Security',
};
const KIND_LABEL: Record<string, string> = {
  functional: 'Functional',
  non_functional: 'Non-functional',
  constraint: 'Constraint',
  story: 'Story',
  metric: 'Metric',
  out_of_scope: 'Out of scope',
  persona: 'Persona',
};
const STATUS_TONE: Record<
  string,
  'neutral' | 'primary' | 'info' | 'warning' | 'success' | 'danger'
> = {
  new: 'neutral',
  interviewing: 'primary',
  proposed: 'warning',
  in_review: 'info', // [PCODE-277 | S15 | v0.1.0]
  approved: 'success',
  declined: 'danger',
};

/** An idea nobody touched for 30 days gets a nudge. */
export const isStale = (
  i: Pick<IdeaSummary, 'status' | 'lastActivityAt'>,
  now = Date.now(),
): boolean =>
  (i.status === 'new' || i.status === 'interviewing') &&
  now - Date.parse(i.lastActivityAt) > 30 * 86_400_000;

/** The mean of the areas: how far the interview and extraction have come. */
export const coverageTotal = (c: Record<string, number>): number => {
  const v = Object.values(c);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0;
};

type Sub =
  | 'interview'
  | 'sources'
  | 'requirements'
  | 'stories'
  | 'personas'
  | 'questions'
  | 'risks'
  | 'priority'
  | 'decisions';
const SUBS: readonly Sub[] = [
  'interview',
  'sources',
  'requirements',
  'stories',
  'personas',
  'questions',
  'risks',
  'priority',
  'decisions',
];

/** [PCODE-273 | S15 | v0.1.0] The idea and tab a link names (?idea=…&sub=questions), as an inbox entry opens it. */
export function ideaInQuery(search: string): { idea: string | null; sub: Sub | null } {
  const q = new URLSearchParams(search);
  const sub = q.get('sub') ?? '';
  return {
    idea: q.get('idea'),
    sub: (SUBS as readonly string[]).includes(sub) ? (sub as Sub) : null,
  };
}

/** [PCODE-273 | S15 | v0.1.0] How far the interview is: questions asked of the most it asks. */
export const askedText = (asked: number, max: number): string =>
  'Question ' + String(Math.min(asked, max)) + ' of at most ' + String(max);

export function IdeationPage(props: {
  workspaceId: string;
  projectId: string;
  hub: EventHub;
  canEdit: boolean;
  meId: string;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, projectId } = props;
  const [ideas, setIdeas] = useState<IdeaSummary[] | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  // [PCODE-273 | S15 | v0.1.0] a link may name the idea and its tab
  const [linked] = useState(() =>
    typeof window === 'undefined' ? { idea: null, sub: null } : ideaInQuery(window.location.search),
  );
  const [selected, setSelected] = useState<string | null>(linked.idea);
  const [view, setView] = useState<'idea' | 'matrix' | 'evidence'>('idea'); // [PCODE-274 | S15 | v0.1.0]
  const [adding, setAdding] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const loadIdeas = useCallback(async () => {
    const r = await api<IdeaSummary[]>('GET', W(workspaceId, '/projects/' + projectId + '/ideas'));
    if (r.ok) setIdeas(r.data);
  }, [workspaceId, projectId]);
  useEffect(() => {
    void loadIdeas();
    void api<{ userId: string; name: string }[]>('GET', W(workspaceId, '/members')).then((r) => {
      if (r.ok) setPeople(r.data.map((m) => ({ id: m.userId, name: m.name })));
    });
    return props.hub.on((e) => {
      if (e.projectid === projectId && e.data.object.type === 'idea') void loadIdeas();
    });
  }, [loadIdeas, props.hub, projectId, workspaceId]);
  const list = (ideas ?? []).filter(
    (i) => filter === 'all' || (i.status !== 'approved' && i.status !== 'declined'),
  );
  const current = (ideas ?? []).find((i) => i.id === selected) ?? list[0] ?? null;
  return (
    <div className="pv-workspace">
      <aside className="pv-list-pane" aria-label="Ideas">
        <div className="pv-list-pane-head">
          <strong>Ideas</strong>
          {props.canEdit ? (
            <Button
              size="sm"
              kind="primary"
              icon="plus"
              onClick={() => {
                setAdding((a) => !a);
              }}
            >
              New
            </Button>
          ) : null}
        </div>
        {adding ? (
          <NewIdea
            onCreate={async (title, body) => {
              const r = await api<{ id: string }>(
                'POST',
                W(workspaceId, '/projects/' + projectId + '/ideas'),
                { title, body },
              );
              if (r.ok) {
                setAdding(false);
                setSelected(r.data.id);
                await loadIdeas();
              }
              return r.ok ? '' : r.error.message;
            }}
          />
        ) : null}
        <div className="pv-segmented pv-segmented--full" role="radiogroup" aria-label="Show">
          <button
            type="button"
            role="radio"
            aria-checked={filter === 'open'}
            className="pv-seg"
            onClick={() => {
              setFilter('open');
            }}
          >
            Open
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={filter === 'all'}
            className="pv-seg"
            onClick={() => {
              setFilter('all');
            }}
          >
            All
          </button>
        </div>
        {/* [PCODE-274 | S15 | v0.1.0] across the project's ideas */}
        <div className="pv-segmented pv-segmented--full" role="radiogroup" aria-label="View">
          {(
            [
              ['idea', 'Idea'],
              ['matrix', 'Matrix'],
              ['evidence', 'Evidence'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={view === k}
              className="pv-seg"
              onClick={() => {
                setView(k);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <ul className="pv-idea-list">
          {list.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                className="pv-idea"
                aria-current={current?.id === i.id ? 'true' : undefined}
                onClick={() => {
                  setSelected(i.id);
                  setView('idea');
                }}
              >
                <span className="pv-idea-top">
                  <span className="pv-mono pv-muted">{i.ref}</span>
                  <Chip tone={STATUS_TONE[i.status] ?? 'neutral'}>{i.status}</Chip>
                  {isStale(i) ? <Chip tone="warning">quiet 30 days</Chip> : null}
                </span>
                <span className="pv-idea-title">{i.title}</span>
                <span className="pv-idea-meta">
                  <span>{i.kind.replace('_', ' ')}</span>
                  <span>·</span>
                  <span>{i.createdBy ?? 'someone'}</span>
                </span>
              </button>
            </li>
          ))}
          {ideas && !list.length ? <li className="pv-muted v2-pad">No ideas here yet.</li> : null}
        </ul>
      </aside>
      <section className="pv-detail-pane">
        {view === 'matrix' ? (
          <IdeaMatrix
            workspaceId={workspaceId}
            projectId={projectId}
            onOpen={(id) => {
              setSelected(id);
              setView('idea');
            }}
          />
        ) : view === 'evidence' ? (
          <EvidenceLibrary
            workspaceId={workspaceId}
            projectId={projectId}
            onOpen={(id) => {
              setSelected(id);
              setView('idea');
            }}
          />
        ) : current ? (
          <IdeaDetail
            key={current.id}
            workspaceId={workspaceId}
            projectId={projectId}
            idea={current}
            ideas={ideas ?? []}
            people={people}
            hub={props.hub}
            canEdit={props.canEdit}
            go={props.go}
            onChanged={() => void loadIdeas()}
            {...(linked.sub && current.id === linked.idea ? { sub: linked.sub } : {})}
          />
        ) : (
          <div className="pv-empty">
            <PIcon name="ideation" size={28} />
            <strong>{ideas ? 'No idea yet.' : 'Loading…'}</strong>
            <span>
              An idea collects its sources; the Analyst turns them into requirements, questions and
              risks for a PRD.
            </span>
          </div>
        )}
      </section>
    </div>
  );
}

function NewIdea(props: { onCreate: (title: string, body: string) => Promise<string> }): ReactNode {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      className="v2-form v2-pad"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) void props.onCreate(title.trim(), body.trim()).then(setError);
      }}
    >
      <input
        className="v2-input"
        aria-label="Title"
        placeholder="What is the idea?"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
        }}
      />
      <textarea
        className="v2-input"
        aria-label="Description"
        rows={3}
        placeholder="Who has the problem, and why now?"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
        }}
      />
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm" disabled={!title.trim()}>
        File the idea
      </button>
    </form>
  );
}

function IdeaDetail(props: {
  workspaceId: string;
  projectId: string;
  idea: IdeaSummary;
  ideas: IdeaSummary[];
  people: Person[];
  hub: EventHub;
  canEdit: boolean;
  go: (p: string) => void;
  onChanged: () => void;
  sub?: Sub; // [PCODE-273 | S15 | v0.1.0] the tab to open on
}): ReactNode {
  const { workspaceId } = props;
  const [ws, setWs] = useState<IdeaWorkspace | null>(null);
  const [sub, setSub] = useState<Sub>(props.sub ?? 'interview');
  const [error, setError] = useState('');
  const [unread, setUnread] = useState<string[]>([]); // [PCODE-272 | S15 | v0.1.0] sources the last extraction found empty
  const [busy, setBusy] = useState('');
  const [setAside, setSetAside] = useState(false);
  const [merging, setMerging] = useState(false);
  const [comparing, setComparing] = useState(false); // [PCODE-274 | S15 | v0.1.0]
  const load = useCallback(async () => {
    const r = await api<IdeaWorkspace>(
      'GET',
      W(workspaceId, '/ideas/' + props.idea.id + '/workspace'),
    );
    if (r.ok) setWs(r.data);
    else setError(r.error.message);
  }, [workspaceId, props.idea.id]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (e.data.object.id === props.idea.id) void load();
    });
  }, [load, props.hub, props.idea.id]);
  /** One write, then read the workspace again; an error shows above. */
  const call = async (
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<boolean> => {
    const r = await api(method, W(workspaceId, path), body);
    if (!r.ok) setError(r.error.message);
    else setError('');
    await load();
    return r.ok;
  };
  const i = ws?.idea ?? props.idea;
  const locked = i.status === 'approved';
  const edit = props.canEdit && !locked;
  const counts: Partial<Record<Sub, number>> = ws
    ? {
        sources: ws.sources.length,
        requirements: ws.requirements.filter((r) => r.status !== 'rejected').length,
        stories: storiesByPersona(ws.requirements).reduce((n, g) => n + g.stories.length, 0),
        personas: ws.personas?.length ?? 0,
        questions: ws.questions.filter((q) => q.status === 'open').length,
        risks: ws.risks.length + ws.assumptions.length,
      }
    : {};
  const subs: { key: Sub; label: string; icon: PIconName }[] = [
    { key: 'interview', label: 'Interview', icon: 'question' },
    { key: 'sources', label: 'Sources', icon: 'documents' },
    { key: 'requirements', label: 'Requirements', icon: 'check' },
    { key: 'stories', label: 'Stories', icon: 'review' },
    { key: 'personas', label: 'Personas', icon: 'people' },
    { key: 'questions', label: 'Open questions', icon: 'question' },
    { key: 'risks', label: 'Risks and assumptions', icon: 'incident' },
    { key: 'priority', label: 'Priority', icon: 'insights' },
    { key: 'decisions', label: 'Decisions and glossary', icon: 'flag' },
  ];
  return (
    <>
      <header className="pv-idea-head">
        <div>
          <div className="pv-idea-head-top">
            <span className="pv-mono pv-muted">{i.ref}</span>
            <Chip tone={STATUS_TONE[i.status] ?? 'neutral'}>{i.status}</Chip>
            <span className="pv-muted pv-small">
              from {i.createdBy ?? 'someone'} ·{' '}
              {ws ? String(ws.sources.length) + ' sources · ' : ''}
              {ws ? String(coverageTotal(ws.coverage)) + ' % covered' : ''}
            </span>
          </div>
          <h2 className="pv-idea-h">{i.title}</h2>
          {i.status === 'declined' && i.rejectedReason ? (
            <p className="pv-small pv-muted">Set aside: {i.rejectedReason}</p>
          ) : null}
        </div>
        <div className="pv-page-actions">
          {edit ? (
            <Button
              kind="primary"
              icon="sparkle"
              disabled={busy !== ''}
              title="The Analyst reads the idea, its sources and the interview; everything it finds arrives as proposed"
              onClick={() => {
                setBusy('extract');
                void api<{
                  requirements: number;
                  cited: number;
                  questions: number;
                  risks: number;
                  unread?: string[];
                }>('POST', W(workspaceId, '/ideas/' + i.id + '/extract')).then(async (r) => {
                  setBusy('');
                  setError(r.ok ? '' : r.error.message);
                  setUnread(r.ok ? (r.data.unread ?? []) : []);
                  if (r.ok) setSub('requirements');
                  await load();
                });
              }}
            >
              {busy === 'extract' ? 'Extracting…' : 'Extract with the Analyst'}
            </Button>
          ) : null}
          <Button
            icon="signoff"
            onClick={() => {
              props.go('/ideas/' + i.id);
            }}
            title="The proposal (PRD) in versions, the estimate and the signature"
          >
            PRD and sign-off
          </Button>
          {props.ideas.length > 1 ? (
            <Button
              kind="ghost"
              title="This idea next to another: scores, coverage, requirements, risks, evidence"
              onClick={() => {
                setComparing((x) => !x);
              }}
            >
              Compare
            </Button>
          ) : null}
          {edit && i.status !== 'declined' ? (
            <>
              <Button
                kind="ghost"
                onClick={() => {
                  setSetAside((x) => !x);
                }}
              >
                Set aside
              </Button>
              <Button
                kind="ghost"
                onClick={() => {
                  setMerging((x) => !x);
                }}
              >
                Merge into…
              </Button>
            </>
          ) : null}
          {edit && i.status === 'declined' && !i.mergedIntoId ? (
            <Button
              kind="ghost"
              onClick={() =>
                void call('PATCH', '/ideas/' + i.id, { status: 'new' }).then(props.onChanged)
              }
            >
              Take up again
            </Button>
          ) : null}
        </div>
      </header>
      {setAside ? (
        <ReasonForm
          label="Why is it set aside?"
          action="Set aside"
          onSubmit={(reason) =>
            void call('PATCH', '/ideas/' + i.id, {
              status: 'declined',
              rejectedReason: reason,
            }).then((ok) => {
              if (ok) {
                setSetAside(false);
                props.onChanged();
              }
            })
          }
        />
      ) : null}
      {merging ? (
        <form
          className="v2-inline v2-pad"
          onSubmit={(e) => {
            e.preventDefault();
            const into = new FormData(e.currentTarget).get('into');
            if (typeof into === 'string' && into)
              void call('POST', '/ideas/' + i.id + '/merge', { intoId: into }).then((ok) => {
                if (ok) {
                  setMerging(false);
                  props.onChanged();
                }
              });
          }}
        >
          <span className="pv-small">This idea is a duplicate of</span>
          <select className="v2-input" name="into" aria-label="Merge into">
            {props.ideas
              .filter((x) => x.id !== i.id && x.status !== 'approved' && x.status !== 'declined')
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.ref} {x.title}
                </option>
              ))}
          </select>
          <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm">
            Merge
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {unread.length ? (
        <p className="pv-small pv-muted" role="status">
          {labelsText(unread)} had no text yet, so the Analyst could not use{' '}
          {unread.length === 1 ? 'it' : 'them'}. Extract again once{' '}
          {unread.length === 1 ? 'it is' : 'they are'} read.
        </p>
      ) : null}
      {ws && comparing ? (
        <Compare
          workspaceId={workspaceId}
          left={ws}
          ideas={props.ideas}
          onClose={() => {
            setComparing(false);
          }}
        />
      ) : null}
      <nav className="pv-subtabs" aria-label="Idea">
        {subs.map((t) => (
          <button
            key={t.key}
            type="button"
            className="pv-subtab"
            aria-pressed={sub === t.key}
            onClick={() => {
              setSub(t.key);
            }}
          >
            <PIcon name={t.icon} size={14} />
            {t.label}
            {counts[t.key] ? <span className="pv-subtab-count">{counts[t.key]}</span> : null}
          </button>
        ))}
      </nav>
      {!ws ? (
        <p className="pv-muted" role="status">
          Loading…
        </p>
      ) : null}
      {ws && sub === 'interview' ? (
        <Interview
          workspaceId={workspaceId}
          ws={ws}
          edit={edit}
          onChanged={() => void load()}
          onError={setError}
        />
      ) : null}
      {ws && sub === 'sources' ? (
        <Sources
          workspaceId={workspaceId}
          projectId={props.projectId}
          ws={ws}
          edit={edit}
          call={call}
          onError={setError}
          reload={() => void load()}
        />
      ) : null}
      {ws && sub === 'sources' ? (
        <RequestLinks workspaceId={workspaceId} ws={ws} edit={edit} call={call} />
      ) : null}
      {ws && sub === 'requirements' ? <Requirements ws={ws} edit={edit} call={call} /> : null}
      {ws && sub === 'stories' ? <Stories ws={ws} edit={edit} call={call} /> : null}
      {ws && sub === 'personas' ? (
        <Personas projectId={props.projectId} ws={ws} edit={props.canEdit} call={call} />
      ) : null}
      {ws && sub === 'questions' ? (
        <Questions ws={ws} edit={edit} people={props.people} call={call} />
      ) : null}
      {ws && sub === 'risks' ? <Risks ws={ws} edit={edit} call={call} /> : null}
      {ws && sub === 'priority' ? <Priority ws={ws} edit={props.canEdit} call={call} /> : null}
      {ws && sub === 'decisions' ? (
        <Decisions
          workspaceId={workspaceId}
          projectId={props.projectId}
          ideaId={i.id}
          edit={props.canEdit}
          onError={setError}
        />
      ) : null}
    </>
  );
}

function ReasonForm(props: {
  label: string;
  action: string;
  onSubmit: (reason: string) => void;
}): ReactNode {
  const [reason, setReason] = useState('');
  return (
    <form
      className="v2-inline v2-pad"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim()) props.onSubmit(reason.trim());
      }}
    >
      <input
        className="v2-input v2-grow"
        aria-label={props.label}
        placeholder={props.label}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
        }}
      />
      <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm" disabled={!reason.trim()}>
        {props.action}
      </button>
    </form>
  );
}

function Interview(props: {
  workspaceId: string;
  ws: IdeaWorkspace;
  edit: boolean;
  onChanged: () => void;
  onError: (m: string) => void;
}): ReactNode {
  const id = props.ws.idea.id;
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [maxQuestions, setMaxQuestions] = useState(12); // [PCODE-273 | S15 | v0.1.0]
  useEffect(() => {
    void api<{ messages: Message[] }>('GET', W(props.workspaceId, '/ideas/' + id)).then((r) => {
      if (r.ok) setMessages(r.data.messages);
    });
  }, [props.workspaceId, id]);
  const send = async (enough = false): Promise<void> => {
    setBusy(true);
    const r = await api<{ messages: Message[]; maxQuestions?: number }>(
      'POST',
      W(props.workspaceId, '/ideas/' + id + '/interview'),
      {
        ...(draft.trim() ? { answer: draft.trim() } : {}),
        ...(enough ? { enough: true } : {}),
      },
    );
    setBusy(false);
    if (!r.ok) {
      props.onError(r.error.message);
      return;
    }
    setMessages(r.data.messages);
    if (r.data.maxQuestions) setMaxQuestions(r.data.maxQuestions);
    setDraft('');
    props.onChanged();
  };
  const cov = props.ws.coverage;
  const total = coverageTotal(cov);
  const open = !props.ws.idea.interviewDone && props.edit;
  const asked = (messages ?? []).filter((m) => m.role === 'agent').length;
  return (
    <div className="pv-split">
      <Card flush className="pv-chat-card">
        <div className="pv-chat">
          <div className="pv-msg">
            <LiveAvatar
              id={props.ws.idea.createdBy ?? 'x'}
              name={props.ws.idea.createdBy ?? 'Someone'}
              size="sm"
            />
            <div className="pv-msg-body">
              <div className="pv-msg-head">
                <strong>{props.ws.idea.createdBy ?? 'Someone'}</strong> <Chip>the idea</Chip>
              </div>
              <p>{props.ws.idea.body || props.ws.idea.title}</p>
            </div>
          </div>
          {(messages ?? []).map((m) => (
            <div key={m.seq} className={'pv-msg' + (m.role === 'agent' ? ' pv-msg--agent' : '')}>
              <LiveAvatar
                id={m.role === 'agent' ? 'interviewer' : (m.author ?? 'owner')}
                name={m.role === 'agent' ? 'Interviewer' : (m.author ?? 'Owner')}
                size="sm"
                agent={m.role === 'agent'}
              />
              <div className="pv-msg-body">
                <div className="pv-msg-head">
                  <strong>{m.role === 'agent' ? 'Interviewer' : (m.author ?? 'Owner')}</strong>
                  {m.area ? <Chip>{AREA_LABEL[m.area] ?? m.area}</Chip> : null}
                </div>
                <p>{m.body}</p>
              </div>
            </div>
          ))}
          {props.ws.idea.interviewDone && props.ws.idea.summary ? (
            <div className="pv-msg pv-msg--agent">
              <LiveAvatar id="interviewer" name="Interviewer" size="sm" agent />
              <div className="pv-msg-body">
                <div className="pv-msg-head">
                  <strong>Interviewer</strong> <Chip tone="success">summary</Chip>
                </div>
                <p>{props.ws.idea.summary}</p>
              </div>
            </div>
          ) : null}
        </div>
        {open ? (
          <div className="pv-composer">
            {messages?.length ? (
              <textarea
                value={draft}
                placeholder="Answer the Interviewer… (Ctrl Enter to send)"
                aria-label="Your answer"
                onChange={(e) => {
                  setDraft(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && draft.trim()) void send();
                }}
              />
            ) : null}
            <div className="pv-composer-row">
              {/* [PCODE-273 | S15 | v0.1.0] how far it is, and the owner may end it */}
              {asked ? (
                <span className="pv-small pv-muted">{askedText(asked, maxQuestions)}</span>
              ) : null}
              <span className="pv-spacer" />
              {asked ? (
                <Button
                  kind="ghost"
                  size="sm"
                  disabled={busy}
                  title="The Interviewer sums up with what it has; an answer typed above is sent with it"
                  onClick={() => void send(true)}
                >
                  That's enough, sum up
                </Button>
              ) : null}
              <Button
                kind="primary"
                icon="arrowRight"
                size="sm"
                disabled={busy || (Boolean(messages?.length) && !draft.trim())}
                onClick={() => void send()}
              >
                {busy ? 'Thinking…' : messages?.length ? 'Send' : 'Start the interview'}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
      <div className="pv-stack">
        <Card title="Coverage">
          <div className="pv-coverage-head">
            <Ring value={total} max={100} size={64} tone={total === 100 ? 'success' : 'primary'} />
            <p className="pv-muted pv-small">
              Each area fills with requirements, answered questions and interview answers; an open
              question holds it below full. The Interviewer asks about the weakest area next.
            </p>
          </div>
          <ul className="pv-coverage">
            {Object.keys(AREA_LABEL).map((a) => (
              <li key={a}>
                <span>{AREA_LABEL[a]}</span>
                <Bar
                  value={cov[a] ?? 0}
                  max={100}
                  tone={(cov[a] ?? 0) === 100 ? 'success' : 'primary'}
                />
                <span className="pv-num pv-muted">{cov[a] ?? 0} %</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Learned so far">
          <div className="pv-kv">
            <span>Requirements</span>
            <span>
              {props.ws.requirements.filter((r) => r.status !== 'rejected').length} (
              {props.ws.requirements.filter((r) => r.status === 'proposed').length} proposed)
            </span>
            <span>Open questions</span>
            <span>{props.ws.questions.filter((q) => q.status === 'open').length}</span>
            <span>Risks</span>
            <span>{props.ws.risks.length}</span>
            <span>Decisions</span>
            <span>{props.ws.decisions.length}</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Sources(props: {
  workspaceId: string;
  projectId: string;
  ws: IdeaWorkspace;
  edit: boolean;
  call: (m: 'POST' | 'DELETE', p: string, b?: unknown) => Promise<boolean>;
  onError: (m: string) => void;
  reload: () => void; // [PCODE-242 | S15 | v0.1.0]
}): ReactNode {
  const [kind, setKind] = useState<'file' | 'link' | 'text' | 'quote'>('file');
  // [PCODE-242 | S15 | v0.1.0] while a file is being read, look again every few seconds
  const pending = props.ws.sources.some((s) => readText(s.read).pending);
  const { reload } = props;
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(reload, 3000);
    return () => {
      clearTimeout(t);
    };
  }, [pending, reload, props.ws]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [saidBy, setSaidBy] = useState('');
  const [busy, setBusy] = useState(false);
  const id = props.ws.idea.id;
  const reset = (): void => {
    setTitle('');
    setText('');
    setUrl('');
    setSaidBy('');
  };
  const icon: Record<string, PIconName> = {
    file: 'documents',
    link: 'external',
    text: 'overview',
    quote: 'mention',
  };
  return (
    <div className="pv-stack">
      <Card flush title="Sources">
        <ul className="pv-rows">
          {props.ws.sources.map((s) => (
            <li key={s.id} className="pv-row pv-row--static">
              <span className="pv-mono pv-muted">{s.label}</span>
              <span className="pv-kind">
                <PIcon name={icon[s.kind] ?? 'documents'} size={15} />
              </span>
              <span className="pv-row-main">
                <span className="pv-row-title">
                  {s.kind === 'link' ? (
                    <a href={s.url} className="pv-link" target="_blank" rel="noreferrer noopener">
                      {s.title || s.url}
                    </a>
                  ) : s.kind === 'file' && s.fileId ? (
                    <a
                      href={W(props.workspaceId, '/files/' + s.fileId + '/content')}
                      className="pv-link"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.title || s.fileName}
                    </a>
                  ) : (
                    s.title ||
                    (s.kind === 'quote' ? '“' + s.body.slice(0, 120) + '”' : s.body.slice(0, 120))
                  )}
                </span>
                <span className="pv-row-sub">
                  {s.kind}
                  {s.saidBy ? ' · said by ' + s.saidBy : ''}
                  {s.textLength
                    ? ' · ' + sizeText(s.textLength) + ' of text the Analyst reads'
                    : s.fileId
                      ? ' · ' + (readText(s.read).text || 'no text the Analyst can read yet')
                      : s.kind === 'link'
                        ? ' · ' + (linkText(s.link).text || 'no text the Analyst can read')
                        : ''}
                  {/* [PCODE-272 | S15 | v0.1.0] a link is read again on request: a changed page, or after a failure */}
                  {props.edit && s.kind === 'link' ? (
                    <button
                      type="button"
                      className="pv-link-btn"
                      title={
                        s.link?.readAt
                          ? 'Last read ' + new Date(s.link.readAt).toLocaleString()
                          : 'Read the page now'
                      }
                      onClick={() => void props.call('POST', '/idea-sources/' + s.id + '/read')}
                    >
                      Read again
                    </button>
                  ) : null}
                  {/* [PCODE-242 | S15 | v0.1.0] a read that failed can be tried again */}
                  {props.edit && s.kind === 'file' && s.fileId && readText(s.read).failed ? (
                    <button
                      type="button"
                      className="pv-link-btn"
                      onClick={() =>
                        void props.call('POST', '/files/' + String(s.fileId) + '/read')
                      }
                    >
                      Read again
                    </button>
                  ) : null}
                </span>
              </span>
              {props.edit ? (
                <button
                  type="button"
                  className="pv-mini-btn"
                  aria-label={'Remove ' + s.label}
                  onClick={() => void props.call('DELETE', '/idea-sources/' + s.id)}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
          {!props.ws.sources.length ? (
            <li className="pv-row pv-muted">
              No sources yet: add the brief, a call transcript, a link or what a customer said.
            </li>
          ) : null}
        </ul>
      </Card>
      {props.edit ? (
        <Card title="Add a source">
          <div className="pv-segmented" role="radiogroup" aria-label="Kind of source">
            {(['file', 'link', 'text', 'quote'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                className="pv-seg"
                onClick={() => {
                  setKind(k);
                }}
              >
                {k === 'file'
                  ? 'Upload'
                  : k === 'link'
                    ? 'Link'
                    : k === 'text'
                      ? 'Text'
                      : 'Customer quote'}
              </button>
            ))}
          </div>
          {kind === 'file' ? (
            <label className="v2-field v2-pad">
              <span>
                PDF, Markdown, text, images up to 25 MB (text files are read straight away)
              </span>
              <input
                type="file"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setBusy(true);
                  void uploadFile(props.workspaceId, props.projectId, f).then(async (r) => {
                    if (!r.ok) props.onError(r.error.message);
                    else
                      await props.call('POST', '/ideas/' + id + '/sources', {
                        kind: 'file',
                        fileId: r.data.id,
                      });
                    setBusy(false);
                    e.target.value = '';
                  });
                }}
              />
            </label>
          ) : (
            <form
              className="v2-form v2-pad"
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                void props
                  .call('POST', '/ideas/' + id + '/sources', {
                    kind,
                    ...(title.trim() ? { title: title.trim() } : {}),
                    ...(kind === 'link' ? { url: url.trim() } : { body: text.trim() }),
                    ...(kind === 'quote' && saidBy.trim() ? { saidBy: saidBy.trim() } : {}),
                  })
                  .then((ok) => {
                    setBusy(false);
                    if (ok) reset();
                  });
              }}
            >
              {kind === 'link' ? (
                <input
                  className="v2-input"
                  aria-label="Address"
                  placeholder="https://…"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                  }}
                />
              ) : null}
              {kind !== 'link' ? (
                <textarea
                  className="v2-input"
                  rows={4}
                  aria-label={kind === 'quote' ? 'What they said' : 'Text'}
                  placeholder={
                    kind === 'quote'
                      ? 'What the customer said, word for word'
                      : 'Paste notes, an email, a transcript'
                  }
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                  }}
                />
              ) : null}
              {kind === 'quote' ? (
                <input
                  className="v2-input"
                  aria-label="Said by"
                  placeholder="Who said it"
                  value={saidBy}
                  onChange={(e) => {
                    setSaidBy(e.target.value);
                  }}
                />
              ) : null}
              <input
                className="v2-input"
                aria-label="Title"
                placeholder="Title (optional)"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
              />
              <button
                type="submit"
                className="pv-btn pv-btn--primary pv-btn--sm"
                disabled={busy || (kind === 'link' ? !url.trim() : !text.trim())}
              >
                {busy && kind === 'link' ? 'Reading the page…' : 'Add'}
              </button>
            </form>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function Requirements(props: {
  ws: IdeaWorkspace;
  edit: boolean;
  call: (m: 'POST' | 'PATCH' | 'DELETE', p: string, b?: unknown) => Promise<boolean>;
}): ReactNode {
  const [kind, setKind] = useState('all');
  const [text, setText] = useState('');
  const [newKind, setNewKind] = useState('functional');
  const [area, setArea] = useState('scope');
  const label = new Map(props.ws.sources.map((s) => [s.id, s.label]));
  const list = props.ws.requirements.filter((r) => kind === 'all' || r.kind === kind);
  const proposed = props.ws.requirements.filter((r) => r.status === 'proposed');
  return (
    <div className="pv-stack">
      <div className="pv-toolbar">
        <select
          className="pv-select"
          aria-label="Kind"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
          }}
        >
          <option value="all">All kinds</option>
          {Object.entries(KIND_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <span className="pv-spacer" />
        {props.edit && proposed.length ? (
          <Button
            size="sm"
            onClick={() =>
              void Promise.all(
                proposed.map((r) =>
                  props.call('PATCH', '/requirements/' + r.id, { status: 'accepted' }),
                ),
              )
            }
          >
            Accept all {proposed.length} proposed
          </Button>
        ) : null}
      </div>
      <Card flush>
        <table className="pv-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Requirement</th>
              <th>Kind</th>
              <th>Area</th>
              <th>Priority</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className={r.status === 'rejected' ? 'v2-row-off' : ''}>
                <td className="pv-mono pv-cell-ref">{r.code}</td>
                <td className="pv-cell-grow">
                  {r.text}
                  {r.passage ? <span className="v2-cite">“{r.passage}”</span> : null}
                </td>
                <td>
                  <Chip>{KIND_LABEL[r.kind] ?? r.kind}</Chip>
                </td>
                <td className="pv-small">{AREA_LABEL[r.area] ?? r.area}</td>
                <td>
                  {props.edit ? (
                    <select
                      className="v2-input v2-input--sm"
                      aria-label={'Priority of ' + r.code}
                      value={r.priority}
                      onChange={(e) =>
                        void props.call('PATCH', '/requirements/' + r.id, {
                          priority: e.target.value,
                        })
                      }
                    >
                      {['must', 'should', 'could', 'wont'].map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  ) : (
                    r.priority
                  )}
                </td>
                <td className="pv-mono pv-small" title={r.passage || 'no citation'}>
                  {r.sourceId ? (label.get(r.sourceId) ?? '—') : '—'}
                  {r.sourceId && !r.passage ? <span className="pv-text-warning"> ?</span> : null}
                </td>
                <td>
                  {r.status === 'proposed' && props.edit ? (
                    <span className="v2-inline">
                      <Button
                        size="sm"
                        kind="primary"
                        onClick={() =>
                          void props.call('PATCH', '/requirements/' + r.id, { status: 'accepted' })
                        }
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        kind="ghost"
                        onClick={() =>
                          void props.call('PATCH', '/requirements/' + r.id, { status: 'rejected' })
                        }
                      >
                        Reject
                      </Button>
                    </span>
                  ) : (
                    <Chip
                      tone={
                        r.status === 'accepted'
                          ? 'success'
                          : r.status === 'rejected'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {r.status}
                    </Chip>
                  )}
                </td>
              </tr>
            ))}
            {!list.length ? (
              <tr>
                <td colSpan={7} className="pv-muted">
                  No requirements yet. Add sources and extract with the Analyst, or write them here.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="pv-muted pv-small pv-pad">
          A passage in quotes is copied from its source; a “?” means the Analyst named a source but
          the passage was not found there, so no citation is shown.
        </p>
      </Card>
      {props.edit ? (
        <form
          className="v2-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim())
              void props
                .call('POST', '/ideas/' + props.ws.idea.id + '/requirements', {
                  text: text.trim(),
                  kind: newKind,
                  area,
                })
                .then((ok) => {
                  if (ok) setText('');
                });
          }}
        >
          <input
            className="v2-input v2-grow"
            aria-label="New requirement"
            placeholder="A new requirement (Given … When … Then … for a story)"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          <select
            className="v2-input"
            aria-label="Kind of the new requirement"
            value={newKind}
            onChange={(e) => {
              setNewKind(e.target.value);
            }}
          >
            {Object.entries(KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <select
            className="v2-input"
            aria-label="Area of the new requirement"
            value={area}
            onChange={(e) => {
              setArea(e.target.value);
            }}
          >
            {Object.entries(AREA_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!text.trim()}
          >
            Add
          </button>
        </form>
      ) : null}
    </div>
  );
}

function Questions(props: {
  ws: IdeaWorkspace;
  edit: boolean;
  people: Person[];
  call: (m: 'POST' | 'PATCH' | 'DELETE', p: string, b?: unknown) => Promise<boolean>;
}): ReactNode {
  const [text, setText] = useState('');
  const [area, setArea] = useState('scope');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <div className="pv-stack">
      <Card flush>
        <ul className="pv-rows">
          {props.ws.questions.map((q) => (
            <li key={q.id} className="pv-row pv-row--static v2-question">
              <span className="pv-row-main">
                <span className="pv-row-title pv-wrap">{q.text}</span>
                <span className="pv-row-sub">
                  {AREA_LABEL[q.area] ?? q.area}
                  {q.dueDate ? ' · due ' + q.dueDate : ''}
                </span>
                {q.status === 'answered' ? <span className="v2-answer">{q.answer}</span> : null}
                {q.status === 'open' && props.edit ? (
                  <span className="v2-inline">
                    <input
                      className="v2-input v2-grow"
                      aria-label={'Answer to ' + q.text}
                      placeholder="Answer"
                      value={answers[q.id] ?? ''}
                      onChange={(e) => {
                        setAnswers((a) => ({ ...a, [q.id]: e.target.value }));
                      }}
                    />
                    <Button
                      size="sm"
                      disabled={!answers[q.id]?.trim()}
                      onClick={() =>
                        void props.call('PATCH', '/idea-questions/' + q.id, {
                          answer: answers[q.id]?.trim() ?? '',
                        })
                      }
                    >
                      Answer
                    </Button>
                  </span>
                ) : null}
              </span>
              {props.edit ? (
                <select
                  className="v2-input v2-input--sm"
                  aria-label={'Owner of ' + q.text}
                  value={q.ownerId ?? ''}
                  onChange={(e) =>
                    void props.call('PATCH', '/idea-questions/' + q.id, {
                      ownerId: e.target.value || null,
                    })
                  }
                >
                  <option value="">Nobody</option>
                  {props.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="pv-small">{q.ownerName ?? '—'}</span>
              )}
              {props.edit ? (
                <input
                  type="date"
                  className="v2-input v2-input--sm"
                  aria-label={'Due date of ' + q.text}
                  value={q.dueDate ?? ''}
                  onChange={(e) =>
                    void props.call('PATCH', '/idea-questions/' + q.id, {
                      dueDate: e.target.value || null,
                    })
                  }
                />
              ) : null}
              <Chip
                tone={
                  q.status === 'open' ? 'warning' : q.status === 'answered' ? 'success' : 'neutral'
                }
              >
                {q.status}
              </Chip>
            </li>
          ))}
          {!props.ws.questions.length ? (
            <li className="pv-row pv-muted">No open questions.</li>
          ) : null}
        </ul>
      </Card>
      {props.edit ? (
        <form
          className="v2-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim())
              void props
                .call('POST', '/ideas/' + props.ws.idea.id + '/questions', {
                  text: text.trim(),
                  area,
                })
                .then((ok) => {
                  if (ok) setText('');
                });
          }}
        >
          <input
            className="v2-input v2-grow"
            aria-label="New question"
            placeholder="A question someone has to answer"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          <select
            className="v2-input"
            aria-label="Area of the new question"
            value={area}
            onChange={(e) => {
              setArea(e.target.value);
            }}
          >
            {Object.entries(AREA_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!text.trim()}
          >
            Ask
          </button>
        </form>
      ) : null}
    </div>
  );
}

function Risks(props: {
  ws: IdeaWorkspace;
  edit: boolean;
  call: (m: 'POST' | 'PATCH' | 'DELETE', p: string, b?: unknown) => Promise<boolean>;
}): ReactNode {
  const [risk, setRisk] = useState('');
  const [assumption, setAssumption] = useState('');
  const [how, setHow] = useState('');
  const cell = (l: number, i: number): Risk[] =>
    props.ws.risks.filter((r) => r.likelihood === l && r.impact === i);
  return (
    <div className="pv-split pv-split--even">
      <Card title="Risks: likelihood × impact" flush>
        <div className="v2-matrix5" role="table" aria-label="Risk matrix">
          {[5, 4, 3, 2, 1].map((l) => (
            <div key={l} className="v2-matrix5-row" role="row">
              <span className="pv-small pv-muted" role="rowheader">
                {l}
              </span>
              {[1, 2, 3, 4, 5].map((i) => (
                <span
                  key={i}
                  role="cell"
                  className={
                    'v2-matrix5-cell v2-heat-' + (l * i >= 15 ? 'hi' : l * i >= 8 ? 'mid' : 'lo')
                  }
                  title={'Likelihood ' + String(l) + ', impact ' + String(i)}
                >
                  {cell(l, i).length || ''}
                </span>
              ))}
            </div>
          ))}
          <div className="v2-matrix5-row">
            <span />
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} className="pv-small pv-muted v2-center">
                {i}
              </span>
            ))}
          </div>
        </div>
        <ul className="pv-rows">
          {props.ws.risks.map((r) => (
            <li key={r.id} className="pv-row pv-row--static">
              <Chip tone={r.exposure >= 15 ? 'danger' : r.exposure >= 8 ? 'warning' : 'neutral'}>
                {r.exposure}
              </Chip>
              <span className="pv-row-main">
                <span className="pv-row-title pv-wrap">{r.text}</span>
                <span className="pv-row-sub">
                  {r.mitigation ? 'Mitigation: ' + r.mitigation : 'No mitigation yet'}
                </span>
              </span>
              {props.edit ? (
                <>
                  <select
                    className="v2-input v2-input--sm"
                    aria-label="Likelihood"
                    value={r.likelihood}
                    onChange={(e) =>
                      void props.call('PATCH', '/idea-risks/' + r.id, {
                        likelihood: Number(e.target.value),
                      })
                    }
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        L{n}
                      </option>
                    ))}
                  </select>
                  <select
                    className="v2-input v2-input--sm"
                    aria-label="Impact"
                    value={r.impact}
                    onChange={(e) =>
                      void props.call('PATCH', '/idea-risks/' + r.id, {
                        impact: Number(e.target.value),
                      })
                    }
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        I{n}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
            </li>
          ))}
        </ul>
        {props.edit ? (
          <form
            className="v2-inline v2-pad"
            onSubmit={(e) => {
              e.preventDefault();
              if (risk.trim())
                void props
                  .call('POST', '/ideas/' + props.ws.idea.id + '/risks', { text: risk.trim() })
                  .then((ok) => {
                    if (ok) setRisk('');
                  });
            }}
          >
            <input
              className="v2-input v2-grow"
              aria-label="New risk"
              placeholder="A new risk"
              value={risk}
              onChange={(e) => {
                setRisk(e.target.value);
              }}
            />
            <button
              type="submit"
              className="pv-btn pv-btn--primary pv-btn--sm"
              disabled={!risk.trim()}
            >
              Add
            </button>
          </form>
        ) : null}
      </Card>
      <Card title="Assumptions" flush>
        <ul className="pv-rows">
          {props.ws.assumptions.map((x) => (
            <li key={x.id} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title pv-wrap">{x.text}</span>
                <span className="pv-row-sub">
                  {x.validateHow ? 'Validate: ' + x.validateHow : 'How to validate is not set'}
                </span>
              </span>
              {props.edit ? (
                <select
                  className="v2-input v2-input--sm"
                  aria-label={'Status of ' + x.text}
                  value={x.status}
                  onChange={(e) =>
                    void props.call('PATCH', '/idea-assumptions/' + x.id, {
                      status: e.target.value,
                    })
                  }
                >
                  <option value="open">open</option>
                  <option value="validated">validated</option>
                  <option value="invalidated">invalidated</option>
                </select>
              ) : (
                <Chip>{x.status}</Chip>
              )}
            </li>
          ))}
          {!props.ws.assumptions.length ? (
            <li className="pv-row pv-muted">No assumptions yet.</li>
          ) : null}
        </ul>
        {props.edit ? (
          <form
            className="v2-form v2-pad"
            onSubmit={(e) => {
              e.preventDefault();
              if (assumption.trim())
                void props
                  .call('POST', '/ideas/' + props.ws.idea.id + '/assumptions', {
                    text: assumption.trim(),
                    validateHow: how.trim(),
                  })
                  .then((ok) => {
                    if (ok) {
                      setAssumption('');
                      setHow('');
                    }
                  });
            }}
          >
            <input
              className="v2-input"
              aria-label="New assumption"
              placeholder="We assume that…"
              value={assumption}
              onChange={(e) => {
                setAssumption(e.target.value);
              }}
            />
            <input
              className="v2-input"
              aria-label="How to validate"
              placeholder="How we find out"
              value={how}
              onChange={(e) => {
                setHow(e.target.value);
              }}
            />
            <button
              type="submit"
              className="pv-btn pv-btn--primary pv-btn--sm"
              disabled={!assumption.trim()}
            >
              Add
            </button>
          </form>
        ) : null}
      </Card>
    </div>
  );
}

export const METHODS: {
  key: string;
  label: string;
  inputs: { key: string; label: string; min: number; max: number; step: number }[];
  hint: string;
}[] = [
  {
    key: 'rice',
    label: 'RICE',
    hint: 'reach × impact × confidence ÷ effort',
    inputs: [
      { key: 'reach', label: 'Reach (per quarter)', min: 0, max: 1e9, step: 1 },
      { key: 'impact', label: 'Impact (0.25–3)', min: 0.25, max: 3, step: 0.25 },
      { key: 'confidence', label: 'Confidence %', min: 0, max: 100, step: 5 },
      { key: 'effort', label: 'Effort (person-months)', min: 0.1, max: 1e6, step: 0.5 },
    ],
  },
  {
    key: 'ice',
    label: 'ICE',
    hint: 'impact × confidence × ease, each 1–10',
    inputs: [
      { key: 'impact', label: 'Impact', min: 1, max: 10, step: 1 },
      { key: 'confidence', label: 'Confidence', min: 1, max: 10, step: 1 },
      { key: 'ease', label: 'Ease', min: 1, max: 10, step: 1 },
    ],
  },
  {
    key: 'wsjf',
    label: 'WSJF',
    hint: '(business value + time criticality + risk reduction) ÷ job size',
    inputs: [
      { key: 'businessValue', label: 'Business value', min: 1, max: 100, step: 1 },
      { key: 'timeCriticality', label: 'Time criticality', min: 1, max: 100, step: 1 },
      { key: 'riskReduction', label: 'Risk reduction', min: 1, max: 100, step: 1 },
      { key: 'jobSize', label: 'Job size', min: 1, max: 100, step: 1 },
    ],
  },
  {
    key: 'value_effort',
    label: 'Value / effort',
    hint: 'value ÷ effort, each 1–10',
    inputs: [
      { key: 'value', label: 'Value', min: 1, max: 10, step: 1 },
      { key: 'effort', label: 'Effort', min: 1, max: 10, step: 1 },
    ],
  },
];

function Priority(props: {
  ws: IdeaWorkspace;
  edit: boolean;
  call: (m: 'PUT', p: string, b?: unknown) => Promise<boolean>;
}): ReactNode {
  const by = new Map(props.ws.scores.map((s) => [s.method, s]));
  const moscow = by.get('moscow');
  return (
    <div className="pv-stack">
      <div className="pv-split pv-split--even">
        {METHODS.map((m) => (
          <ScoreCard
            key={m.key}
            method={m}
            summary={by.get(m.key)}
            edit={props.edit}
            onSave={(inputs) =>
              props.call('PUT', '/ideas/' + props.ws.idea.id + '/scores/' + m.key, { inputs })
            }
          />
        ))}
        <Card title="MoSCoW">
          <p className="pv-muted pv-small">
            Your call for this idea; the spread shows if people disagree.
          </p>
          <div className="v2-inline">
            {(['must', 'should', 'could', 'wont'] as const).map((c) => (
              <button
                key={c}
                type="button"
                className="pv-filter-chip"
                aria-pressed={moscow?.mine?.inputs['category'] === c}
                disabled={!props.edit}
                onClick={() =>
                  void props.call('PUT', '/ideas/' + props.ws.idea.id + '/scores/moscow', {
                    inputs: { category: c },
                  })
                }
              >
                {c === 'wont' ? 'Won’t' : c.charAt(0).toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>
          {moscow ? <ScoreSpread s={moscow} /> : null}
        </Card>
      </div>
    </div>
  );
}

function ScoreCard(props: {
  method: (typeof METHODS)[number];
  summary: ScoreSummary | undefined;
  edit: boolean;
  onSave: (inputs: Record<string, number>) => Promise<boolean>;
}): ReactNode {
  const mine = props.summary?.mine?.inputs ?? {};
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      props.method.inputs.map((i) => [
        i.key,
        typeof mine[i.key] === 'number' ? String(mine[i.key]) : '',
      ]),
    ),
  );
  const complete = props.method.inputs.every(
    (i) => values[i.key]?.trim() && Number.isFinite(Number(values[i.key])),
  );
  return (
    <Card
      title={props.method.label}
      action={
        props.summary?.mine ? (
          <Chip tone="primary">yours {props.summary.mine.score.toLocaleString(fmtLocale())}</Chip>
        ) : null
      }
    >
      <p className="pv-muted pv-small">{props.method.hint}</p>
      {props.edit ? (
        <form
          className="v2-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (complete)
              void props.onSave(
                Object.fromEntries(props.method.inputs.map((i) => [i.key, Number(values[i.key])])),
              );
          }}
        >
          {props.method.inputs.map((i) => (
            <label key={i.key} className="v2-field">
              <span>{i.label}</span>
              <input
                className="v2-input"
                type="number"
                min={i.min}
                max={i.max}
                step={i.step}
                value={values[i.key] ?? ''}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [i.key]: e.target.value }));
                }}
              />
            </label>
          ))}
          <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm" disabled={!complete}>
            Save my score
          </button>
        </form>
      ) : null}
      {props.summary ? (
        <ScoreSpread s={props.summary} />
      ) : (
        <p className="pv-small pv-muted">Nobody scored with {props.method.label} yet.</p>
      )}
    </Card>
  );
}

function ScoreSpread(props: { s: ScoreSummary }): ReactNode {
  const s = props.s;
  return (
    <div className="v2-spread">
      <div className="pv-kv">
        <span>Mean of {s.count}</span>
        <span className="pv-num">{s.mean.toLocaleString(fmtLocale())}</span>
        <span>Range</span>
        <span className="pv-num">
          {s.min.toLocaleString(fmtLocale())} – {s.max.toLocaleString(fmtLocale())}
        </span>
        <span>Spread</span>
        <span>
          {s.count > 1 ? (
            <Chip tone={s.spread > 0.5 ? 'warning' : 'success'}>
              {s.spread > 0.5 ? 'people disagree' : 'close'}
            </Chip>
          ) : (
            '—'
          )}
        </span>
      </div>
      <ul className="v2-scorers">
        {s.scorers.map((x) => (
          <li key={x.name} className="pv-small">
            {x.name}: <strong className="pv-num">{x.score.toLocaleString(fmtLocale())}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Decision {
  id: string;
  code: string;
  title: string;
  context: string;
  decision: string;
  consequences: string;
  status: string;
  ideaId: string | null;
  decidedBy: string | null;
}
interface Term {
  id: string;
  term: string;
  definition: string;
}

function Decisions(props: {
  workspaceId: string;
  projectId: string;
  ideaId: string;
  edit: boolean;
  onError: (m: string) => void;
}): ReactNode {
  const P = W(props.workspaceId, '/projects/' + props.projectId);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [d, setD] = useState({ title: '', context: '', decision: '', consequences: '' });
  const [t, setT] = useState({ term: '', definition: '' });
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      api<Decision[]>('GET', P + '/decisions'),
      api<Term[]>('GET', P + '/glossary'),
    ]);
    if (a.ok) setDecisions(a.data);
    if (b.ok) setTerms(b.data);
  }, [P]);
  useEffect(() => {
    void load();
  }, [load]);
  const post = async (
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<boolean> => {
    const r = await api(method, path, body);
    if (!r.ok) props.onError(r.error.message);
    await load();
    return r.ok;
  };
  return (
    <div className="pv-split pv-split--even">
      <Card title="Decisions (ADR) of the project" flush>
        <ul className="pv-rows">
          {decisions.map((x) => (
            <li key={x.id} className="pv-row pv-row--static">
              <span className="pv-mono pv-muted">{x.code}</span>
              <span className="pv-row-main">
                <span className="pv-row-title pv-wrap">
                  {x.title}{' '}
                  {x.ideaId === props.ideaId ? <Chip tone="primary">this idea</Chip> : null}
                </span>
                {x.decision ? <span className="pv-row-sub pv-wrap">{x.decision}</span> : null}
              </span>
              {props.edit && x.status === 'proposed' ? (
                <Button
                  size="sm"
                  onClick={() =>
                    void post('PATCH', W(props.workspaceId, '/decisions/' + x.id), {
                      status: 'accepted',
                    })
                  }
                >
                  Accept
                </Button>
              ) : (
                <Chip
                  tone={
                    x.status === 'accepted'
                      ? 'success'
                      : x.status === 'superseded'
                        ? 'neutral'
                        : 'warning'
                  }
                >
                  {x.status}
                </Chip>
              )}
            </li>
          ))}
          {!decisions.length ? (
            <li className="pv-row pv-muted">No decisions recorded yet.</li>
          ) : null}
        </ul>
        {props.edit ? (
          <form
            className="v2-form v2-pad"
            onSubmit={(e) => {
              e.preventDefault();
              if (d.title.trim())
                void post('POST', P + '/decisions', {
                  ...d,
                  title: d.title.trim(),
                  ideaId: props.ideaId,
                }).then((ok) => {
                  if (ok) setD({ title: '', context: '', decision: '', consequences: '' });
                });
            }}
          >
            <input
              className="v2-input"
              aria-label="Decision title"
              placeholder="Decision, e.g. Use OpenStreetMap tiles"
              value={d.title}
              onChange={(e) => {
                setD({ ...d, title: e.target.value });
              }}
            />
            <textarea
              className="v2-input"
              rows={2}
              aria-label="Context"
              placeholder="Context: what forces are at play"
              value={d.context}
              onChange={(e) => {
                setD({ ...d, context: e.target.value });
              }}
            />
            <textarea
              className="v2-input"
              rows={2}
              aria-label="Decision"
              placeholder="What we decided"
              value={d.decision}
              onChange={(e) => {
                setD({ ...d, decision: e.target.value });
              }}
            />
            <textarea
              className="v2-input"
              rows={2}
              aria-label="Consequences"
              placeholder="Consequences"
              value={d.consequences}
              onChange={(e) => {
                setD({ ...d, consequences: e.target.value });
              }}
            />
            <button
              type="submit"
              className="pv-btn pv-btn--primary pv-btn--sm"
              disabled={!d.title.trim()}
            >
              Record
            </button>
          </form>
        ) : null}
      </Card>
      <Card title="Glossary" flush>
        <ul className="pv-rows">
          {terms.map((x) => (
            <li key={x.id} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">{x.term}</span>
                <span className="pv-row-sub pv-wrap">{x.definition}</span>
              </span>
              {props.edit ? (
                <button
                  type="button"
                  className="pv-mini-btn"
                  aria-label={'Remove ' + x.term}
                  onClick={() => void post('DELETE', W(props.workspaceId, '/glossary/' + x.id))}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
          {!terms.length ? (
            <li className="pv-row pv-muted">
              No terms yet; agents use these words as written here.
            </li>
          ) : null}
        </ul>
        {props.edit ? (
          <form
            className="v2-inline v2-pad"
            onSubmit={(e) => {
              e.preventDefault();
              if (t.term.trim() && t.definition.trim())
                void post('POST', P + '/glossary', {
                  term: t.term.trim(),
                  definition: t.definition.trim(),
                }).then((ok) => {
                  if (ok) setT({ term: '', definition: '' });
                });
            }}
          >
            <input
              className="v2-input"
              aria-label="Term"
              placeholder="Term"
              value={t.term}
              onChange={(e) => {
                setT({ ...t, term: e.target.value });
              }}
            />
            <input
              className="v2-input v2-grow"
              aria-label="Definition"
              placeholder="What it means here"
              value={t.definition}
              onChange={(e) => {
                setT({ ...t, definition: e.target.value });
              }}
            />
            <button
              type="submit"
              className="pv-btn pv-btn--primary pv-btn--sm"
              disabled={!t.term.trim() || !t.definition.trim()}
            >
              Add
            </button>
          </form>
        ) : null}
      </Card>
    </div>
  );
}
