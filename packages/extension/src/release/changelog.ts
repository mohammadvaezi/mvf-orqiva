// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-47 | S09 | v0.1.0] Generate the CHANGELOG.md section from Done items since the last tag ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  a release note nobody writes by hand: the tasks Plane marks done since the last tag, grouped by
//          their label, plus the commits that carry no task - because a commit without a Done item behind it
//          is exactly what a reader of the changelog should still see (criticals #7).
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Issue, Label, State } from '../plane/types';
import { refFromSubject, type Commit } from '../util/git';

export const CHANGELOG_FILE = 'CHANGELOG.md';
export const CHANGELOG_HEADER =
  '# Changelog\n\nEvery release, written from the items that were done for it.\n';
export const OTHER_GROUP = 'Other commits';

/** label -> section heading; anything else lands in Changes */
export const GROUPS: Record<string, string> = {
  feature: 'Features',
  bug: 'Fixes',
  hotfix: 'Fixes',
  chore: 'Chores',
  test: 'Tests',
};
export const GROUP_ORDER = ['Features', 'Fixes', 'Tests', 'Chores', 'Changes'];

export interface ChangelogEntry {
  ref: string;
  title: string;
  group: string;
  completedAt: string | null;
}

export interface ChangelogData {
  entries: ChangelogEntry[];
  /** commits since the tag with no Done item behind them */
  otherCommits: Commit[];
  since: string | null;
}

export function groupOfLabels(labels: readonly string[]): string {
  for (const l of labels) {
    const g = GROUPS[l.toLowerCase()];
    if (g) return g;
  }
  return 'Changes';
}

export function refOf(identifier: string, issue: Issue): string {
  return `${identifier}-${String(issue.sequence_id)}`;
}

export interface CollectInput {
  issues: readonly Issue[];
  states: readonly State[];
  labels: readonly Label[];
  identifier: string;
  /** ISO date of the last tag's commit; null means "everything that is done" */
  sinceIso: string | null;
  commits: readonly Commit[];
}

// ── [PCODE-47 | S09 | v0.1.0] collectChangelog: done since the tag, grouped; commits without a task kept ──
export function collectChangelog(input: CollectInput): ChangelogData {
  const completed = new Set(input.states.filter((s) => s.group === 'completed').map((s) => s.id));
  const labelName = new Map(input.labels.map((l) => [l.id, l.name]));
  const entries: ChangelogEntry[] = [];
  for (const issue of input.issues) {
    if (!completed.has(issue.state)) continue;
    const done = issue.completed_at ?? null;
    if (input.sinceIso && (!done || done <= input.sinceIso)) continue;
    entries.push({
      ref: refOf(input.identifier, issue),
      title: issue.name.trim(),
      group: groupOfLabels(issue.labels.map((id) => labelName.get(id) ?? id)),
      completedAt: done,
    });
  }
  entries.sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(a.group);
    const gb = GROUP_ORDER.indexOf(b.group);
    if (ga !== gb) return ga - gb;
    return Number(a.ref.split('-')[1]) - Number(b.ref.split('-')[1]);
  });
  const known = new Set(entries.map((e) => e.ref));
  const otherCommits = input.commits.filter((c) => {
    const ref = c.ref ?? refFromSubject(c.subject);
    return !ref || !known.has(ref);
  });
  return { entries, otherCommits, since: input.sinceIso };
}

// ── [PCODE-47 | S09 | v0.1.0] renderSection: "## v0.2.0 (2026-10-05)" and its groups ──
export function renderSection(version: string, date: string, data: ChangelogData): string {
  const lines = [`## v${version} (${date})`, ''];
  const groups = new Map<string, ChangelogEntry[]>();
  for (const e of data.entries) {
    const list = groups.get(e.group) ?? [];
    groups.set(e.group, list);
    list.push(e);
  }
  for (const group of GROUP_ORDER) {
    const list = groups.get(group);
    if (!list?.length) continue;
    lines.push(`### ${group}`, '');
    for (const e of list) lines.push(`- ${e.ref} ${e.title}`);
    lines.push('');
  }
  if (data.otherCommits.length) {
    lines.push(`### ${OTHER_GROUP}`, '');
    for (const c of data.otherCommits) lines.push(`- ${c.hash} ${c.subject}`);
    lines.push('');
  }
  if (!data.entries.length && !data.otherCommits.length)
    lines.push('_Nothing recorded for this release._', '');
  return lines.join('\n');
}

// ── [PCODE-47 | S09 | v0.1.0] upsertSection: a second run for the same version replaces its section ──
export function upsertSection(existing: string | null, version: string, section: string): string {
  const body = section.trimEnd();
  if (!existing?.trim()) return `${CHANGELOG_HEADER}\n${body}\n`;
  const lines = existing.split(/\r?\n/);
  const start = lines.findIndex(
    (l) => l.startsWith(`## v${version} (`) || l.trim() === `## v${version}`,
  );
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !lines[end]?.startsWith('## ')) end += 1;
    const before = lines.slice(0, start).join('\n').trimEnd();
    const after = lines.slice(end).join('\n').trimStart();
    return `${before}\n\n${body}\n${after ? `\n${after.trimEnd()}\n` : ''}`;
  }
  const firstSection = lines.findIndex((l) => l.startsWith('## '));
  if (firstSection < 0) return `${existing.trimEnd()}\n\n${body}\n`;
  const head = lines.slice(0, firstSection).join('\n').trimEnd();
  const rest = lines.slice(firstSection).join('\n').trimEnd();
  return `${head}\n\n${body}\n\n${rest}\n`;
}

export interface ChangelogIo {
  existsSync: (p: string) => boolean;
  readFileSync: (p: string, enc: 'utf8') => string;
  writeFileSync: (p: string, data: string, enc: 'utf8') => void;
}

const defaultIo: ChangelogIo = {
  existsSync: (p) => fs.existsSync(p),
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  writeFileSync: (p, d, enc) => {
    fs.writeFileSync(p, d, enc);
  },
};

export function writeChangelog(
  root: string,
  version: string,
  section: string,
  io: ChangelogIo = defaultIo,
): { file: string; created: boolean } {
  const file = path.join(root, CHANGELOG_FILE);
  const existed = io.existsSync(file);
  const existing = existed ? io.readFileSync(file, 'utf8') : null;
  io.writeFileSync(file, upsertSection(existing, version, section), 'utf8');
  return { file, created: !existed };
}
