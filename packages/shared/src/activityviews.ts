// ── [PCODE-355 | S15 | v0.1.0] T35.4c Activity: query autocomplete, columns, group-by, drag to zoom, heat map ──
//    Why:  Activity at scale reads faster with help: the query box suggests fields and the values in view,
//          events can be grouped by who, kind, project or day, and a heat map shows when work happens. The
//          rules are here so the web page and its tests agree.
import type { ActivityEvent } from './events.js';

export const QUERY_FIELDS = [
  'actor:',
  'project:',
  'type:',
  'verb:',
  'since:',
  'in:archive',
] as const;
const SPANS = ['1h', '24h', '7d', '30d'];

/** The word being typed at the caret: where it starts and what it says so far. */
export function wordAt(query: string, caret: number): { start: number; word: string } {
  const before = query.slice(0, caret);
  const start = before.search(/\S*$/);
  return { start, word: before.slice(start) };
}

/** What to offer for the word at the caret: fields, or values of the field typed. */
export function querySuggestions(
  query: string,
  caret: number,
  values: {
    actor: readonly string[];
    project: readonly string[];
    type: readonly string[];
    verb: readonly string[];
  },
): string[] {
  const { word } = wordAt(query, caret);
  const neg = word.startsWith('-') ? '-' : '';
  const w = neg ? word.slice(1) : word;
  const m = /^([a-z]+):(.*)$/i.exec(w);
  if (m) {
    const field = (m[1] ?? '').toLowerCase();
    const typed = (m[2] ?? '').replace(/^"/, '').toLowerCase();
    const pool =
      field === 'since'
        ? SPANS
        : field === 'actor' || field === 'project' || field === 'type' || field === 'verb'
          ? values[field]
          : [];
    return [...new Set(pool)]
      .filter((v) => v.toLowerCase().startsWith(typed) && v.toLowerCase() !== typed)
      .slice(0, 8)
      .map((v) => neg + field + ':' + (/\s/.test(v) ? '"' + v + '"' : v));
  }
  if (!w) return [];
  return QUERY_FIELDS.filter((f) => f.startsWith(w.toLowerCase()) && f !== w.toLowerCase()).map(
    (f) => neg + f,
  );
}

/** The query with the word at the caret replaced by a suggestion, and where the caret goes. */
export function acceptSuggestion(
  query: string,
  caret: number,
  s: string,
): { query: string; caret: number } {
  const { start } = wordAt(query, caret);
  const rest = query.slice(caret).replace(/^\S*/, '');
  const add = s.endsWith(':') ? s : s + ' ';
  return { query: query.slice(0, start) + add + rest.replace(/^ /, ''), caret: start + add.length };
}

export type GroupBy = 'actor' | 'type' | 'project' | 'day';

/** Events in groups, largest first; days newest first. */
export function groupEvents<T extends { event: ActivityEvent }>(
  hits: readonly T[],
  by: GroupBy,
  projectKey: (id: string | undefined) => string,
  dayOf: (iso: string) => string,
): { key: string; hits: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const h of hits) {
    const e = h.event;
    const key =
      by === 'actor'
        ? (e.data.actor.name ?? e.data.actor.kind)
        : by === 'type'
          ? e.data.object.type.replace(/_/g, ' ')
          : by === 'project'
            ? projectKey(e.projectid)
            : dayOf(e.time);
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }
  const list = [...groups.entries()].map(([key, hs]) => ({ key, hits: hs }));
  return by === 'day'
    ? list.sort((a, b) => (b.hits[0]?.event.time ?? '').localeCompare(a.hits[0]?.event.time ?? ''))
    : list.sort((a, b) => b.hits.length - a.hits.length || a.key.localeCompare(b.key));
}

/** A heat map's level per cell, 0 (none) to 4 (the busiest hour). */
export function heatLevels(heat: readonly (readonly number[])[]): number[][] {
  const max = Math.max(0, ...heat.flat());
  return heat.map((row) =>
    row.map((n) => (n === 0 || max === 0 ? 0 : Math.max(1, Math.ceil((n / max) * 4)))),
  );
}
