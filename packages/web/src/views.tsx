// ── [PCODE-436 | S15 | v0.1.0] T37 low: Untangle the three folder import cycles ──
// ── [PCODE-433 | S15 | v0.1.0] T37 low: Task descriptions show formatted text ──
// ── [PCODE-419 | S15 | v0.1.0] T37 medium: A filed bug shows as a bug and carries the failing step note ──
// ── [PCODE-418 | S15 | v0.1.0] T37 medium: The task page shows and changes the assignee ──
// ── [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox ──
// ── [PCODE-255 | S15 | v0.1.0] T26.4 Planning details: keys, bulk edit, undo, shared views, item history, Git moves, bug SLAs ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-97 | S15 | v0.1.0] Show projects, item lists and item detail live in the web app ──
// ── [PCODE-99 | S15 | v0.1.0] Build sprints, backlog, board and list views ──
// ── [PCODE-100 | S15 | v0.1.0] Add filters, search and the keyboard command bar ──
// ── [PCODE-101 | S15 | v0.1.0] Add presence: heartbeats, avatars on cards, who-is-where ──
// ── [PCODE-104 | S15 | v0.1.0] Move the fingerprint scanner and index into the server; every loop step emits an event ──
// ── [PCODE-108 | S15 | v0.1.0] Integrate Git hosts: GitHub and Gitea webhooks, commits and PRs on items, live ──
// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
// ── [PCODE-122 | S15 | v0.1.0] Show agents in the web app: agents page, ask from a task, live run view, approvals, card badge ──
// ── [PCODE-147 | S15 | v0.1.0] Show the traceability graph from idea to deploy ──
// ── [PCODE-146 | S15 | v0.1.0] Show compliance, evidence packs and reviews in the web app ──
// ── [PCODE-138 | S15 | v0.1.0] Show tests, coverage and live runs in the web app ──
// ── [PCODE-127 | S15 | v0.1.0] Show measured progress on every card from acceptance criteria and subtasks ──
//    Why:  the work screens as pure views: they draw what they are given and call back what the person
//          does. The workspace shell (workspace.tsx) feeds them from the item store and the live stream,
//          so a change made anywhere redraws them. Copy and states follow the design system: sentence-case
//          verbs, the state's colour only on its dot, its name always written next to it.
import { DescriptionImages } from './v2/descimages.js'; // [PCODE-320 | S15 | v0.1.0]
import { Markdown } from './v2/markdown.js'; // [PCODE-433 | S15 | v0.1.0]
import { CardProgress } from './progress.js';
import { AgentBadge } from './agents.js';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
import type { ProjectViewKind } from './core/nav.js';
import { ProjectHeader } from './project.js';
import type { Item } from './sync/items.js';
import type { PresenceEntry } from '@orqiva/shared';
import { Avatars, HereNow } from './presence.js';

// [PCODE-436 | S15 | v0.1.0] kept in core, still exported from here
export { localTime } from './core/format.js';
export type { Project } from './core/types.js';
import { localTime } from './core/format.js';
import type { Project } from './core/types.js';

export interface State {
  id: string;
  name: string;
  group: string;
  color: string;
}

// [PCODE-104 | S15 | v0.1.0] a marker `orq done` found in the code written for an item
export interface CodeMarker {
  path: string;
  line: number;
  kind: string;
  commit: string | null;
  sprint: string;
  version: string;
}

/** The item's markers grouped by file: "src/a.ts" -> [1, 40]. */
export function codeFiles(markers: CodeMarker[]): { path: string; lines: number[] }[] {
  const files = new Map<string, number[]>();
  for (const m of markers) files.set(m.path, [...(files.get(m.path) ?? []), m.line]);
  return [...files].map(([path, lines]) => ({ path, lines: lines.sort((a, b) => a - b) }));
}

