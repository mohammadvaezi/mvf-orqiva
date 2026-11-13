// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-234 | S15 | v0.1.0] T23.1 Messaging core on the server: channels, direct messages, threads, mentions, live delivery ──
// ── [PCODE-230 | S15 | v0.1.0] T22.3 Presence from and on the phone ──
// ── [PCODE-196 | S15 | v0.1.0] B8.4 VS Code: ideation interview, and presence per file and block (workspace switch, off by default) ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-227 | S15 | v0.1.0] T21.4 Mobile docs, end-to-end check and sprint close ──
// ── [PCODE-95 | S15 | v0.1.0] Build our own WebSocket gateway (RFC 6455) with typed protocol and SSE fallback ──
// ── [PCODE-101 | S15 | v0.1.0] Add presence: heartbeats, avatars on cards, who-is-where ──
//    Why:  where the event bus meets the screens. A client signs in with its session cookie (the browser
//          sends it on the upgrade; a page from another site is refused by its Origin), subscribes to
//          workspaces it belongs to, and receives every event after its cursor that it may see: members see
//          the workspace, guests only their projects' events. Losing membership ends the subscription at
//          once. The same rules serve Server-Sent Events for networks that block WebSockets.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import {
  LIVE_PATH,
  PROTOCOL_VERSION,
  parseClientMessage,
  type ActivityEvent,
  type PresenceEntry,
  type ServerMessage,
} from '@orqiva/shared';
import type { Pool } from 'pg';
import type { Role } from '../api/access.js';
import { messageJson } from '../api/messages.js';
import { currentUser, tokenOf, type SessionUser } from '../auth/sessions.js';
import { inSystem, inWorkspace } from '../db/pool.js';
import type { EventBus } from '../events/bus.js';
import type { ChatHub } from './chat.js';
import type { PresenceHub } from './presence.js';
import {
  CLOSE,
  WebSocketConnection,
  handshakeProblem,
  refuseUpgrade,
  type WsOptions,
} from './websocket.js';

export interface GatewayOptions {
  pool: Pool;
  bus: EventBus;
  /** origins allowed to open a live connection, e.g. "https://orqiva.example.com" */
  allowedOrigins: string[];
  ws?: WsOptions;
  /** [PCODE-101 | S15 | v0.1.0] who is where; without it presence messages are ignored */
  presence?: PresenceHub;
  /** [PCODE-234 | S15 | v0.1.0] conversations; without it nothing about them is sent live */
  chat?: ChatHub;
  /** SSE comment interval that keeps proxies from closing an idle stream */
  sseHeartbeatMs?: number;
}

/** What one person may see in one workspace; refreshed when their membership changes. */
// [PCODE-196 | S15 | v0.1.0] an entry without the file someone has open
const withoutFile = (p: PresenceEntry): PresenceEntry => {
  const out = { ...p };
  delete out.file;
  return out;
};

class Viewer {
  role: Role = 'guest';
  projects = new Set<string>();
  /** [PCODE-101 | S15 | v0.1.0] the workspace shares presence (an admin can switch it off) */
  presence = true;
  /** [PCODE-196 | S15 | v0.1.0] presence also names the file (off unless an admin switched it on) */
  files = false;

  constructor(
    private readonly pool: Pool,
    readonly userId: string,
    readonly workspaceId: string,
    /** [PCODE-227 | S15 | v0.1.0] the token the connection signed in with (a phone, VS Code, a script) */
    readonly tokenId?: string,
  ) {}

  /** false when the person is not (or no longer) a member, or their token was revoked or ran out */
  async load(): Promise<boolean> {
    // [PCODE-227 | S15 | v0.1.0] revoking a token is a membership event of its owner, so it lands here: a
    // phone signed out in the web app stops receiving at once, not at its next reconnect
    if (this.tokenId !== undefined) {
      const id = this.tokenId;
      const valid = await inSystem(
        this.pool,
        async (c) =>
          (
            await c.query(
              `SELECT 1 FROM api_tokens WHERE id = $1 AND revoked_at IS NULL AND state = 'active'
                 AND (expires_at IS NULL OR expires_at > now())`,
              [id],
            )
          ).rowCount === 1,
      );
      if (!valid) return false;
    }
    return inWorkspace(this.pool, this.workspaceId, async (c) => {
      const role = (
        await c.query<{ role: Role }>('SELECT role FROM workspace_members WHERE user_id = $1', [
          this.userId,
        ])
      ).rows[0]?.role;
      if (!role) return false;
      this.role = role;
      const ws = (
        await c.query<{ on: boolean; files: boolean }>(
          'SELECT presence_enabled AS on, presence_files AS files FROM workspaces',
        )
      ).rows[0];
      this.presence = ws?.on ?? true;
      this.files = ws?.files ?? false; // [PCODE-196 | S15 | v0.1.0]
      this.projects = new Set(
        role === 'guest'
          ? (
              await c.query<{ project_id: string }>(
                // [PCODE-163 | S15 | v0.1.0] invited, or a project of their client
                'SELECT id AS project_id FROM projects WHERE guest_sees_project(id, $1)',
                [this.userId],
              )
            ).rows.map((r) => r.project_id)
          : [],
      );
      return true;
    });
  }

