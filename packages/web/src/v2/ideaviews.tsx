// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-276 | S15 | v0.1.0] T28.5 Idea estimates: size, confidence range from estimate vs actual, basis from similar past tasks ──
// ── [PCODE-274 | S15 | v0.1.0] T28.3 Stories with Given/When/Then and personas; value/effort matrix, evidence library, compare ──
//    Why:  the parts of Ideation that look across: stories grouped by the persona they are about, with
//          their Given/When/Then scenarios and a Gherkin copy; the project's personas; client requests
//          linked as evidence; the value/effort matrix of the open ideas; the evidence library with how
//          often each need was asked for; and two ideas side by side.
import { gherkin, storyText, type Scenario } from '@orqiva/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { PIcon } from '../preview/picons.js';
import { Button, Card, Chip } from '../preview/ui.js';
import type { IdeaSummary, IdeaWorkspace } from './ideation.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface PersonaJson {
  id: string;
  name: string;
  role: string;
  goals: string;
  pains: string;
  quote: string;
  sourceId: string | null;
  stories: number;
}
export interface LinkedRequest {
  id: string;
  ref: string;
  title: string;
  kind: string;
  state: string;
  clientName: string;
  createdAt: string;
}
export interface StoryReq {
  id: string;
  code: string;
  kind: string;
  text: string;
  status: string;
  personaId?: string | null;
  personaName?: string | null;
  scenarios?: Scenario[];
}

type Call = (m: 'POST' | 'PATCH' | 'DELETE', p: string, b?: unknown) => Promise<boolean>;

/** Stories by the persona they are about; stories without one last. */
export function storiesByPersona<T extends StoryReq>(
  reqs: readonly T[],
): { persona: string; stories: T[] }[] {
  const out = new Map<string, T[]>();
  for (const r of reqs) {
    if (r.kind !== 'story' || r.status === 'rejected') continue;
    const key = r.personaName ?? '';
    out.set(key, [...(out.get(key) ?? []), r]);
  }
  return [...out.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([persona, stories]) => ({ persona, stories }));
}

