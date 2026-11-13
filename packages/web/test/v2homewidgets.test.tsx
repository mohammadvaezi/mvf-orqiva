// ── [PCODE-347 | S15 | v0.1.0] T35.1b Homes for developers and testers with widgets the person chooses ──
//    Why:  each widget turns its data into lines that open the right page.
import { describe, expect, it } from 'vitest';
import { widgetLines } from '../src/v2/homewidgets.js';

describe('home widget lines', () => {
  it('links tasks, runs, tests and time', () => {
    expect(
      widgetLines('my-tasks', [{ id: 'i1', ref: 'APP-3', title: 'Sign-in', state: 'In progress' }]),
    ).toEqual([{ to: '/items/i1', main: 'APP-3 Sign-in', sub: 'In progress' }]);
    expect(
      widgetLines('my-runs', [
        { id: 'r1', instruction: 'Split', status: 'failed', agent: 'Planner agent' },
      ])[0],
    ).toMatchObject({
      to: '/runs/r1',
      chip: 'failed',
      tone: 'danger',
    });
    expect(
      widgetLines('my-tests', [
        { id: 't1', name: 'UAT', projectKey: 'APP', mine: 4, failing: 0 },
      ])[0],
    ).toEqual({
      to: '/test-runs/t1',
      main: 'APP UAT',
      sub: '4 cases for you',
    });
    expect(widgetLines('time-today', { minutes: 150, running: true })[0]).toMatchObject({
      main: '2,50 h booked today',
      chip: 'timer',
    });
    expect(
      widgetLines('incidents', [
        {
          id: 'x',
          ref: 'INC-2',
          title: 'Down',
          severity: 'sev1',
          state: 'investigating',
          projectKey: null,
        },
      ])[0],
    ).toMatchObject({
      chip: 'SEV-1',
      tone: 'danger',
      sub: 'investigating',
    });
    expect(widgetLines('reviews', 'not a list')).toEqual([]);
  });
});
