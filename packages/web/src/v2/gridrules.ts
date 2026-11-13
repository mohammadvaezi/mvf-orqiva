// ── [PCODE-261 | S15 | v0.1.0] T27.3 Canvas grid: fill down, paste from Excel, formulas and roll-ups, indent and outdent, typed predecessors ──
//    Why:  the grid behaves like the spreadsheet people plan in: a value typed in any common form, a formula
//          that reads other rows by their outline number, predecessors written as MS Project writes them, a
//          block pasted from Excel, a task moved under the one above. The rules are plain functions, so the
//          grid only wires them to cells.

const DAY = 86_400_000;
const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const t0 = (iso: string): number => Date.parse(iso + 'T00:00:00Z');
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number): string => iso(t0(d) + n * DAY);
const isWork = (d: string, wd: readonly string[]): boolean =>
  !wd.length || wd.includes(WD[new Date(t0(d)).getUTCDay()] ?? '');

/** n working days on from a date (back when negative), landing on a working day. */
export function addWorkdays(d: string, n: number, wd: readonly string[]): string {
  let x = d;
  while (!isWork(x, wd)) x = addDays(x, 1);
  const step = n < 0 ? -1 : 1;
  for (let left = Math.abs(n); left > 0;) {
    x = addDays(x, step);
    if (isWork(x, wd)) left--;
  }
  return x;
}

/** Working days from a to b. */
export function workdaysFrom(a: string, b: string, wd: readonly string[]): number {
  const step = b >= a ? 1 : -1;
  let n = 0;
  for (let d = a; d !== b; d = addDays(d, step)) if (isWork(addDays(d, step), wd)) n += step;
  return n;
}

