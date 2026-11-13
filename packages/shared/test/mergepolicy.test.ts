// ── [PCODE-304 | S15 | v0.1.0] T31.5a Conflicts, stacked pull requests, and merge policies the host enforces through a commit status ──
//    Why:  only the rules a project switches on count; what is missing and what is still waiting are told
//          apart in words the host can show; a stack is followed to its bottom.
import { describe, expect, it } from 'vitest';
import { NO_POLICY, policyVerdict, stackOf, type PolicyFacts } from '../src/index.js';

const facts: PolicyFacts = {
  hasTask: true,
  reviewState: 'approved',
  checksState: 'passing',
  unmarked: 0,
  paths: ['src/a.ts'],
  mergeable: 'clean',
  draft: false,
};
const all = {
  ...NO_POLICY,
  requireTask: true,
  requireFingerprints: true,
  requireApproval: true,
  requireChecks: true,
  requireSensitiveApproval: true,
  blockConflicts: true,
};

describe('merge policy', () => {
  it('passes with no rules, and with every rule met', () => {
    expect(policyVerdict(NO_POLICY, facts)).toEqual({
      state: 'success',
      rules: [],
      description: 'No merge rules set',
    });
    expect(policyVerdict(all, facts).description).toBe('All 6 rules met');
  });

  it('says what is missing and what is still waiting', () => {
    const v = policyVerdict(all, {
      ...facts,
      hasTask: false,
      reviewState: 'changes_requested',
      checksState: 'pending',
      unmarked: null,
      paths: ['server/migrations/0007.sql'],
    });
    expect(v.state).toBe('failure');
    expect(v.description).toBe(
      'Not met: no task linked; changes requested; touches migrations without an approval. Waiting: files not read yet; checks running',
    );
    expect(
      policyVerdict({ ...NO_POLICY, requireChecks: true }, { ...facts, checksState: 'pending' }),
    ).toMatchObject({ state: 'pending', description: 'Waiting: checks running' });
  });

  it('keeps a draft from passing, and the description short', () => {
    expect(policyVerdict(all, { ...facts, draft: true })).toMatchObject({
      state: 'pending',
      description: 'Draft; All 6 rules met',
    });
    const long = policyVerdict(all, {
      ...facts,
      hasTask: false,
      reviewState: 'none',
      checksState: 'failing',
      unmarked: 12,
      paths: ['server/migrations/1.sql', 'src/auth/login.ts', 'infra/main.tf'],
      mergeable: 'conflicts',
    });
    expect(long.description.length).toBeLessThanOrEqual(140);
  });
});

describe('stacks', () => {
  const pr = (id: string, number: number, branch: string, base: string, state = 'open') => ({
    id,
    number,
    branch,
    base,
    state,
    connection: 'c',
  });
  const list = [
    pr('a', 1, 'feat/a', 'main'),
    pr('b', 2, 'feat/b', 'feat/a'),
    pr('c', 3, 'feat/c', 'feat/b'),
    pr('d', 4, 'feat/d', 'feat/old'),
    pr('e', 5, 'feat/old', 'main', 'merged'),
  ];
  it('follows a stack to its bottom', () => {
    expect(stackOf(list, 'c')).toEqual({ parent: 2, parentMerged: null, children: [], depth: 2 });
    expect(stackOf(list, 'a')).toEqual({
      parent: null,
      parentMerged: null,
      children: [2],
      depth: 0,
    });
  });
  it('finds a base that was merged away', () => {
    expect(stackOf(list, 'd').parentMerged).toBe(5);
  });
  it('is not fooled by a loop', () => {
    const loop = [pr('x', 1, 'x', 'y'), pr('y', 2, 'y', 'x')];
    expect(stackOf(loop, 'x').depth).toBe(1);
  });
});
