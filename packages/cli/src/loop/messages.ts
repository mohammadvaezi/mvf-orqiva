// ── [PCODE-236 | S15 | v0.1.0] T23.3 Messages for clients, in VS Code and in the CLI ──
//    Why:  the team's conversations from the terminal: which ones have something new, the latest messages
//          of one, and a message or a reply in a thread written without leaving the shell. A conversation
//          is named the way people say it: "#release-planning" or "@bob" for the direct messages with Bob
//          (opened if there are none yet). A message written while the network is gone waits in the queue
//          like every other write of orq.
import { handleOf, messagePreview, type ChannelJson, type MessageJson } from '@orqiva/shared';
import { sendOrQueue } from './api.js';
import { LoopError, option, positionals, type Linked, type LoopResult } from './commands.js';

export const MESSAGES_USAGE = [
  '  msg                        your conversations, the ones with something new first',
  '  msg #CHANNEL|@PERSON [--last N]   the latest messages of a conversation',
  '  msg #CHANNEL|@PERSON "text" [--thread ID]   write there, or reply in the thread of message ID',
];

interface Person {
  userId: string;
  name: string;
  email: string;
  role: string;
}

const time = (iso: string): string => {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

/** A conversation's name as people write it: "#general", "@bob" (direct with one), "@bob,@eve". */
export function nameOf(c: ChannelJson, me: { id: string }, people: readonly Person[]): string {
  if (c.kind === 'channel') return '#' + (c.name ?? '');
  return c.members
    .filter((m) => m.id !== me.id)
    .map((m) => {
      const p = people.find((x) => x.userId === m.id);
      return '@' + (p ? handleOf(p) : m.name.replace(/\s+/g, '').toLowerCase());
    })
    .join(',');
}

/** One line per message: time, author, text; a thread's size and the id to reply to it. */
export function messageLine(m: MessageJson): string {
  const who = m.author?.name ?? 'Someone';
  const text = m.deleted ? '(deleted)' : messagePreview(m.body, 300);
  const thread = m.replyCount
    ? '  [' +
      String(m.replyCount) +
      (m.replyCount === 1 ? ' reply' : ' replies') +
      ', thread ' +
      m.id.slice(0, 8) +
      ']'
    : '';
  return time(m.createdAt) + '  ' + who + ': ' + text + thread;
}

async function resolve(
  l: Linked,
  name: string,
  me: { id: string },
  people: Person[],
): Promise<ChannelJson> {
  const list = await l.api.call<ChannelJson[]>('GET', l.ws + '/channels');
  if (name.startsWith('#')) {
    const c = list.find((x) => x.kind === 'channel' && x.name === name.slice(1).toLowerCase());
    if (!c) throw new LoopError('No channel ' + name + ' that you can see. Run: orq msg');
    return c;
  }
  if (!name.startsWith('@')) throw new LoopError('Name a conversation as #channel or @person');
  const handles = name
    .split(',')
    .map((h) => h.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  const ids: string[] = [];
  for (const h of handles) {
    const p = people.find(
      (x) => handleOf(x) === h || x.name.replace(/\s+/g, '').toLowerCase() === h,
    );
    if (!p) throw new LoopError('Nobody called @' + h + ' in this workspace');
    ids.push(p.userId);
  }
  const want = [...new Set([me.id, ...ids])].sort().join(',');
  const found = list.find(
    (c) =>
      c.kind === 'direct' &&
      c.members
        .map((m) => m.id)
        .sort()
        .join(',') === want,
  );
  if (found) return found;
  return l.api.call<ChannelJson>('POST', l.ws + '/direct', { userIds: ids });
}

export async function messages(argv: readonly string[], l: Linked): Promise<LoopResult> {
  const [conv, text] = positionals(argv.slice(1), ['--thread', '--last']);
  const me = (await l.api.call<{ user: { id: string } }>('GET', '/auth/me')).user;
  const people = await l.api.call<Person[]>('GET', l.ws + '/members').catch(() => [] as Person[]);

  if (!conv) {
    const list = await l.api.call<ChannelJson[]>('GET', l.ws + '/channels');
    if (!list.length) return { code: 0, out: 'No conversations yet.' };
    const sorted = [...list].sort(
      (a, b) =>
        Number(b.mentioned) - Number(a.mentioned) ||
        b.unread - a.unread ||
        (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''),
    );
    return {
      code: 0,
      out: sorted
        .map((c) => {
          const name = nameOf(c, me, people);
          const state = !c.joined
            ? 'not joined'
            : (c.unread ? String(c.unread) + ' new' : '') + (c.mentioned ? '  @ you' : '');
          return name.padEnd(28) + (c.muted ? 'muted  ' : '') + state;
        })
        .join('\n'),
    };
  }

  const c = await resolve(l, conv, me, people);
  const C = l.ws + '/channels/' + c.id;
  if (text !== undefined) {
    const thread = option(argv, '--thread');
    let parentId: string | undefined;
    if (thread) {
      const page = await l.api.call<{ messages: MessageJson[] }>('GET', C + '/messages?limit=100');
      parentId = page.messages.find((m) => m.id === thread || m.id.startsWith(thread))?.id;
      if (!parentId) throw new LoopError('No message ' + thread + ' in the latest of ' + conv);
    }
    const sent = await sendOrQueue(l.root, l.api, 'POST', C + '/messages', {
      body: text,
      ...(parentId ? { parentId } : {}),
    });
    return {
      code: 0,
      out:
        (parentId ? 'Replied in the thread in ' : 'Sent to ') +
        nameOf(c, me, people) +
        (sent ? '' : ' (offline: queued, goes with the next orq sync)'),
    };
  }

  const last = Math.min(100, Math.max(1, Number(option(argv, '--last') ?? 20) || 20));
  const page = await l.api.call<{ messages: MessageJson[] }>(
    'GET',
    C + '/messages?limit=' + String(last),
  );
  await l.api.call('POST', C + '/read').catch(() => undefined);
  const head = nameOf(c, me, people) + (c.topic ? ' · ' + c.topic : '');
  if (!page.messages.length) return { code: 0, out: head + '\nNo messages yet.' };
  return { code: 0, out: [head, ...page.messages.map(messageLine)].join('\n') };
}
