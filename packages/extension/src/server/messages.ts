// ── [PCODE-236 | S15 | v0.1.0] T23.3 Messages for clients, in VS Code and in the CLI ──
//    Why:  the team's conversations without leaving the editor. The Messages view lists the channels you
//          are in and your direct messages, with unread counts and a mark where you are mentioned; a
//          conversation opens in a panel with its threads, and a reply goes out from there. Everything
//          follows the live connection the board already uses. A mention or a direct message raises a
//          notification unless that conversation is open in front of you.
import * as vscode from 'vscode';
import {
  handleOf,
  mentionsIn,
  messagePreview,
  type ChannelJson,
  type ChatEvent,
  type MessageJson,
} from '@orqiva/shared';
import type { Api } from '../../../cli/src/loop/api';
import { createPanel, type PanelHandle } from '../webviews/host';
import type { ChatData, ChatMessageView, ChatToHost, HostToChat } from '../webviews/protocol';

export interface MessagesSource {
  api: Api;
  workspaceId: string;
  server: string;
}

interface Person {
  userId: string;
  name: string;
  email: string;
}

/** A conversation's name: "#channel", or the other people of a direct message. */
export function titleOf(c: ChannelJson, meId: string | null): string {
  if (c.kind === 'channel') return '#' + (c.name ?? '');
  const others = c.members.filter((m) => m.id !== meId).map((m) => m.name);
  return others.join(', ') || 'Just you';
}

/** Messages to count on the badge: unread in joined, unmuted conversations (mentions always count). */
export const unreadOf = (list: readonly ChannelJson[]): number =>
  list.reduce((n, c) => n + (c.joined && (!c.muted || c.mentioned) ? c.unread : 0), 0);

/** Whether a new message should raise a notification for me. */
export function notifies(
  m: MessageJson,
  channel: ChannelJson | undefined,
  me: { id: string; email: string; name: string } | null,
): boolean {
  if (!me || !channel || m.author?.id === me.id || m.deleted) return false;
  if (channel.kind === 'direct') return !channel.muted;
  return mentionsIn(m.body, [{ id: me.id, name: me.name, email: me.email }]).length > 0;
}

export function viewOf(m: MessageJson, meId: string | null): ChatMessageView {
  return {
    id: m.id,
    authorId: m.author?.id ?? null,
    author: m.author?.name ?? 'Someone',
    mine: m.author?.id === meId,
    at: m.createdAt,
    body: m.body,
    deleted: m.deleted,
    edited: m.editedAt !== null,
    replyCount: m.replyCount,
    reactions: m.reactions,
    files: m.files.map((f) => f.name),
    itemId: m.itemId,
  };
}

/** The conversations, read again when one changes; one request at a time. */
export class MessagesModel implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private list: ChannelJson[] = [];
  private loading: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  me: { id: string; email: string; name: string } | null = null;
  people: Person[] = [];

  constructor(readonly source: () => MessagesSource | null) {}

  channels(): ChannelJson[] {
    return this.list;
  }

  channel(id: string): ChannelJson | undefined {
    return this.list.find((c) => c.id === id);
  }

  refresh(): Promise<void> {
    if (this.loading) return this.loading;
    const s = this.source();
    if (!s) {
      this.list = [];
      this.emitter.fire();
      return Promise.resolve();
    }
    const W = '/api/workspaces/' + s.workspaceId;
    this.loading = (async () => {
      if (!this.me) {
        const r = await s.api
          .call<{ user: { id: string; email: string; name: string } }>('GET', '/auth/me')
          .catch(() => null);
        this.me = r?.user ?? null;
        this.people = await s.api.call<Person[]>('GET', W + '/members').catch(() => []);
      }
      this.list = await s.api.call<ChannelJson[]>('GET', W + '/channels').catch(() => this.list);
      this.emitter.fire();
    })().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  refreshSoon(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, 500);
  }

  forget(): void {
    this.me = null;
    this.people = [];
    this.list = [];
    this.emitter.fire();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.emitter.dispose();
  }
}

type Node =
  { kind: 'group'; label: 'Channels' | 'Direct messages' } | { kind: 'channel'; c: ChannelJson };

