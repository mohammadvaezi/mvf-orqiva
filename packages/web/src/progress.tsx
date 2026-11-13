// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-127 | S15 | v0.1.0] Show measured progress on every card from acceptance criteria and subtasks ──
//    Why:  the bar on every card and the checklist behind it. The project's progress is loaded once and
//          read again when any task changes (debounced, so a burst of events is one request); cards read it
//          from context, as they read the agent badge, so no view needs new props.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import type { EventHub } from './core/hub.js';
import { Icon } from './core/icons.js';

export interface Count {
  done: number;
  total: number;
}
export interface ItemProgress {
  itemId: string;
  criteria: Count;
  subtasks: Count;
}

const W = (workspaceId: string, path: string): string => '/api/workspaces/' + workspaceId + path;

/** Criteria and subtasks together, as on the server. */
export const sum = (p: Pick<ItemProgress, 'criteria' | 'subtasks'>): Count => ({
  done: p.criteria.done + p.subtasks.done,
  total: p.criteria.total + p.subtasks.total,
});

export const ProgressMap = createContext<ReadonlyMap<string, ItemProgress>>(new Map());

export function ProgressScope(props: {
  workspaceId: string;
  projectId: string;
  hub: EventHub;
  children: ReactNode;
}): ReactNode {
  const { workspaceId, projectId } = props;
  const [map, setMap] = useState<ReadonlyMap<string, ItemProgress>>(new Map());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async (): Promise<void> => {
      const r = await api<ItemProgress[]>(
        'GET',
        W(workspaceId, '/projects/' + projectId + '/progress'),
      );
      if (r.ok) setMap(new Map(r.data.map((p) => [p.itemId, p])));
    };
    void load();
    const off = props.hub.on((e) => {
      if (e.type !== 'orqiva.workspace.resync' && e.data.object.type !== 'item') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 250);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [workspaceId, projectId, props.hub]);
  return <ProgressMap.Provider value={map}>{props.children}</ProgressMap.Provider>;
}

/** A thin bar with "3 of 5"; nothing for a task with nothing to count. */
export function ProgressBar(props: Count & { label: string }): ReactNode {
  if (!props.total) return null;
  const share = props.done / props.total;
  return (
    <div
      className={'pe-card-progress' + (props.done === props.total ? ' pe-card-progress--done' : '')}
    >
      <svg
        width="100%"
        height="6"
        viewBox="0 0 100 6"
        preserveAspectRatio="none"
        role="img"
        aria-label={props.label}
      >
        <rect className="pe-progress-track" x="0" y="0" width="100" height="6" rx="3" />
        <rect
          className="pe-progress-fill"
          x="0"
          y="0"
          width={Math.max(share * 100, share ? 3 : 0)}
          height="6"
          rx="3"
        />
      </svg>
      <span className="pe-card-progress-text">
        {props.done} of {props.total}
      </span>
    </div>
  );
}

/** The bar for one card, from the project's progress. */
export function CardProgress(props: { itemId: string }): ReactNode {
  const p = useContext(ProgressMap).get(props.itemId);
  if (!p) return null;
  const c = sum(p);
  const parts = [
    p.criteria.total
      ? String(p.criteria.done) + ' of ' + String(p.criteria.total) + ' criteria'
      : '',
    p.subtasks.total
      ? String(p.subtasks.done) + ' of ' + String(p.subtasks.total) + ' subtasks'
      : '',
  ].filter(Boolean);
  return <ProgressBar {...c} label={'Progress: ' + parts.join(', ')} />;
}

// ── the checklist on a task ──

export interface Criterion {
  id: string;
  text: string;
  done: boolean;
  doneBy: string | null;
  doneAt: string | null;
}

export function CriteriaPanel(props: {
  workspaceId: string;
  itemId: string;
  canEdit: boolean;
  hub: EventHub;
}): ReactNode {
  const { workspaceId, itemId } = props;
  const [list, setList] = useState<Criterion[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<Criterion[]>('GET', W(workspaceId, '/items/' + itemId + '/criteria'));
    if (r.ok) setList(r.data);
  }, [workspaceId, itemId]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (
        e.type === 'orqiva.workspace.resync' ||
        (e.data.object.id === itemId && e.data.changes?.['criteria'])
      )
        void load();
    });
  }, [load, props.hub, itemId]);
  const call = async (
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<void> => {
    const r = await api<Criterion[]>(method, W(workspaceId, path), body);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    setList(r.data);
  };
  const done = list?.filter((c) => c.done).length ?? 0;
  return (
    <section aria-label="Acceptance criteria" className="pe-panel">
      <div className="pe-panel-head">
        <div>
          <h2 className="pe-panel-title">Acceptance criteria</h2>
          <p className="pe-panel-subtitle">
            What must be true for this to be done; ticks move the bar.
          </p>
        </div>
      </div>
      {list && list.length ? (
        <ProgressBar done={done} total={list.length} label="Criteria ticked" />
      ) : null}
      {!list ? (
        <p className="pe-muted" role="status">
          Loading…
        </p>
      ) : list.length === 0 ? (
        <p className="pe-muted">No criteria yet.</p>
      ) : (
        <ul className="pe-criteria">
          {list.map((c) => (
            <li key={c.id} className={c.done ? 'pe-criterion pe-criterion--done' : 'pe-criterion'}>
              <label>
                <input
                  type="checkbox"
                  checked={c.done}
                  disabled={!props.canEdit}
                  onChange={(e) => {
                    void call('PATCH', '/criteria/' + c.id, { done: e.target.checked });
                  }}
                />{' '}
                <span>{c.text}</span>
              </label>
              {c.done && c.doneBy ? <span className="pe-small pe-muted">{c.doneBy}</span> : null}
              {props.canEdit ? (
                <button
                  type="button"
                  className="pe-icon-btn pe-icon-btn--sm"
                  aria-label={'Remove ' + c.text}
                  onClick={() => {
                    void call('DELETE', '/criteria/' + c.id);
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {props.canEdit ? (
        <form
          className="pe-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            void call('POST', '/items/' + itemId + '/criteria', { text: text.trim() }).then(() => {
              setText('');
            });
          }}
        >
          <input
            className="pe-input"
            aria-label="New criterion"
            placeholder="e.g. The file opens in the spreadsheet with one header row"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          <button type="submit" className="pe-btn pe-btn--secondary" disabled={!text.trim()}>
            Add
          </button>
        </form>
      ) : null}
      {error ? (
        <div className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
    </section>
  );
}
