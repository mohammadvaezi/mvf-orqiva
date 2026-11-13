// ── [PCODE-124 | S15 | v0.1.0] Generate proposals with an estimate from the interview, with versions ──
import { describe, expect, it } from 'vitest';
import { estimateOf, jsonIn, normalProposal, proposalProblems } from '../src/proposal.js';

const good = {
  summary: 'CSV export',
  problem: 'Finance retypes numbers.',
  goals: ['No retyping'],
  scopeIn: ['Report CSV'],
  scopeOut: ['Excel'],
  risks: [],
  tasks: [
    { title: 'Export endpoint', estimate: 3, description: 'Stream rows' },
    { title: 'Button', estimate: 1 },
    { title: 'Tests', estimate: 2 },
  ],
};

describe('proposals', () => {
  it('accept the fixed shape and compute the estimate from the tasks', () => {
    expect(proposalProblems(good)).toEqual([]);
    const p = normalProposal(good);
    expect(p.tasks[1]).toEqual({ title: 'Button', estimate: 1, description: '' });
    expect(estimateOf(p.tasks)).toEqual({ points: 6, days: 2 });
    expect(estimateOf([])).toEqual({ points: 0, days: 0 });
  });

  it('say what is wrong', () => {
    expect(proposalProblems(null)).toEqual(['A proposal is an object']);
    const bad = proposalProblems({ ...good, summary: ' ', tasks: [{ title: '', estimate: 4 }] });
    expect(bad).toEqual([
      'summary is required (at most 4000 characters)',
      'task 1 needs a title (at most 200 characters)',
      "task 1's estimate is one of 1, 2, 3, 5, 8, 13 points",
    ]);
    expect(proposalProblems({ ...good, tasks: [] })).toContain('tasks is a list of 1 to 60 tasks');
  });

  it('find the JSON in a model answer', () => {
    expect(jsonIn('Here:\n```json\n{"a":1}\n```\nDone')).toEqual({ a: 1 });
    expect(jsonIn('Sure. {"a":2} hope it helps')).toEqual({ a: 2 });
    expect(jsonIn('no json here')).toBeNull();
  });
});
