// ── [PCODE-304 | S15 | v0.1.0] T31.5a Conflicts, stacked pull requests, and merge policies the host enforces through a commit status ──
//    Why:  a project says what a pull request needs before it merges: a task, fingerprints, an approval,
//          passing checks, an approval for sensitive paths, no conflicts. Orqiva checks each rule and tells
//          the host its verdict as a commit status, so the host's branch protection can require it. Every
//          rule that is not met is said in words. A pull request whose base is another open one's branch
//          is stacked on it and merges after it.
import { sensitiveAreas } from './review.js';

export interface MergePolicy {
  requireTask: boolean;
  requireFingerprints: boolean;
  requireApproval: boolean;
  requireChecks: boolean;
  /** sensitive paths (migrations, auth, payments, infrastructure) need an approval even when others do not */
  requireSensitiveApproval: boolean;
  blockConflicts: boolean;
  /** post the verdict to the host as the commit status orqiva/policy */
  postStatus: boolean;
}

export const NO_POLICY: MergePolicy = {
  requireTask: false,
  requireFingerprints: false,
  requireApproval: false,
  requireChecks: false,
  requireSensitiveApproval: false,
  blockConflicts: false,
  postStatus: false,
};

/** The commit status's name on every host. */
export const POLICY_CONTEXT = 'orqiva/policy';

export type Mergeable = 'unknown' | 'clean' | 'conflicts' | 'behind';

export interface PolicyFacts {
  hasTask: boolean;
  reviewState: string;
  checksState: string;
  /** code files without a fingerprint, or null when the files are not read yet */
  unmarked: number | null;
  paths: readonly string[] | null;
  mergeable: Mergeable;
  draft: boolean;
}

export type RuleState = 'met' | 'failing' | 'pending';

export interface MergeRule {
  key: keyof Omit<MergePolicy, 'postStatus'>;
  label: string;
  state: RuleState;
  /** what is wrong, in words; empty when met */
  why: string;
}

export interface PolicyVerdict {
  state: 'success' | 'failure' | 'pending';
  rules: MergeRule[];
  /** at most 140 characters: what the host shows next to the status */
  description: string;
}

const RULE_LABEL: Record<MergeRule['key'], string> = {
  requireTask: 'A task is linked',
  requireFingerprints: 'Every code file carries a fingerprint',
  requireApproval: 'Approved by a reviewer',
  requireChecks: 'Checks pass',
  requireSensitiveApproval: 'Sensitive paths approved',
  blockConflicts: 'No conflicts',
};

/** Checks the rules the policy switches on, in a fixed order. */
export function policyVerdict(policy: MergePolicy, f: PolicyFacts): PolicyVerdict {
  const rules: MergeRule[] = [];
  const rule = (key: MergeRule['key'], state: RuleState, why = ''): void => {
    if (policy[key]) rules.push({ key, label: RULE_LABEL[key], state, why });
  };
  const approved = f.reviewState === 'approved';
  rule('requireTask', f.hasTask ? 'met' : 'failing', 'no task linked');
  rule(
    'requireFingerprints',
    f.unmarked === null ? 'pending' : f.unmarked ? 'failing' : 'met',
    f.unmarked === null
      ? 'files not read yet'
      : String(f.unmarked) +
          ' code file' +
          (f.unmarked === 1 ? '' : 's') +
          ' without a fingerprint',
  );
  rule(
    'requireApproval',
    approved ? 'met' : 'failing',
    f.reviewState === 'changes_requested' ? 'changes requested' : 'not approved',
  );
  rule(
    'requireChecks',
    f.checksState === 'passing' ? 'met' : f.checksState === 'pending' ? 'pending' : 'failing',
    f.checksState === 'failing'
      ? 'checks fail'
      : f.checksState === 'pending'
        ? 'checks running'
        : 'no checks reported',
  );
  const areas = f.paths ? sensitiveAreas(f.paths) : null;
  rule(
    'requireSensitiveApproval',
    areas === null ? 'pending' : !areas.length || approved ? 'met' : 'failing',
    areas === null ? 'files not read yet' : 'touches ' + areas.join(', ') + ' without an approval',
  );
  rule(
    'blockConflicts',
    f.mergeable === 'conflicts' ? 'failing' : f.mergeable === 'unknown' ? 'pending' : 'met',
    f.mergeable === 'conflicts' ? 'has conflicts' : 'not known yet whether it merges cleanly',
  );
  const failing = rules.filter((r) => r.state === 'failing');
  const pending = rules.filter((r) => r.state === 'pending');
  const state = failing.length ? 'failure' : pending.length ? 'pending' : 'success';
  const description =
    state === 'success'
      ? rules.length
        ? 'All ' + String(rules.length) + ' rules met'
        : 'No merge rules set'
      : (failing.length ? 'Not met: ' + failing.map((r) => r.why).join('; ') : 'Waiting: ') +
        (failing.length && pending.length ? '. Waiting: ' : '') +
        pending.map((r) => r.why).join('; ');
  return {
    state: f.draft && state === 'success' ? 'pending' : state,
    rules,
    description: (f.draft && state === 'success' ? 'Draft; ' + description : description).slice(
      0,
      140,
    ),
  };
}

export interface StackPull {
  id: string;
  number: number;
  branch: string;
  base: string;
  state: string;
  connection: string;
}

export interface Stack {
  /** the open pull request this one is stacked on (its base is that one's branch) */
  parent: number | null;
  /** the merged pull request whose branch this one still targets: it should be retargeted */
  parentMerged: number | null;
  /** open pull requests stacked on this one */
  children: number[];
  /** how deep: 0 when it targets a plain branch */
  depth: number;
}

/** Where a pull request sits in its stack, among the pull requests of the same repository. */
export function stackOf(all: readonly StackPull[], id: string): Stack {
  const me = all.find((p) => p.id === id);
  const none: Stack = { parent: null, parentMerged: null, children: [], depth: 0 };
  if (!me) return none;
  const same = all.filter((p) => p.connection === me.connection && p.id !== me.id);
  const openOn = (branch: string) =>
    same.find((p) => p.state === 'open' && p.branch === branch) ?? null;
  const parent = openOn(me.base);
  let depth = 0;
  for (let at = parent, seen = new Set<string>(); at && !seen.has(at.id); at = openOn(at.base)) {
    seen.add(at.id);
    depth += 1;
  }
  const merged = parent
    ? null
    : (same
        .filter((p) => p.state === 'merged' && p.branch === me.base)
        .sort((x, y) => y.number - x.number)[0] ?? null);
  return {
    parent: parent?.number ?? null,
    parentMerged: merged?.number ?? null,
    children: same
      .filter((p) => p.state === 'open' && p.base === me.branch)
      .map((p) => p.number)
      .sort((x, y) => x - y),
    depth,
  };
}
