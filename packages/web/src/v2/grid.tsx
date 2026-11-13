// ── [PCODE-266 | S15 | v0.1.0] Canvas fixes from the T27 browser walkthrough: drop jump-back, grid start width, Enter above a summary, picture menu closing ──
// ── [PCODE-261 | S15 | v0.1.0] T27.3 Canvas grid: fill down, paste from Excel, formulas and roll-ups, indent and outdent, typed predecessors ──
//    Why:  the Canvas grid as the spreadsheet a plan is often kept in: cells edited in place with values typed
//          any common way or as formulas, a column filled down, a block pasted from Excel (new rows become
//          tasks), predecessors typed like MS Project, tasks indented under the one above, and summary rows
//          that add up what is below them. Every change is a normal task or dependency change.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Card } from '../preview/ui.js';
import type { PlanData, Scheduled } from './canvas.js';
import {
  depChanges,
  depText,
  evalFormula,
  indentParent,
  outdentParent,
  parseDay,
  parseNumber,
  parsePredecessors,
  parseTsv,
  type RowValues,
  type TypedDep,
} from './gridrules.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d: string): string => {
  const x = new Date(d + 'T00:00:00Z');
  return String(x.getUTCDate()) + ' ' + (MONTHS[x.getUTCMonth()] ?? '');
};

export type Col = 'title' | 'start' | 'duration' | 'preds' | 'resource' | 'done';
export const COLS: Col[] = ['title', 'start', 'duration', 'preds', 'resource', 'done'];
const LABEL: Record<Col, string> = {
  title: 'Title of ',
  start: 'Start of ',
  duration: 'Duration of ',
  preds: 'Predecessors of ',
  resource: 'Resource of ',
  done: 'Percent done of ',
};

export interface GridChange {
  title?: string;
  startDate?: string | null;
  durationDays?: number | null;
  percentDone?: number | null;
  assigneeId?: string | null;
}
export interface DepEdit {
  successorId: string;
  add: TypedDep[];
  change: { id: string; kind: string; lagDays: number }[];
  remove: string[];
}

/** What the summary rows add up: estimate and work (working days of the leaves below). */
export function rollups(
  plan: Pick<PlanData, 'tasks' | 'schedule'>,
): Map<string, { estimate: number; work: number }> {
  const parent = new Map(plan.tasks.map((t) => [t.id, t.parentId]));
  const sched = new Map(plan.schedule.map((s) => [s.id, s]));
  const out = new Map<string, { estimate: number; work: number }>();
  for (const t of plan.tasks) {
    const s = sched.get(t.id);
    if (!s || s.summary) continue;
    const seen = new Set<string>();
    for (let p = parent.get(t.id) ?? null; p && !seen.has(p); p = parent.get(p) ?? null) {
      seen.add(p);
      const r = out.get(p) ?? { estimate: 0, work: 0 };
      r.estimate += t.estimate ?? 0;
      r.work += s.durationDays;
      out.set(p, r);
    }
  }
  return out;
}