const real = (d: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(t0(d)) && iso(t0(d)) === d;

/** A day as people type it: 2026-10-12, 12.10.2026, 12/10/2026 (day first), 10/12/2026 when it cannot be. */
export function parseDay(raw: string): string | null {
  const v = raw.trim();
  if (real(v)) return v;
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(v);
  if (!m) return null;
  const y = m[3]?.length === 2 ? '20' + m[3] : (m[3] ?? '');
  const a = Number(m[1]);
  const b = Number(m[2]);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const dayFirst = y + '-' + pad(b) + '-' + pad(a);
  if (real(dayFirst)) return dayFirst;
  const monthFirst = y + '-' + pad(a) + '-' + pad(b);
  return real(monthFirst) ? monthFirst : null;
}

/** A number as people type it: 3, 3d, 3 days, 2,5, 40 %. */
export function parseNumber(raw: string): number | null {
  const v = raw
    .trim()
    .replace(/\s*(%|d|days?|wd|t|tage?)$/i, '')
    .replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  return Number(v);
}

// ── formulas ──

export interface RowValues {
  start: string;
  finish: string;
  duration: number;
  done: number;
  estimate: number | null;
}
export type Value = number | { date: string };
const FIELDS = ['start', 'finish', 'duration', 'done', 'estimate'] as const;
type Field = (typeof FIELDS)[number];

/**
 * Evaluates a formula (with or without the leading =). Rows are named by their outline number in
 * brackets with a field: [1.2].finish; a bare [1.2] means the field of the cell's own column.
 * Numbers, + - * /, brackets, SUM, MIN, MAX, AVG, ROUND, WORKDAY(date, n). A date plus or minus a
 * number counts working days; a date minus a date is the working days between.
 */
export function evalFormula(
  input: string,
  ctx: {
    row: (wbs: string) => RowValues | undefined;
    field: Field;
    workingDays: readonly string[];
  },
): { value: Value } | { error: string } {
  const src = input.trim().replace(/^=/, '');
  let i = 0;
  const fail = (m: string): never => {
    throw new Error(m);
  };
  const ws = (): void => {
    while (src[i] === ' ') i++;
  };
  const num = (v: Value, what: string): number =>
    typeof v === 'number' ? v : fail(what + ' needs a number, not a date');
  const plus = (a: Value, b: Value, sign: 1 | -1): Value => {
    if (typeof a === 'number' && typeof b === 'number') return a + sign * b;
    if (typeof a !== 'number' && typeof b === 'number')
      return { date: addWorkdays(a.date, sign * Math.round(b), ctx.workingDays) };
    if (typeof a !== 'number' && typeof b !== 'number' && sign === -1)
      return workdaysFrom(b.date, a.date, ctx.workingDays);
    if (typeof a === 'number' && typeof b !== 'number' && sign === 1)
      return { date: addWorkdays(b.date, Math.round(a), ctx.workingDays) };
    return fail('two dates cannot be added');
  };
  const primary = (): Value => {
    ws();
    const c = src[i];
    if (c === '(') {
      i++;
      const v = sum();
      ws();
      if (src[i] !== ')') fail('a bracket is not closed');
      i++;
      return v;
    }
    if (c === '-') {
      i++;
      return -num(primary(), 'a minus');
    }
    if (c === '[') {
      const close = src.indexOf(']', i);
      if (close < 0) fail('a row reference is not closed');
      const wbs = src.slice(i + 1, close).trim();
      i = close + 1;
      let field: Field = ctx.field;
      if (src[i] === '.') {
        const m = /^\.([a-z]+)/i.exec(src.slice(i));
        const f = (m?.[1] ?? '').toLowerCase();
        if (!FIELDS.includes(f as Field)) fail('a row has start, finish, duration, done, estimate');
        field = f as Field;
        i += (m?.[0] ?? '').length;
      }
      const r = ctx.row(wbs);
      if (!r) return fail('there is no row ' + wbs);
      const v = r[field];
      if (v === null) return fail('row ' + wbs + ' has no ' + field);
      return field === 'start' || field === 'finish' ? { date: v as string } : (v as number);
    }
    const d = /^\d{4}-\d{2}-\d{2}/.exec(src.slice(i));
    if (d && real(d[0])) {
      i += d[0].length;
      return { date: d[0] };
    }
    const n = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (n) {
      i += n[0].length;
      return Number(n[0]);
    }
    const f = /^([A-Za-z]+)\s*\(/.exec(src.slice(i));
    if (f) {
      i += f[0].length;
      const args: Value[] = [];
      ws();
      if (src[i] !== ')')
        for (;;) {
          args.push(sum());
          ws();
          if (src[i] === ',' || src[i] === ';') {
            i++;
            continue;
          }
          break;
        }
      if (src[i] !== ')') fail('a function is not closed');
      i++;
      const name = (f[1] ?? '').toUpperCase();
      const nums = (): number[] => args.map((a) => num(a, name));
      if (!args.length) fail(name + ' needs values');
      switch (name) {
        case 'SUM':
          return nums().reduce((a, b) => a + b, 0);
        case 'MIN':
          return args.every((a) => typeof a !== 'number')
            ? { date: (args as { date: string }[]).map((a) => a.date).sort()[0] ?? '' }
            : Math.min(...nums());
        case 'MAX':
          return args.every((a) => typeof a !== 'number')
            ? {
                date:
                  (args as { date: string }[])
                    .map((a) => a.date)
                    .sort()
                    .pop() ?? '',
              }
            : Math.max(...nums());
        case 'AVG':
          return nums().reduce((a, b) => a + b, 0) / args.length;
        case 'ROUND':
          return Math.round(num(args[0] ?? 0, 'ROUND'));
        case 'WORKDAY': {
          const [d, k] = args;
          if (!d || typeof d === 'number' || typeof k !== 'number')
            return fail('WORKDAY takes a date and a number');
          return { date: addWorkdays(d.date, Math.round(k), ctx.workingDays) };
        }
        default:
          return fail('there is no function ' + name);
      }
    }
    return fail('cannot read "' + src.slice(i, i + 8) + '"');
  };
  const product = (): Value => {
    let v = primary();
    for (;;) {
      ws();
      const c = src[i];
      if (c !== '*' && c !== '/') return v;
      i++;
      const r = num(primary(), c === '*' ? 'times' : 'divided by');
      if (c === '/' && r === 0) fail('division by zero');
      v = c === '*' ? num(v, 'times') * r : num(v, 'divided by') / r;
    }
  };
  const sum = (): Value => {
    let v = product();
    for (;;) {
      ws();
      const c = src[i];
      if (c !== '+' && c !== '-') return v;
      i++;
      v = plus(v, product(), c === '+' ? 1 : -1);
    }
  };
  try {
    const v = sum();
    ws();
    if (i < src.length) fail('cannot read "' + src.slice(i, i + 8) + '"');
    return { value: v };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'the formula cannot be read' };
  }
}

// ── predecessors ──

export interface TypedDep {
  predecessorId: string;
  kind: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays: number;
}

/** "1.2FS+2, 3SS, 4" as in MS Project: outline number, kind (FS when left out), lag in working days. */
export function parsePredecessors(
  raw: string,
  idOf: (wbs: string) => string | undefined,
): { deps: TypedDep[] } | { error: string } {
  const out: TypedDep[] = [];
  for (const part of raw
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean)) {
    const m = /^(\d+(?:\.\d+)*)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+)\s*d?)?$/i.exec(part);
    if (!m) return { error: '"' + part + '" is not like 1.2FS+2' };
    const id = idOf(m[1] ?? '');
    if (!id) return { error: 'there is no row ' + (m[1] ?? '') };
    if (out.some((d) => d.predecessorId === id)) return { error: (m[1] ?? '') + ' is named twice' };
    out.push({
      predecessorId: id,
      kind: (m[2] ?? 'FS').toUpperCase() as TypedDep['kind'],
      lagDays: m[4] ? (m[3] === '-' ? -1 : 1) * Number(m[4]) : 0,
    });
  }
  return { deps: out };
}

