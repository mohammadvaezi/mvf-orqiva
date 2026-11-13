// ── [PCODE-314 | S15 | v0.1.0] T32.2 Runs: assignment and workload, keyboard entry, timers, reopen when the defect is done ──
//    Why:  the keys act only outside fields and without modifiers, set the step still open, and the time
//          reads as people say it.
import { describe, expect, it } from 'vitest';
import { durationText, keyAction, nextStep } from '../src/v2/testruns.js';

const key = (k: string, extra: Partial<Parameters<typeof keyAction>[0]> = {}) =>
  keyAction({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: { tagName: 'BODY' },
    ...extra,
  });

describe('running tests from the keyboard', () => {
  it('maps the keys, and leaves fields and shortcuts alone', () => {
    expect(key('p')).toEqual({ kind: 'result', status: 'passed' });
    expect(key('F')).toEqual({ kind: 'result', status: 'failed' });
    expect(key('b')).toEqual({ kind: 'result', status: 'blocked' });
    expect(key('s')).toEqual({ kind: 'result', status: 'skipped' });
    expect(key('j')).toEqual({ kind: 'move', by: 1 });
    expect(key('k')).toEqual({ kind: 'move', by: -1 });
    expect(key('x')).toBeNull();
    expect(key('p', { target: { tagName: 'TEXTAREA' } })).toBeNull();
    expect(key('p', { target: { tagName: 'DIV', isContentEditable: true } })).toBeNull();
    expect(key('s', { ctrlKey: true })).toBeNull();
  });

  it('sets the first open step, and reads durations', () => {
    expect(nextStep(['passed', 'untested', 'untested'])).toBe(1);
    expect(nextStep(['passed', 'failed'])).toBe(1);
    expect(durationText(45_400)).toBe('45 s');
    expect(durationText(185_000)).toBe('3 min 05 s');
    expect(durationText(3_720_000)).toBe('1 h 02 min');
  });
});
