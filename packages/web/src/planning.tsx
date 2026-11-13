// ── [PCODE-436 | S15 | v0.1.0] T37 low: Untangle the three folder import cycles ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-99 | S15 | v0.1.0] Build sprints, backlog, board and list views ──
// ── [PCODE-101 | S15 | v0.1.0] Add presence: heartbeats, avatars on cards, who-is-where ──
// ── [PCODE-108 | S15 | v0.1.0] Integrate Git hosts: GitHub and Gitea webhooks, commits and PRs on items, live ──
// ── [PCODE-122 | S15 | v0.1.0] Show agents in the web app: agents page, ask from a task, live run view, approvals, card badge ──
// ── [PCODE-127 | S15 | v0.1.0] Show measured progress on every card from acceptance criteria and subtasks ──
// ── [PCODE-128 | S15 | v0.1.0] Add capacity, velocity and the sprint planning agent ──
//    Why:  planning screens. The board shows one column per state; the backlog shows the active sprint, the
//          planned sprints and the unplanned items. Cards and rows move by drag and drop, and every move has
//          a keyboard path too (the state or sprint select on the card or row), because a planning screen
//          that needs a mouse is not one everyone can use. Order is a rank between neighbours, so moving one
//          card changes one item, not the whole column.
import { CardProgress } from './progress.js';
import { AgentBadge } from './agents.js';
import { useState, type DragEvent, type ReactNode, type SyntheticEvent } from 'react';
import type { ProjectViewKind } from './core/nav.js';
import type { Item } from './sync/items.js';
import type { State } from './views.js';
import type { PresenceEntry } from '@orqiva/shared';
import { Avatars } from './presence.js';

export interface Sprint {
  id: string;
  name: string;
  goal: string;
  startDate: string | null;
  endDate: string | null;
  status: 'planned' | 'active' | 'completed';
  itemCount: number;
  doneCount: number;
  estimateTotal: number;
  estimateDone: number;
}

// [PCODE-436 | S15 | v0.1.0] the ranks live in core/ranking, kept here for the files that import them from here
export { byRank, rankBetween } from './core/ranking.js';
import { byRank, rankBetween } from './core/ranking.js';

const DRAG_TYPE = 'application/x-orqiva-item';

