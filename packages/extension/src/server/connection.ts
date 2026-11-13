// ── [PCODE-462 | S15 | v0.1.0] Tasks run in plan order, finish by themselves, and show the same state in VS Code and the portal ──
// ── [PCODE-236 | S15 | v0.1.0] T23.3 Messages for clients, in VS Code and in the CLI ──
// ── [PCODE-196 | S15 | v0.1.0] B8.4 VS Code: ideation interview, and presence per file and block (workspace switch, off by default) ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
// ── [PCODE-106 | S15 | v0.1.0] Add the team activity feed panel to VS Code ──
//    Why:  the extension on Orqiva instead of Plane. A folder linked with `orq link` (its
//          .orqiva/project.json) and a token from `orq login` are all it needs: the same files the CLI
//          and the Claude Code hooks use, so all three work on one active task. The board is read once
//          from the API and then again only when the live stream says something in the project changed;
//          there is no timer. Free of vscode, so it is tested against the real server.
import { hostname as osHostname } from 'node:os';
import {
  LiveClient,
  type ActivityEvent,
  type ChatEvent,
  type Place,
  type PresenceEntry,
  type SocketLike,
} from '@orqiva/shared';
import { makeApi, viaIPv4, type Api } from '../../../cli/src/loop/api';
import {
  findRoot,
  loadCredentials,
  loadLink,
  type ProjectLink as PeLink,
} from '../../../cli/src/loop/config';
import { clientKey } from '../../../cli/src/loop/commands';
import type { Item, Sprint, StateGroup } from '../state/board';
import { openNodeSocket } from './nodeSocket';

export interface ServerTarget {
  root: string;
  link: PeLink;
  token: string;
}

/** The linked project of a folder and the token to reach it, or null when the folder is not on Orqiva. */
export function detectServer(
  folder: string,
  home: string,
  env: Record<string, string | undefined> = process.env,
): ServerTarget | null {
  const root = findRoot(folder);
  if (!root) return null;
  const link = loadLink(root);
  if (!link) return null;
  const token = env['ORQIVA_TOKEN'] ?? loadCredentials(home).servers[link.server]?.token;
  if (!token) return null;
  return { root, link, token };
}

interface StateJson {
  id: string;
  name: string;
  group: string;
}
interface SprintJson {
  id: string;
  number: number;
  name: string;
  goal: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
}
interface ItemJson {
  id: string;
  ref: string;
  title: string;
  stateId: string;
  sprintId: string | null;
  labelIds: string[];
  rank: number;
  sequence: number;
}
interface ProjectDetail {
  states: StateJson[];
  version: string;
}

export interface BoardData {
  version: string;
  sprints: Sprint[];
}

const GROUPS: readonly StateGroup[] = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'];
const RECENT_DAYS = 14;

export const sprintCode = (n: number): string => 'S' + String(n).padStart(2, '0');

