// ── [PCODE-97 | S15 | v0.1.0] Show projects, item lists and item detail live in the web app ──
// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { appRoute } from '../src/core/nav.js';
import type { Item } from '../src/sync/items.js';
import { ProjectGrid, suggestKey } from '../src/pages.js';
import { ItemView, ProjectView, localTime, type Project, type State } from '../src/views.js';

const noop = (): void => undefined;
const none = (): Promise<null> => Promise.resolve(null);
const project: Project = {
  id: 'p1',
  key: 'APP',
  name: 'The App',
  description: '',
  archived: false,
};
const states: State[] = [
  { id: 's1', name: 'Backlog', group: 'backlog', color: '#8b8d98' },
  { id: 's2', name: 'In Progress', group: 'started', color: '#f59e0b' },
];
const item = (id: string, seq: number, title: string): Item => ({
  id,
  ref: 'APP-' + String(seq),
  projectId: 'p1',
  sequence: seq,
  title,
  description: 'Why it matters',
  stateId: 's2',
  assigneeId: null,
  estimate: 3,
  parentId: null,
  labelIds: [],
  sprintId: null,
  rank: 0,
  version: 1,
  commentCount: 2,
  createdAt: '',
  updatedAt: '',
});

describe('routes', () => {
  it('reads the signed-in screens from the path', () => {
    expect(appRoute('/')).toEqual({ kind: 'home' });
    expect(appRoute('/my-work')).toEqual({ kind: 'my-work' });
    expect(appRoute('/projects')).toEqual({ kind: 'projects' });
    expect(appRoute('/activity/')).toEqual({ kind: 'activity' });
    expect(appRoute('/projects/0b6f2f43-7d6e-4f6c-9a39-2f1e3c4d5e6f')).toEqual({
      kind: 'project',
      id: '0b6f2f43-7d6e-4f6c-9a39-2f1e3c4d5e6f',
      view: 'overview',
    });
    expect(appRoute('/projects/0b6f2f43-7d6e-4f6c-9a39-2f1e3c4d5e6f/settings')).toMatchObject({
      view: 'settings',
    });
    expect(appRoute('/settings')).toEqual({ kind: 'settings', section: 'profile' });
    expect(appRoute('/settings/members')).toEqual({ kind: 'settings', section: 'members' });
    expect(appRoute('/settings/nonsense')).toEqual({ kind: 'settings', section: 'profile' });
    expect(appRoute('/items/0b6f2f43-7d6e-4f6c-9a39-2f1e3c4d5e6f').kind).toBe('item');
    expect(appRoute('/items/nope')).toEqual({ kind: 'home' });
  });
});

describe('work screens', () => {
  it('projects: cards with key, name and description; an empty state without projects', () => {
    const html = renderToString(<ProjectGrid projects={[project]} go={noop} />);
    expect(html).toContain('href="/projects/p1"');
    expect(html).toContain('>APP</span>');
    expect(html).toContain('The App');
    expect(renderToString(<ProjectGrid projects={[]} go={noop} />)).toContain('No projects yet');
  });

  it('suggests a project key from the name', () => {
    expect(suggestKey('Order Service')).toBe('OS');
    expect(suggestKey('payments')).toBe('PAYM');
    expect(suggestKey('2fa helper tool')).toBe('');
  });

  it('project: one row per item with its number, title, state by name and comment count', () => {
    const html = renderToString(
      <ProjectView
        project={project}
        states={states}
        items={[item('i1', 1, 'Write the router'), item('local-x', 0, 'Not saved yet')]}
        canEdit
        isPending={(id) => id.startsWith('local-')}
        onCreate={noop}
        onState={noop}
        go={noop}
      />,
    );
    expect(html).toContain('APP-1');
    expect(html).toContain('href="/items/i1"');
    expect(html).toMatch(/<option value="s2" selected="">In Progress<\/option>/);
    expect(html).toContain('class="pe-pending"');
    expect(html).not.toContain('href="/items/local-x"');
    expect(html).not.toContain('style=');
  });

  it('item: editable fields, state, the comments and a way to add one', () => {
    const html = renderToString(
      <ItemView
        project={project}
        item={item('i1', 1, 'Write the router')}
        states={states}
        comments={[
          {
            id: 'c1',
            authorName: 'Gus',
            body: 'Looks good.',
            createdAt: '2026-10-03T10:00:00.000Z',
            editedAt: null,
          },
        ]}
        canEdit
        pending
        onChange={noop}
        onComment={none}
        go={noop}
      />,
    );
    expect(html).toContain('>Write the router</textarea>');
    expect(html).toContain('Why it matters');
    expect(html).toMatch(
      new RegExp(
        '<strong>Gus</strong> <span class="pe-muted">' + localTime('2026-10-03T10:00:00.000Z'),
      ),
    );
    expect(html).toContain('>Comment</button>');
    expect(html).toContain('saving');
  });

  it('shows times in the reader’s time zone', () => {
    const d = new Date(2026, 9, 3, 1, 42);
    expect(localTime(d.toISOString())).toBe('2026-10-03 01:42');
    expect(localTime('not a date')).toBe('');
  });

  it('item: read-only for a guest', () => {
    const html = renderToString(
      <ItemView
        project={project}
        item={item('i1', 1, 'T')}
        states={states}
        comments={[]}
        canEdit={false}
        pending={false}
        onChange={noop}
        onComment={none}
        go={noop}
      />,
    );
    expect(html).toMatch(/id="item-title"[^>]*disabled=""/);
    expect(html).toContain('No comments yet.');
  });
});
