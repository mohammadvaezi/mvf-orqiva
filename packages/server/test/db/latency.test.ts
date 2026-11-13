// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-98 | S15 | v0.1.0] Measure event-to-screen latency with a repeatable load test ──
//    Why:  the T02 exit criterion as a test that keeps guarding it: an edit made by one person shows for
//          another in under a second. Two clients, signed in as two people, hold live connections the way
//          two browsers do; a writer creates items at a steady pace. For each write and each client it
//          measures the time from sending the request to having the event AND the item fetched (what the
//          browser's item store does before it redraws). React's redraw after that is not included; the
//          manual browser check of PCODE-97 measured the whole path at 111–134 ms.
//          Results go to out/latency.json; `npm run latency --workspace packages/server` runs only this.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { ServerMessage } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RawWsClient } from '../wsclient.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const WRITES = 120;
const RATE_PER_SECOND = 20;
const P95_LIMIT_MS = 1000;

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;

describe.skipIf(!hasDatabase)('event-to-screen latency (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let ws = '';
  let project = '';

  beforeAll(async () => {
    t = await startTestApp({ live: true });
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    ws = ada.workspaceId;
    await t.call(ada, 'POST', '/api/workspaces/' + ws + '/members', {
      email: bob.email,
      role: 'member',
    });
    project = (
      await t.call<{ id: string }>(ada, 'POST', '/api/workspaces/' + ws + '/projects', {
        key: 'LAT',
        name: 'Latency',
      })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('shows another person’s edit in under a second at p95', async () => {
    const sent = new Map<string, number>();
    const samples: { client: string; ms: number }[] = [];
    const pending: Promise<void>[] = [];

    const watcher = async (who: Person, name: string): Promise<RawWsClient> => {
      const c = await RawWsClient.open(t.port, { cookie: who.cookie });
      let handled = 0;
      c.sendJson({ type: 'subscribe', workspaceId: ws });
      await c.until(() => c.messages<ServerMessage>().some((m) => m.type === 'subscribed'));
      // poll the frames this client has received, as the browser's live client would handle them
      const tick = setInterval(() => {
        const events = c
          .messages<ServerMessage>()
          .flatMap((m) =>
            m.type === 'event' && m.event.type === 'orqiva.item.created' ? [m.event] : [],
          );
        for (const e of events.slice(handled)) {
          const title = (e.data.object.label ?? '').replace(/^LAT-\d+ /, '');
          const start = sent.get(title);
          if (start === undefined) continue;
          // the item store fetches the item before it redraws: that request belongs to the latency
          pending.push(
            t.call(who, 'GET', '/api/workspaces/' + ws + '/items/' + e.data.object.id).then(() => {
              samples.push({ client: name, ms: performance.now() - start });
            }),
          );
        }
        handled = events.length;
      }, 2);
      c.socket.once('close', () => {
        clearInterval(tick);
      });
      return c;
    };

    const clients = [await watcher(ada, 'ada'), await watcher(bob, 'bob')];
    const writers = [ada, bob];
    for (let i = 0; i < WRITES; i++) {
      const title = 'write ' + String(i);
      const writer = writers[i % 2] ?? ada;
      sent.set(title, performance.now());
      void t.call(writer, 'POST', '/api/workspaces/' + ws + '/projects/' + project + '/items', {
        title,
      });
      await new Promise((r) => setTimeout(r, 1000 / RATE_PER_SECOND));
    }
    const deadline = Date.now() + 15_000;
    while (samples.length < WRITES * 2 && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    await Promise.all(pending);
    for (const c of clients) c.destroy();

    const all = samples.map((s) => s.ms).sort((a, b) => a - b);
    const report = {
      writes: WRITES,
      clients: 2,
      ratePerSecond: RATE_PER_SECOND,
      delivered: all.length,
      p50ms: Math.round(percentile(all, 50)),
      p95ms: Math.round(percentile(all, 95)),
      maxMs: Math.round(all.at(-1) ?? NaN),
      limitP95ms: P95_LIMIT_MS,
      measured:
        'request sent → event received over WebSocket → item fetched, per client (browser redraw not included)',
      at: new Date().toISOString(),
    };
    mkdirSync(new URL('../../../../out/', import.meta.url), { recursive: true });
    writeFileSync(
      new URL('../../../../out/latency.json', import.meta.url),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(
      'latency: p50 ' +
        String(report.p50ms) +
        ' ms, p95 ' +
        String(report.p95ms) +
        ' ms, max ' +
        String(report.maxMs) +
        ' ms over ' +
        String(report.delivered) +
        ' deliveries',
    );

    expect(report.delivered).toBe(WRITES * 2);
    expect(report.p95ms).toBeLessThan(P95_LIMIT_MS);
  }, 60_000);
});
