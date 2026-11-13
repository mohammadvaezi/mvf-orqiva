// ── [PCODE-246 | S15 | v0.1.0] T25.1 Agent triggers act: assignment, label, mention, CI failure, schedule, webhook ──
//    Why:  what decides that a trigger fits, shared by the server that starts the runs and the web app that
//          checks a trigger as it is typed: a schedule in the usual five cron fields, matched at a minute in
//          the workspace's time zone, and a mention such as /coder found as a word of its own in a comment.

export const TRIGGER_KINDS = [
  'assigned',
  'label',
  'mention',
  'schedule',
  'ci_failure',
  'webhook',
] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export interface Trigger {
  kind: TriggerKind;
  /** the label's name, the mention, the cron line; empty for the others */
  value: string;
  /** schedule and webhook: the project the run works in, by key */
  project?: string;
  /** schedule and webhook: what the agent is asked to do */
  instruction?: string;
}

export interface Cron {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  /** both day fields restricted: either may match, as in every cron */
  eitherDay: boolean;
}

const FIELDS: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];
const NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function field(text: string, [lo, hi]: [number, number]): Set<number> | null {
  const out = new Set<number>();
  const num = (s: string): number => {
    const n = NAMES[s.toLowerCase()] ?? (/^\d+$/.test(s) ? Number(s) : NaN);
    return n;
  };
  for (const part of text.split(',')) {
    const m = /^(\*|[a-z0-9]+(?:-[a-z0-9]+)?)(?:\/(\d+))?$/i.exec(part);
    if (!m) return null;
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) return null;
    let from = lo;
    let to = hi;
    const range = m[1] ?? '*';
    if (range !== '*') {
      const [a, b] = range.split('-');
      from = num(a ?? '');
      to = b !== undefined ? num(b) : m[2] ? hi : from;
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < lo || to > hi || from > to)
      return null;
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

/** "0 7 * * 1-5" as sets, or null when it is not five valid fields. */
export function parseCron(line: string): Cron | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets = parts.map((p, i) => field(p, FIELDS[i] as [number, number]));
  if (sets.some((x) => x === null)) return null;
  const [minutes, hours, days, months, weekdays] = sets as Set<number>[];
  if (!minutes || !hours || !days || !months || !weekdays) return null;
  // 7 is Sunday too
  if (weekdays.has(7)) weekdays.add(0);
  return {
    minutes,
    hours,
    days,
    months,
    weekdays,
    eitherDay: parts[2] !== '*' && parts[4] !== '*',
  };
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The minute, hour, day, month and weekday of a moment in a time zone. */
export function wallClock(
  at: Date,
  timeZone: string,
): { minute: number; hour: number; day: number; month: number; weekday: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      minute: 'numeric',
      hour: 'numeric',
      day: 'numeric',
      month: 'numeric',
      weekday: 'short',
    }).formatToParts(at);
  } catch {
    return wallClock(at, 'UTC');
  }
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    minute: Number(get('minute')),
    hour: Number(get('hour')) % 24,
    day: Number(get('day')),
    month: Number(get('month')),
    weekday: WEEKDAY[get('weekday')] ?? 0,
  };
}

/** Whether a schedule starts at the minute of `at`, read in the time zone. */
export function cronMatches(cron: Cron, at: Date, timeZone: string): boolean {
  const w = wallClock(at, timeZone);
  if (!cron.minutes.has(w.minute) || !cron.hours.has(w.hour) || !cron.months.has(w.month))
    return false;
  const day = cron.days.has(w.day);
  const weekday = cron.weekdays.has(w.weekday);
  return cron.eitherDay ? day || weekday : day && weekday;
}

/** Whether a comment names the mention ("/coder", "@coder") as a word of its own, ignoring case. */
export function mentionTriggered(text: string, mention: string): boolean {
  const m = mention.trim();
  if (!m) return false;
  const escaped = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^\\w/@-])' + escaped + '(?![\\w-])', 'i').test(text);
}

/** What is wrong with a trigger, or null when it can be kept. */
export function triggerProblem(t: Trigger): string | null {
  if (t.kind === 'label' && !t.value.trim()) return 'Name the label that starts the agent';
  if (t.kind === 'mention' && !/^[/@]?[\w-]{1,40}$/.test(t.value.trim()))
    return 'A mention is a short word such as /coder';
  if (t.kind === 'schedule') {
    if (!parseCron(t.value)) return 'A schedule is five cron fields, e.g. 0 7 * * 1-5';
    if (!t.project) return 'Name the project a scheduled run works in';
  }
  return null;
}
