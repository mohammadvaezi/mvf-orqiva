// ── [PCODE-305 | S15 | v0.1.0] T31.5b The merge queue: in order per branch, merged through the host when the policy passes ──
//    Why:  only waiting entries make up a line, in their order; each outcome of "Merge next" is a sentence.
import { describe, expect, it } from 'vitest';
import { lanesOf, outcomeText, type QueueEntry } from '../src/v2/mergequeue.js';

const entry = (number: number, lane: string, state: QueueEntry['state']): QueueEntry => ({
  id: String(number),
  pullId: 'p' + String(number),
  number,
  title: 'Work',
  url: '',
  repo: 'acme/shop',
  branch: 'f/' + String(number),
  base: lane.split(':')[1] ?? 'main',
  lane,
  method: 'squash',
  state,
  reason: '',
  addedBy: null,
  addedAt: '2026-10-14T10:00:00Z',
  finishedAt: null,
});

describe('the merge queue', () => {
  it('groups waiting entries into lines, in order', () => {
    const lanes = lanesOf([
      entry(1, 'c:main', 'queued'),
      entry(2, 'c:release', 'queued'),
      entry(3, 'c:main', 'merged'),
      entry(4, 'c:main', 'queued'),
    ]);
    expect(lanes.map((l) => [l.base, l.queued.map((e) => e.number)])).toEqual([
      ['main', [1, 4]],
      ['release', [2]],
    ]);
  });

  it('says what Merge next came to', () => {
    expect(outcomeText({ outcome: 'merged', number: 7, reason: '' })).toBe('#7 merged.');
    expect(
      outcomeText({ outcome: 'removed', number: 8, reason: 'It has conflicts with main' }),
    ).toBe('#8 left the queue: It has conflicts with main.');
    expect(outcomeText({ outcome: 'waiting', number: 9, reason: 'Waiting: checks running' })).toBe(
      '#9 keeps its place: Waiting: checks running.',
    );
    expect(outcomeText({ outcome: 'empty', number: null, reason: '' })).toBe(
      'Nothing waits in this line.',
    );
  });
});
