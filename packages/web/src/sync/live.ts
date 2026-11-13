// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-96 | S15 | v0.1.0] Build our own local-first sync for items: client cache, optimistic writes, reconnect ──
// ── [PCODE-101 | S15 | v0.1.0] Add presence: heartbeats, avatars on cards, who-is-where ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Why:  the browser's end of the live connection: the shared client (@orqiva/shared), opening the
//          page's own host, wss on https. The VS Code extension uses the same client with a Node socket.
import {
  LiveClient as SharedLiveClient,
  type LiveClientOptions as SharedOptions,
  type SocketLike,
} from '@orqiva/shared';

export type { Place, SocketLike } from '@orqiva/shared';

export interface LiveClientOptions extends Omit<SharedOptions, 'open'> {
  /** opens a socket to the given URL path; default: the page's own host, wss on https */
  open?: (path: string) => SocketLike;
}

const defaultOpen = (path: string): SocketLike => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return new WebSocket(proto + '//' + window.location.host + path) as unknown as SocketLike;
};

export class LiveClient extends SharedLiveClient {
  constructor(opts: LiveClientOptions) {
    super({ ...opts, open: opts.open ?? defaultOpen });
  }
}
