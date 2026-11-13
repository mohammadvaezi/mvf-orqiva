// ── [PCODE-436 | S15 | v0.1.0] T37 low: Untangle the three folder import cycles ──
// ── [PCODE-354 | S15 | v0.1.0] T35.4b Offline beyond tasks: comments, messages and time written offline; reads kept for offline ──
// ── [PCODE-269 | S15 | v0.1.0] UX check fixes: no service accounts in people pickers, search leaves on opening a conversation, epic chips open the epic ──
// ── [PCODE-235 | S15 | v0.1.0] T23.2 Messages in the web app ──
//    Why:  the team's conversations, inside Orqiva (owner decision, 11 Oct 2026). Three panes, dense like
//          the rest of v2: the conversations (channels, then direct messages, with unread counts and
//          mentions marked), the conversation itself, and a thread beside it. Everything arrives live; a
//          conversation on screen counts as read. From a message: react, reply in its thread, turn it
//          into a task, edit or delete your own. The composer suggests people after "@", sends with
//          Enter (Shift+Enter for a new line) and attaches files. On a phone, the list and the
//          conversation take the screen in turn.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  channelName,
  handleOf,
  REACTIONS,
  type ChannelJson,
  type MessageJson,
} from '@orqiva/shared';
import { api, type Me } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { navigate } from '../core/nav.js';
import { Dialog } from '../core/dialog.js';
import { PIcon } from '../preview/picons.js';
import { Button, Kbd, PageHead } from '../preview/ui.js';
import { clock, layout, mentionAt, mergeMessages, tokens, type Token } from './chattext.js';
import './messages.css';
import { sizeText, uploadFile, type UploadedFile } from './files.js';
import { LiveAvatar } from './shell.js';
import { outboxFor, sendOrQueue } from '../sync/outbox.js'; // [PCODE-354 | S15 | v0.1.0]

interface Person {
  userId: string;
  name: string;
  email: string;
  role: string;
  service?: boolean; // [PCODE-269 | S15 | v0.1.0] a machine account (CI, a runner), not a person
}
interface ProjectLite {
  id: string;
  key: string;
  name: string;
  archived?: boolean;
}
interface Thread {
  root: MessageJson;
  replies: MessageJson[];
}

const READ_EVENT = 'orqiva:messages-read';

/** The unread count for the rail: messages in joined, unmuted conversations, and every mention. */
export function useUnreadMessages(workspaceId: string, hub: EventHub): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = (): void => {
      void api<ChannelJson[]>('GET', '/api/workspaces/' + workspaceId + '/channels').then((r) => {
        if (r.ok)
          setN(
            r.data.reduce(
              (sum, c) => sum + (c.joined && (!c.muted || c.mentioned) ? c.unread : 0),
              0,
            ),
          );
      });
    };
    const soon = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 400);
    };
    load();
    const off = hub.onChat(soon);
    window.addEventListener(READ_EVENT, soon);
    return () => {
      off();
      window.removeEventListener(READ_EVENT, soon);
      if (timer) clearTimeout(timer);
    };
  }, [workspaceId, hub]);
  return n;
}

const plural = (n: number, one: string, many: string): string =>
  String(n) + ' ' + (n === 1 ? one : many);

const titleOf = (c: ChannelJson, meId: string): string =>
  c.kind === 'direct'
    ? c.members
        .filter((m) => m.id !== meId)
        .map((m) => m.name)
        .join(', ') || 'Just you'
    : '#' + (c.name ?? '');

