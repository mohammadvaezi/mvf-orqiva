// ── [PCODE-228 | S15 | v0.1.0] T22.1 Live map on the phone: projects, health, heat, sprint progress, cards in progress, alerts ──
//    Why:  which live events make a screen read again, and the sprint's calendar. A phone reloads a
//          screen when an event touches it, not on every event in the workspace, and never more often
//          than the reloader allows. Pure, so it is tested in Node.
import { isEventOf, type ActivityEvent } from '@orqiva/shared';

/** What a screen shows: the whole map, one project (its sprint), or one task. */
export type Scope =
  { kind: 'map' } | { kind: 'project'; projectId: string } | { kind: 'item'; itemId: string };

/** Event kinds that change what the map shows: work moving, gates, deploys, tests, risks, agents. */
const MAP_OBJECTS = [
  'project',
  'item',
  'sprint',
  'gate',
  'stage',
  'deploy',
  'test_run',
  'finding',
  'incident',
  'agent_run',
  'environment',
];

export function touches(e: ActivityEvent, scope: Scope): boolean {
  switch (scope.kind) {
    case 'map':
      return MAP_OBJECTS.some((o) => isEventOf(e.type, o));
    case 'project':
      return e.projectid === scope.projectId || e.subject === scope.projectId;
    case 'item':
      return (
        e.subject === scope.itemId ||
        e.data.object.id === scope.itemId ||
        (e.data.parent?.type === 'item' && e.data.parent.id === scope.itemId)
      );
  }
}

/** Day n of m of a sprint (both counted from 1), from its dates; null without both dates. */
export function sprintDay(
  start: string | null,
  end: string | null,
  now: Date,
): { day: number; days: number; share: number } | null {
  if (!start || !end) return null;
  const day0 = (iso: string): number => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000;
  };
  const s = day0(start);
  const e = day0(end);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000;
  const days = Math.max(1, e - s + 1);
  const day = Math.min(days, Math.max(0, today - s + 1));
  return { day, days, share: day / days };
}

/** "10:42", or "yesterday 10:42", for "read at …" lines. */
export function readAt(iso: string | null, now: Date): string {
  if (!iso) return '';
  const d = new Date(iso);
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return hm;
  return d.getDate() + '.' + (d.getMonth() + 1) + '. ' + hm;
}
