// ── [PCODE-346 | S15 | v0.1.0] T35.1a Cmd-K over agents, runs, people and settings; keyboard shortcut sheet ──
// ── [PCODE-283 | S15 | v0.1.0] T29.5 Documents: named versions in the screen, visual diff, mentions in comments, page search and Cmd-K ──
// ── [PCODE-100 | S15 | v0.1.0] Add filters, search and the keyboard command bar ──
//    Why:  everything from the keyboard: Ctrl+K (Cmd+K on a Mac) opens one box that finds items (by words or
//          by reference, APP-12) and projects, and runs commands. Arrow keys choose, Enter acts, Escape
//          closes and returns focus where it was. It is a real dialog for screen readers, and the results are
//          a listbox whose active option the input points at.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface Command {
  id: string;
  label: string;
  /** shown after the label, e.g. the kind or a key */
  hint?: string;
  run: () => void;
}

export interface SearchHits {
  items: { id: string; ref: string; title: string; projectKey: string }[];
  projects: { id: string; key: string; name: string }[];
  /** [PCODE-283 | S15 | v0.1.0] pages, for team members */
  docs?: { id: string; title: string; projectId: string; projectKey: string }[];
  // [PCODE-346 | S15 | v0.1.0] for the team
  agents?: { id: string; key: string; name: string }[];
  runs?: { id: string; instruction: string; status: string; agent: string }[];
  people?: { id: string; name: string; email: string }[];
  settings?: { key: string; label: string }[];
}

/** The rows shown for a query: matching commands first, then what the search found. */
export function commandRows(
  query: string,
  commands: Command[],
  hits: SearchHits | null,
  go: (path: string) => void,
): Command[] {
  const q = query.trim().toLowerCase();
  const matching = commands.filter((c) => !q || c.label.toLowerCase().includes(q));
  const items = (hits?.items ?? []).map((i): Command => ({
    id: 'item-' + i.id,
    label: i.ref + ' ' + i.title,
    hint: 'Item',
    run: () => {
      go('/items/' + i.id);
    },
  }));
  const projects = (hits?.projects ?? []).map((p): Command => ({
    id: 'project-' + p.id,
    label: p.key + ' ' + p.name,
    hint: 'Project',
    run: () => {
      go('/projects/' + p.id);
    },
  }));
  const docs = (hits?.docs ?? []).map((d): Command => ({
    id: 'doc-' + d.id,
    label: d.title,
    hint: 'Page in ' + d.projectKey,
    run: () => {
      go('/projects/' + d.projectId + '/documents?page=' + d.id);
    },
  }));
  // [PCODE-346 | S15 | v0.1.0] agents, runs, people and settings
  const more = [
    ...(hits?.agents ?? []).map((g): Command => ({
      id: 'agent-' + g.id,
      label: g.name,
      hint: 'Agent',
      run: () => {
        go('/agents');
      },
    })),
    ...(hits?.runs ?? []).map((r): Command => ({
      id: 'run-' + r.id,
      label: r.instruction,
      hint: 'Run by ' + r.agent + ' · ' + r.status,
      run: () => {
        go('/runs/' + r.id);
      },
    })),
    ...(hits?.people ?? []).map((p): Command => ({
      id: 'person-' + p.id,
      label: p.name,
      hint: 'Person · ' + p.email,
      run: () => {
        go('/people');
      },
    })),
    ...(hits?.settings ?? []).map((x): Command => ({
      id: 'setting-' + x.key,
      label: x.label,
      hint: 'Setting',
      run: () => {
        go('/settings/workspace');
      },
    })),
  ];
  // a reference typed exactly goes first, so Ctrl+K, the reference, Enter opens it
  return q && /^[a-z][a-z0-9]{1,9}-\d+$/.test(q)
    ? [...items, ...projects, ...matching, ...docs, ...more]
    : [...matching, ...projects, ...items, ...docs, ...more];
}

export function CommandBar(props: {
  commands: Command[];
  search: (q: string) => Promise<SearchHits | null>;
  go: (path: string) => void;
  onClose: () => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHits | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<Element | null>(
    typeof document === 'undefined' ? null : document.activeElement,
  );
  // the latest search function, without making the search effect run again on every render
  const search = useRef(props.search);
  search.current = props.search;

  useEffect(() => {
    input.current?.focus();
    const back = returnFocus.current;
    return () => {
      if (back instanceof HTMLElement) back.focus();
    };
  }, []);

  // search as the person types, a moment after they pause; an older answer never replaces a newer one
  useEffect(() => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    let current = true;
    const t = setTimeout(() => {
      void search.current(query.trim()).then((h) => {
        if (current) {
          setHits(h);
          setActive(0);
        }
      });
    }, 120);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [query]);

  const rows = commandRows(query, props.commands, hits, props.go);
  const activeRow = rows[active];
  const choose = (row: Command | undefined): void => {
    if (!row) return;
    props.onClose();
    row.run();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(rows[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose();
    }
  };

  return (
    <div
      className="pe-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="pe-command" role="dialog" aria-modal="true" aria-label="Command bar">
        <input
          ref={input}
          className="pe-input pe-command-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="pe-command-list"
          aria-activedescendant={activeRow ? 'cmd-' + activeRow.id : undefined}
          aria-label="Type a command, an item or a project"
          placeholder="Type a command, an item (APP-12) or a project"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
        />
        <ul id="pe-command-list" className="pe-command-list" role="listbox" aria-label="Results">
          {rows.length === 0 ? (
            <li className="pe-muted pe-command-empty" role="presentation">
              Nothing found.
            </li>
          ) : null}
          {rows.map((row, i) => (
            <li
              key={row.id}
              id={'cmd-' + row.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'pe-command-row pe-command-row--active' : 'pe-command-row'}
              onMouseEnter={() => {
                setActive(i);
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(row);
              }}
            >
              <span>{row.label}</span>
              {row.hint ? <span className="pe-muted">{row.hint}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** True for the key that opens the command bar: Ctrl+K, or Cmd+K on a Mac. */
export const isCommandKey = (e: { key: string; ctrlKey: boolean; metaKey: boolean }): boolean =>
  e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey);