export function MessagesPage(props: {
  workspaceId: string;
  channelId: string | null;
  me: Me;
  role: string;
  portal: boolean;
  hub: EventHub;
  go: (path: string) => void;
}): ReactNode {
  const W = '/api/workspaces/' + props.workspaceId;
  const meId = props.me.user.id;
  const [channels, setChannels] = useState<ChannelJson[] | null>(null);
  const [messages, setMessages] = useState<MessageJson[]>([]);
  const [more, setMore] = useState(false);
  const [thread, setThread] = useState<Thread | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'channel' | 'direct' | 'members' | null>(null);
  const [taskFrom, setTaskFrom] = useState<MessageJson | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<MessageJson[] | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const member = props.role !== 'guest' && !props.portal;

  const loadChannels = useCallback(async () => {
    const r = await api<ChannelJson[]>('GET', W + '/channels');
    if (r.ok) setChannels(r.data);
    else setError(r.error.message);
  }, [W]);

  // the conversation on screen: the route's, else #general, else the first
  const current = useMemo(() => {
    if (!channels) return null;
    return (
      channels.find((c) => c.id === props.channelId) ??
      (props.channelId ? null : (channels.find((c) => c.name === 'general') ?? channels[0] ?? null))
    );
  }, [channels, props.channelId]);
  // [PCODE-269 | S15 | v0.1.0] choosing a conversation leaves the search
  useEffect(() => {
    setFound(null);
    setQuery('');
  }, [props.channelId]);

  useEffect(() => {
    void loadChannels();
    if (member) {
      void api<Person[]>('GET', W + '/members').then((r) => {
        // [PCODE-269 | S15 | v0.1.0] people to write to and mention, not machine accounts
        if (r.ok) setPeople(r.data.filter((p) => !p.service));
      });
      void api<ProjectLite[]>('GET', W + '/projects').then((r) => {
        if (r.ok) setProjects(r.data.filter((p) => !p.archived));
      });
    }
  }, [W, member, loadChannels]);

  const markRead = useCallback(
    (id: string) => {
      void api('POST', W + '/channels/' + id + '/read').then(() => {
        setChannels(
          (list) =>
            list?.map((c) => (c.id === id ? { ...c, unread: 0, mentioned: false } : c)) ?? list,
        );
        window.dispatchEvent(new Event(READ_EVENT));
      });
    },
    [W],
  );

  const currentId = current?.id ?? null;
  useEffect(() => {
    setMessages([]);
    setMore(false);
    setThread(null);
    if (!currentId) return;
    let stale = false;
    void api<{ messages: MessageJson[]; more: boolean }>(
      'GET',
      W + '/channels/' + currentId + '/messages',
    ).then((r) => {
      if (stale) return;
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setMessages(r.data.messages);
      setMore(r.data.more);
      markRead(currentId);
    });
    // a thread named in the address (a notification about a reply) opens beside it
    const t = new URLSearchParams(window.location.search).get('thread');
    if (t) void openThread(t);
    return () => {
      stale = true;
    };
  }, [W, currentId, markRead]);

  const openThread = async (rootId: string): Promise<void> => {
    const r = await api<Thread>('GET', W + '/messages/' + rootId + '/thread');
    if (r.ok) setThread(r.data);
    else setError(r.error.message);
  };

  // live: new and changed messages, and conversations that changed
  useEffect(
    () =>
      props.hub.onChat((c) => {
        if (c.op === 'channel') {
          void loadChannels();
          return;
        }
        const m = c.message;
        if (m.channelId === currentId) {
          if (!m.parentId) setMessages((list) => mergeMessages(list, [m]));
          else
            setMessages((list) =>
              c.op === 'message'
                ? list.map((x) =>
                    x.id === m.parentId
                      ? { ...x, replyCount: x.replyCount + 1, lastReplyAt: m.createdAt }
                      : x,
                  )
                : list,
            );
          setThread((t) =>
            t && (t.root.id === m.parentId || t.root.id === m.id)
              ? t.root.id === m.id
                ? { ...t, root: m }
                : { ...t, replies: mergeMessages(t.replies, [m]) }
              : t,
          );
          if (c.op === 'message' && document.visibilityState === 'visible') markRead(m.channelId);
        } else if (c.op === 'message') void loadChannels();
      }),
    [props.hub, currentId, loadChannels, markRead],
  );

  const older = (): void => {
    const first = messages[0];
    if (!currentId || !first) return;
    void api<{ messages: MessageJson[]; more: boolean }>(
      'GET',
      W + '/channels/' + currentId + '/messages?before=' + encodeURIComponent(first.createdAt),
    ).then((r) => {
      if (r.ok) {
        setMessages((list) => mergeMessages(r.data.messages, list));
        setMore(r.data.more);
      }
    });
  };

  const search = (q: string): void => {
    setQuery(q);
    if (!q.trim()) {
      setFound(null);
      return;
    }
    void api<MessageJson[]>('GET', W + '/messages/search?q=' + encodeURIComponent(q.trim())).then(
      (r) => {
        if (r.ok) setFound(r.data);
      },
    );
  };

  const handles = useMemo(() => new Set(people.map((p) => handleOf(p))), [people]);
  const mine = handleOf(props.me.user);
  const replace = (m: MessageJson): void => {
    setMessages((list) => list.map((x) => (x.id === m.id ? m : x)));
    setThread((t) =>
      t
        ? t.root.id === m.id
          ? { ...t, root: m }
          : { ...t, replies: t.replies.map((x) => (x.id === m.id ? m : x)) }
        : t,
    );
  };
  const openRef = (ref: string): void => {
    void api<{ items: { id: string; ref: string }[] }>(
      'GET',
      W + '/search?q=' + encodeURIComponent(ref),
    ).then((r) => {
      const hit = r.ok ? r.data.items.find((i) => i.ref === ref) : undefined;
      if (hit) props.go('/items/' + hit.id);
      else setError(ref + ' was not found');
    });
  };

  const joinedChannels = (channels ?? []).filter((c) => c.kind === 'channel' && c.joined);
  const otherChannels = (channels ?? []).filter((c) => c.kind === 'channel' && !c.joined);
  const directs = (channels ?? []).filter((c) => c.kind === 'direct');
  const view = {
    meId,
    handles,
    mine,
    canTask: member && projects.length > 0,
    admin: props.role === 'admin' || props.role === 'owner',
    W,
    onReplace: replace,
    onThread: (id: string) => void openThread(id),
    onTask: setTaskFrom,
    onRef: openRef,
    onError: setError,
  };

  return (
    <div className="pv-page pv-page--full">
      <PageHead
        title="Messages"
        sub={
          channels
            ? plural(joinedChannels.length, 'channel', 'channels') +
              ' · ' +
              plural(directs.length, 'direct conversation', 'direct conversations')
            : 'Loading…'
        }
        icon="chat"
        actions={
          <span className="pv-hint">
            <Kbd>Enter</Kbd> send <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line <Kbd>↑</Kbd> edit last
          </span>
        }
      />
      {error ? (
        <p className="v2-error" role="alert">
          {error}{' '}
          <button
            type="button"
            className="pv-link"
            onClick={() => {
              setError('');
            }}
          >
            Dismiss
          </button>
        </p>
      ) : null}
      {notice ? (
        <div className="v2-undo" role="status">
          {notice}{' '}
          <button
            type="button"
            className="pv-link"
            onClick={() => {
              setNotice('');
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <div
        className={
          'msg-layout' +
          (props.channelId ? ' msg-layout--open' : '') +
          (thread ? ' msg-layout--thread' : '')
        }
      >
        <aside className="msg-list" aria-label="Conversations">
          <input
            className="msg-search"
            type="search"
            placeholder="Search messages"
            aria-label="Search messages"
            value={query}
            onChange={(e) => {
              search(e.target.value);
            }}
          />
          <div className="msg-list-head">
            <span>Channels</span>
            {member ? (
              <button
                type="button"
                className="msg-icon-btn"
                aria-label="New channel"
                title="New channel"
                onClick={() => {
                  setDialog('channel');
                }}
              >
                <PIcon name="plus" size={14} />
              </button>
            ) : null}
          </div>
          {joinedChannels.map((c) => (
            <ChannelLink key={c.id} c={c} meId={meId} current={c.id === currentId} go={props.go} />
          ))}
          {otherChannels.length ? (
            <>
              <div className="msg-list-sub">You can join</div>
              {otherChannels.map((c) => (
                <ChannelLink
                  key={c.id}
                  c={c}
                  meId={meId}
                  current={c.id === currentId}
                  go={props.go}
                />
              ))}
            </>
          ) : null}
          {member ? (
            <>
              <div className="msg-list-head">
                <span>Direct messages</span>
                <button
                  type="button"
                  className="msg-icon-btn"
                  aria-label="New direct message"
                  title="New direct message"
                  onClick={() => {
                    setDialog('direct');
                  }}
                >
                  <PIcon name="plus" size={14} />
                </button>
              </div>
              {directs.map((c) => (
                <ChannelLink
                  key={c.id}
                  c={c}
                  meId={meId}
                  current={c.id === currentId}
                  go={props.go}
                />
              ))}
              {!directs.length ? <p className="msg-quiet">No direct messages yet.</p> : null}
            </>
          ) : null}
          {channels && !channels.length ? (
            <p className="msg-quiet">
              {props.portal
                ? 'No conversation with the team yet. The team opens one for you.'
                : 'No conversations yet.'}
            </p>
          ) : null}
        </aside>

        <section className="msg-main" aria-label="Conversation">
          {found ? (
            <SearchResults
              found={found}
              channels={channels ?? []}
              meId={meId}
              query={query}
              onOpen={(m) => {
                setFound(null);
                setQuery('');
                setHighlight(m.id);
                props.go('/messages/' + m.channelId);
              }}
            />
          ) : current ? (
            <Conversation
              key={current.id}
              channel={current}
              messages={messages}
              more={more}
              highlight={highlight}
              people={people}
              view={view}
              member={member}
              onOlder={older}
              onBack={() => {
                props.go('/messages');
              }}
              onMembers={() => {
                setDialog('members');
              }}
              onChanged={() => void loadChannels()}
              onSent={(m) => {
                setMessages((list) => mergeMessages(list, [m]));
                // [PCODE-236 | S15 | v0.1.0] writing joins a channel: the list says so
                if (!current.joined) void loadChannels();
              }}
            />
          ) : (
            <div className="msg-empty">
              <PIcon name="chat" size={28} />
              <p>{channels ? 'Choose a conversation.' : 'Loading…'}</p>
            </div>
          )}
        </section>

        {thread && current ? (
          <aside className="msg-thread" aria-label="Thread">
            <div className="msg-thread-head">
              <strong>Thread</strong>
              <span className="pv-muted">{titleOf(current, meId)}</span>
              <button
                type="button"
                className="msg-icon-btn"
                aria-label="Close thread"
                onClick={() => {
                  setThread(null);
                }}
              >
                <PIcon name="x" size={14} />
              </button>
            </div>
            <div className="msg-scroll">
              <MessageView m={thread.root} compact={false} view={view} inThread />
              <div className="msg-thread-count">
                {thread.replies.length === 1
                  ? '1 reply'
                  : String(thread.replies.length) + ' replies'}
              </div>
              {layout(thread.replies, new Date()).map((l) =>
                l.kind === 'day' ? null : (
                  <MessageView key={l.key} m={l.message} compact={l.compact} view={view} inThread />
                ),
              )}
            </div>
            <Composer
              W={W}
              channel={current}
              parentId={thread.root.id}
              people={people}
              meId={meId}
              placeholder="Reply in the thread"
              onSent={(m) => {
                setThread((t) => (t ? { ...t, replies: mergeMessages(t.replies, [m]) } : t));
              }}
              onError={setError}
            />
          </aside>
        ) : null}
      </div>

      {dialog === 'channel' ? (
        <NewChannel
          W={W}
          people={people}
          projects={projects}
          meId={meId}
          onClose={() => {
            setDialog(null);
          }}
          onMade={(c) => {
            setDialog(null);
            void loadChannels().then(() => {
              props.go('/messages/' + c.id);
            });
          }}
        />
      ) : null}
      {dialog === 'direct' ? (
        <PickPeople
          title="New direct message"
          action="Open conversation"
          people={people.filter((p) => p.userId !== meId && p.role !== 'guest')}
          onClose={() => {
            setDialog(null);
          }}
          onPick={(ids) => {
            void api<ChannelJson>('POST', W + '/direct', { userIds: ids }).then((r) => {
              setDialog(null);
              if (!r.ok) setError(r.error.message);
              else
                void loadChannels().then(() => {
                  props.go('/messages/' + r.data.id);
                });
            });
          }}
        />
      ) : null}
      {dialog === 'members' && current ? (
        <PickPeople
          title={'Add people to ' + titleOf(current, meId)}
          action="Add"
          people={people.filter(
            (p) =>
              p.userId !== meId &&
              !current.members.some((m) => m.id === p.userId) &&
              (p.role !== 'guest' || current.private || current.projectId || current.clientId),
          )}
          onClose={() => {
            setDialog(null);
          }}
          onPick={(ids) => {
            void api('POST', W + '/channels/' + current.id + '/members', { userIds: ids }).then(
              (r) => {
                setDialog(null);
                if (!r.ok) setError(r.error.message);
                else void loadChannels();
              },
            );
          }}
        />
      ) : null}
      {taskFrom ? (
        <MakeTask
          W={W}
          message={taskFrom}
          projects={projects}
          onClose={() => {
            setTaskFrom(null);
          }}
          onMade={(m, ref) => {
            setTaskFrom(null);
            replace(m);
            setHighlight(m.id);
            setError('');
            setNotice(ref + ' was made from the message.');
          }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function ChannelLink(props: {
  c: ChannelJson;
  meId: string;
  current: boolean;
  go: (p: string) => void;
}): ReactNode {
  const { c } = props;
  const href = '/messages/' + c.id;
  const unread = c.joined && c.unread > 0 && !(c.muted && !c.mentioned);
  return (
    <a
      href={href}
      className={
        'msg-link' + (unread ? ' msg-link--unread' : '') + (c.muted ? ' msg-link--muted' : '')
      }
      aria-current={props.current ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        props.go(href);
      }}
    >
      {c.kind === 'direct' ? (
        <LiveAvatar
          id={c.members.find((m) => m.id !== props.meId)?.id ?? c.id}
          name={c.members.find((m) => m.id !== props.meId)?.name ?? '?'}
          size="xs"
        />
      ) : (
        <span className="msg-hash">{c.private ? <PIcon name="lock" size={12} /> : '#'}</span>
      )}
      <span className="msg-link-name">
        {c.kind === 'direct'
          ? c.members
              .filter((m) => m.id !== props.meId)
              .map((m) => m.name)
              .join(', ')
          : c.name}
      </span>
      {c.mentioned ? (
        <span className="msg-badge msg-badge--mention" title="You were mentioned">
          @
        </span>
      ) : null}
      {unread ? <span className="msg-badge">{c.unread}</span> : null}
    </a>
  );
}

interface View {
  meId: string;
  handles: ReadonlySet<string>;
  mine: string;
  canTask: boolean;
  admin: boolean;
  W: string;
  onReplace: (m: MessageJson) => void;
  onThread: (id: string) => void;
  onTask: (m: MessageJson) => void;
  onRef: (ref: string) => void;
  onError: (e: string) => void;
}

function Conversation(props: {
  channel: ChannelJson;
  messages: MessageJson[];
  more: boolean;
  highlight: string | null;
  people: Person[];
  view: View;
  /** [PCODE-236 | S15 | v0.1.0] a team member (a client contact neither adds people nor leaves) */
  member: boolean;
  onOlder: () => void;
  onBack: () => void;
  onMembers: () => void;
  onChanged: () => void;
  onSent: (m: MessageJson) => void;
}): ReactNode {
  const c = props.channel;
  const { W, meId } = props.view;
  const scroller = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);
  const last = props.messages[props.messages.length - 1]?.id;
  // keep the newest message in view, unless the reader scrolled up to read older ones
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [last]);
  useEffect(() => {
    if (!props.highlight) return;
    document.getElementById('msg-' + props.highlight)?.scrollIntoView({ block: 'center' });
  }, [props.highlight, props.messages.length]);
  const lines = layout(props.messages, new Date());
  const title = titleOf(c, meId);

  return (
    <>
      <header className="msg-head">
        <button
          type="button"
          className="msg-back"
          aria-label="All conversations"
          onClick={props.onBack}
        >
          ‹
        </button>
        <div className="msg-head-text">
          <h2 className="msg-title">
            {title}
            {c.archived ? <span className="pv-muted"> · archived</span> : null}
          </h2>
          {c.topic ? <p className="msg-topic">{c.topic}</p> : null}
        </div>
        {c.private || c.kind === 'direct' ? (
          <span className="msg-members" title={c.members.map((m) => m.name).join(', ')}>
            {c.members.slice(0, 4).map((m) => (
              <LiveAvatar key={m.id} id={m.id} name={m.name} size="xs" />
            ))}
            {c.members.length > 4 ? (
              <span className="pv-muted">+{c.members.length - 4}</span>
            ) : null}
          </span>
        ) : null}
        <div className="msg-head-actions">
          {props.member && c.kind === 'channel' && c.joined ? (
            <Button size="sm" kind="ghost" icon="plus" onClick={props.onMembers}>
              People
            </Button>
          ) : null}
          {c.joined ? (
            <Button
              size="sm"
              kind="ghost"
              icon={c.muted ? 'bell' : 'snooze'}
              onClick={() => {
                void api('PUT', W + '/channels/' + c.id + '/mute', { muted: !c.muted }).then(
                  props.onChanged,
                );
              }}
            >
              {c.muted ? 'Unmute' : 'Mute'}
            </Button>
          ) : (
            <Button
              size="sm"
              kind="primary"
              onClick={() => {
                void api('POST', W + '/channels/' + c.id + '/join').then(props.onChanged);
              }}
            >
              Join
            </Button>
          )}
          {props.member && c.kind === 'channel' && c.joined && c.name !== 'general' ? (
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                void api('POST', W + '/channels/' + c.id + '/leave').then(props.onChanged);
              }}
            >
              Leave
            </Button>
          ) : null}
        </div>
      </header>
      <div
        className="msg-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        aria-live="polite"
      >
        {props.more ? (
          <div className="msg-older">
            <Button size="sm" kind="ghost" onClick={props.onOlder}>
              Show older messages
            </Button>
          </div>
        ) : null}
        {!props.messages.length ? (
          <div className="msg-empty">
            <p>
              {c.kind === 'direct'
                ? 'This is the start of your conversation with ' + title + '.'
                : 'This is the start of ' + title + '.'}
            </p>
          </div>
        ) : null}
        {lines.map((l) =>
          l.kind === 'day' ? (
            <div key={l.key} className="msg-day" role="separator">
              <span>{l.label}</span>
            </div>
          ) : (
            <MessageView
              key={l.key}
              m={l.message}
              compact={l.compact}
              view={props.view}
              highlighted={l.message.id === props.highlight}
            />
          ),
        )}
      </div>
      {c.archived ? (
        <p className="msg-quiet msg-composer-note">This channel is archived.</p>
      ) : (
        <Composer
          W={W}
          channel={c}
          parentId={null}
          people={props.people}
          meId={meId}
          placeholder={'Write to ' + title}
          lastOwn={[...props.messages].reverse().find((m) => m.author?.id === meId && !m.deleted)}
          onEditLast={(m) => {
            document
              .getElementById('msg-' + m.id)
              ?.querySelector<HTMLButtonElement>('.msg-edit-btn')
              ?.click();
          }}
          onSent={(m) => {
            atBottom.current = true;
            props.onSent(m);
          }}
          onError={props.view.onError}
        />
      )}
    </>
  );
}

function Body(props: { text: string; view: View }): ReactNode {
  const parts = tokens(props.text, props.view.handles, props.view.mine);
  return (
    <div className="msg-body">
      {parts.map((t: Token, i) => {
        switch (t.kind) {
          case 'url':
            return (
              <a key={i} href={t.value} target="_blank" rel="noopener noreferrer">
                {t.value}
              </a>
            );
          case 'mention':
            return (
              <span key={i} className={'msg-mention' + (t.me ? ' msg-mention--me' : '')}>
                {t.value}
              </span>
            );
          case 'ref':
            return (
              <button
                key={i}
                type="button"
                className="msg-ref"
                onClick={() => {
                  props.view.onRef(t.value);
                }}
              >
                {t.value}
              </button>
            );
          case 'code':
            return <code key={i}>{t.value}</code>;
          case 'bold':
            return <strong key={i}>{t.value}</strong>;
          default:
            return <span key={i}>{t.value}</span>;
        }
      })}
    </div>
  );
}

function MessageView(props: {
  m: MessageJson;
  compact: boolean;
  view: View;
  inThread?: boolean;
  highlighted?: boolean;
}): ReactNode {
  const { m, view } = props;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.body);
  const [reacting, setReacting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const own = m.author?.id === view.meId;
  const call = (method: 'PATCH' | 'DELETE' | 'PUT', path: string, body?: unknown): void => {
    void api<MessageJson>(method, view.W + path, body).then((r) => {
      if (r.ok) view.onReplace(r.data);
      else view.onError(r.error.message);
    });
  };
  const react = (emoji: string, mine: boolean): void => {
    void api<MessageJson>(
      mine ? 'DELETE' : 'PUT',
      view.W + '/messages/' + m.id + '/reactions/' + encodeURIComponent(emoji),
    ).then((r) => {
      if (r.ok) view.onReplace(r.data);
    });
    setReacting(false);
  };
  return (
    <article
      id={'msg-' + m.id}
      // a tap focuses the message, which shows its actions on a phone
      tabIndex={-1}
      className={
        'msg' +
        (props.compact ? ' msg--compact' : '') +
        (props.highlighted ? ' msg--highlight' : '') +
        (m.deleted ? ' msg--deleted' : '')
      }
    >
      <div className="msg-gutter">
        {props.compact ? (
          <span className="msg-time-hover">{clock(m.createdAt)}</span>
        ) : (
          <LiveAvatar id={m.author?.id ?? 'x'} name={m.author?.name ?? '?'} size="sm" />
        )}
      </div>
      <div className="msg-content">
        {props.compact ? null : (
          <div className="msg-meta">
            <strong>{m.author?.name ?? 'Someone'}</strong>
            <span className="pv-muted">{clock(m.createdAt)}</span>
            {m.editedAt && !m.deleted ? <span className="pv-muted">(edited)</span> : null}
          </div>
        )}
        {m.deleted ? (
          <p className="msg-gone">This message was deleted.</p>
        ) : editing ? (
          <div className="msg-editing">
            <textarea
              className="msg-input"
              value={text}
              aria-label="Edit message"
              onChange={(e) => {
                setText(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false);
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (text.trim()) call('PATCH', '/messages/' + m.id, { body: text });
                  setEditing(false);
                }
              }}
            />
            <span className="pv-hint">
              <Kbd>Enter</Kbd> save <Kbd>Esc</Kbd> cancel
            </span>
          </div>
        ) : (
          <Body text={m.body} view={view} />
        )}
        {m.files.length ? (
          <div className="msg-files">
            {m.files.map((f) =>
              f.mime.startsWith('image/') ? (
                <a
                  key={f.id}
                  href={view.W + '/files/' + f.id + '/content'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="msg-image"
                >
                  <img src={view.W + '/files/' + f.id + '/content'} alt={f.name} loading="lazy" />
                </a>
              ) : (
                <a
                  key={f.id}
                  className="msg-file"
                  href={view.W + '/files/' + f.id + '/content'}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <PIcon name="documents" size={14} /> {f.name}{' '}
                  <span className="pv-muted">{sizeText(f.sizeBytes)}</span>
                </a>
              ),
            )}
          </div>
        ) : null}
        {m.itemId ? (
          <a
            className="msg-task"
            href={'/items/' + m.itemId}
            onClick={(e) => {
              e.preventDefault();
              navigate('/items/' + (m.itemId ?? ''));
            }}
          >
            <PIcon name="check" size={13} /> Became a task
          </a>
        ) : null}
        {m.reactions.length ? (
          <div className="msg-reactions">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                className={'msg-reaction' + (r.mine ? ' msg-reaction--mine' : '')}
                aria-pressed={r.mine}
                onClick={() => {
                  react(r.emoji, r.mine);
                }}
              >
                {r.emoji} {r.count}
              </button>
            ))}
          </div>
        ) : null}
        {!props.inThread && m.replyCount > 0 ? (
          <button
            type="button"
            className="msg-replies"
            onClick={() => {
              view.onThread(m.id);
            }}
          >
            {m.replyCount === 1 ? '1 reply' : String(m.replyCount) + ' replies'}
            {m.lastReplyAt ? (
              <span className="pv-muted"> · last {clock(m.lastReplyAt)}</span>
            ) : null}
          </button>
        ) : null}
        {confirm ? (
          <div className="msg-confirm" role="alert">
            Delete this message?{' '}
            <button
              type="button"
              className="pv-link"
              onClick={() => {
                setConfirm(false);
                call('DELETE', '/messages/' + m.id);
              }}
            >
              Delete
            </button>{' '}
            <button
              type="button"
              className="pv-link"
              onClick={() => {
                setConfirm(false);
              }}
            >
              Keep
            </button>
          </div>
        ) : null}
      </div>
      {m.deleted || editing ? null : (
        <div className="msg-actions" role="toolbar" aria-label="Message actions">
          <button
            type="button"
            className="msg-icon-btn"
            aria-label="React"
            title="React"
            onClick={() => {
              setReacting((x) => !x);
            }}
          >
            ☺
          </button>
          {!props.inThread ? (
            <button
              type="button"
              className="msg-icon-btn"
              aria-label="Reply in thread"
              title="Reply in thread"
              onClick={() => {
                view.onThread(m.id);
              }}
            >
              <PIcon name="chat" size={14} />
            </button>
          ) : null}
          {view.canTask && !m.itemId ? (
            <button
              type="button"
              className="msg-icon-btn"
              aria-label="Make a task"
              title="Make a task"
              onClick={() => {
                view.onTask(m);
              }}
            >
              <PIcon name="check" size={14} />
            </button>
          ) : null}
          {own ? (
            <button
              type="button"
              className="msg-icon-btn msg-edit-btn"
              aria-label="Edit"
              title="Edit"
              onClick={() => {
                setText(m.body);
                setEditing(true);
              }}
            >
              ✎
            </button>
          ) : null}
          {own || view.admin ? (
            <button
              type="button"
              className="msg-icon-btn"
              aria-label="Delete"
              title="Delete"
              onClick={() => {
                setConfirm(true);
              }}
            >
              <PIcon name="x" size={14} />
            </button>
          ) : null}
          {reacting ? (
            <div className="msg-picker" role="menu" aria-label="Reactions">
              {REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    react(
                      e,
                      m.reactions.some((r) => r.emoji === e && r.mine),
                    );
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}

function Composer(props: {
  W: string;
  channel: ChannelJson;
  parentId: string | null;
  people: Person[];
  meId: string;
  placeholder: string;
  lastOwn?: MessageJson | undefined;
  onEditLast?: (m: MessageJson) => void;
  onSent: (m: MessageJson) => void;
  onError: (e: string) => void;
}): ReactNode {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(0);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const word = mentionAt(text.slice(0, caret));
  const suggestions =
    word === null
      ? []
      : props.people
          .filter((p) => p.userId !== props.meId)
          .filter(
            (p) =>
              handleOf(p).startsWith(word.toLowerCase()) ||
              p.name.toLowerCase().startsWith(word.toLowerCase()),
          )
          .slice(0, 6);
  const choose = (p: Person): void => {
    const before = text.slice(0, caret).replace(/@[\w.-]*$/, '@' + handleOf(p) + ' ');
    const next = before + text.slice(caret);
    setText(next);
    setCaret(before.length);
    setPick(0);
    requestAnimationFrame(() => {
      input.current?.setSelectionRange(before.length, before.length);
      input.current?.focus();
    });
  };
  const send = (): void => {
    const body = text.trim();
    if ((!body && !files.length) || busy) return;
    setBusy(true);
    // [PCODE-354 | S15 | v0.1.0] offline, the message waits and goes out when the connection is back
    void sendOrQueue<MessageJson>(
      outboxFor(props.W.split('/')[3] ?? ''),
      'POST',
      props.W + '/channels/' + props.channel.id + '/messages',
      {
        body: body || files.map((f) => f.name).join(', '),
        ...(props.parentId ? { parentId: props.parentId } : {}),
        ...(files.length ? { fileIds: files.map((f) => f.id) } : {}),
      },
      'Message in ' + (props.channel.name ? '#' + props.channel.name : 'a conversation'),
    ).then((r) => {
      setBusy(false);
      if ('error' in r) {
        props.onError(r.error);
        return;
      }
      setText('');
      setFiles([]);
      if ('queued' in r)
        props.onError('You are offline: the message is kept and sent when the connection is back.');
      else props.onSent(r.data);
      input.current?.focus();
    });
  };
  const workspaceId = props.W.split('/')[3] ?? '';
  return (
    <div className="msg-composer">
      {suggestions.length ? (
        <ul className="msg-suggest" role="listbox" aria-label="People to mention">
          {suggestions.map((p, i) => (
            <li key={p.userId} role="option" aria-selected={i === pick}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
              >
                <LiveAvatar id={p.userId} name={p.name} size="xs" /> {p.name}{' '}
                <span className="pv-muted">@{handleOf(p)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {files.length ? (
        <div className="msg-attached">
          {files.map((f) => (
            <span key={f.id} className="msg-file">
              {f.name}
              <button
                type="button"
                className="msg-icon-btn"
                aria-label={'Remove ' + f.name}
                onClick={() => {
                  setFiles((list) => list.filter((x) => x.id !== f.id));
                }}
              >
                <PIcon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="msg-compose-row">
        <button
          type="button"
          className="msg-icon-btn"
          aria-label="Attach a file"
          title="Attach a file"
          onClick={() => fileInput.current?.click()}
        >
          <PIcon name="plus" size={16} />
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          onChange={(e) => {
            const list = [...(e.target.files ?? [])];
            e.target.value = '';
            for (const f of list)
              void uploadFile(workspaceId, props.channel.projectId, f).then((r) => {
                if (r.ok) setFiles((x) => [...x, r.data]);
                else props.onError(r.error.message);
              });
          }}
        />
        <textarea
          ref={input}
          className="msg-input"
          rows={1}
          value={text}
          placeholder={props.placeholder}
          aria-label={props.placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
          }}
          onSelect={(e) => {
            setCaret(e.currentTarget.selectionStart);
          }}
          onKeyDown={(e) => {
            if (suggestions.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setPick((i) => (i + 1) % suggestions.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setPick((i) => (i + suggestions.length - 1) % suggestions.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const p = suggestions[pick];
                if (p) choose(p);
                return;
              }
            }
            if (e.key === 'ArrowUp' && !text && props.lastOwn && props.onEditLast) {
              e.preventDefault();
              props.onEditLast(props.lastOwn);
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button
          kind="primary"
          size="sm"
          onClick={send}
          disabled={busy || (!text.trim() && !files.length)}
        >
          Send
        </Button>
      </div>
    </div>
  );
}

function SearchResults(props: {
  found: MessageJson[];
  channels: ChannelJson[];
  meId: string;
  query: string;
  onOpen: (m: MessageJson) => void;
}): ReactNode {
  const name = (id: string): string => {
    const c = props.channels.find((x) => x.id === id);
    return c ? titleOf(c, props.meId) : '';
  };
  return (
    <div className="msg-scroll">
      <h2 className="msg-title msg-pad">
        {props.found.length === 1 ? '1 message' : String(props.found.length) + ' messages'} for “
        {props.query}”
      </h2>
      {props.found.map((m) => (
        <button
          key={m.id}
          type="button"
          className="msg-hit"
          onClick={() => {
            props.onOpen(m);
          }}
        >
          <span className="msg-meta">
            <strong>{m.author?.name ?? 'Someone'}</strong>
            <span className="pv-muted">
              {name(m.channelId)} · {new Date(m.createdAt).toLocaleString()}
            </span>
          </span>
          <span className="msg-hit-text">{m.body}</span>
        </button>
      ))}
      {!props.found.length ? <p className="msg-quiet msg-pad">Nothing found.</p> : null}
    </div>
  );
}

function NewChannel(props: {
  W: string;
  people: Person[];
  projects: ProjectLite[];
  meId: string;
  onClose: () => void;
  onMade: (c: ChannelJson) => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [priv, setPriv] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState('');
  const shown = channelName(name);
  const make = (): void => {
    void api<ChannelJson>('POST', props.W + '/channels', {
      name,
      ...(topic.trim() ? { topic } : {}),
      private: priv,
      ...(projectId ? { projectId } : {}),
    }).then((r) => {
      if (r.ok) props.onMade(r.data);
      else setError(r.error.message);
    });
  };
  return (
    <Dialog
      title="New channel"
      onClose={props.onClose}
      footer={
        <>
          <Button kind="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button kind="primary" onClick={make} disabled={!shown}>
            Open channel
          </Button>
        </>
      }
    >
      <label className="pe-field">
        <span>Name</span>
        <input
          className="pe-input"
          value={name}
          placeholder="release-planning"
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        {name && shown !== name ? (
          <span className="pe-small pe-muted">
            {shown ? 'It will be #' + shown : 'Needs letters or digits'}
          </span>
        ) : null}
      </label>
      <label className="pe-field">
        <span>What it is for</span>
        <input
          className="pe-input"
          value={topic}
          onChange={(e) => {
            setTopic(e.target.value);
          }}
        />
      </label>
      <label className="pe-field">
        <span>Project</span>
        <select
          className="pe-input"
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
          }}
        >
          <option value="">The whole workspace</option>
          {props.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} · {p.name}
            </option>
          ))}
        </select>
        <span className="pe-small pe-muted">
          A project channel is open to the project’s guests too.
        </span>
      </label>
      <label className="pe-check">
        <input
          type="checkbox"
          checked={priv}
          onChange={(e) => {
            setPriv(e.target.checked);
          }}
        />{' '}
        Private: only the people you add see it
      </label>
      {error ? (
        <p className="pe-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

function PickPeople(props: {
  title: string;
  action: string;
  people: Person[];
  onClose: () => void;
  onPick: (ids: string[]) => void;
}): ReactNode {
  const [ids, setIds] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const list = props.people.filter(
    (p) =>
      !filter ||
      p.name.toLowerCase().includes(filter.toLowerCase()) ||
      p.email.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <Dialog
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <Button kind="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            kind="primary"
            disabled={!ids.length}
            onClick={() => {
              props.onPick(ids);
            }}
          >
            {props.action}
          </Button>
        </>
      }
    >
      <input
        className="pe-input"
        placeholder="Find people"
        aria-label="Find people"
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
        }}
      />
      <ul className="msg-people">
        {list.map((p) => (
          <li key={p.userId}>
            <label>
              <input
                type="checkbox"
                checked={ids.includes(p.userId)}
                onChange={(e) => {
                  setIds((x) =>
                    e.target.checked ? [...x, p.userId] : x.filter((i) => i !== p.userId),
                  );
                }}
              />
              <LiveAvatar id={p.userId} name={p.name} size="xs" /> {p.name}{' '}
              <span className="pv-muted">{p.email}</span>
            </label>
          </li>
        ))}
        {!list.length ? <li className="pv-muted">Nobody to add.</li> : null}
      </ul>
    </Dialog>
  );
}

function MakeTask(props: {
  W: string;
  message: MessageJson;
  projects: ProjectLite[];
  onClose: () => void;
  onMade: (m: MessageJson, ref: string) => void;
  onError: (e: string) => void;
}): ReactNode {
  const [projectId, setProjectId] = useState(props.projects[0]?.id ?? '');
  const [title, setTitle] = useState(props.message.body.split('\n')[0]?.slice(0, 120) ?? '');
  return (
    <Dialog
      title="Make a task"
      onClose={props.onClose}
      footer={
        <>
          <Button kind="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            kind="primary"
            disabled={!projectId || !title.trim()}
            onClick={() => {
              void api<{ itemId: string; ref: string; message: MessageJson }>(
                'POST',
                props.W + '/messages/' + props.message.id + '/task',
                { projectId, title },
              ).then((r) => {
                if (r.ok) props.onMade(r.data.message, r.data.ref);
                else props.onError(r.error.message);
              });
            }}
          >
            Make task
          </Button>
        </>
      }
    >
      <label className="pe-field">
        <span>Project</span>
        <select
          className="pe-input"
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
          }}
        >
          {props.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} · {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="pe-field">
        <span>Title</span>
        <input
          className="pe-input"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
      </label>
      <p className="pe-small pe-muted">
        The message goes into the task’s description, and links to it.
      </p>
    </Dialog>
  );
}