// ── stories ──
export function Stories(props: {
  ws: IdeaWorkspace & { personas?: PersonaJson[] };
  edit: boolean;
  call: Call;
}): ReactNode {
  const personas = props.ws.personas ?? [];
  const groups = storiesByPersona(props.ws.requirements as StoryReq[]);
  const [role, setRole] = useState('');
  const [want, setWant] = useState('');
  const [benefit, setBenefit] = useState('');
  const [copied, setCopied] = useState(false);
  const all = groups.flatMap((g) => g.stories);
  return (
    <div className="pv-stack">
      <div className="pv-toolbar">
        <span className="pv-muted pv-small">
          {all.length} {all.length === 1 ? 'story' : 'stories'},{' '}
          {all.reduce((n, s) => n + (s.scenarios?.length ?? 0), 0)} scenarios
        </span>
        <span className="pv-spacer" />
        {all.length ? (
          <Button
            size="sm"
            kind="ghost"
            title="The stories with their scenarios as a Gherkin feature, for test tools"
            onClick={() => {
              void navigator.clipboard
                .writeText(
                  gherkin(
                    props.ws.idea.title,
                    all.map((s) => ({ code: s.code, text: s.text, scenarios: s.scenarios ?? [] })),
                  ),
                )
                .then(() => {
                  setCopied(true);
                  setTimeout(() => {
                    setCopied(false);
                  }, 2000);
                });
            }}
          >
            {copied ? 'Copied' : 'Copy as Gherkin'}
          </Button>
        ) : null}
      </div>
      {groups.map((g) => (
        <Card key={g.persona || '-'} title={g.persona || 'No persona yet'}>
          <ul className="pv-ix-story-list">
            {g.stories.map((s) => (
              <StoryCard
                key={s.id}
                story={s}
                personas={personas}
                edit={props.edit}
                call={props.call}
              />
            ))}
          </ul>
        </Card>
      ))}
      {!groups.length ? (
        <p className="pv-muted v2-pad">
          No stories yet. The Analyst writes them from the sources and the interview, or add one
          here.
        </p>
      ) : null}
      {props.edit ? (
        <Card title="New story">
          <form
            className="v2-form v2-pad"
            onSubmit={(e) => {
              e.preventDefault();
              const persona = personas.find(
                (p) => p.name.toLowerCase() === role.trim().toLowerCase(),
              );
              void props
                .call('POST', '/ideas/' + props.ws.idea.id + '/requirements', {
                  text: storyText(role, want, benefit),
                  kind: 'story',
                  area: 'users',
                  ...(persona ? { personaId: persona.id } : {}),
                })
                .then((ok) => {
                  if (!ok) return;
                  setWant('');
                  setBenefit('');
                });
            }}
          >
            <label className="v2-field">
              <span>As a</span>
              <input
                className="v2-input"
                list="pv-persona-names"
                placeholder="dispatcher"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                }}
              />
              <datalist id="pv-persona-names">
                {personas.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
            </label>
            <label className="v2-field">
              <span>I want</span>
              <input
                className="v2-input"
                placeholder="to see who confirmed"
                value={want}
                onChange={(e) => {
                  setWant(e.target.value);
                }}
              />
            </label>
            <label className="v2-field">
              <span>So that</span>
              <input
                className="v2-input"
                placeholder="I call only the others (optional)"
                value={benefit}
                onChange={(e) => {
                  setBenefit(e.target.value);
                }}
              />
            </label>
            <button
              type="submit"
              className="pv-btn pv-btn--primary pv-btn--sm"
              disabled={!role.trim() || !want.trim()}
            >
              Add story
            </button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}

function StoryCard(props: {
  story: StoryReq;
  personas: PersonaJson[];
  edit: boolean;
  call: Call;
}): ReactNode {
  const s = props.story;
  const scenarios = s.scenarios ?? [];
  const [adding, setAdding] = useState(false);
  const [given, setGiven] = useState('');
  const [when, setWhen] = useState('');
  const [then, setThen] = useState('');
  const save = (next: Scenario[]) =>
    props.call('PATCH', '/requirements/' + s.id, { scenarios: next });
  return (
    <li className="pv-ix-story">
      <div className="pv-ix-story-head">
        <span className="pv-mono pv-muted">{s.code}</span>
        <span className="pv-ix-story-text">{s.text}</span>
        {s.status === 'proposed' ? <Chip tone="info">proposed</Chip> : null}
        {props.edit ? (
          <select
            className="pv-select pv-select--sm"
            aria-label={'Persona of ' + s.code}
            value={s.personaId ?? ''}
            onChange={(e) =>
              void props.call('PATCH', '/requirements/' + s.id, {
                personaId: e.target.value || null,
              })
            }
          >
            <option value="">No persona</option>
            {props.personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {scenarios.length ? (
        <ol className="pv-ix-scenarios">
          {scenarios.map((sc, i) => (
            <li key={i} className="pv-ix-scenario">
              {sc.given ? (
                <p>
                  <b>Given</b> {sc.given}
                </p>
              ) : null}
              {sc.when ? (
                <p>
                  <b>When</b> {sc.when}
                </p>
              ) : null}
              <p>
                <b>Then</b> {sc.then}
              </p>
              {props.edit ? (
                <button
                  type="button"
                  className="pv-mini-btn"
                  aria-label={'Remove scenario ' + String(i + 1) + ' of ' + s.code}
                  onClick={() => void save(scenarios.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="pv-small pv-muted">No scenario yet: how would you know it works?</p>
      )}
      {props.edit && !adding ? (
        <button
          type="button"
          className="pv-link-btn"
          onClick={() => {
            setAdding(true);
          }}
        >
          Add a scenario
        </button>
      ) : null}
      {props.edit && adding ? (
        <form
          className="pv-ix-scenario-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save([
              ...scenarios,
              { given: given.trim(), when: when.trim(), then: then.trim() },
            ]).then((ok) => {
              if (!ok) return;
              setGiven('');
              setWhen('');
              setThen('');
              setAdding(false);
            });
          }}
        >
          {(
            [
              ['Given', given, setGiven, 'ten bookings tomorrow'],
              ['When', when, setWhen, 'six customers confirm'],
              ['Then', then, setThen, 'the other four are listed to call'],
            ] as const
          ).map(([label, value, set, hint]) => (
            <label key={label} className="v2-field">
              <span>{label}</span>
              <input
                className="v2-input"
                placeholder={hint}
                value={value}
                onChange={(e) => {
                  set(e.target.value);
                }}
              />
            </label>
          ))}
          <div className="v2-inline">
            <button
              type="submit"
              className="pv-btn pv-btn--primary pv-btn--sm"
              disabled={!then.trim() || (!given.trim() && !when.trim())}
            >
              Add
            </button>
            <button
              type="button"
              className="pv-btn pv-btn--ghost pv-btn--sm"
              onClick={() => {
                setAdding(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

// ── personas ──
export function Personas(props: {
  projectId: string;
  ws: IdeaWorkspace & { personas?: PersonaJson[] };
  edit: boolean;
  call: Call;
}): ReactNode {
  const personas = props.ws.personas ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="pv-stack">
      <p className="pv-muted pv-small">
        Personas belong to the project: every idea of it and its stories speak of the same people.
      </p>
      <div className="pv-ix-persona-grid">
        {personas.map((p) =>
          editing === p.id ? (
            <PersonaForm
              key={p.id}
              persona={p}
              onSave={(v) =>
                props.call('PATCH', '/personas/' + p.id, v).then((ok) => {
                  if (ok) setEditing(null);
                  return ok;
                })
              }
              onCancel={() => {
                setEditing(null);
              }}
            />
          ) : (
            <Card
              key={p.id}
              title={
                <span className="pv-ix-persona-name">
                  <PIcon name="user" size={15} />
                  {p.name}
                </span>
              }
              action={
                props.edit ? (
                  <span className="v2-inline">
                    <button
                      type="button"
                      className="pv-link-btn"
                      onClick={() => {
                        setEditing(p.id);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="pv-mini-btn"
                      aria-label={'Remove ' + p.name}
                      title="Remove the persona; its stories stay without one"
                      onClick={() => void props.call('DELETE', '/personas/' + p.id)}
                    >
                      ×
                    </button>
                  </span>
                ) : undefined
              }
            >
              <div className="pv-kv pv-ix-kv v2-pad">
                <span>Role</span>
                <span>{p.role || '—'}</span>
                <span>Goals</span>
                <span>{p.goals || '—'}</span>
                <span>Pains</span>
                <span>{p.pains || '—'}</span>
                <span>Stories</span>
                <span>{p.stories}</span>
              </div>
              {p.quote ? <blockquote className="pv-ix-quote">“{p.quote}”</blockquote> : null}
            </Card>
          ),
        )}
        {props.edit ? (
          <PersonaForm
            onSave={(v) => props.call('POST', '/projects/' + props.projectId + '/personas', v)}
          />
        ) : null}
      </div>
    </div>
  );
}

function PersonaForm(props: {
  persona?: PersonaJson;
  onSave: (v: Record<string, string>) => Promise<boolean>;
  onCancel?: () => void;
}): ReactNode {
  const p = props.persona;
  const [v, setV] = useState({
    name: p?.name ?? '',
    role: p?.role ?? '',
    goals: p?.goals ?? '',
    pains: p?.pains ?? '',
    quote: p?.quote ?? '',
  });
  const field = (k: keyof typeof v, label: string, area = false) => (
    <label className="v2-field">
      <span>{label}</span>
      {area ? (
        <textarea
          className="v2-input"
          rows={2}
          value={v[k]}
          onChange={(e) => {
            setV({ ...v, [k]: e.target.value });
          }}
        />
      ) : (
        <input
          className="v2-input"
          value={v[k]}
          onChange={(e) => {
            setV({ ...v, [k]: e.target.value });
          }}
        />
      )}
    </label>
  );
  return (
    <Card title={p ? 'Edit ' + p.name : 'New persona'}>
      <form
        className="v2-form v2-pad"
        onSubmit={(e) => {
          e.preventDefault();
          void props.onSave(v).then((ok) => {
            if (ok && !p) setV({ name: '', role: '', goals: '', pains: '', quote: '' });
          });
        }}
      >
        {field('name', 'Name')}
        {field('role', 'Role')}
        {field('goals', 'Goals', true)}
        {field('pains', 'Pains', true)}
        {field('quote', 'In their words')}
        <div className="v2-inline">
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!v.name.trim()}
          >
            {p ? 'Save' : 'Add persona'}
          </button>
          {props.onCancel ? (
            <button
              type="button"
              className="pv-btn pv-btn--ghost pv-btn--sm"
              onClick={props.onCancel}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

// ── client requests as evidence ──
export function RequestLinks(props: {
  workspaceId: string;
  ws: IdeaWorkspace & { requests?: LinkedRequest[] };
  edit: boolean;
  call: Call;
}): ReactNode {
  const linked = props.ws.requests ?? [];
  const [cands, setCands] = useState<LinkedRequest[] | null>(null);
  const [pick, setPick] = useState('');
  const id = props.ws.idea.id;
  useEffect(() => {
    if (!props.edit) return;
    void api<LinkedRequest[]>(
      'GET',
      W(props.workspaceId, '/ideas/' + id + '/request-candidates'),
    ).then((r) => {
      setCands(r.ok ? r.data : []);
    });
  }, [props.workspaceId, id, props.edit, linked.length]);
  return (
    <Card flush title="Client requests">
      <ul className="pv-rows">
        {linked.map((r) => (
          <li key={r.id} className="pv-row pv-row--static">
            <span className="pv-mono pv-muted">{r.ref}</span>
            <span className="pv-row-main">
              <span className="pv-row-title">{r.title}</span>
              <span className="pv-row-sub">
                {r.clientName} · {r.kind} · {r.state}
              </span>
            </span>
            {props.edit ? (
              <button
                type="button"
                className="pv-mini-btn"
                aria-label={'Unlink ' + r.ref}
                onClick={() => void props.call('DELETE', '/ideas/' + id + '/requests/' + r.id)}
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
        {!linked.length ? (
          <li className="pv-muted v2-pad pv-small">
            No client request linked. A request that asks for this idea counts as evidence.
          </li>
        ) : null}
      </ul>
      {props.edit && cands?.length ? (
        <form
          className="v2-inline v2-pad"
          onSubmit={(e) => {
            e.preventDefault();
            if (pick)
              void props
                .call('POST', '/ideas/' + id + '/requests', { requestId: pick })
                .then(() => {
                  setPick('');
                });
          }}
        >
          <select
            className="pv-select v2-grow"
            aria-label="Client request"
            value={pick}
            onChange={(e) => {
              setPick(e.target.value);
            }}
          >
            <option value="">Link a client request…</option>
            {cands.map((r) => (
              <option key={r.id} value={r.id}>
                {r.ref} {r.title} ({r.clientName})
              </option>
            ))}
          </select>
          <button type="submit" className="pv-btn pv-btn--sm" disabled={!pick}>
            Link
          </button>
        </form>
      ) : null}
    </Card>
  );
}

// ── the value/effort matrix ──
export interface MatrixIdea {
  id: string;
  ref: string;
  title: string;
  status: string;
  value: number | null;
  effort: number | null;
  scorers: number;
  quadrant: string | null;
}

export const QUADRANT_LABEL: Record<string, string> = {
  quick_win: 'Quick wins',
  big_bet: 'Big bets',
  fill_in: 'Fill-ins',
  money_pit: 'Money pits',
};

/** Where a score sits in the drawing: effort 1–10 left to right, value 1–10 bottom to top. */
export const matrixPoint = (
  value: number,
  effort: number,
  size: number,
  pad: number,
): { x: number; y: number } => ({
  x: pad + ((effort - 1) / 9) * (size - 2 * pad),
  y: size - pad - ((value - 1) / 9) * (size - 2 * pad),
});

export function IdeaMatrix(props: {
  workspaceId: string;
  projectId: string;
  onOpen: (id: string) => void;
}): ReactNode {
  const [rows, setRows] = useState<MatrixIdea[] | null>(null);
  useEffect(() => {
    void api<MatrixIdea[]>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/idea-matrix'),
    ).then((r) => {
      setRows(r.ok ? r.data : []);
    });
  }, [props.workspaceId, props.projectId]);
  const S = 420;
  const P = 36;
  const placed = (rows ?? []).filter((r) => r.value !== null && r.effort !== null);
  const unscored = (rows ?? []).filter((r) => r.value === null || r.effort === null);
  const mid = matrixPoint(5.5, 5.5, S, P);
  return (
    <div className="pv-stack">
      <Card title="Value and effort">
        <div className="pv-ix-matrix-wrap">
          <svg
            className="pv-ix-matrix"
            viewBox={'0 0 ' + String(S) + ' ' + String(S)}
            role="img"
            aria-label="The open ideas by value and effort"
          >
            <rect
              x={P}
              y={P}
              width={mid.x - P}
              height={mid.y - P}
              className="pv-ix-matrix-q pv-ix-matrix-q--win"
            />
            <rect
              x={mid.x}
              y={P}
              width={S - P - mid.x}
              height={mid.y - P}
              className="pv-ix-matrix-q"
            />
            <rect
              x={P}
              y={mid.y}
              width={mid.x - P}
              height={S - P - mid.y}
              className="pv-ix-matrix-q"
            />
            <rect
              x={mid.x}
              y={mid.y}
              width={S - P - mid.x}
              height={S - P - mid.y}
              className="pv-ix-matrix-q pv-ix-matrix-q--pit"
            />
            <text x={P + 6} y={P + 16} className="pv-ix-matrix-label">
              {QUADRANT_LABEL['quick_win']}
            </text>
            <text x={S - P - 6} y={P + 16} className="pv-ix-matrix-label" textAnchor="end">
              {QUADRANT_LABEL['big_bet']}
            </text>
            <text x={P + 6} y={S - P - 8} className="pv-ix-matrix-label">
              {QUADRANT_LABEL['fill_in']}
            </text>
            <text x={S - P - 6} y={S - P - 8} className="pv-ix-matrix-label" textAnchor="end">
              {QUADRANT_LABEL['money_pit']}
            </text>
            <text x={S / 2} y={S - 8} className="pv-ix-matrix-axis" textAnchor="middle">
              Effort →
            </text>
            <text
              x={12}
              y={S / 2}
              className="pv-ix-matrix-axis"
              textAnchor="middle"
              transform={'rotate(-90 12 ' + String(S / 2) + ')'}
            >
              Value →
            </text>
            {placed.map((r) => {
              const p = matrixPoint(r.value ?? 1, r.effort ?? 1, S, P);
              return (
                <g
                  key={r.id}
                  className="pv-ix-matrix-dot"
                  tabIndex={0}
                  role="button"
                  aria-label={
                    r.ref +
                    ' ' +
                    r.title +
                    ': value ' +
                    String(r.value) +
                    ', effort ' +
                    String(r.effort)
                  }
                  onClick={() => {
                    props.onOpen(r.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') props.onOpen(r.id);
                  }}
                >
                  <circle cx={p.x} cy={p.y} r={6 + Math.min(r.scorers, 6)} />
                  <text x={p.x + 12} y={p.y + 4}>
                    {r.ref}
                  </text>
                  <title>
                    {r.ref +
                      ' ' +
                      r.title +
                      ' · value ' +
                      String(r.value) +
                      ' · effort ' +
                      String(r.effort)}
                  </title>
                </g>
              );
            })}
          </svg>
          <ul className="pv-rows pv-ix-matrix-list">
            {placed
              .slice()
              .sort((a, b) => (b.value ?? 0) / (b.effort ?? 1) - (a.value ?? 0) / (a.effort ?? 1))
              .map((r) => (
                <li key={r.id} className="pv-row">
                  <button
                    type="button"
                    className="pv-ix-row-btn"
                    onClick={() => {
                      props.onOpen(r.id);
                    }}
                  >
                    <span className="pv-mono pv-muted">{r.ref}</span>
                    <span className="pv-row-main">
                      <span className="pv-row-title">{r.title}</span>
                      <span className="pv-row-sub">
                        value {r.value} · effort {r.effort} · {r.scorers}{' '}
                        {r.scorers === 1 ? 'score' : 'scores'}
                      </span>
                    </span>
                    {r.quadrant ? (
                      <Chip
                        tone={
                          r.quadrant === 'quick_win'
                            ? 'success'
                            : r.quadrant === 'money_pit'
                              ? 'danger'
                              : 'neutral'
                        }
                      >
                        {QUADRANT_LABEL[r.quadrant]}
                      </Chip>
                    ) : null}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      </Card>
      {unscored.length ? (
        <p className="pv-small pv-muted">
          Not placed yet (no value/effort score): {unscored.map((r) => r.ref).join(', ')}. Score
          them under Priority.
        </p>
      ) : null}
      {rows && !rows.length ? <p className="pv-muted">No open ideas.</p> : null}
    </div>
  );
}

// ── the evidence library ──
interface Evidence {
  ideas: {
    id: string;
    ref: string;
    title: string;
    status: string;
    quotes: number;
    requests: number;
    voices: number;
  }[];
  quotes: {
    id: string;
    ideaId: string;
    ideaRef: string;
    text: string;
    saidBy: string;
    createdAt: string;
  }[];
  requests: (LinkedRequest & { ideaId: string; ideaRef: string })[];
}

export function EvidenceLibrary(props: {
  workspaceId: string;
  projectId: string;
  onOpen: (id: string) => void;
}): ReactNode {
  const [ev, setEv] = useState<Evidence | null>(null);
  const [only, setOnly] = useState<string | null>(null);
  useEffect(() => {
    void api<Evidence>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/evidence'),
    ).then((r) => {
      if (r.ok) setEv(r.data);
    });
  }, [props.workspaceId, props.projectId]);
  if (!ev)
    return (
      <p className="pv-muted" role="status">
        Loading…
      </p>
    );
  const quotes = ev.quotes.filter((q) => !only || q.ideaId === only);
  const requests = ev.requests.filter((r) => !only || r.ideaId === only);
  return (
    <div className="pv-stack">
      <Card flush title="How often each need was asked for">
        <table className="pv-table">
          <thead>
            <tr>
              <th>Idea</th>
              <th className="pv-num">Voices</th>
              <th className="pv-num">Quotes</th>
              <th className="pv-num">Client requests</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ev.ideas.map((i) => (
              <tr key={i.id} aria-selected={only === i.id}>
                <td>
                  <button
                    type="button"
                    className="pv-link-btn"
                    onClick={() => {
                      setOnly(only === i.id ? null : i.id);
                    }}
                  >
                    <span className="pv-mono pv-muted">{i.ref}</span> {i.title}
                  </button>
                </td>
                <td className="pv-num">{i.voices}</td>
                <td className="pv-num">{i.quotes}</td>
                <td className="pv-num">{i.requests}</td>
                <td>
                  <button
                    type="button"
                    className="pv-link-btn"
                    onClick={() => {
                      props.onOpen(i.id);
                    }}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
            {!ev.ideas.length ? (
              <tr>
                <td colSpan={5} className="pv-muted">
                  No evidence yet. Add customer quotes as sources, or link client requests to an
                  idea.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
      <div className="pv-split pv-split--even">
        <Card
          flush
          title={'Quotes' + (only ? ' of ' + (ev.ideas.find((i) => i.id === only)?.ref ?? '') : '')}
        >
          <ul className="pv-rows">
            {quotes.map((q) => (
              <li key={q.id} className="pv-row pv-row--static">
                <span className="pv-row-main">
                  <span className="pv-row-title">“{q.text}”</span>
                  <span className="pv-row-sub">
                    {q.saidBy || 'someone'} · {q.ideaRef}
                  </span>
                </span>
              </li>
            ))}
            {!quotes.length ? <li className="pv-muted v2-pad pv-small">No quotes.</li> : null}
          </ul>
        </Card>
        <Card flush title="Client requests">
          <ul className="pv-rows">
            {requests.map((r) => (
              <li key={r.id} className="pv-row pv-row--static">
                <span className="pv-mono pv-muted">{r.ref}</span>
                <span className="pv-row-main">
                  <span className="pv-row-title">{r.title}</span>
                  <span className="pv-row-sub">
                    {r.clientName} · {r.ideaRef}
                  </span>
                </span>
              </li>
            ))}
            {!requests.length ? (
              <li className="pv-muted v2-pad pv-small">No linked requests.</li>
            ) : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// ── two ideas side by side ──
type CompareWs = IdeaWorkspace & { personas?: PersonaJson[]; requests?: LinkedRequest[] };

/** The rows of a side-by-side compare: a label and what each idea has. */
export function compareRows(
  a: CompareWs,
  b: CompareWs,
): { label: string; left: string; right: string }[] {
  const mean = (w: CompareWs, m: string): string => {
    const s = w.scores.find((x) => x.method === m);
    return s ? String(s.mean) + ' (' + String(s.count) + ')' : '—';
  };
  const cov = (w: CompareWs): string => {
    const v = Object.values(w.coverage);
    return v.length ? String(Math.round(v.reduce((x, y) => x + y, 0) / v.length)) + ' %' : '—';
  };
  const kinds = (w: CompareWs): string => {
    const live = w.requirements.filter((r) => r.status !== 'rejected');
    const by = new Map<string, number>();
    for (const r of live) by.set(r.kind, (by.get(r.kind) ?? 0) + 1);
    return live.length
      ? String(live.length) +
          ' (' +
          [...by.entries()].map(([k, n]) => String(n) + ' ' + k.replace(/_/g, ' ')).join(', ') +
          ')'
      : '0';
  };
  const topRisk = (w: CompareWs): string => {
    const r = [...w.risks].sort((x, y) => y.exposure - x.exposure)[0];
    return r ? r.text + ' (' + String(r.exposure) + ')' : '—';
  };
  const evidence = (w: CompareWs): string => {
    const q = w.sources.filter((s) => s.kind === 'quote').length;
    const r = w.requests?.length ?? 0;
    return (
      String(q) +
      (q === 1 ? ' quote, ' : ' quotes, ') +
      String(r) +
      (r === 1 ? ' client request' : ' client requests')
    );
  };
  return [
    { label: 'Status', left: a.idea.status, right: b.idea.status },
    { label: 'Value/effort', left: mean(a, 'value_effort'), right: mean(b, 'value_effort') },
    { label: 'RICE', left: mean(a, 'rice'), right: mean(b, 'rice') },
    { label: 'Coverage', left: cov(a), right: cov(b) },
    { label: 'Requirements', left: kinds(a), right: kinds(b) },
    {
      label: 'Open questions',
      left: String(a.questions.filter((q) => q.status === 'open').length),
      right: String(b.questions.filter((q) => q.status === 'open').length),
    },
    { label: 'Top risk', left: topRisk(a), right: topRisk(b) },
    { label: 'Evidence', left: evidence(a), right: evidence(b) },
  ];
}

export function Compare(props: {
  workspaceId: string;
  left: CompareWs;
  ideas: IdeaSummary[];
  onClose: () => void;
}): ReactNode {
  const others = props.ideas.filter((i) => i.id !== props.left.idea.id);
  const [otherId, setOtherId] = useState(others[0]?.id ?? '');
  const [right, setRight] = useState<CompareWs | null>(null);
  // [PCODE-276 | S15 | v0.1.0] each idea's estimate, when it has a PRD
  const [sizes, setSizes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!otherId) return;
    void api<CompareWs>('GET', W(props.workspaceId, '/ideas/' + otherId + '/workspace')).then(
      (r) => {
        setRight(r.ok ? r.data : null);
      },
    );
  }, [props.workspaceId, otherId]);
  useEffect(() => {
    for (const id of [props.left.idea.id, otherId].filter(Boolean))
      void api<{ text: string }>('GET', W(props.workspaceId, '/ideas/' + id + '/estimate')).then(
        (r) => {
          setSizes((x) => ({ ...x, [id]: r.ok ? r.data.text : '—' }));
        },
      );
  }, [props.workspaceId, props.left.idea.id, otherId]);
  return (
    <Card
      title="Side by side"
      action={
        <button type="button" className="pv-link-btn" onClick={props.onClose}>
          Close
        </button>
      }
    >
      <div className="v2-inline v2-pad">
        <span className="pv-small pv-muted">Compare with</span>
        <select
          className="pv-select"
          aria-label="Compare with"
          value={otherId}
          onChange={(e) => {
            setOtherId(e.target.value);
          }}
        >
          {others.map((i) => (
            <option key={i.id} value={i.id}>
              {i.ref} {i.title}
            </option>
          ))}
        </select>
      </div>
      {right ? (
        <table className="pv-table pv-ix-compare">
          <thead>
            <tr>
              <th />
              <th>
                {props.left.idea.ref} {props.left.idea.title}
              </th>
              <th>
                {right.idea.ref} {right.idea.title}
              </th>
            </tr>
          </thead>
          <tbody>
            {[
              ...compareRows(props.left, right),
              {
                label: 'Estimate',
                left: sizes[props.left.idea.id] ?? '…',
                right: sizes[right.idea.id] ?? '…',
              },
            ].map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>{r.left}</td>
                <td>{r.right}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : others.length ? (
        <p className="pv-muted v2-pad" role="status">
          Loading…
        </p>
      ) : (
        <p className="pv-muted v2-pad">There is no other idea to compare with.</p>
      )}
    </Card>
  );
}