/** What to add, change and remove to get from the dependencies there are to the ones typed. */
export function depChanges(
  now: readonly { id: string; predecessorId: string; kind: string; lagDays: number }[],
  want: readonly TypedDep[],
): { add: TypedDep[]; change: { id: string; kind: string; lagDays: number }[]; remove: string[] } {
  const add: TypedDep[] = [];
  const change: { id: string; kind: string; lagDays: number }[] = [];
  for (const w of want) {
    const had = now.find((d) => d.predecessorId === w.predecessorId);
    if (!had) add.push(w);
    else if (had.kind !== w.kind || had.lagDays !== w.lagDays)
      change.push({ id: had.id, kind: w.kind, lagDays: w.lagDays });
  }
  const remove = now
    .filter((d) => !want.some((w) => w.predecessorId === d.predecessorId))
    .map((d) => d.id);
  return { add, change, remove };
}

/** As MS Project writes them: "1.2FS+2". */
export const depText = (wbs: string, kind: string, lag: number): string =>
  wbs + (kind === 'FS' && !lag ? '' : kind) + (lag ? (lag > 0 ? '+' : '') + String(lag) + 'd' : '');

// ── paste ──

/** Rows and cells of text copied from Excel or Google Sheets (tabs between cells, quotes allowed). */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === '\t') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ── outline ──

/** Indent: the task goes under the row above it on its level; null when there is none. */
export function indentParent(
  rows: readonly { id: string; level: number; parentId: string | null }[],
  id: string,
): string | null {
  const i = rows.findIndex((r) => r.id === id);
  const me = rows[i];
  if (!me) return null;
  for (let j = i - 1; j >= 0; j--) {
    const r = rows[j];
    if (!r || r.level < me.level) return null;
    if (r.level === me.level && r.parentId === me.parentId) return r.id;
  }
  return null;
}

/** Outdent: the task goes up one level (to its parent's parent); undefined when it is at the top. */
export function outdentParent(
  rows: readonly { id: string; parentId: string | null }[],
  id: string,
): string | null | undefined {
  const me = rows.find((r) => r.id === id);
  if (!me?.parentId) return undefined;
  return rows.find((r) => r.id === me.parentId)?.parentId ?? null;
}
