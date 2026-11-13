// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-358 | S15 | v0.1.0] T35.6 Accessibility to WCAG 2.2 AA ──
// ── [PCODE-255 | S15 | v0.1.0] T26.4 Planning details: keys, bulk edit, undo, shared views, item history, Git moves, bug SLAs ──
//    Why:  the board and the backlog at keyboard speed: keys to move, open, assign and move on; a bar that
//          changes every selected task at once; a short window to undo; saved views shared with the team; the
//          time left to fix each bug.
import { describe, type ActivityEvent } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button } from '../preview/ui.js';
import type { LiveState, LiveSprint } from './planning.js';
import { useDialog } from './dialog.js'; // [PCODE-358 | S15 | v0.1.0]
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export const KEYS: [string, string][] = [
  ['j / k', 'next and previous task'],
  ['Enter', 'open the task'],
  ['e', 'open it to edit the title'],
  ['a', 'assign it to me'],
  ['m', 'move it to the next column'],
  ['x', 'select it for a bulk change'],
  ['c', 'new task (backlog)'],
  ['Ctrl+Z', 'undo the last change'],
  ['Esc', 'clear the selection, close the task'],
  ['?', 'show these keys'],
];

/** Whether a key press belongs to a field being typed in. */
export const typing = (e: KeyboardEvent): boolean => {
  const t = e.target as HTMLElement | null;
  return Boolean(t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)));
};

