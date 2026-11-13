// ── [PCODE-236 | S15 | v0.1.0] T23.3 Messages for clients, in VS Code and in the CLI ──
import { describe, expect, it } from 'vitest';
import type { ChannelJson, MessageJson } from '@orqiva/shared';
import { notifies, titleOf, unreadOf, viewOf } from '../../src/server/messages';
import { isWebviewMessage } from '../../src/webviews/protocol';

const channel = (over: Partial<ChannelJson>): ChannelJson => ({
  id: 'c1',
  kind: 'channel',
  name: 'general',
  topic: '',
  projectId: null,
  clientId: null,
  private: false,
  members: [],
  joined: true,
  muted: false,
  unread: 0,
  mentioned: false,
  lastMessageAt: null,
  archived: false,
  ...over,
});
const msg = (body: string, author = 'u2'): MessageJson => ({
  id: 'm1',
  channelId: 'c1',
  parentId: null,
  author: { id: author, name: 'Bob' },
  body,
  fileIds: [],
  files: [],
  itemId: null,
  replyCount: 0,
  lastReplyAt: null,
  reactions: [],
  createdAt: '2026-10-11T09:00:00.000Z',
  editedAt: null,
  deleted: false,
});
const me = { id: 'u1', email: 'ada@example.test', name: 'Ada Lovelace' };

describe('conversations in VS Code', () => {
  it('names channels and direct messages', () => {
    expect(titleOf(channel({}), 'u1')).toBe('#general');
    expect(
      titleOf(
        channel({
          kind: 'direct',
          name: null,
          members: [
            { id: 'u1', name: 'Ada' },
            { id: 'u2', name: 'Bob' },
          ],
        }),
        'u1',
      ),
    ).toBe('Bob');
  });

  it('counts unread messages in joined, unmuted conversations, and mentions always', () => {
    expect(
      unreadOf([
        channel({ unread: 2 }),
        channel({ unread: 5, muted: true }),
        channel({ unread: 1, muted: true, mentioned: true }),
        channel({ unread: 7, joined: false }),
      ]),
    ).toBe(3);
  });

  it('notifies about a mention of me or a direct message, never about my own', () => {
    expect(notifies(msg('ping @ada'), channel({}), me)).toBe(true);
    expect(notifies(msg('ping @AdaLovelace'), channel({}), me)).toBe(true);
    expect(notifies(msg('hello all'), channel({}), me)).toBe(false);
    expect(notifies(msg('hi'), channel({ kind: 'direct', name: null }), me)).toBe(true);
    expect(notifies(msg('hi'), channel({ kind: 'direct', name: null, muted: true }), me)).toBe(
      false,
    );
    expect(notifies(msg('@ada', 'u1'), channel({}), me)).toBe(false);
  });

  it('shows a message for the panel', () => {
    expect(viewOf(msg('x', 'u1'), 'u1')).toMatchObject({ mine: true, author: 'Bob', body: 'x' });
  });

  it('takes only valid messages from the panel', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(isWebviewMessage({ type: 'chat/send', text: 'hi' })).toBe(true);
    expect(isWebviewMessage({ type: 'chat/send', text: '  ' })).toBe(false);
    expect(isWebviewMessage({ type: 'chat/send', text: 'hi', parentId: 'nope' })).toBe(false);
    expect(isWebviewMessage({ type: 'chat/react', messageId: id, emoji: '👍', on: true })).toBe(
      true,
    );
    expect(isWebviewMessage({ type: 'chat/react', messageId: id, emoji: '🦄', on: true })).toBe(
      false,
    );
    expect(isWebviewMessage({ type: 'chat/openRef', ref: 'APP-12' })).toBe(true);
    expect(isWebviewMessage({ type: 'chat/openRef', ref: 'javascript:x' })).toBe(false);
  });
});
