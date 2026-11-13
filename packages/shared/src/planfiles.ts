// ── [PCODE-263 | S15 | v0.1.0] T27.5 Plan files: MS Project XML and CSV export and import, iCal of the plan ──
//    Why:  a plan goes in and out of the tools people already have: MS Project's XML (MSPDI, which MS Project,
//          ProjectLibre and GanttProject read and write), a CSV for Excel, and an iCal file for calendars. Both
//          imports land on one shape (tasks by outline level with dates, durations, constraints, people and
//          predecessors), so the server makes tasks the same way whichever file came in. No dependencies: the
//          XML is read with a small reader for the flat shape MSPDI has.
import {
  CONSTRAINT_TEXT,
  CONSTRAINT_TYPES,
  type ConstraintType,
  type DependencyKind,
} from './schedule.js';

const DAY = 86_400_000;
const t0 = (iso: string): number => Date.parse(iso + 'T00:00:00Z');
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);
const real = (d: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(t0(d)) && iso(t0(d)) === d;

/** One task of the plan as it goes out. */
export interface ExportTask {
  id: string;
  ref: string;
  title: string;
  wbs: string;
  /** 1 for the top level */
  level: number;
  kind: string;
  start: string;
  finish: string;
  durationDays: number;
  percentDone: number;
  summary: boolean;
  milestone: boolean;
  manual: boolean;
  constraintType: ConstraintType;
  constraintDate: string | null;
  resource: string | null;
}
export interface ExportDep {
  predecessorId: string;
  successorId: string;
  kind: DependencyKind;
  lagDays: number;
}

/** One task as it comes in, from either file. */
export interface ImportTask {
  /** the file's own id for the task (UID or ID), to resolve predecessors */
  key: string;
  title: string;
  level: number;
  start: string | null;
  durationDays: number | null;
  milestone: boolean;
  summary: boolean;
  percentDone: number | null;
  manual: boolean;
  constraintType: ConstraintType | null;
  constraintDate: string | null;
  resource: string | null;
  preds: { key: string; kind: DependencyKind; lagDays: number }[];
}
export interface ImportPlan {
  tasks: ImportTask[];
  problems: string[];
}

// ── MS Project XML ──

const MSP_CONSTRAINT: Record<ConstraintType, number> = {
  asap: 0,
  alap: 1,
  mso: 2,
  mfo: 3,
  snet: 4,
  snlt: 5,
  fnet: 6,
  fnlt: 7,
};
const MSP_LINK: Record<DependencyKind, number> = { FF: 0, FS: 1, SF: 2, SS: 3 };
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

/** The plan as MS Project XML (MSPDI): 8-hour days, durations in hours, lags in tenths of minutes. */
export function toMsProjectXml(p: {
  name: string;
  start: string;
  tasks: readonly ExportTask[];
  deps: readonly ExportDep[];
}): string {
  const uid = new Map(p.tasks.map((t, i) => [t.id, i + 1]));
  const people = [...new Set(p.tasks.map((t) => t.resource).filter((r): r is string => !!r))];
  const rid = new Map(people.map((r, i) => [r, i + 1]));
  const tag = (name: string, v: string | number): string =>
    '<' + name + '>' + (typeof v === 'number' ? String(v) : esc(v)) + '</' + name + '>';
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Project xmlns="http://schemas.microsoft.com/project">',
    '  ' + tag('Name', p.name + '.xml'),
    '  ' + tag('Title', p.name),
    '  ' + tag('ScheduleFromStart', 1),
    '  ' + tag('StartDate', p.start + 'T08:00:00'),
    '  ' + tag('MinutesPerDay', 480),
    '  ' + tag('MinutesPerWeek', 2400),
    '  ' + tag('DaysPerMonth', 20),
    '  <Tasks>',
  ];
  p.tasks.forEach((t, i) => {
    const parts = [
      tag('UID', i + 1),
      tag('ID', i + 1),
      tag('Name', t.title),
      tag('WBS', t.wbs),
      tag('OutlineNumber', t.wbs),
      tag('OutlineLevel', t.level),
      tag('Start', t.start + 'T08:00:00'),
      tag('Finish', t.finish + 'T17:00:00'),
      tag('Duration', 'PT' + String(t.durationDays * 8) + 'H0M0S'),
      tag('DurationFormat', 7),
      tag('Manual', t.manual ? 1 : 0),
      tag('Milestone', t.milestone ? 1 : 0),
      tag('Summary', t.summary ? 1 : 0),
      tag('PercentComplete', Math.round(t.percentDone)),
      tag('ConstraintType', MSP_CONSTRAINT[t.constraintType]),
      ...(t.constraintDate ? [tag('ConstraintDate', t.constraintDate + 'T08:00:00')] : []),
      tag('Notes', t.ref),
      ...p.deps
        .filter((d) => d.successorId === t.id && uid.has(d.predecessorId))
        .map(
          (d) =>
            '<PredecessorLink>' +
            tag('PredecessorUID', uid.get(d.predecessorId) ?? 0) +
            tag('Type', MSP_LINK[d.kind]) +
            tag('LinkLag', d.lagDays * 4800) +
            tag('LagFormat', 7) +
            '</PredecessorLink>',
        ),
    ];
    lines.push('    <Task>' + parts.join('') + '</Task>');
  });
  lines.push('  </Tasks>', '  <Resources>');
  people.forEach((r, i) => {
    lines.push(
      '    <Resource>' +
        tag('UID', i + 1) +
        tag('ID', i + 1) +
        tag('Name', r) +
        tag('Type', 1) +
        '</Resource>',
    );
  });
  lines.push('  </Resources>', '  <Assignments>');
  let a = 0;
  p.tasks.forEach((t, i) => {
    const r = t.resource ? rid.get(t.resource) : undefined;
    if (!r || t.summary) return;
    a++;
    lines.push(
      '    <Assignment>' +
        tag('UID', a) +
        tag('TaskUID', i + 1) +
        tag('ResourceUID', r) +
        tag('Units', 1) +
        '</Assignment>',
    );
  });
  lines.push('  </Assignments>', '</Project>', '');
  return lines.join('\n');
}

