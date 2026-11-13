// ── [PCODE-205 | S15 | v0.1.0] T17.3 Release agent with release tools, approved release notes, changelogs per release, project and train ──
//    Why:  a changelog in the form people know (Keep a Changelog): one section per shipped version, newest
//          first, the changes grouped by what they are. The groups come from the task kinds; a breaking
//          change is named first so nobody misses it. The same text for the server, the terminal and the
//          extension.
import type { NoteItem } from './quality.js';

export interface ChangelogVersion {
  version: string;
  /** YYYY-MM-DD, or null while it is not shipped */
  date: string | null;
  items: readonly NoteItem[];
  rolledBack?: boolean;
}

const GROUPS: { title: string; match: (i: NoteItem) => boolean }[] = [
  { title: 'Added', match: (i) => i.kind === 'story' || i.kind === 'epic' || i.kind === 'feature' },
  { title: 'Fixed', match: (i) => i.kind === 'bug' },
  {
    title: 'Changed',
    match: (i) => i.kind === 'task' || i.kind === 'spike' || i.kind === 'milestone',
  },
];

/** One version's section: ## [1.4.0] - 2026-10-16, then Breaking, Added, Fixed, Changed. */
export function changelogSection(v: ChangelogVersion): string {
  const head =
    '## [' + v.version + '] - ' + (v.date ?? 'Unreleased') + (v.rolledBack ? ' [ROLLED BACK]' : '');
  const lines = [head, ''];
  const breaking = v.items.filter((i) => i.breaking);
  if (breaking.length) {
    lines.push('### Breaking', '');
    for (const i of breaking) lines.push('- ' + i.title + ' (' + i.ref + ')');
    lines.push('');
  }
  const placed = new Set<NoteItem>(breaking);
  for (const g of GROUPS) {
    const list = v.items.filter((i) => !placed.has(i) && g.match(i));
    if (!list.length) continue;
    lines.push('### ' + g.title, '');
    for (const i of list) {
      lines.push('- ' + i.title + ' (' + i.ref + ')');
      placed.add(i);
    }
    lines.push('');
  }
  const rest = v.items.filter((i) => !placed.has(i));
  if (rest.length) {
    lines.push('### Changed', '');
    for (const i of rest) lines.push('- ' + i.title + ' (' + i.ref + ')');
    lines.push('');
  }
  if (lines.length === 2) lines.push('- Maintenance release.', '');
  return lines.join('\n');
}

/** A whole changelog: the title, then every version newest first. */
export function changelog(
  title: string,
  versions: readonly ChangelogVersion[],
  compare: (a: string, b: string) => number,
): string {
  const sorted = [...versions].sort((a, b) => compare(b.version, a.version));
  return [
    '# ' + title,
    '',
    'All notable changes, newest first. The format follows Keep a Changelog.',
    '',
    ...sorted.map(changelogSection),
  ].join('\n');
}
