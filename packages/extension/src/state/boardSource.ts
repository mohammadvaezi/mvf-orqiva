// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-236 | S15 | v0.1.0] T23.3 Messages for clients, in VS Code and in the CLI ──
// ── [PCODE-196 | S15 | v0.1.0] B8.4 VS Code: ideation interview, and presence per file and block (workspace switch, off by default) ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
// ── [PCODE-106 | S15 | v0.1.0] Add the team activity feed panel to VS Code ──
//    Why:  where the board comes from, without a timer. A folder on Orqiva reads it from the server and
//          then follows the live stream: a change anyone makes redraws the tree within a moment, and nothing
//          is asked for when nothing happened. A folder still on Plane reads it once at start and again
//          after each loop command or file change (Plane retires in T06); the 30-second Plane poller is
//          gone. Replaces state/poller.ts. Free of vscode: the parts are injected.
import type { ActivityEvent, ChatEvent, PresenceEntry } from '@orqiva/shared';
import { ServerConnection, detectServer, type ServerConnectionOptions } from '../server/connection';
import type { Sprint } from './board';
import type { Store } from './store';

export interface BoardSourceOptions {
  store: Store;
  home: string;
  /** the Plane board, for a folder still on Plane; null when Plane is not set up */
  fetchPlane: () => Promise<Sprint[] | null>;
  onEvent?: (event: ActivityEvent) => void;
  /** [PCODE-106 | S15 | v0.1.0] the feed's history; an empty list when the folder leaves Orqiva */
  onHistory?: (events: ActivityEvent[]) => void;
  /** [PCODE-196 | S15 | v0.1.0] who is where */
  onPresence?: (people: PresenceEntry[]) => void;
  /** [PCODE-236 | S15 | v0.1.0] conversations */
  onChat?: (chat: ChatEvent) => void;
  log?: (line: string) => void;
  /** test seam: how the server connection is made */
  connect?: (opts: ServerConnectionOptions) => ServerConnection;
}

export class BoardSource {
  private server: ServerConnection | null = null;
  private serverKey = '';
  private inFlight: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly opts: BoardSourceOptions) {}

  /** the live connection, when the folder is on Orqiva and signed in */
  get connection(): ServerConnection | null {
    return this.server;
  }

  /** (Re)connects for the store's current project; call again when the link changes. */
  start(): void {
    if (this.disposed) return;
    const { store } = this.opts;
    const root = store.state.root;
    const target = root && store.state.link?.server ? detectServer(root, this.opts.home) : null;
    const key = target ? target.link.server + '|' + target.link.projectId + '|' + target.root : '';
    // already following this project: nothing to do
    if (target && this.server && key === this.serverKey) return;
    this.server?.stop();
    if (this.server) this.opts.onHistory?.([]); // [PCODE-106 | S15 | v0.1.0] another project's feed starts empty
    this.server = null;
    this.serverKey = key;
    if (!target) {
      if (root && store.state.link?.server)
        store.setOnline(false, 'Not signed in to ' + store.state.link.server + ': run orq login');
      void this.refreshNow();
      return;
    }
    const make = this.opts.connect ?? ((o: ServerConnectionOptions) => new ServerConnection(o));
    this.server = make({
      target,
      onBoard: (b) => {
        const link = store.state.link;
        if (link) link.version = b.version;
        store.applyBoard(b.sprints);
      },
      onStatus: (online, error) => {
        if (online !== store.state.online || error !== store.state.lastError)
          store.setOnline(online, error);
      },
      ...(this.opts.onEvent ? { onEvent: this.opts.onEvent } : {}),
      ...(this.opts.onHistory ? { onHistory: this.opts.onHistory } : {}),
      ...(this.opts.onPresence ? { onPresence: this.opts.onPresence } : {}), // [PCODE-196 | S15 | v0.1.0]
      ...(this.opts.onChat ? { onChat: this.opts.onChat } : {}), // [PCODE-236 | S15 | v0.1.0]
      ...(this.opts.log ? { log: this.opts.log } : {}),
    });
    this.opts.log?.('Orqiva: ' + target.link.server + ' project ' + target.link.projectKey);
    this.server.start();
  }

  /** Reads the board now: from the server, or once from Plane. Single-flight. */
  refreshNow(): Promise<void> {
    if (this.server) return this.server.refresh();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.opts
      .fetchPlane()
      .then((sprints) => {
        if (this.disposed || !sprints) return;
        this.opts.store.applyBoard(sprints);
        this.opts.store.setOnline(true);
      })
      .catch((e: unknown) => {
        if (this.disposed) return;
        const msg = e instanceof Error ? e.message : String(e);
        this.opts.log?.('Tracker: offline (' + msg + ')');
        this.opts.store.setOnline(false, msg);
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  dispose(): void {
    this.disposed = true;
    this.server?.stop();
    this.server = null;
  }
}
