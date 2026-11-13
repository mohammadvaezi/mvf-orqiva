// ── [PCODE-129 | S15 | v0.1.0] Import from Jira and Linear CSV exports ──
//    Why:  our own reader for RFC 4180 CSV, the format both Jira and Linear export: quoted fields, doubled
//          quotes, commas and line breaks inside quotes, CRLF or LF, and a byte-order mark. Jira repeats a
//          column name for multi-value fields (Labels, Sprint), so rows keep every value under its name.

/** Splits CSV text into rows of fields. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      row.push(field);
      field = '';
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
    } else {
      field += ch;
    }
    i += 1;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
  }
  return rows;
}

/** A row read by column name: the first value, or every value of a repeated column. */
export interface Record {
  get(name: string): string;
  all(name: string): string[];
  has(name: string): boolean;
}

/** The rows after the header, read by column name (case and spacing do not matter). */
export function records(text: string): Record[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const columns = new Map<string, number[]>();
  header.forEach((h, i) => {
    const k = norm(h);
    columns.set(k, [...(columns.get(k) ?? []), i]);
  });
  return rows.map((r) => ({
    get: (name) => {
      for (const i of columns.get(norm(name)) ?? []) {
        const v = (r[i] ?? '').trim();
        if (v) return v;
      }
      return '';
    },
    all: (name) => (columns.get(norm(name)) ?? []).map((i) => (r[i] ?? '').trim()).filter(Boolean),
    has: (name) => columns.has(norm(name)),
  }));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A date as both tools write it, as ISO 8601: ISO itself (Linear), or Jira's "03/Oct/26 2:15 PM".
 * An unreadable date becomes the fallback (the time of the import).
 */
export function toIso(value: string, fallback: string): string {
  const v = value.trim();
  if (!v) return fallback;
  const jira = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M)?)?$/i.exec(v);
  if (jira) {
    const month = MONTHS.indexOf((jira[2] ?? '').toLowerCase());
    let year = Number(jira[3]);
    if (year < 100) year += 2000;
    let hour = Number(jira[4] ?? 0);
    const pm = (jira[6] ?? '').toUpperCase() === 'PM';
    if (jira[6]) hour = (hour % 12) + (pm ? 12 : 0);
    if (month >= 0)
      return new Date(
        Date.UTC(year, month, Number(jira[1]), hour, Number(jira[5] ?? 0)),
      ).toISOString();
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}
