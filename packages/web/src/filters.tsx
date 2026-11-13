// ── [PCODE-434 | S15 | v0.1.0] T37 low: Board WIP limits and custom-field filters in the screen ──
// ── [PCODE-100 | S15 | v0.1.0] Add filters, search and the keyboard command bar ──
//    Why:  a project's view narrowed by text, state, assignee, label and sprint. The filter lives in the
//          address (?q=…&state=…), so a filtered view can be bookmarked, shared and gone back to. Everything
//          but text is applied to the item store at once; text goes to the server's full-text search, which
//          returns the matching item ids. Saved filters keep a person's favourite views.
import { useState, type ReactNode } from 'react';
import type { Item } from './sync/items.js';
import type { State } from './views.js';

export interface ItemFilter {
  q?: string;
  stateId?: string;
  /** a user id, "me" or "none" */
  assigneeId?: string;
  labelId?: string;
  /** a sprint id or "backlog" */
  sprintId?: string;
  /** [PCODE-434 | S15 | v0.1.0] a custom field's value, "key:value" */
  field?: string;
}

const KEYS: [keyof ItemFilter, string][] = [
  ['q', 'q'],
  ['stateId', 'state'],
  ['assigneeId', 'assignee'],
  ['labelId', 'label'],
  ['sprintId', 'sprint'],
  ['field', 'field'], // [PCODE-434 | S15 | v0.1.0]
];

export function filterFromSearch(search: string): ItemFilter {
  const params = new URLSearchParams(search);
  const f: ItemFilter = {};
  for (const [key, param] of KEYS) {
    const v = params.get(param);
    if (v) f[key] = v;
  }
  return f;
}

export function searchFromFilter(f: ItemFilter): string {
  const params = new URLSearchParams();
  for (const [key, param] of KEYS) {
    const v = f[key];
    if (v) params.set(param, v);
  }
  return params.toString();
}

export const isEmptyFilter = (f: ItemFilter): boolean => KEYS.every(([k]) => !f[k]);

/** The items that pass every part of the filter; `textHits` are the ids the server found for f.q. */
export function applyFilter(
  items: Item[],
  f: ItemFilter,
  myId: string,
  textHits: ReadonlySet<string> | null,
): Item[] {
  return items.filter((it) => {
    if (f.stateId && it.stateId !== f.stateId) return false;
    if (
      f.assigneeId === 'none'
        ? it.assigneeId !== null
        : f.assigneeId && it.assigneeId !== (f.assigneeId === 'me' ? myId : f.assigneeId)
    )
      return false;
    if (f.labelId && !it.labelIds.includes(f.labelId)) return false;
    if (f.sprintId === 'backlog' ? it.sprintId !== null : f.sprintId && it.sprintId !== f.sprintId)
      return false;
    // [PCODE-434 | S15 | v0.1.0] a custom field's value
    if (f.field) {
      const at = f.field.indexOf(':');
      const key = f.field.slice(0, at);
      const value = (it.custom ?? {})[key];
      if (
        at < 1 ||
        (typeof value === 'string' ? value : JSON.stringify(value ?? '')) !== f.field.slice(at + 1)
      )
        return false;
    }
    // text: the server's hits; items made here and not yet saved match by their title
    if (
      f.q &&
      textHits &&
      !textHits.has(it.id) &&
      !(it.id.startsWith('local-') && it.title.toLowerCase().includes(f.q.toLowerCase()))
    )
      return false;
    return true;
  });
}

export interface SavedFilter {
  id: string;
  name: string;
  query: ItemFilter;
}

export function FilterBar(props: {
  filter: ItemFilter;
  states: State[];
  people: { id: string; name: string }[];
  labels: { id: string; name: string }[];
  sprints: { id: string; name: string }[];
  /** [PCODE-434 | S15 | v0.1.0] the project's fields with a fixed list of values */
  fields?: { key: string; label: string; options: string[] }[];
  saved: SavedFilter[];
  shown: number;
  total: number;
  onChange: (f: ItemFilter) => void;
  onSave: (name: string) => Promise<string | null>;
}): ReactNode {
  const { filter, onChange } = props;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const set = (key: keyof ItemFilter, value: string): void => {
    // an empty value removes that part of the filter
    const next = Object.fromEntries(
      Object.entries({ ...filter, [key]: value }).filter(([, v]) => v),
    ) as ItemFilter;
    onChange(next);
  };
  const select = (
    key: keyof ItemFilter,
    label: string,
    options: [string, string][],
    allLabel: string,
  ): ReactNode => (
    <select
      className="pe-select"
      aria-label={label}
      value={filter[key] ?? ''}
      onChange={(e) => {
        set(key, e.target.value);
      }}
    >
      <option value="">{allLabel}</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
  return (
    <div className="pe-filters" role="search">
      <input
        className="pe-input pe-filter-text"
        type="search"
        aria-label="Search items"
        placeholder="Search items"
        value={filter.q ?? ''}
        onChange={(e) => {
          set('q', e.target.value);
        }}
      />
      {select(
        'stateId',
        'Filter by state',
        props.states.map((s) => [s.id, s.name]),
        'Any state',
      )}
      {select(
        'assigneeId',
        'Filter by assignee',
        [
          ['me', 'Assigned to me'],
          ['none', 'Unassigned'],
          ...props.people.map((p): [string, string] => [p.id, p.name]),
        ],
        'Anyone',
      )}
      {props.labels.length
        ? select(
            'labelId',
            'Filter by label',
            props.labels.map((l) => [l.id, l.name]),
            'Any label',
          )
        : null}
      {select(
        'sprintId',
        'Filter by sprint',
        [['backlog', 'Backlog'], ...props.sprints.map((s): [string, string] => [s.id, s.name])],
        'Any sprint',
      )}
      {/* [PCODE-434 | S15 | v0.1.0] */}
      {props.fields?.some((x) => x.options.length)
        ? select(
            'field',
            'Filter by field',
            props.fields.flatMap((x) =>
              x.options.map((o): [string, string] => [x.key + ':' + o, x.label + ': ' + o]),
            ),
            'Any field',
          )
        : null}
      {props.saved.length ? (
        <select
          className="pe-select"
          aria-label="Saved filters"
          value=""
          onChange={(e) => {
            const f = props.saved.find((x) => x.id === e.target.value);
            if (f) onChange(f.query);
          }}
        >
          <option value="">Saved filters</option>
          {props.saved.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      ) : null}
      {isEmptyFilter(filter) ? null : (
        <>
          <span className="pe-muted">
            {props.shown} of {props.total}
          </span>
          <button
            className="pe-btn pe-btn--secondary"
            type="button"
            onClick={() => {
              onChange({});
            }}
          >
            Clear
          </button>
          {naming ? (
            <form
              className="pe-inline-form pe-inline-form--tight"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                void props.onSave(name.trim()).then((err) => {
                  setError(err ?? '');
                  if (!err) {
                    setNaming(false);
                    setName('');
                  }
                });
              }}
            >
              <input
                className="pe-input"
                aria-label="Filter name"
                placeholder="Name this filter"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
              <button className="pe-btn pe-btn--primary" type="submit">
                Save
              </button>
            </form>
          ) : (
            <button
              className="pe-btn pe-btn--secondary"
              type="button"
              onClick={() => {
                setNaming(true);
              }}
            >
              Save filter
            </button>
          )}
        </>
      )}
      {error ? (
        <div className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
