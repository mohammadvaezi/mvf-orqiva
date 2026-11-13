// ── [PCODE-20 | S04 | v0.1.0] Build the task detail panel with description, acceptance, comments and badges ──
//    Why:  pure assembly of TaskData from Plane objects or from the offline board; the panel host only fetches.
import type { Comment, Issue, Label, State } from '../../plane/types';
import type { Item } from '../../state/board';
import { htmlToText, sanitizeHtml } from '../../util/sanitize';
import type { TaskData } from '../protocol';

const CHECK = /^\s*[☐☑☒]\s*(.*)$/;

// ── [PCODE-20 | S04 | v0.1.0] splitAcceptance: the "Acceptance" section (engine writes ☐/☑ list items) ──
export function splitAcceptance(descriptionHtml: string): {
  body: string;
  acceptance: { text: string; done: boolean }[];
} {
  const safe = sanitizeHtml(descriptionHtml);
  const idx = safe.search(/<h[1-6]>\s*Acceptance\s*<\/h[1-6]>/i);
  if (idx < 0) return { body: safe, acceptance: [] };
  const rest = safe.slice(idx);
  const end = rest.search(/<h[1-6]>(?!\s*Acceptance)/i);
  const section = end > 0 ? rest.slice(0, end) : rest;
  const acceptance: { text: string; done: boolean }[] = [];
  for (const m of section.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const t = htmlToText(m[1] ?? '');
    const c = CHECK.exec(t);
    const check = /<input type="checkbox" disabled( checked)?>/.exec(m[1] ?? '');
    acceptance.push({
      text: (c?.[1] ?? t).trim(),
      done: (c ? t.startsWith('☑') : false) || Boolean(check?.[1]),
    });
  }
  const body = safe.slice(0, idx) + (end > 0 ? rest.slice(end) : '');
  return { body: body.trim(), acceptance };
}

// ── [PCODE-20 | S04 | v0.1.0] taskDataFromPlane ──
export function taskDataFromPlane(
  issue: Issue,
  comments: Comment[],
  states: State[],
  labels: Label[],
  identifier: string,
  url: string,
  files: TaskData['files'],
  activeRef: string | null,
): TaskData {
  const st = states.find((s) => s.id === issue.state);
  const { body, acceptance } = splitAcceptance(issue.description_html ?? '');
  const ref = `${identifier}-${issue.sequence_id}`;
  return {
    ref,
    title: issue.name,
    state: { name: st?.name ?? '?', group: st?.group ?? 'backlog' },
    priority: issue.priority ?? 'none',
    labels: issue.labels.map((id) => labels.find((l) => l.id === id)?.name ?? id),
    url,
    descriptionHtml: body,
    acceptance,
    comments: [...comments]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((c) => ({
        date: c.created_at.slice(0, 10),
        html: sanitizeHtml(c.comment_html),
        ...(c.actor_detail?.display_name ? { who: c.actor_detail.display_name } : {}),
      })),
    files,
    offline: false,
    isActive: activeRef === ref,
  };
}

// ── [PCODE-20 | S04 | v0.1.0] taskDataOffline: what sprints.md knows plus the offline notice ──
export function taskDataOffline(
  item: Item,
  files: TaskData['files'],
  activeRef: string | null,
  boardUrl?: string,
): TaskData {
  return {
    ref: item.ref,
    title: item.title,
    state: item.state,
    priority: item.priority,
    labels: item.labels,
    ...((item.url ?? boardUrl) ? { url: item.url ?? boardUrl ?? '' } : {}),
    descriptionHtml: '',
    acceptance: [],
    comments: [],
    files,
    offline: true,
    isActive: activeRef === item.ref,
  };
}
