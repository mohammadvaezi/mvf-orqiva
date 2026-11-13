// ── [PCODE-226 | S15 | v0.1.0] T21.3 React Native (Expo) app shell: pairing, live feed, offline cache ──
import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '@orqiva/shared';
import { dayLabel, feedRows, initials } from '../src/rows';

const ev = (
  sequence: number,
  time: string,
  actor: ActivityEvent['data']['actor'],
  type = 'item',
): ActivityEvent =>
  ({
    specversion: '1.0',
    id: 'e' + String(sequence),
    source: '/workspaces/w1',
    type: 'orqiva.' + type + '.created',
    time,
    subject: 's',
    datacontenttype: 'application/json',
    workspaceid: 'w1',
    sequence,
    data: {
      actor,
      verb: 'created',
      object: { type, id: 'o', label: 'APP-' + String(sequence) + ' Sign in' },
    },
  }) as ActivityEvent;

describe('feed rows', () => {
  it('heads each day and writes each event as the web app does', () => {
    const now = new Date(2026, 9, 10, 15, 0);
    const rows = feedRows(
      [
        ev(3, new Date(2026, 9, 10, 14, 5).toISOString(), {
          kind: 'user',
          id: 'u',
          name: 'Ada Lovelace',
        }),
        ev(
          2,
          new Date(2026, 9, 9, 9, 30).toISOString(),
          { kind: 'agent', id: 'a', name: 'Planner' },
          'agent_run',
        ),
        ev(1, new Date(2026, 9, 2, 9, 0).toISOString(), { kind: 'system', id: 's' }),
      ],
      now,
    );
    expect(
      rows.map((r) => (r.kind === 'day' ? '# ' + r.label : r.time + ' ' + r.initials)),
    ).toEqual(['# Today', '14:05 AL', '# Yesterday', '09:30 P', '# Friday, 2 Oct', '09:00 O']);
    const first = rows[1];
    expect(first?.kind === 'event' && first.text).toContain('Ada Lovelace');
    expect(rows[3]).toMatchObject({ tone: 'agent', agent: true });
    // [PCODE-229 | S15 | v0.1.0] a row about a task opens it
    expect(rows[1]).toMatchObject({ itemId: 'o' });
    expect(rows[3]).toMatchObject({ itemId: null });
  });

  it('names days of another year with the year', () => {
    expect(dayLabel(new Date(2025, 11, 31), new Date(2026, 0, 5))).toBe('Wednesday, 31 Dec 2025');
    expect(initials('  ')).toBe('?');
  });
});
