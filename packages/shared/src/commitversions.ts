// ── [PCODE-306 | S15 | v0.1.0] T31.6 Versions from commits: conventional commits, tags and components per path ──
//    Why:  the next version follows from what was merged since the last tag: a breaking change, a feature or
//          a fix, read from conventional commit messages ("feat(cart): …", "fix!: …", "BREAKING CHANGE:").
//          A monorepo's components each have a folder and a tag prefix and get their own version from the
//          commits that touched their folder. A message that is not conventional counts as a fix and is
//          reported, never silently dropped.
import { compareVersions } from './quality.js';

export interface ParsedCommit {
  type: string;
  scope: string;
  breaking: boolean;
  subject: string;
  conventional: boolean;
}

const HEAD = /^([a-zA-Z]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;
const BREAKING = /^BREAKING[ -]CHANGE:/m;

/** A commit message read as a conventional commit (its first line, and BREAKING CHANGE in the body). */
export function parseCommit(message: string): ParsedCommit {
  const first = message.split('\n')[0]?.trim() ?? '';
  const m = HEAD.exec(first);
  const body = message.slice(first.length);
  if (!m)
    return {
      type: '',
      scope: '',
      breaking: BREAKING.test(body),
      subject: first,
      conventional: false,
    };
  return {
    type: (m[1] ?? '').toLowerCase(),
    scope: m[2]?.trim() ?? '',
    breaking: m[3] === '!' || BREAKING.test(body),
    subject: m[4]?.trim() ?? '',
    conventional: true,
  };
}

export type Bump = 'major' | 'minor' | 'patch' | 'none';

/** Types that change nothing a user gets: they alone do not make a release. */
const QUIET = new Set(['docs', 'chore', 'test', 'tests', 'ci', 'build', 'style']);

export function bumpOf(commits: readonly ParsedCommit[]): Bump {
  if (commits.some((c) => c.breaking)) return 'major';
  if (commits.some((c) => c.type === 'feat')) return 'minor';
  if (commits.some((c) => !c.conventional || !QUIET.has(c.type))) return 'patch';
  return 'none';
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** The version after `last`; before 1.0.0 a breaking change raises the minor number, as is usual. */
export function applyBump(last: string | null, bump: Bump): string | null {
  if (bump === 'none') return null;
  const m = SEMVER.exec(last ?? '');
  if (!m) return bump === 'major' ? '1.0.0' : '0.1.0';
  const [x, y, z] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === 'major') return x === 0 ? '0.' + String(y + 1) + '.0' : String(x + 1) + '.0.0';
  if (bump === 'minor') return String(x) + '.' + String(y + 1) + '.0';
  return String(x) + '.' + String(y) + '.' + String(z + 1);
}

/** The version a tag names under a prefix ("v1.2.3", "server-v1.2.3"), or null. */
export function tagVersion(tag: string, prefix: string): string | null {
  if (!tag.startsWith(prefix)) return null;
  const rest = tag.slice(prefix.length);
  return SEMVER.test(rest) ? rest : null;
}

/** The highest version among the tags with that prefix, and its tag. */
export function lastTag(
  tags: readonly { name: string; sha: string }[],
  prefix: string,
): { name: string; sha: string; version: string } | null {
  let best: { name: string; sha: string; version: string } | null = null;
  for (const t of tags) {
    const v = tagVersion(t.name, prefix);
    if (v && (!best || compareVersions(v, best.version) > 0)) best = { ...t, version: v };
  }
  return best;
}

/** Whether a commit touched the folder; null when the host did not say which files it changed. */
export function touches(
  files: { added: string[]; modified: string[]; removed: string[] } | null,
  folder: string,
): boolean | null {
  if (!folder) return true;
  if (!files) return null;
  const dir = folder.replace(/^\/+|\/+$/g, '') + '/';
  return [...files.added, ...files.modified, ...files.removed].some((p) => p.startsWith(dir));
}

export interface ChangeCommit {
  sha: string;
  message: string;
}

const SECTION: { title: string; take: (c: ParsedCommit) => boolean }[] = [
  { title: 'Breaking changes', take: (c) => c.breaking },
  { title: 'Features', take: (c) => c.type === 'feat' },
  { title: 'Fixes', take: (c) => c.type === 'fix' },
  { title: 'Performance', take: (c) => c.type === 'perf' },
  { title: 'Other changes', take: (c) => !c.conventional || !QUIET.has(c.type) },
];

/** The changelog in Markdown: each commit once, in the first section it belongs to; quiet types left out. */
export function commitChangelog(commits: readonly ChangeCommit[]): string {
  const parsed = commits.map((c) => ({ c, p: parseCommit(c.message) }));
  const used = new Set<string>();
  const out: string[] = [];
  for (const s of SECTION) {
    const lines = parsed
      .filter((x) => !used.has(x.c.sha) && s.take(x.p))
      .map((x) => {
        used.add(x.c.sha);
        return (
          '- ' +
          (x.p.scope ? '**' + x.p.scope + ':** ' : '') +
          x.p.subject +
          ' (' +
          x.c.sha.slice(0, 7) +
          ')'
        );
      });
    if (lines.length) out.push('### ' + s.title, '', ...lines, '');
  }
  return out.join('\n').trim();
}

/** Why the bump is what it is, in words. */
export function bumpReason(commits: readonly ParsedCommit[], bump: Bump): string {
  const n = (f: (c: ParsedCommit) => boolean): number => commits.filter(f).length;
  const plural = (k: number, one: string): string => String(k) + ' ' + one + (k === 1 ? '' : 's');
  if (bump === 'none')
    return commits.length
      ? 'Only ' + plural(commits.length, 'commit') + ' that change nothing for users'
      : 'Nothing new since the last version';
  if (bump === 'major')
    return plural(
      n((c) => c.breaking),
      'breaking change',
    );
  if (bump === 'minor')
    return plural(
      n((c) => c.type === 'feat'),
      'feature',
    );
  const fixes = n((c) => c.conventional && !QUIET.has(c.type));
  const odd = n((c) => !c.conventional);
  return [
    fixes ? plural(fixes, 'fix').replace('fixs', 'fixes') : '',
    odd ? plural(odd, 'message') + ' not in the conventional form (counted as fixes)' : '',
  ]
    .filter(Boolean)
    .join(', ');
}
