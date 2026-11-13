// ── [PCODE-226 | S15 | v0.1.0] T21.3 React Native (Expo) app shell: pairing, live feed, offline cache ──
//    Why:  the feed as the list shows it: a heading per day (Today, Yesterday, then the date) and one row
//          per event with the sentence the web app and VS Code show, who did it and when. Pure, so it is
//          tested without a phone.
import { describe, whenText, type ActivityEvent, type ObjectType } from '@orqiva/shared';

export type Tone = 'work' | 'agent' | 'ship' | 'quality' | 'risk' | 'people';

export type Row =
  | { kind: 'day'; key: string; label: string }
  | {
      kind: 'event';
      key: string;
      text: string;
      time: string;
      who: string;
      initials: string;
      tone: Tone;
      agent: boolean;
      /** [PCODE-229 | S15 | v0.1.0] the task it is about, to open it */
      itemId: string | null;
    };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const dayKey = (d: Date): string =>
  String(d.getFullYear()) + '-' + String(d.getMonth() + 1) + '-' + String(d.getDate());

export function dayLabel(d: Date, now: Date): string {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return 'Today';
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
  const sameYear = d.getFullYear() === now.getFullYear();
  return (
    (DAYS[d.getDay()] ?? '') +
    ', ' +
    String(d.getDate()) +
    ' ' +
    (MONTHS[d.getMonth()] ?? '') +
    (sameYear ? '' : ' ' + String(d.getFullYear()))
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

const TONES: Record<ObjectType, Tone> = {
  workspace: 'people',
  member: 'people',
  client: 'people',
  client_request: 'people',
  meeting: 'people',
  timesheet: 'people',
  absence: 'people',
  project: 'work',
  item: 'work',
  comment: 'work',
  sprint: 'work',
  stage: 'work',
  idea: 'agent',
  agent: 'agent',
  agent_run: 'agent',
  environment: 'ship',
  deploy: 'ship',
  release: 'ship',
  train: 'ship',
  handover: 'ship',
  test_run: 'quality',
  gate: 'risk',
  finding: 'risk',
  incident: 'risk',
};

/** Rows for the list, newest first, with a heading where the day changes. */
export function feedRows(events: readonly ActivityEvent[], now: Date): Row[] {
  const rows: Row[] = [];
  let day = '';
  for (const e of events) {
    const d = new Date(e.time);
    const key = Number.isNaN(d.getTime()) ? 'unknown' : dayKey(d);
    if (key !== day) {
      day = key;
      rows.push({
        kind: 'day',
        key: 'day-' + key,
        label: key === 'unknown' ? 'Earlier' : dayLabel(d, now),
      });
    }
    const actor = e.data.actor;
    const who = actor.name ?? (actor.kind === 'system' ? 'Orqiva' : 'Someone');
    rows.push({
      kind: 'event',
      key: 'e-' + String(e.sequence),
      text: describe(e),
      time: whenText(e.time, now).split(' ').pop() ?? '',
      who,
      initials: initials(who),
      tone: (TONES as Partial<Record<string, Tone>>)[e.data.object.type] ?? 'work',
      agent: actor.kind === 'agent',
      itemId:
        e.data.object.type === 'item'
          ? e.data.object.id
          : e.data.parent?.type === 'item'
            ? e.data.parent.id
            : null,
    });
  }
  return rows;
}
