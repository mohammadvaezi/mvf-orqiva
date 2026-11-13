// ── [PCODE-175 | S15 | v0.1.0] B4.1 Test and Versions on the server: suites, steps, configs, evidence, flaky, Playwright, pull requests, releases, notes, flags, DORA ──
//    Why:  the rules of Test and Versions that the server, the web app and the extension share: the next
//          semantic version from what a release contains, when a test counts as flaky, release notes for
//          the team and for a client, Playwright's JSON report read into results, and the four DORA
//          numbers from a project's deploys.

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

export interface ReleaseChange {
  kind: string;
  breaking: boolean;
}

/** The next version after `last`: major for a breaking change, minor for new work, patch for fixes. */
export function nextVersion(last: string | null, changes: readonly ReleaseChange[]): string {
  const m = SEMVER.exec(last ?? '');
  const [major, minor, patch] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  if (!m) return changes.some((c) => c.breaking) ? '1.0.0' : '0.1.0';
  if (changes.some((c) => c.breaking)) return String(major + 1) + '.0.0';
  if (changes.some((c) => c.kind !== 'bug' && c.kind !== 'task'))
    return String(major) + '.' + String(minor + 1) + '.0';
  return String(major) + '.' + String(minor) + '.' + String(patch + 1);
}

/** Compares two versions (pre-releases sort before their release). */
export function compareVersions(a: string, b: string): number {
  const x = SEMVER.exec(a);
  const y = SEMVER.exec(b);
  if (!x || !y) return a.localeCompare(b);
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return d;
  }
  const pa = a.includes('-');
  const pb = b.includes('-');
  return pa === pb ? a.localeCompare(b) : pa ? -1 : 1;
}

/**
 * Flaky: across its last results (newest first, at most ten), a case both passed and failed at least
 * twice each and changed outcome at least three times. Skipped and blocked results do not count.
 */
export function flakiness(statuses: readonly string[]): {
  flips: number;
  flaky: boolean;
  passRate: number;
} {
  const s = statuses.filter((x) => x === 'passed' || x === 'failed').slice(0, 10);
  let flips = 0;
  for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) flips++;
  const passed = s.filter((x) => x === 'passed').length;
  const failed = s.length - passed;
  return {
    flips,
    flaky: passed >= 2 && failed >= 2 && flips >= 3,
    passRate: s.length ? Math.round((passed / s.length) * 100) : 0,
  };
}

export interface NoteItem {
  ref: string;
  title: string;
  kind: string;
  breaking: boolean;
}

const GROUPS: { title: string; clientTitle: string; match: (i: NoteItem) => boolean }[] = [
  {
    title: 'Breaking changes',
    clientTitle: 'Changes you need to know about',
    match: (i) => i.breaking,
  },
  {
    title: 'New',
    clientTitle: 'New',
    match: (i) =>
      !i.breaking && (i.kind === 'story' || i.kind === 'epic' || i.kind === 'milestone'),
  },
  {
    title: 'Improved',
    clientTitle: 'Improved',
    match: (i) => !i.breaking && (i.kind === 'task' || i.kind === 'spike'),
  },
  { title: 'Fixed', clientTitle: 'Fixed', match: (i) => !i.breaking && i.kind === 'bug' },
];

/** Release notes in Markdown: the team's with task references, the client's in plain words without. */
export function releaseNotes(
  version: string,
  items: readonly NoteItem[],
  audience: 'team' | 'client',
  date?: string,
): string {
  const lines = ['# ' + version + (date ? ' (' + date + ')' : ''), ''];
  for (const g of GROUPS) {
    const list = items.filter(g.match).filter((i) => audience === 'team' || i.kind !== 'spike');
    if (!list.length) continue;
    lines.push('## ' + (audience === 'team' ? g.title : g.clientTitle), '');
    for (const i of list) lines.push('- ' + (audience === 'team' ? i.ref + ' ' : '') + i.title);
    lines.push('');
  }
  if (lines.length === 2)
    lines.push(audience === 'team' ? 'No tasks in this release yet.' : 'Maintenance release.', '');
  return lines.join('\n');
}

export interface ImportedResult {
  key: string;
  title: string;
  suite: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  message: string;
}

const asObj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Playwright's JSON reporter output: suites of specs, each with tests and their results (retries). */
export function parsePlaywright(report: unknown): ImportedResult[] {
  const out: ImportedResult[] = [];
  const walk = (suite: Record<string, unknown>, path: string[]): void => {
    const title = typeof suite['title'] === 'string' ? suite['title'] : '';
    const here = title ? [...path, title] : path;
    for (const spec of asArr(suite['specs']).map(asObj)) {
      const name = typeof spec['title'] === 'string' ? spec['title'] : 'test';
      for (const test of asArr(spec['tests']).map(asObj)) {
        const project =
          typeof test['projectName'] === 'string' && test['projectName']
            ? ' [' + test['projectName'] + ']'
            : '';
        const results = asArr(test['results']).map(asObj);
        const last = results[results.length - 1] ?? {};
        const raw =
          typeof last['status'] === 'string'
            ? last['status']
            : typeof test['status'] === 'string'
              ? test['status']
              : 'skipped';
        const status: ImportedResult['status'] =
          raw === 'passed' ? 'passed' : raw === 'skipped' ? 'skipped' : 'failed';
        const error = asObj(last['error']);
        out.push({
          key: ('pw:' + [...here, name].join(' › ') + project).slice(0, 500),
          title: (name + project).slice(0, 300),
          suite: here.join(' / ').slice(0, 300),
          status,
          durationMs:
            typeof last['duration'] === 'number' ? Math.max(0, Math.round(last['duration'])) : 0,
          message: typeof error['message'] === 'string' ? error['message'].slice(0, 20000) : '',
        });
      }
    }
    for (const s of asArr(suite['suites']).map(asObj)) walk(s, here);
  };
  for (const s of asArr(asObj(report)['suites']).map(asObj)) walk(s, []);
  return out;
}

export interface DeployFact {
  status: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface Dora {
  /** successful production deploys per week */
  deploysPerWeek: number;
  /** median hours from a task's start to the deploy that shipped it */
  leadTimeHours: number | null;
  /** share of production deploys that failed, in percent */
  changeFailureRate: number | null;
  /** median hours from a failed deploy to the next successful one */
  timeToRestoreHours: number | null;
}

const median = (v: number[]): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2) * 10) / 10;
};

/** The four DORA numbers from the production deploys of a period and the lead times of its tasks. */
export function doraMetrics(
  deploys: readonly DeployFact[],
  leadTimesHours: readonly number[],
  days: number,
): Dora {
  const done = [...deploys]
    .filter((d) => d.status === 'succeeded' || d.status === 'failed')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ok = done.filter((d) => d.status === 'succeeded');
  const restore: number[] = [];
  for (let i = 0; i < done.length; i++) {
    const d = done[i];
    if (d?.status !== 'failed') continue;
    if (i > 0 && done[i - 1]?.status === 'failed') continue;
    const next = done.slice(i + 1).find((x) => x.status === 'succeeded');
    if (next?.finishedAt)
      restore.push(
        (Date.parse(next.finishedAt) - Date.parse(d.finishedAt ?? d.createdAt)) / 3_600_000,
      );
  }
  return {
    deploysPerWeek: Math.round((ok.length / Math.max(1, days / 7)) * 10) / 10,
    leadTimeHours: median([...leadTimesHours]),
    changeFailureRate: done.length
      ? Math.round(((done.length - ok.length) / done.length) * 100)
      : null,
    timeToRestoreHours: median(restore),
  };
}
