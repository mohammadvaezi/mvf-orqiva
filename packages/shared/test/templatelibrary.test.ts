// ── [PCODE-350 | S15 | v0.1.0] T35.3a Templates library for projects, PRDs, sprints and agents ──
//    Why:  every built-in template fits its kind, a broken one is named, and a sprint ends on its last day.
import { describe, expect, it } from 'vitest';
import { BUILTIN_LIBRARY, libraryProblem, sprintEnd } from '../src/templatelibrary.js';

describe('templates library', () => {
  it('has built-in templates that fit their kind', () => {
    for (const t of BUILTIN_LIBRARY)
      expect([t.id, libraryProblem(t.kind, t.body)]).toEqual([t.id, null]);
  });
  it('names what is wrong with a template', () => {
    expect(
      libraryProblem('project', {
        labels: [],
        epics: [],
        settings: {},
        states: [
          { name: 'A', grp: 'started', color: '#000000' },
          { name: 'B', grp: 'started', color: '#000000' },
        ],
      }),
    ).toBe('A board needs a done state');
    expect(libraryProblem('sprint', { days: 50, goal: '', tasks: [] })).toBe(
      'A sprint lasts 1 to 42 days',
    );
    expect(libraryProblem('agent', { name: 'X', description: '', instructions: '' })).toBe(
      'An agent needs instructions',
    );
    expect(
      libraryProblem('prd', {
        ideaKind: 'feature',
        sections: [{ key: 'Bad Key', title: 'x', hint: '' }],
      }),
    ).toBe('Each section needs a key, a title and a hint');
    expect(libraryProblem('project', null)).toBe('The template is empty');
  });
  it('ends a sprint on its last day', () => {
    expect(sprintEnd('2026-11-02', 14)).toBe('2026-11-15');
    expect(sprintEnd('2026-12-28', 7)).toBe('2027-01-03');
  });
});
