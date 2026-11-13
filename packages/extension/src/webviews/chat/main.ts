// ── [PCODE-236 | S15 | v0.1.0] T23.3 Messages for clients, in VS Code and in the CLI ──
//    Why:  the webview side of a conversation: messages with their day headings, mentions and task
//          references marked the same way the web app marks them (shared text rules), reactions, the
//          thread beside it, and a composer that sends with Enter. It only renders what the host sends
//          and posts typed messages back; text is set as text, never as HTML.
import { REACTIONS } from '@orqiva/shared';
import { tokens } from '../../../../web/src/v2/chattext';
import type { ChatData, ChatMessageView, ChatToHost, HostToChat } from '../protocol';
import { el, icon, vscodeApi } from '../vscodeApi';

const api = vscodeApi<ChatToHost>();
const app = document.getElementById('app') as HTMLDivElement;
let data: ChatData | null = null;
const drafts = new Map<string, string>();

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const day = (iso: string): string => new Date(iso).toDateString();

function body(m: ChatMessageView, d: ChatData): HTMLElement {
  const p = el('div', { class: 'pc-chat-body' });
  if (m.deleted) {
    p.append(el('em', { class: 'pc-muted', text: 'This message was deleted.' }));
    return p;
  }
  for (const t of tokens(m.body, new Set(d.handles), d.me)) {
    if (t.kind === 'mention')
      p.append(
        el('span', {
          class: 'pc-chat-mention' + (t.me ? ' pc-chat-mention--me' : ''),
          text: t.value,
        }),
      );
    else if (t.kind === 'ref') {
      const b = el('button', { class: 'pc-chat-ref', type: 'button', text: t.value });
      b.addEventListener('click', () => {
        api.postMessage({ type: 'chat/openRef', ref: t.value });
      });
      p.append(b);
    } else if (t.kind === 'code') p.append(el('code', { text: t.value }));
    else if (t.kind === 'bold') p.append(el('strong', { text: t.value }));
    else if (t.kind === 'url') p.append(el('span', { class: 'pc-chat-url', text: t.value }));
    else p.append(document.createTextNode(t.value));
  }
  return p;
}

function message(
  m: ChatMessageView,
  d: ChatData,
  compact: boolean,
  inThread: boolean,
): HTMLElement {
  const box = el('article', { class: 'pc-chat-msg' + (compact ? ' pc-chat-msg--compact' : '') });
  if (!compact)
    box.append(
      el(
        'div',
        { class: 'pc-chat-meta' },
        el('strong', { text: m.author }),
        el('span', { class: 'pc-muted', text: clock(m.at) + (m.edited ? ' (edited)' : '') }),
      ),
    );
  box.append(body(m, d));
  if (m.files.length)
    box.append(
      el(
        'div',
        { class: 'pc-chat-files' },
        ...m.files.map((f) => el('span', { class: 'pc-badge' }, icon('file'), f)),
      ),
    );
  if (m.itemId) box.append(el('div', { class: 'pc-chat-task' }, icon('check'), 'Became a task'));
  const actions = el('div', { class: 'pc-chat-reactions' });
  for (const r of m.reactions) {
    const b = el('button', {
      class: 'pc-chat-reaction' + (r.mine ? ' pc-chat-reaction--mine' : ''),
      type: 'button',
      'aria-pressed': String(r.mine),
      text: r.emoji + ' ' + String(r.count),
    });
    b.addEventListener('click', () => {
      api.postMessage({ type: 'chat/react', messageId: m.id, emoji: r.emoji, on: !r.mine });
    });
    actions.append(b);
  }
  if (!m.deleted) {
    const add = el('button', { class: 'pc-chat-add', type: 'button', title: 'React', text: '+' });
    add.addEventListener('click', () => {
      const pick = el('span', { class: 'pc-chat-picker' });
      for (const e of REACTIONS) {
        const b = el('button', { type: 'button', text: e });
        b.addEventListener('click', () => {
          api.postMessage({ type: 'chat/react', messageId: m.id, emoji: e, on: true });
        });
        pick.append(b);
      }
      add.replaceWith(pick);
    });
    actions.append(add);
  }
  if (!inThread && m.replyCount > 0) {
    const t = el('button', {
      class: 'pc-link',
      type: 'button',
      text: m.replyCount === 1 ? '1 reply' : String(m.replyCount) + ' replies',
    });
    t.addEventListener('click', () => {
      api.postMessage({ type: 'chat/thread', messageId: m.id });
    });
    actions.append(t);
  } else if (!inThread && !m.deleted) {
    const t = el('button', { class: 'pc-link pc-chat-reply', type: 'button', text: 'Reply' });
    t.addEventListener('click', () => {
      api.postMessage({ type: 'chat/thread', messageId: m.id });
    });
    actions.append(t);
  }
  box.append(actions);
  return box;
}