export class MessagesTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly sub: vscode.Disposable;

  constructor(private readonly model: MessagesModel) {
    this.sub = model.onDidChange(() => {
      this.emitter.fire(undefined);
    });
  }

  getChildren(node?: Node): Node[] {
    const list = this.model.channels();
    if (!node) {
      if (!list.length) return [];
      return [
        { kind: 'group', label: 'Channels' },
        { kind: 'group', label: 'Direct messages' },
      ];
    }
    if (node.kind === 'group')
      return list
        .filter((c) =>
          node.label === 'Channels' ? c.kind === 'channel' && c.joined : c.kind === 'direct',
        )
        .map((c) => ({ kind: 'channel', c }));
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'group') {
      const t = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      t.contextValue = 'messages-group';
      return t;
    }
    const c = node.c;
    const t = new vscode.TreeItem(titleOf(c, this.model.me?.id ?? null));
    const unread = c.joined && c.unread > 0 && (!c.muted || c.mentioned);
    t.description = (c.mentioned ? '@ ' : '') + (unread ? String(c.unread) : '');
    t.tooltip = c.topic || titleOf(c, this.model.me?.id ?? null);
    t.iconPath = new vscode.ThemeIcon(
      c.kind === 'direct' ? 'account' : c.private ? 'lock' : 'comment-discussion',
    );
    t.contextValue = 'conversation';
    t.command = { command: 'orqiva.messages.open', title: 'Open', arguments: [c] };
    return t;
  }

  dispose(): void {
    this.sub.dispose();
    this.emitter.dispose();
  }
}

interface Conversation {
  handle: PanelHandle<ChatToHost, HostToChat>;
  channel: ChannelJson;
  messages: MessageJson[];
  more: boolean;
  thread: { root: MessageJson; replies: MessageJson[] } | null;
  error: string | null;
}

const merge = (list: readonly MessageJson[], more: readonly MessageJson[]): MessageJson[] => {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of more) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

