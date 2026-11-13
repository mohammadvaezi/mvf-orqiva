// ── [PCODE-22 | S04 | v0.1.0] Add action buttons to the task panel: Start, Done, Status, Note, Open in Plane ──
//    Why:  the primary action per state, the busy gate (double-click ignored), and the host mapping that
//          calls the same task commands as the tree and reloads afterwards.
import { describe, expect, it } from 'vitest';
import {
  ActionGate,
  handlePanelAction,
  primaryAction,
  type PanelActionRunner,
} from '../../src/webviews/taskDetail/actions';

describe('primaryAction', () => {
  it('follows the design-system rule per state', () => {
    expect(primaryAction('Todo', 'unstarted')).toBe('start');
    expect(primaryAction('Backlog', 'backlog')).toBe('start');
    expect(primaryAction('In Progress', 'started')).toBe('done');
    expect(primaryAction('Blocked', 'started')).toBe('done');
    expect(primaryAction('Review', 'started')).toBeNull();
    expect(primaryAction('Test', 'started')).toBeNull();
    expect(primaryAction('Done', 'completed')).toBeNull();
    expect(primaryAction('Cancelled', 'cancelled')).toBeNull();
  });
});

describe('handlePanelAction', () => {
  function runner(): PanelActionRunner & { calls: string[][] } {
    const calls: string[][] = [];
    return {
      calls,
      start: (ref) => {
        calls.push(['start', ref]);
        return new Promise((r) => setTimeout(r, 15));
      },
      done: (ref) => {
        calls.push(['done', ref]);
        return Promise.reject(
          new Error('no file carries the fingerprint [FIX-2 | ...]. Add the marker'),
        );
      },
      status: (ref, state, note) => {
        calls.push(['status', ref, state, note ?? '']);
        return Promise.resolve();
      },
      note: (ref, text) => {
        calls.push(['note', ref, text]);
        return Promise.resolve();
      },
    };
  }

  // ── [PCODE-22 | S04 | v0.1.0] Start from the panel calls start(FIX-3), posts busy on/off, reloads ──
  it('start posts busy, runs the command, reloads; a second click while busy is ignored', async () => {
    const r = runner();
    const gate = new ActionGate();
    const posted: unknown[] = [];
    let reloads = 0;
    const post = (m: unknown): Promise<unknown> => {
      posted.push(m);
      return Promise.resolve(true);
    };
    const reload = (): Promise<void> => {
      reloads++;
      return Promise.resolve();
    };
    const first = handlePanelAction({ type: 'task/start' }, 'FIX-3', r, gate, post, reload);
    const second = await handlePanelAction({ type: 'task/start' }, 'FIX-3', r, gate, post, reload);
    expect(second).toBe(false);
    expect(await first).toBe(true);
    expect(r.calls).toEqual([['start', 'FIX-3']]);
    expect(posted).toEqual([
      { type: 'task/busy', busy: true, action: 'start' },
      { type: 'task/busy', busy: false },
    ]);
    expect(reloads).toBe(1);
    expect(gate.busy).toBe(false);
  });

  it('a failed Done posts the error into the panel and still reloads', async () => {
    const r = runner();
    const posted: { type: string; message?: string }[] = [];
    let reloads = 0;
    await handlePanelAction(
      { type: 'task/done' },
      'FIX-2',
      r,
      new ActionGate(),
      (m) => {
        posted.push(m);
        return Promise.resolve(true);
      },
      () => {
        reloads++;
        return Promise.resolve();
      },
    );
    expect(posted.map((p) => p.type)).toEqual(['task/busy', 'task/error', 'task/busy']);
    expect(posted[1]?.message).toContain('Add the marker');
    expect(reloads).toBe(1);
  });

  it('status and note pass their payloads; unrelated messages are not handled', async () => {
    const r = runner();
    const noop = (): Promise<unknown> => Promise.resolve(true);
    const reload = (): Promise<void> => Promise.resolve();
    await handlePanelAction(
      { type: 'task/status', state: 'blocked', note: 'why' },
      'FIX-2',
      r,
      new ActionGate(),
      noop,
      reload,
    );
    await handlePanelAction(
      { type: 'task/note', text: 'hello' },
      'FIX-2',
      r,
      new ActionGate(),
      noop,
      reload,
    );
    expect(
      await handlePanelAction(
        { type: 'task/openPlane' },
        'FIX-2',
        r,
        new ActionGate(),
        noop,
        reload,
      ),
    ).toBe(false);
    expect(r.calls).toEqual([
      ['status', 'FIX-2', 'blocked', 'why'],
      ['note', 'FIX-2', 'hello'],
    ]);
  });
});