export function GridV2(props: {
  plan: PlanData;
  canEdit: boolean;
  scenario: boolean;
  name: (id: string | null) => string;
  onEdit: (id: string, change: GridChange) => void;
  people?: { id: string; name: string }[];
  onDeps?: (e: DepEdit) => void;
  onCreate?: (rows: { title: string; startDate?: string; durationDays?: number }[]) => void;
  onParent?: (id: string, parentId: string | null) => void;
}): ReactNode {
  const { plan } = props;
  const task = useMemo(() => new Map(plan.tasks.map((t) => [t.id, t])), [plan.tasks]);
  const wbs = useMemo(() => new Map(plan.schedule.map((s) => [s.id, s.wbs])), [plan.schedule]);
  const byWbs = useMemo(() => new Map(plan.schedule.map((s) => [s.wbs, s])), [plan.schedule]);
  const sums = useMemo(() => rollups(plan), [plan]);
  const varOf = new Map((plan.baseline?.variance ?? []).map((v) => [v.itemId, v]));
  const rows = plan.schedule;
  const [active, setActive] = useState<{ row: string; col: Col; to: string } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const table = useRef<HTMLTableElement>(null);
  /** values already sent for a cell, so leaving it twice does not send them twice */
  const saved = useRef(new Set<string>());
  const key = (id: string, col: Col): string => id + ':' + col;
  // a saved value shows until the plan comes back with it
  useEffect(() => {
    setDrafts({});
    saved.current.clear();
  }, [plan]);

  const predsOf = (id: string): string =>
    plan.dependencies
      .filter((d) => d.successorId === id)
      .map((d) => depText(wbs.get(d.predecessorId) ?? '?', d.kind, d.lagDays))
      .join(', ');
  const shown = (s: Scheduled, col: Col): string => {
    const t = task.get(s.id);
    switch (col) {
      case 'title':
        return t?.title ?? '';
      case 'start':
        return t?.startDate ?? s.start;
      case 'duration':
        return String(s.durationDays);
      case 'preds':
        return predsOf(s.id);
      case 'resource':
        return t?.assigneeId ? props.name(t.assigneeId) : '';
      case 'done':
        return String(s.percentDone);
    }
  };
  const can = (s: Scheduled, col: Col): boolean => {
    if (!props.canEdit) return false;
    if (props.scenario && col !== 'start' && col !== 'duration') return false;
    if (s.summary) return col === 'title' && !props.scenario;
    if (s.milestone) return col !== 'duration' && col !== 'done';
    return true;
  };
  const rowValues = (w: string): RowValues | undefined => {
    const s = byWbs.get(w);
    if (!s) return undefined;
    return {
      start: s.start,
      finish: s.finish,
      duration: s.durationDays,
      done: s.percentDone,
      estimate: task.get(s.id)?.estimate ?? null,
    };
  };

  /** Saves a typed value; the answer is what is wrong with it, or null. */
  const commit = (id: string, col: Col, raw: string): string | null => {
    const s = rows.find((r) => r.id === id);
    if (!s || !can(s, col)) return 'this cell cannot be changed here';
    let v = raw.trim();
    if (v === shown(s, col)) return null;
    if (v.startsWith('=') && (col === 'start' || col === 'duration' || col === 'done')) {
      const r = evalFormula(v, {
        row: rowValues,
        field: col === 'start' ? 'start' : col === 'duration' ? 'duration' : 'done',
        workingDays: plan.workingDays,
      });
      if ('error' in r) return r.error;
      if (col === 'start') {
        if (typeof r.value === 'number') return 'a start is a date';
        v = r.value.date;
      } else {
        if (typeof r.value !== 'number') return 'this cell takes a number';
        v = String(Math.round(r.value));
      }
    }
    switch (col) {
      case 'title':
        if (!v || v.length > 500) return 'a title has 1 to 500 characters';
        props.onEdit(id, { title: v });
        return null;
      case 'start': {
        if (!v) {
          props.onEdit(id, { startDate: null });
          return null;
        }
        const d = parseDay(v);
        if (!d) return 'write a date as 2026-10-12 or 12.10.2026';
        props.onEdit(id, { startDate: d });
        return null;
      }
      case 'duration': {
        const n = parseNumber(v);
        if (n === null || n < 1 || n > 3650) return 'a duration is 1 to 3650 working days';
        props.onEdit(id, { durationDays: Math.round(n) });
        return null;
      }
      case 'done': {
        const n = parseNumber(v);
        if (n === null || n < 0 || n > 100) return '% done is 0 to 100';
        props.onEdit(id, { percentDone: Math.round(n) });
        return null;
      }
      case 'resource': {
        if (!v) {
          props.onEdit(id, { assigneeId: null });
          return null;
        }
        const low = v.toLowerCase();
        const who =
          (props.people ?? []).find((p) => p.name.toLowerCase() === low) ??
          (props.people ?? []).find((p) => p.name.toLowerCase().startsWith(low));
        if (!who) return 'nobody in the workspace is called ' + v;
        props.onEdit(id, { assigneeId: who.id });
        return null;
      }
      case 'preds': {
        const r = parsePredecessors(v, (w) => {
          const x = byWbs.get(w);
          return x && !x.summary ? x.id : undefined;
        });
        if ('error' in r) return r.error;
        if (r.deps.some((d) => d.predecessorId === id)) return 'a task cannot wait for itself';
        const now = plan.dependencies.filter((d) => d.successorId === id);
        props.onDeps?.({ successorId: id, ...depChanges(now, r.deps) });
        return null;
      }
    }
  };
  const save = (id: string, col: Col, raw: string): void => {
    const k = key(id, col);
    const problem = commit(id, col, raw);
    setErrors((e) =>
      problem
        ? { ...e, [k]: problem }
        : Object.fromEntries(Object.entries(e).filter(([x]) => x !== k)),
    );
    if (!problem) setDrafts((d) => ({ ...d, [k]: raw }));
  };

  const range = (): Scheduled[] => {
    if (!active) return [];
    const a = rows.findIndex((r) => r.id === active.row);
    const b = rows.findIndex((r) => r.id === active.to);
    return rows.slice(Math.min(a, b), Math.max(a, b) + 1);
  };
  const fillDown = (): void => {
    if (!active) return;
    const list = range();
    const first = list[0];
    if (!first || list.length < 2) {
      setNote('Select cells in one column first: click one, Shift-click another.');
      return;
    }
    const value = drafts[key(first.id, active.col)] ?? shown(first, active.col);
    let n = 0;
    for (const r of list.slice(1))
      if (can(r, active.col)) {
        save(r.id, active.col, value);
        n++;
      }
    setNote('Filled ' + String(n) + (n === 1 ? ' cell' : ' cells') + ' down.');
  };
  const move = (id: string, dir: 'in' | 'out'): void => {
    const shape = rows.map((r) => ({
      id: r.id,
      level: r.level,
      parentId: task.get(r.id)?.parentId ?? null,
    }));
    if (dir === 'in') {
      const p = indentParent(shape, id);
      if (p) props.onParent?.(id, p);
      else setNote('There is no task above on this level to go under.');
    } else {
      const p = outdentParent(shape, id);
      if (p !== undefined) props.onParent?.(id, p);
      else setNote('The task is already at the top level.');
    }
  };
  const paste = (id: string, col: Col, e: ClipboardEvent<HTMLInputElement>): void => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text.replace(/\n$/, ''))) return;
    e.preventDefault();
    const grid = parseTsv(text);
    const r0 = rows.findIndex((r) => r.id === id);
    const c0 = COLS.indexOf(col);
    let done = 0;
    const problems: string[] = [];
    const fresh: { title: string; startDate?: string; durationDays?: number }[] = [];
    grid.forEach((cells, dr) => {
      const target = rows[r0 + dr];
      if (!target) {
        // past the last row: a new task, when the block holds a title
        const at = (c: Col): string | undefined => {
          const j = COLS.indexOf(c) - c0;
          return j >= 0 ? cells[j]?.trim() : undefined;
        };
        const title = at('title');
        if (!title) return;
        const start = at('start') ? parseDay(at('start') ?? '') : null;
        const dur = at('duration') ? parseNumber(at('duration') ?? '') : null;
        fresh.push({
          title,
          ...(start ? { startDate: start } : {}),
          ...(dur && dur >= 1 ? { durationDays: Math.round(dur) } : {}),
        });
        return;
      }
      cells.forEach((cell, dc) => {
        const c = COLS[c0 + dc];
        if (!c || !can(target, c)) return;
        const p = commit(target.id, c, cell);
        if (p) problems.push((wbs.get(target.id) ?? '') + ' ' + c + ': ' + p);
        else done++;
      });
    });
    if (fresh.length) props.onCreate?.(fresh);
    setNote(
      'Pasted ' +
        String(done) +
        (done === 1 ? ' cell' : ' cells') +
        (fresh.length ? ', ' + String(fresh.length) + ' new tasks' : '') +
        (problems.length ? '. Not taken: ' + problems.slice(0, 3).join('; ') : '.'),
    );
  };
  /** Moves into a cell; false when that row has no cell to edit there. */
  const focusCell = (id: string | undefined, col: Col): boolean => {
    if (!id) return false;
    const input = table.current?.querySelector<HTMLInputElement>(
      'input[data-cell="' + key(id, col) + '"]',
    );
    input?.focus();
    return Boolean(input);
  };
  const keys = (s: Scheduled, col: Col, e: KeyboardEvent<HTMLInputElement>): void => {
    const i = rows.findIndex((r) => r.id === s.id);
    if (e.key === 'Enter') {
      // leaving the cell saves it
      e.preventDefault();
      // [PCODE-266 | S15 | v0.1.0] the next editable cell down, or out of the cell when there is none
      const below = rows.slice(i + 1).find((r) => can(r, col))?.id;
      if (!focusCell(below, col)) e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      // the value as it was, and no complaint about the one dropped
      const k = key(s.id, col);
      const drop = (m: Record<string, string>): Record<string, string> =>
        Object.fromEntries(Object.entries(m).filter(([x]) => x !== k));
      setDrafts(drop);
      setErrors(drop);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      fillDown();
    } else if (e.altKey && e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      move(s.id, e.key === 'ArrowRight' ? 'in' : 'out');
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusCell(rows[i + (e.key === 'ArrowDown' ? 1 : -1)]?.id, col);
    }
  };
  const inRange = new Set(range().map((r) => r.id));

  const cell = (s: Scheduled, col: Col, extra = ''): ReactNode => {
    const t = task.get(s.id);
    const k = key(s.id, col);
    if (!can(s, col))
      return col === 'start'
        ? shortDate(s.start)
        : col === 'duration'
          ? String(s.durationDays) + ' d'
          : col === 'done'
            ? String(s.percentDone) + ' %'
            : col === 'title'
              ? (t?.title ?? '')
              : shown(s, col);
    const err = errors[k];
    return (
      <input
        className={
          'pv-cell-input ' +
          extra +
          (err ? ' pv-cell-input--bad' : '') +
          (active?.col === col && inRange.has(s.id) ? ' pv-cell-input--sel' : '')
        }
        data-cell={k}
        aria-label={LABEL[col] + (t?.ref ?? '')}
        aria-invalid={err ? true : undefined}
        title={
          err ??
          (col === 'start' || col === 'duration' || col === 'done'
            ? 'A value or =formula'
            : undefined)
        }
        list={col === 'resource' ? 'pv-grid-people' : undefined}
        value={drafts[k] ?? shown(s, col)}
        onMouseDown={(e) => {
          if (e.shiftKey && active && active.col === col) {
            e.preventDefault();
            setActive({ ...active, to: s.id });
          }
        }}
        onFocus={() => {
          if (!(active?.col === col && inRange.has(s.id) && active.row !== active.to))
            setActive({ row: s.id, col, to: s.id });
        }}
        onChange={(e) => {
          setDrafts({ ...drafts, [k]: e.target.value });
        }}
        onBlur={(e) => {
          if (e.target.value !== shown(s, col) && !saved.current.has(k + '|' + e.target.value)) {
            saved.current.add(k + '|' + e.target.value);
            save(s.id, col, e.target.value);
          }
        }}
        onKeyDown={(e) => {
          keys(s, col, e);
        }}
        onPaste={(e) => {
          paste(s.id, col, e);
        }}
      />
    );
  };

  const activeRow = active ? rows.find((r) => r.id === active.row) : undefined;
  return (
    <Card flush>
      {props.scenario ? (
        <p className="v2-pad pv-small">
          Edits go into the scenario; the live plan stays as it is until you merge.
        </p>
      ) : null}
      {props.canEdit && !props.scenario ? (
        <div className="pv-grid-tools v2-inline">
          <button
            type="button"
            className="pv-btn pv-btn--sm"
            disabled={!activeRow || activeRow.summary}
            onClick={() => {
              if (activeRow) move(activeRow.id, 'out');
            }}
            title="Alt+Shift+Left"
          >
            ← Outdent
          </button>
          <button
            type="button"
            className="pv-btn pv-btn--sm"
            disabled={!activeRow}
            onClick={() => {
              if (activeRow) move(activeRow.id, 'in');
            }}
            title="Alt+Shift+Right"
          >
            Indent →
          </button>
          <button
            type="button"
            className="pv-btn pv-btn--sm"
            disabled={!active || active.row === active.to}
            onClick={fillDown}
            title="Ctrl+D"
          >
            Fill down
          </button>
          <span className="pv-small pv-muted" role="status">
            {note}
          </span>
        </div>
      ) : null}
      <datalist id="pv-grid-people">
        {(props.people ?? []).map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      <div className="pv-grid-scroll">
        <table className="pv-table pv-sheet" ref={table}>
          <thead>
            <tr>
              <th>WBS</th>
              <th>Task</th>
              <th>Start</th>
              <th>Finish</th>
              <th className="pv-num">Duration</th>
              <th>Predecessors</th>
              <th>Resource</th>
              <th className="pv-num">% done</th>
              <th className="pv-num">Estimate</th>
              <th className="pv-num">Work</th>
              <th className="pv-num">Variance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = task.get(r.id);
              const v = varOf.get(r.id);
              const sum = sums.get(r.id);
              return (
                <tr key={r.id} className={r.summary ? 'pv-sheet-summary' : ''}>
                  <td className="pv-mono pv-muted">{r.wbs}</td>
                  <td className={'pv-indent-' + String(Math.min(3, r.level))}>
                    <span className="pv-sheet-title">
                      <span className="pv-mono pv-muted">{t?.ref}</span> {cell(r, 'title')}
                    </span>
                  </td>
                  <td className="pv-num">{cell(r, 'start', 'pv-cell-input--date')}</td>
                  <td className="pv-num">{shortDate(r.finish)}</td>
                  <td className="pv-num">{cell(r, 'duration', 'pv-cell-input--num')}</td>
                  <td className="pv-mono">{cell(r, 'preds', 'pv-cell-input--preds')}</td>
                  <td>{cell(r, 'resource')}</td>
                  <td className="pv-num">{cell(r, 'done', 'pv-cell-input--num')}</td>
                  <td className="pv-num">
                    {r.summary
                      ? String(sum?.estimate ?? 0)
                      : t?.estimate !== null && t?.estimate !== undefined
                        ? String(t.estimate)
                        : '—'}
                  </td>
                  <td className="pv-num">
                    {String(r.summary ? (sum?.work ?? 0) : r.milestone ? 0 : r.durationDays) + ' d'}
                  </td>
                  <td
                    className={
                      'pv-num ' +
                      (v?.finishSlip && v.finishSlip > 0 ? 'pv-text-danger' : 'pv-muted')
                    }
                  >
                    {v?.finishSlip
                      ? (v.finishSlip > 0 ? '+' : '') + String(v.finishSlip) + ' d'
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="pv-muted pv-small pv-pad">
        Type a value or a formula (=[1.2].finish+2, =SUM([1.1].duration, [1.3].duration)) and press
        Enter. Shift-click to select down a column, Ctrl+D to fill down, paste a block from Excel;
        rows past the end become new tasks. Durations and lags are working days; predecessors are
        written like 1.2FS+2.
      </p>
    </Card>
  );
}
