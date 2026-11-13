// ── [PCODE-360 | S15 | v0.1.0] T35.7b Jira and Linear imports with assignees and comments ──
// ── [PCODE-129 | S15 | v0.1.0] Import from Jira and Linear CSV exports ──
//    Why:  teams arrive from Jira and Linear with their backlog in a CSV export. Both are read into the same
//          bundle the Plane importer sends, so the server's import (idempotent, numbers kept) does the rest:
//          APP-12 stays APP-12, and a second run updates instead of duplicating. Statuses map to state
//          groups by the tool's own category where it has one, by well-known names where not.
import { records, toIso, type Record } from './csv.js';
import type { Bundle } from './plane.js';

export class TrackerError extends Error {}

type Group = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';

const CANCELLED = /^(cancel+ed|won'?t (do|fix)|declined|rejected|duplicate|obsolete)$/i;
const DONE = /^(done|closed|resolved|released|shipped|complete[d]?)$/i;
const STARTED = /^(in progress|in review|review|code review|testing|in test|qa|doing|started)$/i;

/** A status name to a group, by name alone. */
export function groupOfName(status: string): Group {
  const s = status.trim();
  if (CANCELLED.test(s)) return 'cancelled';
  if (DONE.test(s)) return 'completed';
  if (STARTED.test(s)) return 'started';
  if (/^backlog$/i.test(s)) return 'backlog';
  return 'unstarted';
}

/** Jira: its status category decides, the name refines (Backlog, Won't Do). */
export function jiraGroup(status: string, category: string): Group {
  if (CANCELLED.test(status.trim())) return 'cancelled';
  const c = category.trim().toLowerCase();
  if (c === 'done') return 'completed';
  if (c === 'in progress') return 'started';
  if (c === 'to do' || c === 'new')
    return /^backlog$/i.test(status.trim()) ? 'backlog' : 'unstarted';
  return groupOfName(status);
}

/** Linear: the timestamps it exports say where an issue is; the name is the fallback. */
export function linearGroup(status: string, r: Pick<Record, 'get'>): Group {
  if (r.get('Canceled') || r.get('Cancelled')) return 'cancelled';
  if (r.get('Completed')) return 'completed';
  if (r.get('Started')) return 'started';
  return groupOfName(status);
}

const KEY = /^([A-Z][A-Z0-9]{1,9})-(\d+)$/;

/** Story points as a whole number, when the field holds one. */
export function points(value: string): number | null {
  const n = Number(value.replace(',', '.'));
  if (!value.trim() || !Number.isFinite(n) || n < 0) return null;
  return Math.min(1000, Math.round(n));
}

interface Row {
  externalId: string;
  key: string;
  sequence: number;
  title: string;
  description: string;
  status: string;
  group: Group;
  labels: string[];
  sprint: string;
  parent: string;
  priority: string;
  estimate: number | null;
  createdAt: string;
  updatedAt: string;
  // [PCODE-360 | S15 | v0.1.0] who holds it and what was said, as the file names them
  assignee: string;
  comments: { author: string; body: string; createdAt: string }[];
}

/** Rows of one project (the most common key, or the one asked for) into the import bundle. */
function bundleOf(
  tool: 'jira' | 'linear',
  rows: Row[],
  projectName: (key: string) => string,
  onlyKey?: string,
): { bundle: Bundle; skipped: number } {
  if (!rows.length) throw new TrackerError('The file has no issues');
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.key, (counts.get(r.key) ?? 0) + 1);
  const key =
    onlyKey?.toUpperCase() ?? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const mine = rows.filter((r) => r.key === key);
  if (!mine.length) throw new TrackerError('No issues with the key ' + key + ' in the file');
  const ext = (kind: string, name: string): string => tool + ':' + key + ':' + kind + ':' + name;
  const states = new Map<string, Group>();
  for (const r of mine) if (!states.has(r.status)) states.set(r.status, r.group);
  const labels = new Set(mine.flatMap((r) => r.labels));
  const sprints = new Set(mine.map((r) => r.sprint).filter(Boolean));
  const byRef = new Map<string, string>();
  for (const r of mine) {
    byRef.set(r.externalId, r.externalId);
    byRef.set(r.key + '-' + String(r.sequence), r.externalId);
  }
  const bundle: Bundle = {
    project: { externalId: tool + ':project:' + key, key, name: projectName(key), description: '' },
    states: [...states.entries()].map(([name, group]) => ({
      externalId: ext('state', name),
      name,
      group,
    })),
    labels: [...labels].map((name) => ({
      externalId: ext('label', name),
      name: name.slice(0, 60),
    })),
    sprints: [...sprints].map((name) => ({
      externalId: ext('sprint', name),
      name: name.slice(0, 120),
      goal: '',
      startDate: null,
      endDate: null,
    })),
    items: mine
      .sort((a, b) => a.sequence - b.sequence)
      .map((r) => ({
        externalId: r.externalId,
        sequence: r.sequence,
        title: r.title.slice(0, 255) || r.key + '-' + String(r.sequence),
        description: r.description,
        stateExternalId: ext('state', r.status),
        labelExternalIds: r.labels.map((l) => ext('label', l)),
        sprintExternalId: r.sprint ? ext('sprint', r.sprint) : null,
        parentExternalId: (r.parent && byRef.get(r.parent)) || null,
        priority: /^no priority$/i.test(r.priority) ? 'none' : r.priority.toLowerCase(),
        estimate: r.estimate,
        // [PCODE-360 | S15 | v0.1.0] a name, an email or an id for now; matchPeople turns it into an email
        assigneeEmails: r.assignee ? [r.assignee] : [],
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    comments: mine.flatMap((r) =>
      r.comments.map((cm, i) => ({
        externalId: r.externalId + ':comment:' + String(i + 1),
        itemExternalId: r.externalId,
        body: cm.body,
        author: cm.author.slice(0, 200),
        ...(cm.author.includes('@') ? { authorEmail: cm.author } : {}),
        createdAt: cm.createdAt,
        editedAt: null,
      })),
    ),
    history: [],
  };
  return { bundle, skipped: rows.length - mine.length };
}

// [PCODE-360 | S15 | v0.1.0]
/** A Jira comment cell: "date;author;text" (the text may hold more semicolons). */
export function jiraComment(
  cell: string,
  now: string,
): { author: string; body: string; createdAt: string } {
  const m = /^([^;]{6,40});([^;]*);([\s\S]*)$/.exec(cell);
  if (!m) return { author: '', body: cell.trim(), createdAt: now };
  return {
    author: (m[2] ?? '').trim(),
    body: (m[3] ?? '').trim(),
    createdAt: toIso(m[1] ?? '', now),
  };
}

/** A person of the workspace, or a line of the --people file. */
export interface PersonRef {
  name: string;
  email: string;
}

/** Turns the names, emails and ids in a bundle into members' emails: the --people file first, then a
 *  member's email, then a member's name. Unknown people are left out of assignees; a comment keeps the
 *  name as its author label. Returns the names found and the ones no one matched. */
export function matchPeople(
  b: Bundle,
  members: readonly PersonRef[],
  extra: readonly PersonRef[] = [],
): { named: number; unmatched: string[] } {
  const by = new Map<string, string>();
  for (const m of members) {
    by.set(m.name.trim().toLowerCase(), m.email);
    by.set(m.email.trim().toLowerCase(), m.email);
  }
  for (const p of extra) by.set(p.name.trim().toLowerCase(), p.email);
  const named = new Set<string>();
  const unmatched = new Set<string>();
  const find = (who: string): string | undefined => {
    const k = who.trim().toLowerCase();
    if (!k) return undefined;
    named.add(k);
    const hit = by.get(k);
    if (!hit) unmatched.add(who.trim());
    return hit;
  };
  for (const it of b.items)
    it.assigneeEmails = it.assigneeEmails.flatMap((who) => {
      const e = find(who);
      return e ? [e] : [];
    });
  for (const cm of b.comments) {
    const e = find(cm.authorEmail ?? cm.author);
    if (e) cm.authorEmail = e;
    else delete cm.authorEmail;
  }
  return { named: named.size, unmatched: [...unmatched].sort((a, b) => a.localeCompare(b)) };
}

/** The --people file: a CSV with a name (or an id) and an email per line. */
export function readPeople(text: string): PersonRef[] {
  return records(text).flatMap((r) => {
    const email = r.get('email') || r.get('Email');
    const name = r.get('name') || r.get('Name') || r.get('id') || r.get('Id');
    return email && name ? [{ name, email }] : [];
  });
}

/** A Jira CSV export ("Export Excel CSV (all fields)"). */
export function readJira(
  text: string,
  now: string,
  onlyKey?: string,
): { bundle: Bundle; skipped: number } {
  const recs = records(text);
  if (recs[0] && !recs[0].has('Issue key'))
    throw new TrackerError('This is not a Jira export: it has no "Issue key" column');
  const names = new Map<string, string>();
  const rows: Row[] = [];
  for (const r of recs) {
    const m = KEY.exec(r.get('Issue key'));
    if (!m) continue;
    const key = m[1] ?? '';
    if (r.get('Project name')) names.set(key, r.get('Project name'));
    const status = r.get('Status') || 'To Do';
    const type = r.get('Issue Type');
    rows.push({
      externalId: 'jira:' + (r.get('Issue id') || r.get('Issue key')),
      key,
      sequence: Number(m[2]),
      title: r.get('Summary'),
      description: r.get('Description'),
      status,
      group: jiraGroup(status, r.get('Status Category')),
      labels: [
        ...r.all('Labels'),
        ...(type && !/^(story|task|sub-?task)$/i.test(type) ? ['type: ' + type] : []),
      ],
      sprint: r.all('Sprint').at(-1) ?? '',
      parent: (() => {
        const p = r.get('Parent') || r.get('Parent id') || r.get('Parent key');
        return /^\d+$/.test(p) ? 'jira:' + p : p;
      })(),
      priority: r.get('Priority'),
      estimate: points(
        r.get('Custom field (Story Points)') ||
          r.get('Custom field (Story point estimate)') ||
          r.get('Story Points') ||
          r.get('Story point estimate'),
      ),
      createdAt: toIso(r.get('Created'), now),
      updatedAt: toIso(r.get('Updated'), now),
      assignee: r.get('Assignee') || r.get('Assignee Id'), // [PCODE-360 | S15 | v0.1.0]
      comments: r
        .all('Comment')
        .filter((v) => v.trim())
        .map((v) => jiraComment(v, now)),
    });
  }
  return bundleOf('jira', rows, (k) => names.get(k) ?? k, onlyKey);
}

/** A Linear CSV export (Settings, Import / export, Export CSV). */
export function readLinear(
  text: string,
  now: string,
  onlyKey?: string,
): { bundle: Bundle; skipped: number } {
  const recs = records(text);
  if (recs[0] && !(recs[0].has('ID') && recs[0].has('Title')))
    throw new TrackerError('This is not a Linear export: it has no "ID" and "Title" columns');
  const teams = new Map<string, string>();
  const rows: Row[] = [];
  for (const r of recs) {
    const m = KEY.exec(r.get('ID'));
    if (!m) continue;
    const key = m[1] ?? '';
    if (r.get('Team')) teams.set(key, r.get('Team'));
    const status = r.get('Status') || 'Todo';
    const cycle =
      r.get('Cycle Name') || (r.get('Cycle Number') ? 'Cycle ' + r.get('Cycle Number') : '');
    rows.push({
      externalId: 'linear:' + (r.get('UUID') || r.get('ID')),
      key,
      sequence: Number(m[2]),
      title: r.get('Title'),
      description: r.get('Description'),
      status,
      group: linearGroup(status, r),
      labels: r
        .get('Labels')
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean),
      sprint: cycle,
      parent: r.get('Parent issue') || r.get('Parent'),
      priority: r.get('Priority'),
      estimate: points(r.get('Estimate')),
      createdAt: toIso(r.get('Created'), now),
      updatedAt: toIso(r.get('Updated'), now),
      // [PCODE-360 | S15 | v0.1.0] Linear's CSV has the assignee but no comments
      assignee: r.get('Assignee'),
      comments: [],
    });
  }
  return bundleOf('linear', rows, (k) => teams.get(k) ?? k, onlyKey);
}