/** The tree's board from the server's answers: active sprint first, then planned, recent completed, backlog. */
export function boardFromServer(
  server: string,
  states: StateJson[],
  sprints: SprintJson[],
  items: ItemJson[],
  labels: { id: string; name: string }[],
  today: string,
  deps: { predecessorId: string; successorId: string }[] = [],
): Sprint[] {
  const stateOf = new Map(states.map((s) => [s.id, s]));
  // [PCODE-462 | S15 | v0.1.0] what each task still waits for: predecessors not handed on or done yet
  const itemOf = new Map(items.map((i) => [i.id, i]));
  const finished = (i: ItemJson): boolean => {
    const st = stateOf.get(i.stateId);
    return (
      st?.group === 'completed' ||
      st?.group === 'cancelled' ||
      ['review', 'test'].includes((st?.name ?? '').toLowerCase())
    );
  };
  const waits = (id: string): string[] =>
    deps
      .filter((d) => d.successorId === id)
      .map((d) => itemOf.get(d.predecessorId))
      .filter((p): p is ItemJson => Boolean(p) && !finished(p as ItemJson))
      .map((p) => p.ref);
  const labelOf = new Map(labels.map((l) => [l.id, l.name]));
  const item = (i: ItemJson): Item => {
    const st = stateOf.get(i.stateId);
    const group = (GROUPS as readonly string[]).includes(st?.group ?? '')
      ? (st?.group as StateGroup)
      : 'backlog';
    return {
      id: i.id,
      ref: i.ref,
      title: i.title,
      state: { name: st?.name ?? '?', group },
      priority: 'none',
      labels: i.labelIds.flatMap((id) => labelOf.get(id) ?? []),
      url: server.replace(/\/$/, '') + '/items/' + i.id,
      done: group === 'completed' || group === 'cancelled',
      ...(waits(i.id).length ? { waitsFor: waits(i.id) } : {}),
    };
  };
  const byRank = (a: ItemJson, b: ItemJson): number => a.rank - b.rank || a.sequence - b.sequence;
  const cutoff = new Date(Date.parse(today + 'T00:00:00Z') - RECENT_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const order = { active: 0, planned: 1, completed: 2 } as Record<string, number>;
  const shown = sprints
    .filter((s) => s.status !== 'completed' || (s.endDate ?? '') >= cutoff)
    .sort(
      (a, b) =>
        (order[a.status] ?? 3) - (order[b.status] ?? 3) ||
        (a.status === 'completed' ? b.number - a.number : a.number - b.number),
    );
  const board: Sprint[] = shown.map((s) => ({
    id: s.id,
    name: s.name,
    code: sprintCode(s.number),
    date: s.startDate ?? '',
    endDate: s.endDate ?? '',
    goal: s.goal,
    isToday: s.status === 'active',
    items: items
      .filter((i) => i.sprintId === s.id)
      .sort(byRank)
      .map(item),
    source: 'server',
  }));
  const backlog = items.filter((i) => i.sprintId === null).sort(byRank);
  if (backlog.length)
    board.push({
      name: 'Backlog',
      code: 'S00',
      date: '',
      endDate: '',
      goal: '',
      isToday: false,
      items: backlog.map(item),
      source: 'server',
    });
  return board;
}

export interface ServerConnectionOptions {
  target: ServerTarget;
  onBoard: (board: BoardData) => void;
  onStatus: (online: boolean, error: string | null) => void;
  /** every event of the project, for the activity feed */
  onEvent?: (event: ActivityEvent) => void;
  /** [PCODE-106 | S15 | v0.1.0] the recent events the feed opens with (again after a resync) */
  onHistory?: (events: ActivityEvent[]) => void;
  log?: (line: string) => void;
  today?: () => string;
  fetchImpl?: typeof fetch;
  openSocket?: (url: string, headers: Record<string, string>) => SocketLike;
  /** how long events are gathered before the board is read again */
  debounceMs?: number;
  /** [PCODE-196 | S15 | v0.1.0] who is where in the workspace, on every change */
  onPresence?: (people: PresenceEntry[]) => void;
  /** [PCODE-236 | S15 | v0.1.0] a conversation the person may see changed */
  onChat?: (chat: ChatEvent) => void;
}

export class ServerConnection {
  readonly api: Api;
  /** the client key the loop uses for this machine and folder */
  readonly client: string;
  private live: LiveClient | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loading: Promise<void> | null = null;
  private again = false;
  private stopped = false;
  private place: Place | null = null;

  constructor(private readonly opts: ServerConnectionOptions) {
    this.api = makeApi(opts.target.link.server, opts.target.token, opts.fetchImpl);
    this.client = clientKey(osHostname(), opts.target.root);
  }

  get link(): PeLink {
    return this.opts.target.link;
  }

  private get ws(): string {
    return '/api/workspaces/' + this.link.workspaceId;
  }

  start(): void {
    this.stopped = false;
    void this.refresh();
    // [PCODE-106 | S15 | v0.1.0] the history first, then the stream from where it ends: no gap
    void this.history().then((after) => {
      if (!this.stopped) this.follow(after);
    });
  }

  /** [PCODE-106 | S15 | v0.1.0] Hands the recent events to the feed; returns the sequence to follow from. */
  private async history(): Promise<number | undefined> {
    if (!this.opts.onHistory) return undefined;
    try {
      const r = await this.api.call<{ sequence: number; events: ActivityEvent[] }>(
        'GET',
        this.ws + '/activity?limit=50&projectId=' + this.link.projectId,
      );
      this.opts.onHistory(r.events);
      return r.sequence;
    } catch (e) {
      this.opts.log?.(
        'activity history unavailable: ' + (e instanceof Error ? e.message : String(e)),
      );
      return undefined;
    }
  }

  private follow(after: number | undefined): void {
    // [PCODE-236 | S15 | v0.1.0] a server on this machine over IPv4, as orq reaches it (PCODE-239)
    const base = viaIPv4(this.link.server.replace(/\/$/, ''));
    const open =
      this.opts.openSocket ??
      ((url: string, headers: Record<string, string>) => openNodeSocket(url, { headers }));
    this.live = new LiveClient({
      workspaceId: this.link.workspaceId,
      ...(after !== undefined ? { after } : {}),
      open: (path) => open(base + path, { Authorization: 'Bearer ' + this.opts.target.token }),
      onEvent: (e) => {
        if (e.projectid && e.projectid !== this.link.projectId) return;
        this.opts.onEvent?.(e);
        this.soon();
      },
      onResync: () => {
        this.soon();
        void this.history();
      },
      ...(this.opts.onPresence ? { onPresence: this.opts.onPresence } : {}),
      ...(this.opts.onChat ? { onChat: this.opts.onChat } : {}), // [PCODE-236 | S15 | v0.1.0]
      onStatus: (online) => {
        this.opts.log?.('live ' + (online ? 'connected' : 'disconnected'));
        // back online: what happened meanwhile was replayed, but read the board once to be sure
        if (online) this.soon();
        else this.opts.onStatus(false, 'live connection lost; reconnecting');
      },
    });
    this.live.start();
    if (this.place) this.live.setPresence(this.place);
  }

  /** [PCODE-196 | S15 | v0.1.0] Reports where this person is; the live client repeats it as a heartbeat. */
  setPlace(place: Place): void {
    this.place = place;
    this.live?.setPresence(place);
  }

  /** Reads the board again after a short pause, so a burst of events costs one read. */
  private soon(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, this.opts.debounceMs ?? 150);
  }

  /** Reads the board now; a call during a read runs one more read after it. */
  refresh(): Promise<void> {
    if (this.loading) {
      this.again = true;
      return this.loading;
    }
    this.loading = this.load().finally(() => {
      this.loading = null;
      if (this.again) {
        this.again = false;
        void this.refresh();
      }
    });
    return this.loading;
  }

  private async load(): Promise<void> {
    const p = '/projects/' + this.link.projectId;
    try {
      const [project, sprints, items, labels, deps] = await Promise.all([
        this.api.call<ProjectDetail>('GET', this.ws + p),
        this.api.call<SprintJson[]>('GET', this.ws + p + '/sprints'),
        this.api.call<ItemJson[]>('GET', this.ws + p + '/items'),
        this.api.call<{ id: string; name: string }[]>('GET', this.ws + p + '/labels'),
        // [PCODE-462 | S15 | v0.1.0] the order of the tasks; an older server has none
        this.api
          .call<{ dependencies?: { predecessorId: string; successorId: string }[] }>(
            'GET',
            this.ws + p + '/plan',
          )
          .then((x) => x.dependencies ?? [])
          .catch(() => []),
      ]);
      const today = (this.opts.today ?? (() => new Date().toISOString().slice(0, 10)))();
      this.opts.onBoard({
        version: project.version,
        sprints: boardFromServer(
          this.link.server,
          project.states,
          sprints,
          items,
          labels,
          today,
          deps,
        ),
      });
      this.opts.onStatus(true, null);
    } catch (e) {
      this.opts.onStatus(false, e instanceof Error ? e.message : String(e));
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.live?.stop();
    this.live = null;
  }
}