export function KeysHelp(props: { onClose: () => void }): ReactNode {
  const dialog = useDialog<HTMLDivElement>(props.onClose); // [PCODE-358 | S15 | v0.1.0]
  return (
    <div
      ref={dialog}
      className="pk-help"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard keys"
    >
      <div className="pk-help-card">
        <strong>Keys on the board and the backlog</strong>
        <table className="pv-table">
          <tbody>
            {KEYS.map(([k, what]) => (
              <tr key={k}>
                <td>
                  <kbd className="pk-kbd">{k}</kbd>
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button size="sm" onClick={props.onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

/** A short-lived note at the bottom with an Undo button. */
export function UndoToast(props: {
  text: string;
  canUndo: boolean;
  onUndo: () => void;
  onClose: () => void;
}): ReactNode {
  const { onClose } = props;
  useEffect(() => {
    const t = setTimeout(onClose, 10_000);
    return () => {
      clearTimeout(t);
    };
  }, [onClose, props.text]);
  return (
    <div className="pk-toast" role="status">
      <span>{props.text}</span>
      {props.canUndo ? (
        <button type="button" className="pv-link-btn" onClick={props.onUndo}>
          Undo
        </button>
      ) : null}
      <button type="button" className="pv-mini-btn" aria-label="Close" onClick={props.onClose}>
        ×
      </button>
    </div>
  );
}

export interface BulkResult {
  updated: number;
  deleted: number;
  before: { id: string; fields: Record<string, unknown> }[];
  refused: { ref: string; why: string }[];
}

/** The bar over the selected tasks: one change for all of them. */
export function BulkBar(props: {
  workspaceId: string;
  projectId: string;
  ids: string[];
  states: LiveState[];
  sprints: LiveSprint[];
  people: { id: string; name: string }[];
  onDone: (r: BulkResult, what: string) => void;
  onClear: () => void;
  onError: (m: string) => void;
}): ReactNode {
  const run = async (set: Record<string, unknown> | null, what: string): Promise<void> => {
    const r = await api<BulkResult>(
      'POST',
      W(props.workspaceId, '/projects/' + props.projectId + '/items/bulk'),
      set ? { itemIds: props.ids, set } : { itemIds: props.ids, delete: true },
    );
    if (!r.ok) props.onError(r.error.message);
    else props.onDone(r.data, what);
  };
  const pick = (
    label: string,
    options: { value: string; text: string }[],
    apply: (v: string) => void,
  ): ReactNode => (
    <select
      className="v2-input v2-input--sm"
      aria-label={label}
      value=""
      onChange={(e) => {
        if (e.target.value) apply(e.target.value);
      }}
    >
      <option value="">{label}…</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.text}
        </option>
      ))}
    </select>
  );
  return (
    <div className="pk-bulk" role="toolbar" aria-label="Change the selected tasks">
      <strong>{props.ids.length} selected</strong>
      {pick(
        'Move to',
        props.states.map((s) => ({ value: s.id, text: s.name })),
        (v) => void run({ stateId: v }, 'moved'),
      )}
      {pick(
        'Assign',
        [
          { value: 'none', text: 'Nobody' },
          ...props.people.map((p) => ({ value: p.id, text: p.name })),
        ],
        (v) => void run({ assigneeId: v === 'none' ? null : v }, 'assigned'),
      )}
      {pick(
        'Sprint',
        [
          { value: 'none', text: 'Backlog' },
          ...props.sprints
            .filter((s) => s.status !== 'completed')
            .map((s) => ({ value: s.id, text: s.name })),
        ],
        (v) => void run({ sprintId: v === 'none' ? null : v }, 'planned'),
      )}
      {pick(
        'Priority',
        ['urgent', 'high', 'medium', 'low', 'none'].map((p) => ({ value: p, text: p })),
        (v) => void run({ priority: v }, 'reprioritised'),
      )}
      <Button size="sm" kind="danger" onClick={() => void run(null, 'deleted')}>
        Delete
      </Button>
      <Button size="sm" kind="ghost" onClick={props.onClear}>
        Clear
      </Button>
    </div>
  );
}

interface View {
  id: string;
  name: string;
  query: { lanes?: string; quick?: string[] };
  shared: boolean;
  mine: boolean;
  owner: string;
}

/** The board's saved views: mine and the team's; apply one, save the current one. */
export function ViewsMenu(props: {
  workspaceId: string;
  projectId: string;
  current: { lanes: string; quick: string[] };
  onApply: (v: { lanes: string; quick: string[] }) => void;
}): ReactNode {
  const [views, setViews] = useState<View[]>([]);
  const [saving, setSaving] = useState<{ name: string; shared: boolean } | null>(null);
  const F = W(props.workspaceId, '/projects/' + props.projectId + '/filters');
  const load = useCallback(async () => {
    const r = await api<View[]>('GET', F + '?surface=board');
    if (r.ok) setViews(r.data);
  }, [F]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (): Promise<void> => {
    if (!saving?.name.trim()) return;
    await api('POST', F, {
      name: saving.name.trim(),
      surface: 'board',
      shared: saving.shared,
      query: { lanes: props.current.lanes, quick: props.current.quick },
    });
    setSaving(null);
    void load();
  };
  return (
    <span className="v2-inline">
      <select
        className="v2-input v2-input--sm"
        aria-label="Saved views"
        value=""
        onChange={(e) => {
          const v = views.find((x) => x.id === e.target.value);
          if (v) props.onApply({ lanes: v.query.lanes ?? 'none', quick: v.query.quick ?? [] });
        }}
      >
        <option value="">Views…</option>
        {views.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name + (v.mine ? (v.shared ? ' (shared)' : '') : ' · ' + v.owner)}
          </option>
        ))}
      </select>
      {saving ? (
        <>
          <input
            className="v2-input v2-input--sm"
            aria-label="View name"
            placeholder="Name"
            size={12}
            value={saving.name}
            onChange={(e) => {
              setSaving({ ...saving, name: e.target.value });
            }}
          />
          <label className="v2-switch">
            <input
              type="checkbox"
              checked={saving.shared}
              onChange={(e) => {
                setSaving({ ...saving, shared: e.target.checked });
              }}
            />
            <span>share</span>
          </label>
          <Button size="sm" kind="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          kind="ghost"
          onClick={() => {
            setSaving({ name: '', shared: false });
          }}
        >
          Save view
        </Button>
      )}
    </span>
  );
}

