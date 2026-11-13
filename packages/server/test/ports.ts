// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
//    Why:  this machine's dynamic port range starts at 1024, so listen(0) can hand out a port fetch refuses
//          ("bad port"); every server a test fetches from listens on one fetch accepts.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const FETCH_BLOCKED = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
]);

/** Listens on a free local port that fetch will connect to. */
export async function listenFetchable(server: Server): Promise<void> {
  for (;;) {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    if (!FETCH_BLOCKED.has((server.address() as AddressInfo).port)) return;
    await new Promise<void>((r) => {
      server.close(() => {
        r();
      });
    });
  }
}
