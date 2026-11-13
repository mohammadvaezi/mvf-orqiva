// ── [PCODE-183 | S15 | v0.1.0] B6.1 Activity at scale live: search, query language, facets, histogram, saved views, export, archive, hash chain, webhooks ──
//    Why:  one query language for the Activity page, saved views, exports and webhooks, shared by server,
//          web app and CLI: `actor:agent project:APP type:item -verb:progressed since:24h in:archive` and
//          free words for the full text. Also the small rules around it: time spans, repeats that collapse
//          into one line, and CSV that spreadsheets open safely.

export type QueryField = 'actor' | 'project' | 'type' | 'verb' | 'text';
export interface QueryTerm {
  field: QueryField;
  value: string;
  not: boolean;
}
export interface ActivityQuery {
  terms: QueryTerm[];
  /** only events of the last … hours */
  sinceHours: number | null;
  /** include the archive tier */
  archive: boolean;
  errors: string[];
}

const ALIASES: Record<string, QueryField> = {
  actor: 'actor',
  who: 'actor',
  project: 'project',
  type: 'type',
  kind: 'type',
  object: 'type',
  verb: 'verb',
  did: 'verb',
};

/** 30m, 24h, 7d, 2w as hours; null when it is not a span. */
export function spanHours(v: string): number | null {
  const m = /^(\d{1,4})([mhdw])$/.exec(v.trim().toLowerCase());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  return unit === 'm' ? n / 60 : unit === 'h' ? n : unit === 'd' ? n * 24 : n * 24 * 7;
}

/** Reads a query; words in quotes stay together. Unknown fields and bad spans are reported, not guessed. */
export function parseActivityQuery(q: string): ActivityQuery {
  const out: ActivityQuery = { terms: [], sinceHours: null, archive: false, errors: [] };
  const tokens = q.match(/-?[a-z]+:"[^"]*"|-?"[^"]*"|\S+/gi) ?? [];
  for (const raw of tokens) {
    const not = raw.startsWith('-') && raw.length > 1;
    const tok = not ? raw.slice(1) : raw;
    const m = /^([a-z]+):(.*)$/i.exec(tok);
    const unquote = (s: string): string => s.replace(/^"|"$/g, '').trim();
    if (!m) {
      const v = unquote(tok).toLowerCase();
      if (v) out.terms.push({ field: 'text', value: v, not });
      continue;
    }
    const key = (m[1] ?? '').toLowerCase();
    const value = unquote(m[2] ?? '');
    if (key === 'since') {
      const h = spanHours(value);
      if (h === null) out.errors.push('since takes a span like 30m, 24h, 7d or 2w');
      else out.sinceHours = h;
      continue;
    }
    if (key === 'in') {
      if (value.toLowerCase() === 'archive') out.archive = true;
      else out.errors.push('in takes archive');
      continue;
    }
    const field = ALIASES[key];
    if (!field) {
      out.errors.push('Unknown field ' + key + ': use actor, project, type, verb, since or in');
      continue;
    }
    if (!value) {
      out.errors.push(key + ' needs a value');
      continue;
    }
    out.terms.push({ field, value: value.toLowerCase(), not });
  }
  return out;
}

/** The query back as text, e.g. to save a view after the facets changed it. */
export function formatActivityQuery(q: ActivityQuery): string {
  const quote = (v: string): string => (/\s/.test(v) ? '"' + v + '"' : v);
  return [
    ...q.terms.map(
      (t) =>
        (t.not ? '-' : '') + (t.field === 'text' ? quote(t.value) : t.field + ':' + quote(t.value)),
    ),
    ...(q.sinceHours !== null
      ? [
          'since:' +
            (Number.isInteger(q.sinceHours)
              ? String(q.sinceHours) + 'h'
              : String(Math.round(q.sinceHours * 60)) + 'm'),
        ]
      : []),
    ...(q.archive ? ['in:archive'] : []),
  ].join(' ');
}

export interface RepeatInput {
  actorId: string;
  verb: string;
  objectType: string;
  time: string;
}

/**
 * Collapses runs of the same actor doing the same thing to the same kind of object within a few
 * minutes of each other ("Coder progressed 42 agent runs"); returns, per event, how many follow it in
 * its run (0 for events folded into the one before).
 */
export function collapseRepeats(events: readonly RepeatInput[], minutes = 10): number[] {
  const out = events.map(() => 0);
  let head = -1;
  events.forEach((e, i) => {
    const h = head >= 0 ? events[head] : undefined;
    const same =
      h !== undefined &&
      h.actorId === e.actorId &&
      h.verb === e.verb &&
      h.objectType === e.objectType &&
      Math.abs(new Date(h.time).getTime() - new Date(e.time).getTime()) <= minutes * 60_000;
    if (same) {
      out[head] = (out[head] ?? 0) + 1;
      out[i] = -1;
    } else head = i;
  });
  return out;
}

/** CSV with every cell quoted; cells that a spreadsheet would run as a formula get a leading quote. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const cell = (v: string): string => {
    const safe = /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
