// ── [PCODE-204 | S15 | v0.1.0] T17.2 Promotions with approval, rollback per environment, backports, go/no-go meeting notes ──
// ── [PCODE-203 | S15 | v0.1.0] T17.1 Release trains on the server: releases of several projects, freeze, go/no-go, ship with deploys, rollback ──
//    Why:  a release train ships the releases of several projects together, so the rules about it are the
//          same on the server, in the web app and in the terminal: what a release still needs before the
//          train may go, and what the train's deploys say about it (on its way, shipped, or partly
//          shipped because one deploy failed, which calls for a decision: fix forward or roll back).

export const TRAIN_STATES = [
  'planned',
  'frozen',
  'shipping',
  'shipped',
  'partial',
  'rolling_back',
  'rolled_back',
] as const;
export type TrainState = (typeof TRAIN_STATES)[number];

export interface TrainMember {
  project: string;
  version: string;
  items: number;
  done: number;
  environment: string | null;
  /** release policy violations, as sentences */
  violations: string[];
}

export interface MemberCheck {
  project: string;
  version: string;
  ready: boolean;
  missing: string[];
}

/** What each release still needs before the train goes; the train goes when none needs anything. */
export function trainChecks(members: readonly TrainMember[]): MemberCheck[] {
  return members.map((m) => {
    const missing: string[] = [];
    if (m.done < m.items)
      missing.push(
        String(m.items - m.done) +
          (m.items - m.done === 1 ? ' task is' : ' tasks are') +
          ' not done',
      );
    if (!m.environment) missing.push('No environment to ship to');
    missing.push(...m.violations);
    return { project: m.project, version: m.version, ready: missing.length === 0, missing };
  });
}

export type DeployStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * Where a shipping (or rolling back) train stands from the latest deploy of each release: done when all
 * succeeded, partly done when any failed or was cancelled while the others finished, still moving
 * otherwise.
 */
export function trainProgress(
  moving: 'shipping' | 'rolling_back',
  deploys: readonly (DeployStatus | null)[],
): TrainState {
  const live = deploys.filter((d): d is DeployStatus => d !== null);
  if (!live.length) return moving === 'shipping' ? 'shipped' : 'rolled_back';
  if (live.some((d) => d === 'queued' || d === 'running')) return moving;
  if (live.every((d) => d === 'succeeded'))
    return moving === 'shipping' ? 'shipped' : 'rolled_back';
  return 'partial';
}

/** The sentence a train's state reads as. */
export function trainStateText(state: string): string {
  const t: Record<string, string> = {
    planned: 'planned',
    frozen: 'frozen: fixes only',
    shipping: 'shipping',
    shipped: 'shipped',
    partial: 'partly shipped: a deploy failed',
    rolling_back: 'rolling back',
    rolled_back: 'rolled back',
  };
  return t[state] ?? state;
}

// ── [PCODE-204 | S15 | v0.1.0] version lines for backports, and what an environment does not have yet ──
const SEM = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

/** The line a version belongs to: 1.3.8 → 1.3. */
export const lineOf = (version: string): string | null => {
  const m = SEM.exec(version);
  return m ? String(m[1]) + '.' + String(m[2]) : null;
};

/** The next patch on a line, after the versions it shipped: 1.3 with 1.3.7 and 1.3.8 shipped → 1.3.9. */
export function backportVersion(shipped: readonly string[], line: string): string | null {
  const patches = shipped
    .filter((v) => lineOf(v) === line && !v.includes('-'))
    .map((v) => Number(SEM.exec(v)?.[3] ?? -1));
  if (!patches.length) return null;
  return line + '.' + String(Math.max(...patches) + 1);
}

/** Releases between what runs behind and what runs ahead: their tasks and fixes are not there yet. */
export function notYetOn(
  releases: readonly { version: string; tasks: number; fixes: number }[],
  ahead: string | null,
  behind: string | null,
  compare: (a: string, b: string) => number,
): { versions: string[]; tasks: number; fixes: number } {
  if (!ahead) return { versions: [], tasks: 0, fixes: 0 };
  const between = releases
    .filter((r) => compare(r.version, ahead) <= 0 && (!behind || compare(r.version, behind) > 0))
    .sort((a, b) => compare(a.version, b.version));
  return {
    versions: between.map((r) => r.version),
    tasks: between.reduce((n, r) => n + r.tasks, 0),
    fixes: between.reduce((n, r) => n + r.fixes, 0),
  };
}