  /** [PCODE-101 | S15 | v0.1.0] the presence this person may see: guests only their projects, themselves always */
  seesPresence(people: PresenceEntry[]): PresenceEntry[] {
    if (!this.presence) return [];
    // [PCODE-196 | S15 | v0.1.0] files switched off: gone at once, not with the next heartbeat
    if (!this.files) people = people.map(withoutFile);
    if (this.role !== 'guest') return people;
    // [PCODE-196 | S15 | v0.1.0] a guest never sees which file someone has open
    return people
      .filter(
        (p) => p.userId === this.userId || (p.projectId !== null && this.projects.has(p.projectId)),
      )
      .map(withoutFile);
  }

  sees(event: ActivityEvent, projectFilter?: string): boolean {
    if (projectFilter && event.projectid !== projectFilter) return false;
    if (this.role !== 'guest') return true;
    return event.projectid !== undefined && this.projects.has(event.projectid);
  }
}

/** A membership event about this person: who they are or what they may see may have changed. */
const touchesMembership = (e: ActivityEvent, userId: string): boolean =>
  e.data.object.type === 'member' && e.data.object.id === userId;

/** Wires one viewer to the bus; returns the unsubscribe function. */
async function follow(
  bus: EventBus,
  viewer: Viewer,
  after: number | undefined,
  projectFilter: string | undefined,
  send: (m: ServerMessage) => void,
  lost: () => void,
  /** [PCODE-101 | S15 | v0.1.0] after a reload of what the viewer may see, e.g. to resend presence */
  reloaded?: () => void,
): Promise<() => void> {
  let refreshing = Promise.resolve(true);
  return bus.subscribe(
    viewer.workspaceId,
    {
      onEvent: (event) => {
        if (touchesMembership(event, viewer.userId) || event.data.object.type === 'workspace') {
          refreshing = viewer.load().then((still) => {
            if (!still) lost();
            else reloaded?.();
            return still;
          });
        }
        void refreshing.then((still) => {
          if (still && viewer.sees(event, projectFilter)) send({ type: 'event', event });
        });
      },
      onResync: (sequence, reason) => {
        send({ type: 'resync', workspaceId: viewer.workspaceId, sequence, reason });
      },
    },
    after,
  );
}

export class LiveGateway {
  private readonly sockets = new Set<WebSocketConnection>();
  private readonly streams = new Set<ServerResponse>();

  constructor(private readonly opts: GatewayOptions) {}

