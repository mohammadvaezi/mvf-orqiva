// ── [PCODE-434 | S15 | v0.1.0] T37 low: Board WIP limits and custom-field filters in the screen ──
// ── [PCODE-100 | S15 | v0.1.0] Add filters, search and the keyboard command bar ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommandBar, commandRows, isCommandKey, type Command } from '../src/commandbar.js';
import {
  FilterBar,
  applyFilter,
  filterFromSearch,
  isEmptyFilter,
  searchFromFilter,
} from '../src/filters.js';
import type { Item } from '../src/sync/items.js';

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  ref: 'APP-' + id,
  projectId: 'p',
  sequence: 1,
  title: 'Item ' + id,
  description: '',
  stateId: 'todo',
  assigneeId: null,
  estimate: null,
  parentId: null,
  labelIds: [],
  sprintId: null,
  rank: 1,
  version: 1,
  commentCount: 0,
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('filters', () => {
  it('round-trip through the address', () => {
    const f = { q: 'pass reset', stateId: 's1', assigneeId: 'me', sprintId: 'backlog' };
    expect(filterFromSearch(searchFromFilter(f))).toEqual(f);
    expect(searchFromFilter({})).toBe('');
    expect(isEmptyFilter(filterFromSearch('unknown=1'))).toBe(true);
  });

  it('narrow items by state, assignee (me, none), label, sprint and the server’s text hits', () => {
    const items = [
      item('1', { assigneeId: 'u1', labelIds: ['l1'] }),
      item('2', { stateId: 'done', sprintId: 's9' }),
      item('3'),
      item('local-x', { title: 'Password reset' }),
    ];
    const ids = (f: Parameters<typeof applyFilter>[1], hits: Set<string> | null = null): string[] =>
      applyFilter(items, f, 'u1', hits).map((i) => i.id);
    expect(ids({ assigneeId: 'me' })).toEqual(['1']);
    expect(ids({ assigneeId: 'none' })).toEqual(['2', '3', 'local-x']);
    expect(ids({ labelId: 'l1' })).toEqual(['1']);
    expect(ids({ sprintId: 'backlog' })).toEqual(['1', '3', 'local-x']);
    expect(ids({ stateId: 'done' })).toEqual(['2']);
    expect(ids({ q: 'password' }, new Set(['3']))).toEqual(['3', 'local-x']);
  });

  // [PCODE-434 | S15 | v0.1.0]
  it('narrow items by a custom field’s value, kept in the address, offered by the field’s values', () => {
    const items = [
      item('1', { custom: { customer: 'Northwind' } }),
      item('2', { custom: { customer: 'Helio' } }),
      item('3'),
    ];
    expect(applyFilter(items, { field: 'customer:Helio' }, 'u1', null).map((i) => i.id)).toEqual([
      '2',
    ]);
    expect(filterFromSearch(searchFromFilter({ field: 'customer:Helio' }))).toEqual({
      field: 'customer:Helio',
    });
    const html = renderToString(
      <FilterBar
        filter={{}}
        states={[]}
        people={[]}
        labels={[]}
        sprints={[]}
        fields={[{ key: 'customer', label: 'Customer', options: ['Northwind', 'Helio'] }]}
        saved={[]}
        shown={3}
        total={3}
        onChange={() => undefined}
        onSave={() => Promise.resolve(null)}
      />,
    );
    expect(html).toContain('<option value="customer:Helio">Customer: Helio</option>');
  });

  it('render a search box and selects, and offer to save a filter only when one is set', () => {
    const props = {
      states: [{ id: 's1', name: 'Todo', group: 'unstarted', color: '#3f76ff' }],
      people: [{ id: 'u2', name: 'Bob' }],
      labels: [],
      sprints: [],
      saved: [],
      shown: 1,
      total: 3,
      onChange: () => undefined,
      onSave: () => Promise.resolve(null),
    };
    expect(renderToString(<FilterBar filter={{}} {...props} />)).not.toContain('Save filter');
    const html = renderToString(<FilterBar filter={{ assigneeId: 'u2' }} {...props} />);
    expect(html).toContain('role="search"');
    expect(html).toContain('1<!-- --> of <!-- -->3');
    expect(html).toContain('>Save filter</button>');
    expect(html).toMatch(/<option value="u2" selected="">Bob<\/option>/);
  });
});

describe('command bar', () => {
  const noop = (): void => undefined;
  const commands: Command[] = [
    { id: 'go', label: 'Go to projects', run: noop },
    { id: 'dark', label: 'Dark theme', run: noop },
  ];
  const hits = {
    items: [{ id: 'i2', ref: 'APP-2', title: 'Password reset', projectKey: 'APP' }],
    projects: [{ id: 'p1', key: 'APP', name: 'The App' }],
  };

  it('opens on Ctrl+K and Cmd+K only', () => {
    expect(isCommandKey({ key: 'k', ctrlKey: true, metaKey: false })).toBe(true);
    expect(isCommandKey({ key: 'K', ctrlKey: false, metaKey: true })).toBe(true);
    expect(isCommandKey({ key: 'k', ctrlKey: false, metaKey: false })).toBe(false);
  });

  it('puts an item typed by its reference first, so Ctrl+K, the reference, Enter opens it', () => {
    const paths: string[] = [];
    const rows = commandRows('app-2', commands, hits, (p) => paths.push(p));
    expect(rows[0]?.label).toBe('APP-2 Password reset');
    rows[0]?.run();
    expect(paths).toEqual(['/items/i2']);
  });

  it('lists matching commands before search hits for words', () => {
    expect(commandRows('dark', commands, null, noop).map((r) => r.id)).toEqual(['dark']);
    expect(commandRows('', commands, null, noop)).toHaveLength(2);
  });

  it('is an accessible dialog with a listbox', () => {
    const html = renderToString(
      <CommandBar
        commands={commands}
        search={() => Promise.resolve(null)}
        go={noop}
        onClose={noop}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-activedescendant="cmd-go"');
  });
});
