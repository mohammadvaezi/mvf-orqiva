// ── [PCODE-409 | S15 | v0.1.0] T36.4 Load and scale ──
// ── [PCODE-211 | S15 | v0.1.0] T18.3 Scale test (20 projects, 50 live users, under 1 s event-to-screen) and orq portfolio ──
//    Why:  the T18 exit as a test that keeps guarding it: a workspace with 20 projects and 50 people, each
//          holding a live connection the way a browser does, while writers create cards across the
//          projects. Per change and per screen it measures request sent → event received; under the same
//          load it samples the command center's portfolio read, which a screen does (after a short pause
//          that bundles bursts) before it redraws. Event p95 + that pause + read p95 must stay under 1 s.
//          Results go to out/scale.json; `npm run scale --workspace packages/server` runs only this.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { ServerMessage } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { RawWsClient } from '../wsclient.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

// [PCODE-409 | S15 | v0.1.0] the v1 target: the command center with 100 projects
const PROJECTS = Number(process.env['ORQIVA_SCALE_PROJECTS'] ?? 100);
const PEOPLE = 50;
const WRITES = 100;
const RATE_PER_SECOND = 10;
/** the command center bundles events this long before it reads again (web/src/v2/command.tsx) */
const SCREEN_PAUSE_MS = 150;
const LIMIT_MS = 1000;

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;

describe.skipIf(!hasDatabase)('command center at scale (PostgreSQL)', () => {
  let t: TestApp;
  const people: Person[] = [];
  const projects: string[] = [];
  let ws = '';
  const W = (p: string): string => '/api/workspaces/' + ws + p;

  beforeAll(async () => {
    t = await startTestApp({ live: true });
    for (let i = 0; i < PEOPLE; i++) people.push(await t.signup('Person ' + String(i)));
    const owner = people[0];
    if (!owner) throw new Error('no owner');
    ws = owner.workspaceId;
    // the free plan has 5 seats; a load test adds its people directly
    await inSystem(t.db.pool, async (c) => {
      for (const p of people.slice(1))
        await c.query(
          "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
          [ws, p.id],
        );
    });
    for (let i = 0; i < PROJECTS; i++)
      projects.push(
        (
          await t.call<{ id: string }>(owner, 'POST', W('/projects'), {
            key: 'P' + String(i).padStart(2, '0'),
            name: 'Project ' + String(i),
          })
        ).body.id,
      );
  }, 300_000);

  afterAll(async () => {
    await t.stop();
  });

  it(
    'keeps 50 screens under a second behind ' + String(PROJECTS) + ' busy projects',
    async () => {
      const sent = new Map<string, number>();
      const delays: number[] = [];
      const clients: RawWsClient[] = [];
      for (const p of people) {
        const c = await RawWsClient.open(t.port, { cookie: p.cookie });
        c.sendJson({ type: 'subscribe', workspaceId: ws });
        await c.until(() => c.messages<ServerMessage>().some((m) => m.type === 'subscribed'));
        let seen = c.frames.length;
        // the frames parse on each chunk; stamp the new ones as they arrive
        c.socket.on('data', () => {
          const at = performance.now();
          const fresh = c.messages<ServerMessage>().slice(seen);
          seen = c.frames.length;
          for (const m of fresh) {
            if (m.type !== 'event' || m.event.type !== 'orqiva.item.created') continue;
            const title = (m.event.data.object.label ?? '').replace(/^P\d\d-\d+ /, '');
            const start = sent.get(title);
            if (start !== undefined) delays.push(at - start);
          }
        });
        clients.push(c);
      }

      // a few screens read the portfolio once a second while the writes go on
      const reads: number[] = [];
      let writing = true;
      const readers = people.slice(0, 5).map(async (p) => {
        while (writing) {
          const t0 = performance.now();
          const r = await t.call(p, 'GET', W('/command-center'));
          if (r.status === 200) reads.push(performance.now() - t0);
          await new Promise((res) => setTimeout(res, 1000));
        }
      });

      for (let i = 0; i < WRITES; i++) {
        const title = 'card ' + String(i);
        const writer = people[i % PEOPLE] ?? people[0];
        if (!writer) break;
        sent.set(title, performance.now());
        void t.call(writer, 'POST', W('/projects/' + (projects[i % PROJECTS] ?? '') + '/items'), {
          title,
        });
        await new Promise((r) => setTimeout(r, 1000 / RATE_PER_SECOND));
      }
      const deadline = Date.now() + 20_000;
      while (delays.length < WRITES * PEOPLE && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 50));
      writing = false;
      await Promise.all(readers);
      for (const c of clients) c.destroy();

      const ev = [...delays].sort((a, b) => a - b);
      const rd = [...reads].sort((a, b) => a - b);
      const report = {
        projects: PROJECTS,
        liveUsers: PEOPLE,
        writes: WRITES,
        ratePerSecond: RATE_PER_SECOND,
        deliveries: ev.length,
        expected: WRITES * PEOPLE,
        eventP50ms: Math.round(percentile(ev, 50)),
        eventP95ms: Math.round(percentile(ev, 95)),
        eventMaxMs: Math.round(ev.at(-1) ?? NaN),
        portfolioReads: rd.length,
        portfolioP95ms: Math.round(percentile(rd, 95)),
        screenPauseMs: SCREEN_PAUSE_MS,
        screenP95ms: Math.round(percentile(ev, 95) + SCREEN_PAUSE_MS + percentile(rd, 95)),
        limitMs: LIMIT_MS,
        measured:
          'request sent → event received over WebSocket, per change and screen; plus the pause and the portfolio read the command center does before it redraws',
        at: new Date().toISOString(),
      };
      mkdirSync(new URL('../../../../out/', import.meta.url), { recursive: true });
      writeFileSync(
        new URL('../../../../out/scale.json', import.meta.url),
        JSON.stringify(report, null, 2) + '\n',
      );
      console.log(
        'scale: events p95 ' +
          String(report.eventP95ms) +
          ' ms over ' +
          String(report.deliveries) +
          ' deliveries; portfolio p95 ' +
          String(report.portfolioP95ms) +
          ' ms; screen p95 ' +
          String(report.screenP95ms) +
          ' ms',
      );
      expect(report.deliveries).toBe(report.expected);
      expect(report.screenP95ms).toBeLessThan(LIMIT_MS);
    },
    300_000,
  );
});