/** Hours, minutes and seconds of an ISO 8601 duration (PT24H0M0S, P3DT4H), in working days of 8 hours. */
export function mspDays(d: string, minutesPerDay = 480): number | null {
  const m =
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      d.trim(),
    );
  if (!m) return null;
  const minutes =
    Number(m[1] ?? 0) * minutesPerDay +
    Number(m[2] ?? 0) * 60 +
    Number(m[3] ?? 0) +
    Number(m[4] ?? 0) / 60;
  return Math.round((minutes / minutesPerDay) * 100) / 100;
}

/** Reads MS Project XML (MSPDI) into the plan's import shape. */
export function parseMsProjectXml(xml: string): ImportPlan {
  const problems: string[] = [];
  if (!/<Project[\s>]/.test(xml)) return { tasks: [], problems: ['this is not MS Project XML'] };
  const one = (block: string, name: string): string | null => {
    const m = new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>').exec(block);
    return m ? unesc(m[1] ?? '').trim() : null;
  };
  const perDay = Number(one(xml.replace(/<Tasks>[\s\S]*$/, ''), 'MinutesPerDay') ?? 480) || 480;
  const people = new Map<string, string>();
  for (const m of xml.matchAll(/<Resource>([\s\S]*?)<\/Resource>/g)) {
    const u = one(m[1] ?? '', 'UID');
    const n = one(m[1] ?? '', 'Name');
    if (u && n) people.set(u, n);
  }
  const assigned = new Map<string, string>();
  for (const m of xml.matchAll(/<Assignment>([\s\S]*?)<\/Assignment>/g)) {
    const task = one(m[1] ?? '', 'TaskUID');
    const r = people.get(one(m[1] ?? '', 'ResourceUID') ?? '');
    if (task && r && !assigned.has(task)) assigned.set(task, r);
  }
  const kinds: Record<string, DependencyKind> = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' };
  const constraints = Object.fromEntries(
    Object.entries(MSP_CONSTRAINT).map(([k, v]) => [String(v), k as ConstraintType]),
  );
  const tasks: ImportTask[] = [];
  for (const m of xml.matchAll(/<Task>([\s\S]*?)<\/Task>/g)) {
    const raw = m[1] ?? '';
    const links = [...raw.matchAll(/<PredecessorLink>([\s\S]*?)<\/PredecessorLink>/g)].map(
      (l) => l[1] ?? '',
    );
    const flat = raw.replace(
      /<(PredecessorLink|ExtendedAttribute|Baseline|TimephasedData|OutlineCode)>[\s\S]*?<\/\1>/g,
      '',
    );
    const uid = one(flat, 'UID') ?? '';
    const level = Number(one(flat, 'OutlineLevel') ?? '1');
    const name = one(flat, 'Name') ?? '';
    // the project's own summary task (level 0) and empty rows are not tasks
    if (level === 0 || one(flat, 'IsNull') === '1') continue;
    if (!name) {
      problems.push('task ' + uid + ' has no name');
      continue;
    }
    const day = (v: string | null): string | null => {
      const d = (v ?? '').slice(0, 10);
      return real(d) ? d : null;
    };
    const dur = one(flat, 'Duration');
    const milestone = one(flat, 'Milestone') === '1';
    const ct = constraints[one(flat, 'ConstraintType') ?? '0'] ?? 'asap';
    tasks.push({
      key: uid,
      title: name.slice(0, 255),
      level: Math.max(1, level),
      start: day(one(flat, 'Start')),
      durationDays: milestone ? 0 : dur ? mspDays(dur, perDay) : null,
      milestone,
      summary: one(flat, 'Summary') === '1',
      percentDone: one(flat, 'PercentComplete') ? Number(one(flat, 'PercentComplete')) : null,
      manual: one(flat, 'Manual') === '1',
      constraintType: ct === 'asap' ? null : ct,
      constraintDate: ct === 'asap' || ct === 'alap' ? null : day(one(flat, 'ConstraintDate')),
      resource: assigned.get(uid) ?? null,
      preds: links.map((l) => ({
        key: one(l, 'PredecessorUID') ?? '',
        kind: kinds[one(l, 'Type') ?? '1'] ?? 'FS',
        lagDays: Math.round(Number(one(l, 'LinkLag') ?? '0') / (perDay * 10)),
      })),
    });
  }
  if (!tasks.length && !problems.length) problems.push('the file has no tasks');
  return { tasks, problems };
}

