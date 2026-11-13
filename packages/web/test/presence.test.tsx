// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-101 | S15 | v0.1.0] Add presence: heartbeats, avatars on cards, who-is-where ──
import type { PresenceEntry } from '@orqiva/shared';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AVATAR_COLOURS,
  Avatars,
  HereNow,
  avatarSlot,
  initials,
  peopleAt,
} from '../src/presence.js';
import { LiveClient, type SocketLike } from '../src/sync/live.js';

const p = (
  userId: string,
  name: string,
  itemId: string | null,
  state: 'viewing' | 'editing' = 'viewing',
): PresenceEntry => ({ userId, name, kind: 'user', projectId: 'proj', itemId, state, since: '' });

describe('presence display', () => {
  it('gives each person stable initials and one of six colours', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('bob')).toBe('B');
    expect(avatarSlot('user-1')).toBe(avatarSlot('user-1'));
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      expect(avatarSlot(id)).toBeGreaterThanOrEqual(1);
      expect(avatarSlot(id)).toBeLessThanOrEqual(AVATAR_COLOURS);
    }
  });

  it('shows the others, never yourself, at an item or in a project', () => {
    const people = [
      p('me', 'Me', 'i1'),
      p('b', 'Bob', 'i1'),
      p('c', 'Cy', 'i2'),
      p('d', 'Di', null),
    ];
    expect(peopleAt(people, 'me', { itemId: 'i1' }).map((x) => x.name)).toEqual(['Bob']);
    expect(peopleAt(people, 'me', { projectId: 'proj' }).map((x) => x.name)).toEqual([
      'Bob',
      'Cy',
      'Di',
    ]);
  });

  it('writes who is there and what they do, for screen readers and tooltips', () => {
    const html = renderToString(
      <Avatars
        people={[
          p('b', 'Bob Builder', 'i1', 'editing'),
          p('c', 'Cy', 'i1'),
          p('d', 'Di', 'i1'),
          p('e', 'Ed', 'i1'),
        ]}
      />,
    );
    expect(html).toContain(
      'aria-label="Bob Builder is editing, Cy is viewing, Di is viewing, Ed is viewing"',
    );
    expect(html).toContain('>BB<');
    expect(html).toContain('pe-avatar--editing');
    expect(html).toContain('+<!-- -->1');
    expect(html).not.toContain('style=');
    expect(renderToString(<HereNow people={[]} />)).toBe('');
  });
});

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sent: Record<string, unknown>[] = [];
  send(text: string): void {
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
  }
  close(): void {
    this.onclose?.();
  }
}

describe('live client presence', () => {
  it('reports its place once subscribed, again on every move, and hands on what the server says', () => {
    const s = new FakeSocket();
    const seen: PresenceEntry[][] = [];
    const live = new LiveClient({
      workspaceId: 'w',
      open: () => s,
      onEvent: () => undefined,
      onResync: () => undefined,
      onPresence: (x) => seen.push(x),
    });
    live.start();
    live.setPresence({ projectId: 'p', itemId: 'i1', state: 'viewing' });
    s.onopen?.();
    expect(s.sent.filter((m) => m['type'] === 'presence')).toEqual([]);
    s.onmessage?.({ data: JSON.stringify({ type: 'subscribed', workspaceId: 'w', sequence: 0 }) });
    live.setPresence({ projectId: 'p', itemId: 'i2', state: 'editing' });
    expect(s.sent.filter((m) => m['type'] === 'presence').map((m) => m['itemId'])).toEqual([
      'i1',
      'i2',
    ]);
    s.onmessage?.({
      data: JSON.stringify({ type: 'presence', workspaceId: 'w', people: [p('b', 'Bob', 'i2')] }),
    });
    expect(seen.at(-1)?.map((x) => x.name)).toEqual(['Bob']);
    s.close();
    expect(seen.at(-1)).toEqual([]);
    live.stop();
  });
});
