// ── [PCODE-230 | S15 | v0.1.0] T22.3 Presence from and on the phone ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-101 | S15 | v0.1.0] Add presence: heartbeats, avatars on cards, who-is-where ──
//    Why:  who else is here: small initials on the cards and rows people are looking at, and a line on the
//          item page. Each person keeps one colour (from their id), and their name and whether they are
//          viewing or editing are written out for screen readers and tooltips; colour never carries meaning
//          alone. You never see yourself: presence is about the others.
import type { PresenceEntry } from '@orqiva/shared';
import type { ReactNode } from 'react';

export const AVATAR_COLOURS = 6;

/** A stable colour slot 1..6 for a person. */
export function avatarSlot(userId: string): number {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % AVATAR_COLOURS) + 1;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** The others at an item, or anywhere in a project (any item or the project page). */
export function peopleAt(
  people: PresenceEntry[],
  meId: string,
  where: { itemId?: string; projectId?: string },
): PresenceEntry[] {
  return people.filter(
    (p) =>
      p.userId !== meId &&
      (where.itemId ? p.itemId === where.itemId : p.projectId === where.projectId),
  );
}

const describe = (p: PresenceEntry): string =>
  p.name +
  (p.state === 'editing' ? ' is editing' : ' is viewing') +
  // [PCODE-230 | S15 | v0.1.0]
  (p.device === 'phone' ? ' on the phone' : '');

export function Avatars(props: { people: PresenceEntry[]; max?: number }): ReactNode {
  if (props.people.length === 0) return null;
  const max = props.max ?? 3;
  const shown = props.people.slice(0, max);
  const more = props.people.length - shown.length;
  return (
    <span className="pe-avatars" aria-label={props.people.map(describe).join(', ')} role="img">
      {shown.map((p) => (
        <span
          key={p.userId}
          className={
            'pe-avatar pe-avatar--' +
            String(avatarSlot(p.userId)) +
            (p.state === 'editing' ? ' pe-avatar--editing' : '') +
            (p.device === 'phone' ? ' pe-avatar--phone' : '')
          }
          title={describe(p)}
          aria-hidden="true"
        >
          {initials(p.name)}
        </span>
      ))}
      {more > 0 ? (
        <span className="pe-avatar pe-avatar--more" aria-hidden="true">
          +{more}
        </span>
      ) : null}
    </span>
  );
}

/** "Bob is editing, Ada is viewing" for the item page. */
export function HereNow(props: { people: PresenceEntry[] }): ReactNode {
  if (props.people.length === 0) return null;
  return (
    <p className="pe-here" aria-live="polite">
      <Avatars people={props.people} max={5} />{' '}
      <span className="pe-muted">{props.people.map(describe).join(', ')}</span>
    </p>
  );
}