// ── CSV ──

const CSV_HEAD = [
  'ID',
  'WBS',
  'Name',
  'Kind',
  'Start',
  'Finish',
  'Duration',
  'Predecessors',
  'Resource',
  '% Complete',
  'Constraint',
  'Constraint date',
  'Ref',
];
const cell = (v: string): string => (/[",;\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);

/** MS Project's way of writing a link: 2FS+1d, 3SS, 4 (finish-to-start without lag). */
export const mspLinkText = (id: number, kind: DependencyKind, lag: number): string =>
  String(id) +
  (kind === 'FS' && !lag ? '' : kind) +
  (lag ? (lag > 0 ? '+' : '') + String(lag) + 'd' : '');

/** The plan as CSV with the columns Excel users know from MS Project; predecessors name the ID column. */
export function toPlanCsv(tasks: readonly ExportTask[], deps: readonly ExportDep[]): string {
  const id = new Map(tasks.map((t, i) => [t.id, i + 1]));
  const rows = [CSV_HEAD.join(',')];
  for (const t of tasks)
    rows.push(
      [
        String(id.get(t.id) ?? 0),
        t.wbs,
        t.title,
        t.kind,
        t.start,
        t.finish,
        String(t.durationDays) + (t.durationDays === 1 ? ' day' : ' days'),
        deps
          .filter((d) => d.successorId === t.id && id.has(d.predecessorId))
          .map((d) => mspLinkText(id.get(d.predecessorId) ?? 0, d.kind, d.lagDays))
          .join(';'),
        t.resource ?? '',
        String(Math.round(t.percentDone)) + '%',
        CONSTRAINT_TEXT[t.constraintType],
        t.constraintDate ?? '',
        t.ref,
      ]
        .map(cell)
        .join(','),
    );
  return rows.join('\r\n') + '\r\n';
}

/** Rows of a CSV: the delimiter is the one the header uses most (comma, semicolon or tab). */
export function readCsv(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const head = s.split('\n')[0] ?? '';
  const count = (c: string): number => head.split(c).length - 1;
  const sep = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0] ?? ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (quoted) {
      if (c === '"' && s.charAt(i + 1) === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"' && cur === '') quoted = true;
    else if (c === sep) {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** A day written the ways exports write it: 2026-10-12, 12.10.2026, Mon 12.10.26, 10/12/2026 08:00. */
export function readDay(raw: string): string | null {
  const v = raw
    .trim()
    .replace(/^[A-Za-zÄÖÜäöü]{2,3}\.?\s+/, '')
    .replace(/[T\s]\d{1,2}:\d{2}.*$/, '');
  if (real(v)) return v;
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(v);
  if (!m) return null;
  const y = (m[3] ?? '').length === 2 ? '20' + (m[3] ?? '') : (m[3] ?? '');
  const a = Number(m[1]);
  const b = Number(m[2]);
  const pad = (n: number): string => String(n).padStart(2, '0');
  // dots are day first; slashes are month first unless that cannot be
  const dayFirst = y + '-' + pad(b) + '-' + pad(a);
  const monthFirst = y + '-' + pad(a) + '-' + pad(b);
  const dotted = v.includes('.');
  if (dotted) return real(dayFirst) ? dayFirst : null;
  return real(monthFirst) ? monthFirst : real(dayFirst) ? dayFirst : null;
}

/** A duration as written: 3 days, 3d, 3 Tage, 2 wks, 16h, 0 days?; in working days. */
export function readDuration(raw: string): number | null {
  const v = raw.trim().replace('?', '').replace(',', '.').toLowerCase();
  const m = /^(-?\d+(?:\.\d+)?)\s*([a-zä]*)$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? '';
  if (!unit || /^(d|day|days|t|tag|tage|wd|edays?)$/.test(unit)) return n;
  if (/^(w|wk|wks|week|weeks|wo|woche|wochen)$/.test(unit)) return n * 5;
  if (/^(h|hr|hrs|hour|hours|std)$/.test(unit)) return Math.round((n / 8) * 100) / 100;
  if (/^(mo|mon|mons|month|months)$/.test(unit)) return n * 20;
  return null;
}

const LINK_RE =
  /^(\d+(?:\.\d+)*)\s*(FS|SS|FF|SF|EA|AA|EE|AE)?\s*(?:([+-])\s*(\d+(?:[.,]\d+)?)\s*([a-zä]*))?$/i;
const GERMAN: Record<string, DependencyKind> = { EA: 'FS', AA: 'SS', EE: 'FF', AE: 'SF' };

/** Reads a plan CSV (ours, MS Project's, or a sheet with a Name column) into the import shape. */
export function parsePlanCsv(text: string): ImportPlan {
  const rows = readCsv(text);
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]): number => head.findIndex((h) => names.includes(h));
  const c = {
    id: col('id', 'nr.', 'nr'),
    wbs: col('wbs', 'outline number', 'psp-code', 'gliederungsnummer'),
    level: col('outline level', 'level', 'gliederungsebene'),
    name: col('name', 'task name', 'title', 'task', 'vorgangsname'),
    kind: col('kind', 'type'),
    start: col('start', 'start date', 'anfang'),
    duration: col('duration', 'dauer'),
    preds: col('predecessors', 'vorgänger'),
    resource: col('resource', 'resource names', 'assignee', 'who', 'ressourcennamen'),
    done: col('% complete', 'percent complete', '% done', 'done', '% abgeschlossen'),
    constraint: col('constraint', 'constraint type', 'einschränkungsart'),
    cdate: col('constraint date', 'einschränkungstermin'),
    milestone: col('milestone', 'meilenstein'),
  };
  if (c.name < 0) return { tasks: [], problems: ['the first row needs a Name column'] };
  const problems: string[] = [];
  const at = (r: string[], i: number): string => (i >= 0 ? (r[i] ?? '').trim() : '');
  const byText = new Map<string, ConstraintType>([
    ...CONSTRAINT_TYPES.map((k) => [k, k] as const),
    ...CONSTRAINT_TYPES.map((k) => [CONSTRAINT_TEXT[k].toLowerCase(), k] as const),
  ]);
  const body = rows.slice(1);
  const keyOf = (r: string[], i: number): string => at(r, c.id) || at(r, c.wbs) || String(i + 1);
  const tasks: ImportTask[] = [];
  body.forEach((r, i) => {
    const title = at(r, c.name);
    if (!title) return;
    const wbs = at(r, c.wbs);
    const level = c.level >= 0 ? Number(at(r, c.level)) || 1 : wbs ? wbs.split('.').length : 1;
    const durRaw = at(r, c.duration);
    const dur = durRaw ? readDuration(durRaw) : null;
    if (durRaw && dur === null)
      problems.push('row ' + String(i + 2) + ': cannot read the duration "' + durRaw + '"');
    const startRaw = at(r, c.start);
    const start = startRaw ? readDay(startRaw) : null;
    if (startRaw && !start)
      problems.push('row ' + String(i + 2) + ': cannot read the start "' + startRaw + '"');
    const kind = at(r, c.kind).toLowerCase();
    const milestone =
      kind === 'milestone' || /^(yes|ja|1|true)$/i.test(at(r, c.milestone)) || dur === 0;
    const ct = byText.get(at(r, c.constraint).toLowerCase()) ?? null;
    const preds: ImportTask['preds'] = [];
    for (const part of at(r, c.preds)
      .split(/[;,]/)
      .map((x) => x.trim())
      .filter(Boolean)) {
      const m = LINK_RE.exec(part);
      if (!m) {
        problems.push('row ' + String(i + 2) + ': cannot read the predecessor "' + part + '"');
        continue;
      }
      const k = (m[2] ?? 'FS').toUpperCase();
      const lag = m[4] ? readDuration(m[4] + (m[5] ?? 'd')) : 0;
      preds.push({
        key: m[1] ?? '',
        kind: GERMAN[k] ?? (k as DependencyKind),
        lagDays: Math.round((m[3] === '-' ? -1 : 1) * (lag ?? 0)),
      });
    }
    const done = at(r, c.done).replace('%', '').trim();
    tasks.push({
      key: keyOf(r, i),
      title: title.slice(0, 255),
      level: Math.max(1, Math.min(10, level)),
      start,
      durationDays: milestone ? 0 : dur,
      milestone,
      summary: false,
      percentDone:
        done && !Number.isNaN(Number(done)) ? Math.max(0, Math.min(100, Number(done))) : null,
      manual: false,
      constraintType: ct === 'asap' ? null : ct,
      constraintDate: readDay(at(r, c.cdate)),
      resource:
        at(r, c.resource)
          .split(/[;,]/)[0]
          ?.replace(/\[.*\]$/, '')
          .trim() || null,
      preds,
    });
  });
  // a row followed by a deeper one is a summary
  tasks.forEach((t, i) => {
    if ((tasks[i + 1]?.level ?? 0) > t.level) t.summary = true;
  });
  if (!tasks.length && !problems.length) problems.push('the file has no tasks');
  return { tasks, problems };
}

// ── iCal ──

const icsText = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Lines longer than 75 octets are folded, as RFC 5545 asks. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** The plan as a calendar: each task an all-day event over its days, each milestone on its day. */
export function planIcs(p: {
  name: string;
  stamp: string;
  tasks: readonly {
    id: string;
    ref: string;
    title: string;
    start: string;
    finish: string;
    milestone: boolean;
    percentDone: number;
    url?: string;
  }[];
}): string {
  const date = (d: string): string => d.replace(/-/g, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Orqiva//Canvas//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsText(p.name),
  ];
  for (const t of p.tasks) {
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + t.id + '@orqiva',
      'DTSTAMP:' + p.stamp,
      'DTSTART;VALUE=DATE:' + date(t.start),
      'DTEND;VALUE=DATE:' + date(iso(t0(t.milestone ? t.start : t.finish) + DAY)),
      'SUMMARY:' + icsText((t.milestone ? '◆ ' : '') + t.ref + ' ' + t.title),
      'DESCRIPTION:' + icsText(String(t.percentDone) + ' % done'),
      ...(t.url ? ['URL:' + t.url] : []),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
