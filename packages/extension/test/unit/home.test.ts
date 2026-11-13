// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-78 | S08 | v0.1.0] Add the Orqiva Home tab: guided setup steps and a visual task board ──
//    Why:  the Home tab decides what a newcomer sees first; the step order, the columns and the message
//          gate (critical #12) are pinned here.
import { describe, expect, it } from 'vitest';
import type { Item, Sprint } from '../../src/state/board';
import { columnOf, homeModel, homeProject, type HomeInputs } from '../../src/webviews/home/model';
import { ACTION_COMMANDS } from '../../src/webviews/home/panel';
import { HOME_ACTIONS, isWebviewMessage } from '../../src/webviews/protocol';
import pkg from '../../package.json';

const item = (ref: string, name: string, group: Item['state']['group'], done = false): Item => ({
  ref,
  title: `Task ${ref}`,
  state: { name, group },
  priority: 'high',
  labels: [],
  done,
});

const sprint = (items: Item[], isToday = true): Sprint => ({
  name: 'Sprint 01 - First',
  code: 'S01',
  date: '2026-10-02',
  endDate: '2026-10-02',
  goal: '',
  isToday,
  items,
  source: 'file',
});

const inputs = (over: Partial<HomeInputs> = {}): HomeInputs => ({
  folderOpen: true,
  trusted: true,
  engineFound: true,
  connected: true,
  link: { identifier: 'HELLO', name: 'Hello' },
  sprints: [],
  activeRef: null,
  online: true,
  hasRecent: false,
  ...over,
});

describe('the Home steps', () => {
  it('points at the first thing missing, in order', () => {
    expect(homeModel(inputs({ engineFound: false, connected: false })).current).toBe('computer');
    expect(homeModel(inputs({ connected: false })).current).toBe('plane');
    expect(homeModel(inputs({ link: null })).current).toBe('project');
    expect(homeModel(inputs({ folderOpen: false })).current).toBe('project');
    expect(homeModel(inputs()).current).toBe('work');
  });

  it('marks each step done on its own facts, and the first missing one current', () => {
    const d = homeModel(inputs({ connected: false }));
    expect(d.steps.map((s) => s.state)).toEqual(['done', 'current', 'done', 'todo']);
  });
});

describe('the Home board', () => {
  it('puts each item in its column and leaves cancelled ones out', () => {
    const d = homeModel(
      inputs({
        activeRef: 'HELLO-2',
        sprints: [
          sprint([
            item('HELLO-1', 'Todo', 'unstarted'),
            item('HELLO-2', 'In Progress', 'started'),
            item('HELLO-3', 'Review', 'started'),
            item('HELLO-4', 'Done', 'completed', true),
            item('HELLO-5', 'Cancelled', 'cancelled'),
            item('HELLO-6', 'Blocked', 'started'),
          ]),
        ],
      }),
    );
    const cols = Object.fromEntries(
      (d.sprints[0]?.columns ?? []).map((c) => [c.id, c.cards.map((x) => x.ref)]),
    );
    expect(cols).toEqual({
      todo: ['HELLO-1'],
      working: ['HELLO-2', 'HELLO-6'],
      review: ['HELLO-3'],
      done: ['HELLO-4'],
    });
    const working = d.sprints[0]?.columns.find((c) => c.id === 'working')?.cards ?? [];
    expect(working.find((c) => c.ref === 'HELLO-2')?.active).toBe(true);
    expect(working.find((c) => c.ref === 'HELLO-6')?.blocked).toBe(true);
    expect(d.sprints[0]?.open).toBe(4);
  });

  it('treats Test like Review and Backlog like To do', () => {
    expect(columnOf(item('A-1', 'Test', 'started'))).toBe('review');
    expect(columnOf(item('A-2', 'Backlog', 'backlog'))).toBe('todo');
  });
});

describe('Home messages (critical #12)', () => {
  it('accepts known actions and task operations only', () => {
    expect(isWebviewMessage({ type: 'home/ready' })).toBe(true);
    expect(isWebviewMessage({ type: 'home/go', action: 'newProject' })).toBe(true);
    expect(isWebviewMessage({ type: 'home/go', action: 'rm -rf' })).toBe(false);
    expect(isWebviewMessage({ type: 'home/task', op: 'build', ref: 'PCODE-12' })).toBe(true);
    expect(isWebviewMessage({ type: 'home/task', op: 'delete', ref: 'PCODE-12' })).toBe(false);
    expect(isWebviewMessage({ type: 'home/task', op: 'start', ref: 'PCODE-12; calc' })).toBe(false);
  });

  it('maps every action to a command that exists', () => {
    const declared = new Set(pkg.contributes.commands.map((c) => c.command));
    for (const a of HOME_ACTIONS) {
      const cmd = ACTION_COMMANDS[a];
      if (cmd.startsWith('orqiva.')) expect(declared, `${a} -> ${cmd}`).toContain(cmd);
    }
  });
});

// ── [PCODE-454 | S15 | v0.1.0] VS Code extension: Home tab shows and changes project, server and account; planning works on the Orqiva server ──
describe('Home tab: where the project lives and who is signed in', () => {
  it('shows the server and the project page of an Orqiva folder', () => {
    expect(
      homeProject({
        identifier: 'MARK',
        name: 'Marketspider',
        server: 'http://195.0.2.1:8490/',
        projectId: 'p1',
      }),
    ).toEqual({
      identifier: 'MARK',
      name: 'Marketspider',
      server: 'http://195.0.2.1:8490',
      url: 'http://195.0.2.1:8490/projects/p1',
    });
    expect(homeProject({ identifier: 'OLD', name: 'Old' })).toEqual({
      identifier: 'OLD',
      name: 'Old',
    });
  });

  it('hands the sign-in to the tab, and none when there is none', () => {
    const account = { server: 'http://s.test', email: 'a@x.test' };
    expect(homeModel(inputs({ account })).account).toEqual(account);
    expect(homeModel(inputs()).account).toBeNull();
  });

  it('opens the project page through a command the extension contributes', () => {
    expect(ACTION_COMMANDS.openProjectOnline).toBe('orqiva.openProjectOnline');
    expect(isWebviewMessage({ type: 'home/go', action: 'openProjectOnline' })).toBe(true);
  });
});