/** Open bugs' fix times by task, read again when `key` changes. */
export function useBugSlas(
  workspaceId: string,
  projectId: string,
  key: unknown,
): Map<string, string> {
  const [due, setDue] = useState(new Map<string, string>());
  useEffect(() => {
    const t = setTimeout(() => {
      void api<{ itemId: string; dueAt: string }[]>(
        'GET',
        W(workspaceId, '/projects/' + projectId + '/bug-slas'),
      ).then((r) => {
        if (r.ok) setDue(new Map(r.data.map((b) => [b.itemId, b.dueAt])));
      });
    }, 300);
    return () => {
      clearTimeout(t);
    };
  }, [workspaceId, projectId, key]);
  return due;
}

/** A task's whole history: every change, who made it and when, oldest first. */
export function ItemHistory(props: { workspaceId: string; itemId: string }): ReactNode {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    void api<ActivityEvent[]>(
      'GET',
      W(props.workspaceId, '/items/' + props.itemId + '/history'),
    ).then((r) => {
      if (r.ok) setEvents(r.data);
    });
  }, [open, props.workspaceId, props.itemId]);
  return (
    <section className="pe-card pk-history">
      <button
        type="button"
        className="pv-link-btn"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {open ? 'Hide the history' : 'History'}
      </button>
      {open && events ? (
        events.length ? (
          <ol className="pk-history-list">
            {events.map((e) => (
              <li key={e.id}>
                <span className="pv-muted pv-small">
                  {new Date(e.time).toLocaleString(fmtLocale(), {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>{' '}
                {describe(e)}
              </li>
            ))}
          </ol>
        ) : (
          <p className="pv-muted pv-small">Nothing happened yet.</p>
        )
      ) : null}
    </section>
  );
}

/** Where a branch, a pull request and a merge move the project's tasks. */
export function GitMovesForm(props: { workspaceId: string; projectId: string }): ReactNode {
  const [states, setStates] = useState<{ name: string }[]>([]);
  const [moves, setMoves] = useState({ branch: '', opened: '', merged: '' });
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void api<{ states: { name: string }[] }>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId),
    ).then((r) => {
      if (r.ok) setStates(r.data.states);
    });
    void api<{ key: string; value: unknown }[]>(
      'GET',
      W(props.workspaceId, '/settings?projectId=' + props.projectId),
    ).then((r) => {
      if (!r.ok) return;
      const v = r.data.find((x) => x.key === 'git.moves')?.value as
        Record<string, unknown> | undefined;
      setMoves({
        branch: typeof v?.['branch'] === 'string' ? v['branch'] : '',
        opened: typeof v?.['opened'] === 'string' ? v['opened'] : '',
        merged: typeof v?.['merged'] === 'string' ? v['merged'] : '',
      });
    });
  }, [props.workspaceId, props.projectId]);
  const save = async (): Promise<void> => {
    const r = await api('PUT', W(props.workspaceId, '/settings/git.moves'), {
      scope: 'project',
      scopeId: props.projectId,
      value: moves,
    });
    setMsg(r.ok ? 'Saved.' : r.error.message);
  };
  const pick = (key: 'branch' | 'opened' | 'merged', label: string): ReactNode => (
    <label className="pe-field">
      <span>{label}</span>
      <select
        className="pe-input"
        value={moves[key]}
        onChange={(e) => {
          setMoves({ ...moves, [key]: e.target.value });
        }}
      >
        <option value="">does not move it</option>
        {states.map((s) => (
          <option key={s.name} value={s.name}>
            moves it to {s.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="pk-git">
      <div className="pe-form-grid">
        {pick('branch', 'A branch or a commit')}
        {pick('opened', 'A pull request opens')}
        {pick('merged', 'A pull request is merged')}
      </div>
      <div className="pe-form-actions">
        <button type="button" className="pe-btn pe-btn--primary" onClick={() => void save()}>
          Save
        </button>
        {msg ? <span role="status">{msg}</span> : null}
      </div>
    </div>
  );
}