/** The open conversation panels: one per conversation, live. */
export class ConversationPanels implements vscode.Disposable {
  private readonly open = new Map<string, Conversation>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly model: MessagesModel,
    private readonly log: (line: string) => void,
  ) {}

  /** Whether a conversation is in front of the person now. */
  showing(channelId: string): boolean {
    return this.open.get(channelId)?.handle.panel.visible ?? false;
  }

  async show(c: ChannelJson): Promise<void> {
    const s = this.model.source();
    if (!s) return;
    const title = titleOf(c, this.model.me?.id ?? null);
    const { handle, created } = createPanel<ChatToHost, HostToChat>(this.context, {
      id: 'chat-' + c.id,
      title,
      entry: 'chat',
      log: this.log,
    });
    if (!created) {
      void this.read(c.id);
      return;
    }
    const conv: Conversation = {
      handle,
      channel: c,
      messages: [],
      more: false,
      thread: null,
      error: null,
    };
    this.open.set(c.id, conv);
    handle.panel.onDidDispose(() => this.open.delete(c.id));
    handle.panel.onDidChangeViewState(() => {
      if (handle.panel.visible) void this.read(c.id);
    });
    handle.onMessage((m) => {
      void this.act(conv, m).catch((err: unknown) => {
        conv.error = err instanceof Error ? err.message : String(err);
        this.post(conv);
      });
    });
    await this.load(conv);
  }

  private W(): string {
    return '/api/workspaces/' + (this.model.source()?.workspaceId ?? '');
  }

  private async load(conv: Conversation): Promise<void> {
    const s = this.model.source();
    if (!s) return;
    const r = await s.api.call<{ messages: MessageJson[]; more: boolean }>(
      'GET',
      this.W() + '/channels/' + conv.channel.id + '/messages',
    );
    conv.messages = r.messages;
    conv.more = r.more;
    this.post(conv);
    await this.read(conv.channel.id);
  }

  private async read(channelId: string): Promise<void> {
    const s = this.model.source();
    if (!s) return;
    await s.api.call('POST', this.W() + '/channels/' + channelId + '/read').catch(() => undefined);
    this.model.refreshSoon();
  }

  private async act(conv: Conversation, m: ChatToHost): Promise<void> {
    const s = this.model.source();
    if (!s) return;
    const W = this.W();
    conv.error = null;
    switch (m.type) {
      case 'chat/ready':
        break;
      case 'chat/send': {
        const sent = await s.api.call<MessageJson>(
          'POST',
          W + '/channels/' + conv.channel.id + '/messages',
          { body: m.text, ...(m.parentId ? { parentId: m.parentId } : {}) },
        );
        if (sent.parentId && conv.thread?.root.id === sent.parentId)
          conv.thread = { ...conv.thread, replies: merge(conv.thread.replies, [sent]) };
        else if (!sent.parentId) conv.messages = merge(conv.messages, [sent]);
        break;
      }
      case 'chat/thread':
        conv.thread = await s.api.call<{ root: MessageJson; replies: MessageJson[] }>(
          'GET',
          W + '/messages/' + m.messageId + '/thread',
        );
        break;
      case 'chat/closeThread':
        conv.thread = null;
        break;
      case 'chat/older': {
        const first = conv.messages[0];
        if (!first) break;
        const r = await s.api.call<{ messages: MessageJson[]; more: boolean }>(
          'GET',
          W +
            '/channels/' +
            conv.channel.id +
            '/messages?before=' +
            encodeURIComponent(first.createdAt),
        );
        conv.messages = merge(r.messages, conv.messages);
        conv.more = r.more;
        break;
      }
      case 'chat/react': {
        const r = await s.api.call<MessageJson>(
          m.on ? 'PUT' : 'DELETE',
          W + '/messages/' + m.messageId + '/reactions/' + encodeURIComponent(m.emoji),
        );
        this.replace(conv, r);
        break;
      }
      case 'chat/openRef':
        void vscode.commands.executeCommand('orqiva.openTask', m.ref);
        return;
      case 'chat/openWeb':
        void vscode.env.openExternal(
          vscode.Uri.parse(s.server.replace(/\/$/, '') + '/messages/' + conv.channel.id),
        );
        return;
    }
    this.post(conv);
  }

  private replace(conv: Conversation, m: MessageJson): void {
    conv.messages = conv.messages.map((x) => (x.id === m.id ? m : x));
    if (conv.thread)
      conv.thread =
        conv.thread.root.id === m.id
          ? { ...conv.thread, root: m }
          : { ...conv.thread, replies: conv.thread.replies.map((x) => (x.id === m.id ? m : x)) };
  }

  /** A live change: the open conversation it belongs to follows. */
  onChat(c: ChatEvent): void {
    if (c.op === 'channel') return;
    const m = c.message;
    const conv = this.open.get(m.channelId);
    if (!conv) return;
    if (c.op === 'updated') this.replace(conv, m);
    else if (!m.parentId) conv.messages = merge(conv.messages, [m]);
    else {
      conv.messages = conv.messages.map((x) =>
        x.id === m.parentId ? { ...x, replyCount: x.replyCount + 1 } : x,
      );
      if (conv.thread?.root.id === m.parentId)
        conv.thread = { ...conv.thread, replies: merge(conv.thread.replies, [m]) };
    }
    this.post(conv);
    if (c.op === 'message' && conv.handle.panel.visible) void this.read(m.channelId);
  }

  private post(conv: Conversation): void {
    const me = this.model.me?.id ?? null;
    const data: ChatData = {
      channelId: conv.channel.id,
      title: titleOf(conv.channel, me),
      topic: conv.channel.topic,
      messages: conv.messages.map((m) => viewOf(m, me)),
      more: conv.more,
      thread: conv.thread
        ? {
            root: viewOf(conv.thread.root, me),
            replies: conv.thread.replies.map((m) => viewOf(m, me)),
          }
        : null,
      handles: this.model.people.map((p) => handleOf(p)),
      me: this.model.me ? handleOf(this.model.me) : '',
      error: conv.error,
    };
    void conv.handle.post({ type: 'chat/data', data });
  }

  dispose(): void {
    for (const c of this.open.values()) c.handle.panel.dispose();
    this.open.clear();
  }
}

/** A short line for a notification about a message. */
export const noticeText = (m: MessageJson, where: string): string =>
  (m.author?.name ?? 'Someone') + ' in ' + where + ': ' + messagePreview(m.body, 100);
