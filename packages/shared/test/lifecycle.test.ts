// ── [PCODE-117 | S15 | v0.1.0] Build the lifecycle engine: phases, stages, gates, criteria, sign-off, live ──
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIFECYCLE, lifecycleProblems, type LifecycleDef } from '../src/lifecycle.js';

describe('lifecycle definitions', () => {
  it('the default is the plan: 14 stages in four phases, three gates, and valid', () => {
    expect(DEFAULT_LIFECYCLE.phases.flatMap((p) => p.stages)).toHaveLength(14);
    expect(DEFAULT_LIFECYCLE.phases.flatMap((p) => (p.gate ? [p.gate.key] : []))).toEqual([
      'g1',
      'g2',
      'g3',
    ]);
    expect(DEFAULT_LIFECYCLE.phases[0]?.gate?.signer).toBe('owner');
    expect(lifecycleProblems(DEFAULT_LIFECYCLE)).toEqual([]);
  });

  it('names what is wrong with a broken one', () => {
    const broken: LifecycleDef = {
      phases: [
        { key: 'a', name: 'A', stages: [{ key: 'x', name: 'X', agent: '', owner: '' }] },
        {
          key: 'a',
          name: '',
          stages: [],
          gate: {
            key: 'G 1',
            name: 'Gate',
            signer: 'owner',
            criteria: [
              { key: 'c', text: '' },
              { key: 'c', text: 'two' },
            ],
          },
        },
      ],
    };
    const problems = lifecycleProblems(broken);
    expect(problems).toContain('Phase key "a" is used twice.');
    expect(problems).toContain('Every phase needs a name.');
    expect(problems.some((p) => p.includes('needs at least one stage'))).toBe(true);
    expect(problems).toContain('Gate key "G 1" must be lower case letters, digits and dashes.');
    expect(problems).toContain('Criterion key "c" is used twice in "Gate".');
    expect(problems).toContain('Every criterion needs a text.');
    expect(lifecycleProblems({ phases: [] })).toEqual(['A lifecycle needs at least one phase.']);
  });
});
