// ── [PCODE-226 | S15 | v0.1.0] T21.3 React Native (Expo) app shell: pairing, live feed, offline cache ──
//    Why:  the phone shows these sentences first; a person joining and a phone signing in must read as
//          what happened, not as "Ada created Ada".
import { describe as suite, expect, it } from 'vitest';
import { describe, type ActivityEvent } from '../src/index.js';

const member = (
  verb: string,
  changes?: Record<string, { from: unknown; to: unknown }>,
  label = 'Ada',
) =>
  ({
    specversion: '1.0',
    id: 'e1',
    source: '/workspaces/w',
    type: 'orqiva.member.' + verb,
    time: '2026-10-10T10:00:00.000Z',
    subject: 'u1',
    datacontenttype: 'application/json',
    workspaceid: 'w',
    sequence: 1,
    data: {
      actor: { kind: 'user', id: 'u1', name: 'Ada' },
      verb,
      object: { type: 'member', id: 'u1', label },
      ...(changes ? { changes } : {}),
    },
  }) as ActivityEvent;

suite('sentences about people and tokens', () => {
  it('says who joined and who was added', () => {
    expect(describe(member('created'))).toBe('Ada joined');
    expect(describe(member('created', undefined, 'Bob'))).toBe('Ada added Bob');
  });

  it('says a phone signed in or out, and names other tokens', () => {
    expect(describe(member('created', { token: { from: null, to: 'Phone: Pixel 9' } }))).toBe(
      'Ada signed in on Pixel 9',
    );
    expect(describe(member('deleted', { token: { from: 'Phone: Pixel 9', to: null } }))).toBe(
      'Ada signed out Pixel 9',
    );
    expect(describe(member('deleted', { token: { from: 'CI deploys', to: null } }))).toBe(
      'Ada revoked the token “CI deploys”',
    );
  });
});

// [PCODE-229 | S15 | v0.1.0]
suite('sentences about changed fields', () => {
  it('names the fields in words', () => {
    const e = member('updated', {
      stateId: { from: 'a', to: 'b' },
      assigneeId: { from: null, to: 'u' },
      title: { from: 'x', to: 'y' },
    });
    const item = {
      ...e,
      data: { ...e.data, object: { type: 'item' as const, id: 'i', label: 'APP-3 Move' } },
    };
    expect(describe(item)).toBe('Ada changed the state, assignee and title of APP-3 Move');
  });
});