  private originAllowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    // non-browser clients (VS Code, CLI, mobile) send no Origin; browsers always do
    if (origin === undefined) return true;
    if (this.opts.allowedOrigins.includes(origin)) return true;
    const host = req.headers.host;
    return host !== undefined && (origin === 'http://' + host || origin === 'https://' + host);
  }

  /** The 'upgrade' listener of the HTTP server. */
  handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    // [PCODE-365 | S15 | v0.1.0] a client that gives up while we look it up resets the socket; without a
    // listener that error would end the process
    socket.on('error', () => {
      socket.destroy();
    });
    void this.upgrade(req, socket, head).catch(() => {
      refuseUpgrade(socket, 400, 'Upgrade failed');
    });
  };

  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if ((req.url ?? '').split('?')[0] !== LIVE_PATH) {
      refuseUpgrade(socket, 404, 'No live endpoint here');
      return;
    }
    const problem = handshakeProblem(req);
    if (problem) {
      refuseUpgrade(socket, problem.status, problem.reason);
      return;
    }
    if (!this.originAllowed(req)) {
      refuseUpgrade(socket, 403, 'This origin may not connect');
      return;
    }
    const user = await currentUser(this.opts.pool, req);
    if (!user) {
      refuseUpgrade(socket, 401, 'Sign in first');
      return;
    }
    this.open(req, socket, head, user);
  }

  private open(req: IncomingMessage, socket: Duplex, head: Buffer, user: SessionUser): void {
    const subs = new Map<string, () => void>();
    // [PCODE-101 | S15 | v0.1.0] this connection's presence: its key, the viewers it may report through, and
    // where it last was (so a heartbeat keeps 'since')
    const connKey = randomUUID();
    const viewers = new Map<string, Viewer>();
    const places = new Map<string, PresenceEntry>();
    const presence = this.opts.presence;
    const send = (m: ServerMessage): void => {
      conn.sendText(JSON.stringify(m));
    };
    const conn = WebSocketConnection.accept(
      req,
      socket,
      head,
      {
        onText: (text) => {
          const msg = parseClientMessage(text);
          if (!msg) {
            send({
              type: 'error',
              code: 'invalid_message',
              message: 'Not a message this server understands',
            });
            return;
          }
          if (msg.type === 'ping') {
            send(msg.id !== undefined ? { type: 'pong', id: msg.id } : { type: 'pong' });
            return;
          }
          if (msg.type === 'unsubscribe') {
            subs.get(msg.workspaceId)?.();
            subs.delete(msg.workspaceId);
            presence?.leave(msg.workspaceId, connKey);
            viewers.delete(msg.workspaceId);
            return;
          }
          if (msg.type === 'presence') {
            // only into a workspace this connection subscribed to, only where the person may be
            const viewer = viewers.get(msg.workspaceId);
            if (!presence || !viewer?.presence) return;
            if (msg.projectId && viewer.role === 'guest' && !viewer.projects.has(msg.projectId))
              return;
            const before = places.get(msg.workspaceId);
            // [PCODE-196 | S15 | v0.1.0] the file only where the workspace shares files, never from a guest
            const file = viewer.files && viewer.role !== 'guest' ? (msg.file ?? null) : null;
            const same =
              before?.projectId === msg.projectId &&
              before.itemId === msg.itemId &&
              before.state === msg.state &&
              (before.file ?? null) === file &&
              before.device === msg.device;
            const entry: PresenceEntry = {
              userId: user.id,
              name: user.name,
              kind: 'user',
              projectId: msg.projectId,
              itemId: msg.itemId,
              state: msg.state,
              since: same ? before.since : new Date().toISOString(),
              ...(file ? { file } : {}),
              ...(msg.device ? { device: msg.device } : {}), // [PCODE-230 | S15 | v0.1.0]
            };
            places.set(msg.workspaceId, entry);
            presence.set(msg.workspaceId, connKey, entry);
            return;
          }
          const { workspaceId, after, projectId } = msg;
          void (async () => {
            const viewer = new Viewer(this.opts.pool, user.id, workspaceId, tokenOf(req)?.id);
            if (!(await viewer.load())) {
              send({
                type: 'error',
                code: 'not_found',
                message: 'Workspace not found',
                workspaceId,
              });
              return;
            }
            if (projectId && viewer.role === 'guest' && !viewer.projects.has(projectId)) {
              send({
                type: 'error',
                code: 'not_found',
                message: 'Project not found',
                workspaceId,
              });
              return;
            }
            subs.get(workspaceId)?.();
            viewers.set(workspaceId, viewer);
            const unwatch = presence?.watch(workspaceId, (people) => {
              send({ type: 'presence', workspaceId, people: viewer.seesPresence(people) });
            });
            const off = await follow(
              this.opts.bus,
              viewer,
              after,
              projectId,
              send,
              () => {
                send({
                  type: 'error',
                  code: 'not_found',
                  message: 'You are no longer a member of this workspace',
                  workspaceId,
                });
                subs.get(workspaceId)?.();
                subs.delete(workspaceId);
                // [PCODE-227 | S15 | v0.1.0] a revoked token keeps no connection open
                if (viewer.tokenId !== undefined) conn.close(CLOSE.policy, 'Signed out');
              },
              () => {
                if (presence)
                  send({
                    type: 'presence',
                    workspaceId,
                    people: viewer.seesPresence(presence.people(workspaceId)),
                  });
              },
            );
            // [PCODE-234 | S15 | v0.1.0] conversations this person may see, live; what they may see is read
            // once and again whenever a conversation's membership changes or an unknown one speaks
            const chat = this.opts.chat;
            let visible: Promise<Set<string>> | null = null;
            const see = (): Promise<Set<string>> =>
              (visible = inSystem(
                this.opts.pool,
                async (c) =>
                  new Set(
                    (
                      await c.query<{ id: string }>(
                        'SELECT c.id FROM channels c WHERE c.workspace_id = $1 AND sees_channel(c, $2, $3)',
                        [workspaceId, user.id, viewer.role],
                      )
                    ).rows.map((r) => r.id),
                  ),
              ));
            const unchat = chat?.watch(workspaceId, (change) => {
              void (async () => {
                let ids = await (visible ?? see());
                if (change.op === 'channel' || !ids.has(change.channelId)) ids = await see();
                if (!ids.has(change.channelId)) return;
                if (change.op === 'channel')
                  send({
                    type: 'chat',
                    workspaceId,
                    chat: { op: 'channel', channelId: change.channelId },
                  });
                else if (change.row)
                  send({
                    type: 'chat',
                    workspaceId,
                    chat: { op: change.op, message: messageJson(change.row, user.id) },
                  });
              })().catch(() => undefined);
            });
            subs.set(workspaceId, () => {
              off();
              unwatch?.();
              unchat?.();
            });
            send({ type: 'subscribed', workspaceId, sequence: await this.head(workspaceId) });
          })().catch(() => {
            send({ type: 'error', code: 'internal', message: 'Subscribing failed', workspaceId });
          });
        },
        onClose: () => {
          for (const off of subs.values()) off();
          subs.clear();
          for (const ws of viewers.keys()) presence?.leave(ws, connKey);
          viewers.clear();
          this.sockets.delete(conn);
        },
      },
      this.opts.ws,
    );
    this.sockets.add(conn);
    send({ type: 'welcome', protocol: PROTOCOL_VERSION, userId: user.id });
  }

  private head(workspaceId: string): Promise<number> {
    return inWorkspace(this.opts.pool, workspaceId, async (c) =>
      Number(
        (await c.query<{ n: string | null }>('SELECT max(sequence) AS n FROM activity_events'))
          .rows[0]?.n ?? 0,
      ),
    );
  }

  /**
   * GET /api/workspaces/:workspaceId/events/stream: the same events as Server-Sent Events. The cursor
   * comes from ?after= or the Last-Event-ID header the browser resends on reconnect.
   */
  handleStream = (req: IncomingMessage, res: ServerResponse): boolean => {
    const m = /^\/api\/workspaces\/([0-9a-f-]{36})\/events\/stream$/i.exec(
      (req.url ?? '').split('?')[0] ?? '',
    );
    if (!m || req.method !== 'GET') return false;
    const workspaceId = m[1] ?? '';
    void this.stream(req, res, workspaceId).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { code: 'internal', message: 'Something went wrong on our side' },
          }),
        );
      } else res.end();
    });
    return true;
  };

  private async stream(
    req: IncomingMessage,
    res: ServerResponse,
    workspaceId: string,
  ): Promise<void> {
    const fail = (status: number, code: string, message: string): void => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify({ error: { code, message } }));
    };
    const user = await currentUser(this.opts.pool, req);
    if (!user) {
      fail(401, 'unauthorized', 'Sign in first');
      return;
    }
    const viewer = new Viewer(this.opts.pool, user.id, workspaceId, tokenOf(req)?.id);
    if (!(await viewer.load())) {
      fail(404, 'not_found', 'Workspace not found');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://x');
    const raw = req.headers['last-event-id'] ?? url.searchParams.get('after') ?? undefined;
    const after = raw !== undefined && /^\d+$/.test(String(raw)) ? Number(raw) : undefined;
    const projectId = url.searchParams.get('projectId') ?? undefined;

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
    });
    res.write('retry: 2000\n\n');
    this.streams.add(res);
    const send = (msg: ServerMessage): void => {
      if (msg.type === 'event')
        res.write(
          'id: ' +
            String(msg.event.sequence) +
            '\nevent: activity\ndata: ' +
            JSON.stringify(msg.event) +
            '\n\n',
        );
      else res.write('event: ' + msg.type + '\ndata: ' + JSON.stringify(msg) + '\n\n');
    };
    const off = await follow(this.opts.bus, viewer, after, projectId, send, () => {
      send({
        type: 'error',
        code: 'not_found',
        message: 'You are no longer a member of this workspace',
        workspaceId,
      });
      res.end();
    });
    send({ type: 'subscribed', workspaceId, sequence: await this.head(workspaceId) });
    const beat = setInterval(
      () => res.write(': keep-alive\n\n'),
      this.opts.sseHeartbeatMs ?? 25_000,
    );
    beat.unref();
    const done = (): void => {
      clearInterval(beat);
      off();
      this.streams.delete(res);
    };
    res.on('close', done);
  }

  /** Server shutdown: say goodbye to every live client. */
  close(): void {
    for (const s of this.sockets) s.close(CLOSE.goingAway, 'server shutting down');
    for (const r of this.streams) r.end();
  }
}