export function ProjectTabs(props: {
  projectId: string;
  view: ProjectViewKind;
  go: (path: string) => void;
}): ReactNode {
  const tabs: [ProjectViewKind, string, string][] = [
    ['list', 'List', ''],
    ['board', 'Board', '/board'],
    ['backlog', 'Backlog', '/backlog'],
    ['git', 'Repositories', '/git'], // [PCODE-108 | S15 | v0.1.0]
  ];
  return (
    <nav className="pe-tabs" aria-label="Views">
      {tabs.map(([kind, label, suffix]) => {
        const href = '/projects/' + props.projectId + suffix;
        return (
          <a
            key={kind}
            href={href}
            aria-current={props.view === kind ? 'page' : undefined}
            onClick={(e: SyntheticEvent) => {
              e.preventDefault();
              props.go(href);
            }}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}

function Card(props: {
  /** [PCODE-101 | S15 | v0.1.0] the others looking at this item */
  here?: PresenceEntry[];
  item: Item;
  states: State[];
  canEdit: boolean;
  pending: boolean;
  onState: (stateId: string) => void;
  go: (p: string) => void;
  extra?: ReactNode;
}): ReactNode {
  const { item } = props;
  const local = item.id.startsWith('local-');
  return (
    <article
      className={'pe-card-item' + (props.pending ? ' pe-pending' : '')}
      draggable={props.canEdit && !local}
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData(DRAG_TYPE, item.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      data-item-id={item.id}
    >
      <div className="pe-card-head">
        <span className="pe-mono pe-muted">{item.ref}</span>
        {item.estimate !== null ? <span className="pe-badge">{item.estimate}</span> : null}
        {props.extra}
        {/* [PCODE-122 | S15 | v0.1.0] an agent at work on it */}
        <AgentBadge itemId={item.id} />
        <Avatars people={props.here ?? []} />
      </div>
      {local ? (
        <div>{item.title}</div>
      ) : (
        <a
          href={'/items/' + item.id}
          onClick={(e: SyntheticEvent) => {
            e.preventDefault();
            props.go('/items/' + item.id);
          }}
        >
          {item.title}
        </a>
      )}
      {/* [PCODE-127 | S15 | v0.1.0] measured progress */}
      <CardProgress itemId={item.id} />
      {props.canEdit && !local ? (
        <select
          className="pe-select pe-card-select"
          aria-label={'State of ' + item.ref}
          value={item.stateId}
          onChange={(e) => {
            props.onState(e.target.value);
          }}
        >
          {props.states.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : null}
    </article>
  );
}

/** Where in a list a drop at clientY lands: the rank between the cards above and below it. */
function dropRank(e: DragEvent, list: Item[], draggedId: string): number {
  const cards = [
    ...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-item-id]'),
  ].filter((el) => el.dataset['itemId'] !== draggedId);
  const others = list.filter((i) => i.id !== draggedId);
  let index = others.length;
  for (const [i, el] of cards.entries()) {
    const box = el.getBoundingClientRect();
    if (e.clientY < box.top + box.height / 2) {
      index = i;
      break;
    }
  }
  return rankBetween(others[index - 1]?.rank, others[index]?.rank);
}

export function BoardView(props: {
  here?: (itemId: string) => PresenceEntry[];
  states: State[];
  items: Item[];
  canEdit: boolean;
  isPending: (id: string) => boolean;
  onMove: (itemId: string, fields: { stateId?: string; rank?: number }) => void;
  go: (path: string) => void;
}): ReactNode {
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="pe-board">
      {props.states.map((st) => {
        const column = props.items.filter((i) => i.stateId === st.id).sort(byRank);
        return (
          <section
            key={st.id}
            className={'pe-column' + (over === st.id ? ' pe-column--over' : '')}
            aria-label={st.name}
            onDragOver={(e) => {
              if (!props.canEdit || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
              e.preventDefault();
              setOver(st.id);
            }}
            onDragLeave={() => {
              setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData(DRAG_TYPE);
              const it = props.items.find((i) => i.id === id);
              if (!it) return;
              const rank = dropRank(e, column, id);
              props.onMove(id, it.stateId === st.id ? { rank } : { stateId: st.id, rank });
            }}
          >
            <h2 className="pe-column-head">
              <svg className="pe-dot" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <circle cx="5" cy="5" r="5" fill={st.color} />
              </svg>
              {st.name} <span className="pe-muted">{column.length}</span>
            </h2>
            {column.map((it) => (
              <Card
                key={it.id}
                here={props.here?.(it.id) ?? []}
                item={it}
                states={props.states}
                canEdit={props.canEdit}
                pending={props.isPending(it.id)}
                go={props.go}
                onState={(stateId) => {
                  props.onMove(it.id, { stateId });
                }}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

const sprintDates = (sp: Sprint): string =>
  sp.startDate || sp.endDate ? (sp.startDate ?? '…') + ' to ' + (sp.endDate ?? '…') : 'no dates';

export function BacklogView(props: {
  here?: (itemId: string) => PresenceEntry[];
  sprints: Sprint[];
  states: State[];
  items: Item[];
  canEdit: boolean;
  isPending: (id: string) => boolean;
  onMove: (
    itemId: string,
    fields: { sprintId?: string | null; rank?: number; stateId?: string },
  ) => void;
  onCreateSprint: (name: string) => Promise<string | null>;
  onStart: (sprintId: string) => Promise<string | null>;
  onComplete: (sprintId: string, moveTo: string | null) => Promise<string | null>;
  onDelete: (sprintId: string) => Promise<string | null>;
  /** [PCODE-128 | S15 | v0.1.0] opens capacity and the planning agent for a sprint */
  onPlan?: (sprintId: string) => void;
  go: (path: string) => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [completing, setCompleting] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const open = props.sprints.filter((s) => s.status !== 'completed');
  const planned = open.filter((s) => s.status === 'planned');
  const hasActive = open.some((s) => s.status === 'active');
  const run = (p: Promise<string | null>): void => {
    void p.then((err) => {
      setError(err ?? '');
    });
  };

  const section = (
    sprintId: string | null,
    title: ReactNode,
    actions: ReactNode,
    key: string,
  ): ReactNode => {
    const list = props.items.filter((i) => i.sprintId === sprintId).sort(byRank);
    return (
      <section
        key={key}
        className="pe-sprint"
        aria-label={sprintId ? 'Sprint' : 'Backlog'}
        onDragOver={(e) => {
          if (props.canEdit && e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData(DRAG_TYPE);
          const it = props.items.find((i) => i.id === id);
          if (!it) return;
          const rank = dropRank(e, list, id);
          props.onMove(id, it.sprintId === sprintId ? { rank } : { sprintId, rank });
        }}
      >
        <header className="pe-sprint-head">
          {title}
          <span className="pe-spacer" />
          {actions}
        </header>
        {list.length === 0 ? (
          <p className="pe-muted pe-sprint-empty">
            {sprintId ? 'Drag items here, or pick this sprint on an item.' : 'Nothing unplanned.'}
          </p>
        ) : null}
        {list.map((it) => (
          <Card
            key={it.id}
            here={props.here?.(it.id) ?? []}
            item={it}
            states={props.states}
            canEdit={props.canEdit}
            pending={props.isPending(it.id)}
            go={props.go}
            onState={(stateId) => {
              props.onMove(it.id, { stateId });
            }}
            extra={
              props.canEdit && !it.id.startsWith('local-') ? (
                <select
                  className="pe-select"
                  aria-label={'Sprint of ' + it.ref}
                  value={it.sprintId ?? ''}
                  onChange={(e) => {
                    props.onMove(it.id, {
                      sprintId: e.target.value || null,
                      rank: rankBetween(
                        props.items
                          .filter((i) => i.sprintId === (e.target.value || null))
                          .sort(byRank)
                          .at(-1)?.rank,
                        undefined,
                      ),
                    });
                  }}
                >
                  <option value="">Backlog</option>
                  {open.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : null
            }
          />
        ))}
      </section>
    );
  };

  return (
    <div className="pe-backlog">
      {error ? (
        <div className="pe-banner" role="alert">
          {error}
        </div>
      ) : null}
      {open.map((sp) =>
        section(
          sp.id,
          <div>
            <h2 className="pe-sprint-title">
              {sp.name}{' '}
              <span className="pe-badge">{sp.status === 'active' ? 'Active' : 'Planned'}</span>
            </h2>
            <div className="pe-muted">
              {sprintDates(sp)} · {sp.doneCount}/{sp.itemCount} done · {sp.estimateDone}/
              {sp.estimateTotal} points
              {sp.goal ? ' · ' + sp.goal : ''}
            </div>
          </div>,
          props.canEdit ? (
            <>
              {/* [PCODE-128 | S15 | v0.1.0] capacity and the Planner agent */}
              {props.onPlan ? (
                <button
                  className="pe-btn pe-btn--secondary"
                  type="button"
                  onClick={() => {
                    props.onPlan?.(sp.id);
                  }}
                >
                  Plan
                </button>
              ) : null}
              {sp.status === 'active' ? (
                completing === sp.id ? (
                  <form
                    className="pe-inline-form pe-inline-form--tight"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setCompleting(null);
                      run(props.onComplete(sp.id, moveTo || null));
                    }}
                  >
                    <label htmlFor={'move-' + sp.id}>Unfinished items go to</label>
                    <select
                      id={'move-' + sp.id}
                      className="pe-select"
                      value={moveTo}
                      onChange={(e) => {
                        setMoveTo(e.target.value);
                      }}
                    >
                      <option value="">Backlog</option>
                      {planned.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button className="pe-btn pe-btn--primary" type="submit">
                      Complete {sp.name}
                    </button>
                    <button
                      className="pe-btn pe-btn--secondary"
                      type="button"
                      onClick={() => {
                        setCompleting(null);
                      }}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    className="pe-btn pe-btn--secondary"
                    type="button"
                    onClick={() => {
                      setCompleting(sp.id);
                      setMoveTo(planned[0]?.id ?? '');
                    }}
                  >
                    Complete sprint
                  </button>
                )
              ) : (
                <>
                  <button
                    className="pe-btn pe-btn--primary"
                    type="button"
                    disabled={hasActive}
                    title={hasActive ? 'Complete the active sprint first' : undefined}
                    onClick={() => {
                      run(props.onStart(sp.id));
                    }}
                  >
                    Start sprint
                  </button>
                  <button
                    className="pe-btn pe-btn--secondary"
                    type="button"
                    onClick={() => {
                      run(props.onDelete(sp.id));
                    }}
                  >
                    Delete
                  </button>
                </>
              )}
            </>
          ) : null,
          sp.id,
        ),
      )}
      {section(null, <h2 className="pe-sprint-title">Backlog</h2>, null, 'backlog')}
      {props.canEdit ? (
        <form
          className="pe-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            run(
              props.onCreateSprint(name.trim()).then((err) => {
                if (!err) setName('');
                return err;
              }),
            );
          }}
        >
          <input
            className="pe-input"
            aria-label="New sprint name"
            placeholder={'Sprint ' + String(props.sprints.length + 1)}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <button className="pe-btn pe-btn--secondary" type="submit">
            Plan sprint
          </button>
        </form>
      ) : null}
    </div>
  );
}