function list(messages: ChatMessageView[], d: ChatData, inThread: boolean): HTMLElement {
  const box = el('div', { class: 'pc-chat-list' });
  let prev: ChatMessageView | null = null;
  for (const m of messages) {
    if (!prev || day(prev.at) !== day(m.at))
      box.append(el('div', { class: 'pc-chat-day', text: new Date(m.at).toLocaleDateString() }));
    const compact =
      prev !== null &&
      day(prev.at) === day(m.at) &&
      prev.authorId === m.authorId &&
      Date.parse(m.at) - Date.parse(prev.at) < 5 * 60_000;
    box.append(message(m, d, compact, inThread));
    prev = m;
  }
  return box;
}

function composer(key: string, placeholder: string, parentId?: string): HTMLElement {
  const box = el('div', { class: 'pc-chat-composer' });
  const input = el('textarea', {
    class: 'pc-input',
    rows: '2',
    placeholder,
    'aria-label': placeholder,
  });
  input.value = drafts.get(key) ?? '';
  input.addEventListener('input', () => drafts.set(key, input.value));
  const send = (): void => {
    const text = input.value.trim();
    if (!text) return;
    api.postMessage({ type: 'chat/send', text, ...(parentId ? { parentId } : {}) });
    input.value = '';
    drafts.delete(key);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  const b = el('button', { class: 'pc-btn pc-btn--primary', type: 'button' }, icon('send'), 'Send');
  b.addEventListener('click', send);
  box.append(input, b);
  return box;
}

function render(): void {
  const d = data;
  app.replaceChildren();
  if (!d) {
    app.append(el('p', { class: 'pc-muted', text: 'Loading…' }));
    return;
  }
  const head = el(
    'header',
    { class: 'pc-chat-head' },
    el('div', {}, el('h1', { text: d.title }), el('p', { class: 'pc-muted', text: d.topic })),
  );
  const web = el(
    'button',
    { class: 'pc-btn', type: 'button' },
    icon('link-external'),
    'Open in browser',
  );
  web.addEventListener('click', () => {
    api.postMessage({ type: 'chat/openWeb' });
  });
  head.append(web);
  app.append(head);
  if (d.error) app.append(el('div', { class: 'pc-alert', role: 'alert', text: d.error }));
  const cols = el('div', { class: 'pc-chat-cols' + (d.thread ? ' pc-chat-cols--thread' : '') });
  const main = el('section', { class: 'pc-chat-main' });
  if (d.more) {
    const older = el('button', { class: 'pc-link', type: 'button', text: 'Show older messages' });
    older.addEventListener('click', () => {
      api.postMessage({ type: 'chat/older' });
    });
    main.append(older);
  }
  if (!d.messages.length)
    main.append(el('p', { class: 'pc-muted', text: 'No messages yet. Say hello.' }));
  const scroller = list(d.messages, d, false);
  main.append(scroller, composer(d.channelId, 'Write to ' + d.title));
  cols.append(main);
  if (d.thread) {
    const side = el('section', { class: 'pc-chat-thread', 'aria-label': 'Thread' });
    const close = el('button', { class: 'pc-link', type: 'button', text: 'Close thread' });
    close.addEventListener('click', () => {
      api.postMessage({ type: 'chat/closeThread' });
    });
    side.append(
      el('div', { class: 'pc-chat-thread-head' }, el('strong', { text: 'Thread' }), close),
      list([d.thread.root], d, true),
      el('div', {
        class: 'pc-muted',
        text:
          d.thread.replies.length === 1 ? '1 reply' : String(d.thread.replies.length) + ' replies',
      }),
      list(d.thread.replies, d, true),
      composer('thread-' + d.thread.root.id, 'Reply in the thread', d.thread.root.id),
    );
    cols.append(side);
  }
  app.append(cols);
  scroller.scrollTop = scroller.scrollHeight;
}

window.addEventListener('message', (e: MessageEvent<HostToChat>) => {
  data = e.data.data;
  render();
});
render();
api.postMessage({ type: 'chat/ready' });