export interface Comment {
  id: string;
  authorName: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

const link =
  (to: string, go: (path: string) => void) =>
  (e: SyntheticEvent): void => {
    e.preventDefault();
    go(to);
  };

export function StateSelect(props: {
  id: string;
  states: State[];
  value: string;
  disabled: boolean;
  onChange: (stateId: string) => void;
}): ReactNode {
  const current = props.states.find((s) => s.id === props.value);
  return (
    <span className="pe-state">
      {/* an SVG fill, not an inline style: the page's CSP allows no inline styles */}
      <svg className="pe-dot" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <circle cx="5" cy="5" r="5" fill={current?.color ?? 'transparent'} />
      </svg>
      <select
        id={props.id}
        className="pe-select"
        aria-label="State"
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => {
          props.onChange(e.target.value);
        }}
      >
        {current ? null : <option value={props.value}>…</option>}
        {props.states.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </span>
  );
}

export function ProjectView(props: {
  project: Project;
  states: State[];
  items: Item[];
  canEdit: boolean;
  isPending: (id: string) => boolean;
  onCreate: (title: string) => void;
  onState: (itemId: string, stateId: string) => void;
  go: (path: string) => void;
  /** [PCODE-99 | S15 | v0.1.0] which view; board and backlog arrive as children */
  view?: ProjectViewKind;
  sprintNames?: Record<string, string>;
  /** [PCODE-100 | S15 | v0.1.0] the filter bar, shown above every view */
  filterBar?: ReactNode;
  /** [PCODE-101 | S15 | v0.1.0] the others looking at an item */
  here?: (itemId: string) => PresenceEntry[];
  children?: ReactNode;
}): ReactNode {
  const [title, setTitle] = useState('');
  const view = props.view ?? 'list';
  return (
    // [PCODE-113 | S15 | v0.1.0] the project frame: header with tabs, then the toolbar and the view
    <div className={view === 'board' ? 'pe-page pe-page--wide' : 'pe-page'}>
      <ProjectHeader project={props.project} view={view} go={props.go} />
      <div className="pe-toolbar">{props.filterBar}</div>
      {props.canEdit ? (
        <form
          className="pe-inline-form pe-quick-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) props.onCreate(title.trim());
            setTitle('');
          }}
        >
          <input
            className="pe-input"
            aria-label="New item title"
            placeholder="What needs doing?"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
          <button className="pe-btn pe-btn--primary" type="submit">
            Add item
          </button>
        </form>
      ) : null}
      {view !== 'list' ? (
        props.children
      ) : props.items.length === 0 ? (
        <section className="pe-empty" aria-label="Items">
          <p className="pe-muted">No items yet.</p>
        </section>
      ) : (
        <div className="pe-panel pe-panel--flush">
          <table className="pe-table" aria-label="Items">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Title</th>
                <th scope="col">State</th>
                <th scope="col">Sprint</th>
                <th scope="col">Comments</th>
                <th scope="col">
                  <span className="pe-visually-hidden">Who is here</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {props.items.map((it) => (
                <tr key={it.id} className={props.isPending(it.id) ? 'pe-pending' : undefined}>
                  <td className="pe-mono">{it.ref}</td>
                  <td>
                    {it.id.startsWith('local-') ? (
                      it.title
                    ) : (
                      <a href={'/items/' + it.id} onClick={link('/items/' + it.id, props.go)}>
                        {it.title}
                      </a>
                    )}
                    {/* [PCODE-127 | S15 | v0.1.0] measured progress */}
                    <CardProgress itemId={it.id} />
                  </td>
                  <td>
                    <StateSelect
                      id={'state-' + it.id}
                      states={props.states}
                      value={it.stateId}
                      disabled={!props.canEdit || it.id.startsWith('local-')}
                      onChange={(s) => {
                        props.onState(it.id, s);
                      }}
                    />
                  </td>
                  <td className="pe-muted">
                    {it.sprintId ? (props.sprintNames?.[it.sprintId] ?? '…') : 'Backlog'}
                  </td>
                  <td className="pe-muted">{it.commentCount}</td>
                  <td>
                    {/* [PCODE-122 | S15 | v0.1.0] an agent at work on it */}
                    <AgentBadge itemId={it.id} />
                    <Avatars people={props.here?.(it.id) ?? []} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// [PCODE-419 | S15 | v0.1.0]
const KIND_LABELS: Record<string, string> = {
  bug: 'Bug',
  story: 'Story',
  epic: 'Epic',
  spike: 'Spike',
  initiative: 'Initiative',
  milestone: 'Milestone',
};
const kindLabel = (kind: string): string =>
  KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);

export function ItemView(props: {
  /** [PCODE-101 | S15 | v0.1.0] the others on this item, and editing reported while a field has focus */
  here?: PresenceEntry[];
  onEditing?: (editing: boolean) => void;
  project: Project;
  item: Item;
  states: State[];
  comments: Comment[];
  /** [PCODE-104 | S15 | v0.1.0] the code written for it, as of its last done */
  code?: CodeMarker[];
  /** [PCODE-108 | S15 | v0.1.0] its commits and pull requests, drawn by the caller */
  git?: ReactNode;
  /** [PCODE-122 | S15 | v0.1.0] its agent runs and the Ask an agent button, drawn by the caller */
  agents?: ReactNode;
  /** [PCODE-127 | S15 | v0.1.0] its acceptance criteria, drawn by the caller */
  criteria?: ReactNode;
  /** [PCODE-138 | S15 | v0.1.0] its test cases and their results, drawn by the caller */
  tests?: ReactNode;
  /** [PCODE-146 | S15 | v0.1.0] its review stage, drawn by the caller */
  review?: ReactNode;
  /** [PCODE-147 | S15 | v0.1.0] its trace from idea to deploy */
  trace?: ReactNode;
  /** [PCODE-255 | S15 | v0.1.0] every change it went through */
  history?: ReactNode;
  /** [PCODE-113 | S15 | v0.1.0] the sprint's name, for the details panel */
  sprintName?: string | null;
  canEdit: boolean;
  pending: boolean;
  /** [PCODE-418 | S15 | v0.1.0] the people a task can be given to */
  people?: { id: string; name: string }[];
  onChange: (
    fields: Partial<Pick<Item, 'title' | 'description' | 'stateId' | 'estimate' | 'assigneeId'>>,
  ) => void;
  onComment: (body: string) => Promise<string | null>;
  go: (path: string) => void;
}): ReactNode {
  const { item } = props;
  const [writing, setWriting] = useState(false); // [PCODE-433 | S15 | v0.1.0]
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  // [PCODE-113 | S15 | v0.1.0] two columns: the work on the left, its details in a side panel
  return (
    <div className="pe-page">
      <nav className="pe-crumbs" aria-label="Breadcrumb">
        <a href="/projects" onClick={link('/projects', props.go)}>
          Projects
        </a>
        <span aria-hidden="true"> / </span>
        <a
          href={'/projects/' + props.project.id}
          onClick={link('/projects/' + props.project.id, props.go)}
        >
          {props.project.name}
        </a>
        <span aria-hidden="true"> / </span>
        <span className="pe-mono">{item.ref}</span>
        {/* [PCODE-419 | S15 | v0.1.0] a bug, a story, an epic … says so */}
        {item.kind && item.kind !== 'task' ? (
          <span className={'pe-kind-chip pe-kind-chip--' + item.kind}>{kindLabel(item.kind)}</span>
        ) : null}
        {props.pending ? <span className="pe-muted"> · saving</span> : null}
      </nav>
      <div className="pe-item-layout">
        <div className="pe-item-main">
          <div className="pe-field pe-field--title">
            <label htmlFor="item-title" className="pe-visually-hidden">
              Title
            </label>
            {/* [PCODE-113 | S15 | v0.1.0] a long title wraps; Enter saves it like leaving the field */}
            <textarea
              id="item-title"
              rows={1}
              onFocus={() => {
                props.onEditing?.(true);
              }}
              className="pe-input pe-input--title"
              key={'title-' + item.title}
              defaultValue={item.title}
              disabled={!props.canEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) => {
                props.onEditing?.(false);
                const v = e.target.value.replace(/\s+/g, ' ').trim();
                if (v && v !== item.title) props.onChange({ title: v });
              }}
            />
          </div>
          <section className="pe-panel" aria-label="Description">
            <div className="pe-panel-head">
              <h2 className="pe-panel-title">
                <label htmlFor="item-description">Description</label>
              </h2>
              {/* [PCODE-433 | S15 | v0.1.0] read as formatted text; written as Markdown */}
              {props.canEdit && !writing && item.description ? (
                <button
                  type="button"
                  className="pe-btn pe-btn--text pe-btn--small"
                  onClick={() => {
                    setWriting(true);
                  }}
                >
                  Edit
                </button>
              ) : null}
            </div>
            {writing || (props.canEdit && !item.description) ? (
              <textarea
                id="item-description"
                autoFocus={writing}
                onFocus={() => {
                  props.onEditing?.(true);
                }}
                className="pe-input pe-textarea pe-textarea--doc"
                placeholder="What, why, and how to check it"
                key={'description-' + item.description}
                defaultValue={item.description}
                disabled={!props.canEdit}
                onBlur={(e) => {
                  props.onEditing?.(false);
                  setWriting(false);
                  if (e.target.value !== item.description)
                    props.onChange({ description: e.target.value });
                }}
              />
            ) : item.description ? (
              <div id="item-description" className="pe-item-description">
                <Markdown text={item.description} />
              </div>
            ) : (
              <p className="pe-muted">No description.</p>
            )}
            {/* [PCODE-320 | S15 | v0.1.0] a captured bug's screenshot, shown */}
            <DescriptionImages text={item.description} />
          </section>
          {props.criteria}
          {props.tests}
          {props.review}
          {props.trace}
          {props.history}
          {/* [PCODE-104 | S15 | v0.1.0] the code written for the item, from its fingerprints */}
          {props.code?.length ? (
            <section aria-label="Code" className="pe-panel">
              <div className="pe-panel-head">
                <div>
                  <h2 className="pe-panel-title">Code</h2>
                  <p className="pe-panel-subtitle">
                    {props.code[0]?.commit
                      ? 'Commit ' + props.code[0].commit.slice(0, 9) + ' · '
                      : ''}
                    {props.code[0]?.sprint} · v{props.code[0]?.version}
                  </p>
                </div>
              </div>
              <ul className="pe-code-list">
                {codeFiles(props.code).map((f) => (
                  <li key={f.path}>
                    <span className="pe-mono">{f.path}</span>{' '}
                    <span className="pe-muted">line {f.lines.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {props.git}
          {props.agents}
          <section aria-label="Comments" className="pe-panel pe-comments">
            <div className="pe-panel-head">
              <h2 className="pe-panel-title">Comments</h2>
            </div>
            {props.comments.length === 0 ? <p className="pe-muted">No comments yet.</p> : null}
            <ol className="pe-comment-list">
              {props.comments.map((c) => (
                <li key={c.id}>
                  <div className="pe-comment-meta">
                    <strong>{c.authorName ?? 'Someone who left'}</strong>{' '}
                    <span className="pe-muted">
                      {localTime(c.createdAt)}
                      {c.editedAt ? ' · edited' : ''}
                    </span>
                  </div>
                  <div className="pe-comment-body">{c.body}</div>
                </li>
              ))}
            </ol>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!comment.trim()) return;
                void props.onComment(comment.trim()).then((err) => {
                  setError(err ?? '');
                  if (!err) setComment('');
                });
              }}
            >
              <label htmlFor="new-comment" className="pe-visually-hidden">
                Comment
              </label>
              <textarea
                id="new-comment"
                className="pe-input pe-textarea"
                placeholder="Write a comment"
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                }}
              />
              {error ? (
                <div className="pe-field-error" role="alert">
                  {error}
                </div>
              ) : null}
              <button className="pe-btn pe-btn--primary" type="submit">
                Comment
              </button>
            </form>
          </section>
        </div>
        <aside className="pe-item-side" aria-label="Details">
          <section className="pe-panel">
            <div className="pe-panel-head">
              <h2 className="pe-panel-title">Details</h2>
            </div>
            <dl className="pe-props">
              <dt>
                <label htmlFor="item-state">State</label>
              </dt>
              <dd>
                <StateSelect
                  id="item-state"
                  states={props.states}
                  value={item.stateId}
                  disabled={!props.canEdit}
                  onChange={(s) => {
                    props.onChange({ stateId: s });
                  }}
                />
              </dd>
              {/* [PCODE-418 | S15 | v0.1.0] who it is assigned to, and giving it to someone */}
              <dt>
                <label htmlFor="item-assignee">Assignee</label>
              </dt>
              <dd>
                <select
                  id="item-assignee"
                  className="pe-select"
                  value={item.assigneeId ?? ''}
                  disabled={!props.canEdit}
                  onChange={(e) => {
                    props.onChange({ assigneeId: e.target.value || null });
                  }}
                >
                  <option value="">Unassigned</option>
                  {item.assigneeId && !props.people?.some((p) => p.id === item.assigneeId) ? (
                    <option value={item.assigneeId}>Someone not in the list</option>
                  ) : null}
                  {(props.people ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </dd>
              <dt>
                <label htmlFor="item-estimate">Estimate</label>
              </dt>
              <dd>
                <input
                  id="item-estimate"
                  className="pe-input pe-input--small"
                  type="number"
                  min={0}
                  max={1000}
                  key={'estimate-' + String(item.estimate)}
                  defaultValue={item.estimate ?? ''}
                  disabled={!props.canEdit}
                  onBlur={(e) => {
                    const v = e.target.value === '' ? null : Number(e.target.value);
                    if (
                      v !== item.estimate &&
                      (v === null || (Number.isInteger(v) && v >= 0 && v <= 1000))
                    )
                      props.onChange({ estimate: v });
                  }}
                />
              </dd>
              <dt>Sprint</dt>
              <dd>{props.sprintName ?? 'Backlog'}</dd>
              <dt>Reference</dt>
              <dd className="pe-mono">{item.ref}</dd>
              <dt>Comments</dt>
              <dd>{props.comments.length}</dd>
            </dl>
          </section>
          <section className="pe-panel" aria-label="Here now">
            <div className="pe-panel-head">
              <h2 className="pe-panel-title">Here now</h2>
            </div>
            {(props.here ?? []).length ? (
              <HereNow people={props.here ?? []} />
            ) : (
              <p className="pe-muted pe-small">Only you are looking at this task.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
