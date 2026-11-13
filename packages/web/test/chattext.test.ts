// ── [PCODE-235 | S15 | v0.1.0] T23.2 Messages in the web app ──
import { describe, expect, it } from 'vitest';
import type { MessageJson } from '@orqiva/shared';
import { appRoute } from '../src/core/nav.js';
import { layout, mentionAt, mergeMessages, tokens } from '../src/v2/chattext.js';

const msg = (
  id: string,
  at: string,
  author: string,
  extra: Partial<MessageJson> = {},
): MessageJson => ({
  id,
  channelId: 'c',
  parentId: null,
  author: { id: author, name: author },
  body: id,
  fileIds: [],
  files: [],
  itemId: null,
  replyCount: 0,
  lastReplyAt: null,
  reactions: [],
  createdAt: at,
  editedAt: null,
  deleted: false,
  ...extra,
});

describe('message text', () => {
  it('finds links, known mentions, task references, code and bold', () => {
    const t = tokens(
      'Hi @ada and @nobody, see APP-12 at https://x.test/a. Run `npm ci` **now**',
      new Set(['ada', 'bob']),
      'bob',
    );
    expect(t).toEqual([
      { kind: 'text', value: 'Hi ' },
      { kind: 'mention', value: '@ada', me: false },
      { kind: 'text', value: ' and @nobody, see ' },
      { kind: 'ref', value: 'APP-12' },
      { kind: 'text', value: ' at ' },
      { kind: 'url', value: 'https://x.test/a' },
      { kind: 'text', value: '. Run ' },
      { kind: 'code', value: 'npm ci' },
      { kind: 'text', value: ' ' },
      { kind: 'bold', value: 'now' },
    ]);
    expect(tokens('@bob look', new Set(['bob']), 'bob')[0]).toEqual({
      kind: 'mention',
      value: '@bob',
      me: true,
    });
    expect(tokens('mail ada@example.com', new Set(['example']), 'x')).toEqual([
      { kind: 'text', value: 'mail ada@example.com' },
    ]);
  });

  it('knows when someone is being mentioned at the caret', () => {
    expect(mentionAt('hello @ad')).toBe('ad');
    expect(mentionAt('@')).toBe('');
    expect(mentionAt('mail a@b')).toBeNull();
    expect(mentionAt('hello')).toBeNull();
  });
});

describe('a conversation on screen', () => {
  it('heads each day and groups one person’s quick messages', () => {
    const now = new Date(2026, 9, 11, 15, 0);
    const lines = layout(
      [
        msg('a', new Date(2026, 9, 10, 9, 0).toISOString(), 'ada'),
        msg('b', new Date(2026, 9, 11, 9, 0).toISOString(), 'ada'),
        msg('c', new Date(2026, 9, 11, 9, 3).toISOString(), 'ada'),
        msg('d', new Date(2026, 9, 11, 9, 4).toISOString(), 'bob'),
        msg('e', new Date(2026, 9, 11, 9, 30).toISOString(), 'bob'),
      ],
      now,
    );
    expect(
      lines.map((l) => (l.kind === 'day' ? '# ' + l.label : l.key + (l.compact ? '+' : ''))),
    ).toEqual(['# Yesterday', 'a', '# Today', 'b', 'c+', 'd', 'e']);
  });

  it('merges live messages by id, in time order', () => {
    const a = msg('a', '2026-10-11T09:00:00.000Z', 'ada');
    const b = msg('b', '2026-10-11T09:01:00.000Z', 'ada');
    const b2 = { ...b, body: 'changed' };
    expect(mergeMessages([b, a], [b2]).map((m) => m.id + ':' + m.body)).toEqual([
      'a:a',
      'b:changed',
    ]);
  });

  it('routes to the list and to one conversation', () => {
    expect(appRoute('/messages')).toEqual({ kind: 'messages', id: null });
    expect(appRoute('/messages/11111111-1111-4111-8111-111111111111')).toEqual({
      kind: 'messages',
      id: '11111111-1111-4111-8111-111111111111',
    });
  });
});
