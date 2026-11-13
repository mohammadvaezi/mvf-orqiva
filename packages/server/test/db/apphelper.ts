// ── [PCODE-366 | S15 | v0.1.0] T36.2 End-to-end journeys for every role in a real browser ──
// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
// ── [PCODE-312 | S15 | v0.1.0] T31.10 T31 exit check, docs and sprint close ──
// ── [PCODE-241 | S15 | v0.1.0] T24.2 Reading files through the models: PDF, DOCX, images, audio ──
// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
// ── [PCODE-214 | S15 | v0.1.0] T19.3 Several server nodes (events, presence and migrations across nodes) and a Helm chart ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-191 | S15 | v0.1.0] B7.6 Client status page with uptime probes, own portal domains with DNS verification and on-demand TLS ──
// ── [PCODE-169 | S15 | v0.1.0] B3.2 Documents and UI kit on the server: page tree, versions, comments, backlinks, templates, knowledge, tokens, components, mockups, assets ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
// ── [PCODE-92 | S15 | v0.1.0] Add workspaces, projects, members and roles to the API ──
// ── [PCODE-107 | S15 | v0.1.0] Build the Plane importer: projects, items, states, comments, cycles, history ──
// ── [PCODE-120 | S15 | v0.1.0] Build the agent runtime: agents, queued runs, model providers, tools with approvals, budgets, streamed steps ──
// ── [PCODE-123 | S15 | v0.1.0] Add the ideas inbox and the AI owner interview ──
// ── [PCODE-149 | S15 | v0.1.0] Bill through Stripe without its SDK: checkout, webhooks, licences ──
// ── [PCODE-150 | S15 | v0.1.0] Add the cloud tenant and harden sign-in, rate limits and headers ──
//    Why:  API tests talk HTTP to a real server on a real database, as people do. This starts one and
//          signs people up; each person keeps their own session cookie.
import type { BillingDeps } from '../../src/api/billing.js';
import type { PushDeps } from '../../src/push/dispatch.js';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/app.js';
import { RateLimiter } from '../../src/auth/ratelimit.js';
import { migrate } from '../../src/db/migrate.js';
import { AgentWorker } from '../../src/agents/worker.js';
import type { ProviderFor } from '../../src/agents/runner.js';
import { providerResolver } from '../../src/agents/connections.js'; // [PCODE-240 | S15 | v0.1.0]
import { EventBus } from '../../src/events/bus.js';
import { PresenceHub } from '../../src/live/presence.js';
import { ChatHub } from '../../src/live/chat.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlobStore } from '../../src/files/blobstore.js';
import { FileReader } from '../../src/files/reading.js';
import { MailWorker } from '../../src/mail/outbox.js';
import type { MailConfig } from '../../src/mail/smtp.js';
import type { HttpServer } from '../../src/http/server.js';
import { createTestDb, type TestDb } from './testdb.js';
import { listenFetchable } from '../ports.js'; // [PCODE-365 | S15 | v0.1.0]

export interface Person {
  id: string;
  email: string;
  name: string;
  cookie: string;
  /** the workspace sign-up created for them */
  workspaceId: string;
}

export interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
}

export interface TestApp {
  db: TestDb;
  app: HttpServer;
  base: string;
  port: number;
  call<T = Record<string, unknown>>(
    who: Person | null,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Reply<T>>;
  signup(name: string): Promise<Person>;
  stop(): Promise<void>;
}

// [PCODE-365 | S15 | v0.1.0] moved to test/ports.ts, kept here for the tests that import it from this file
export { listenFetchable };

export async function startTestApp(
  opts: {
    live?: boolean;
    agents?: { provider: ProviderFor };
    // [PCODE-240 | S15 | v0.1.0] recorded provider answers: the AI connections (routes, one-answer calls, the agent worker) use them
    aiFetch?: typeof fetch;
    /** [PCODE-322 | S15 | v0.1.0] the vulnerability feeds' stand-in */
    vulnFeeds?: import('../../src/security/feeds.js').FeedDeps;
    // [PCODE-241 | S15 | v0.1.0] the file reader; not started, tests run its rounds
    reads?: boolean;
    billing?: BillingDeps;
    // [PCODE-150 | S15 | v0.1.0]
    rateLimit?: { requestsPerMinute: number; writesPerMinute: number };
    hsts?: boolean;
    // [PCODE-151 | S15 | v0.1.0] a local fake push service
    push?: PushDeps;
    // [PCODE-191 | S15 | v0.1.0] a fake DNS for portal domains
    dns?: { resolveTxt: (name: string) => Promise<string[][]> };
    // [PCODE-214 | S15 | v0.1.0] a second node on the first one's database (not dropped on stop)
    db?: TestDb;
    // [PCODE-237 | S15 | v0.1.0] a mail server (a local test one); the worker is not started, tests run its rounds
    mail?: MailConfig;
    /** [PCODE-366 | S15 | v0.1.0] the built web app, for journeys in a real browser */
    webDir?: string;
  } = {},
): Promise<
  TestApp & { agents: AgentWorker | null; mailer: MailWorker | null; reader: FileReader | null }
> {
  const db = opts.db ?? (await createTestDb());
  await migrate(db.pool);
  // [PCODE-95 | S15 | v0.1.0] live tests run the event bus and the gateway too
  const bus = opts.live ? new EventBus(db.pool, { connectionString: db.url, pollMs: 1000 }) : null;
  await bus?.start();
  // [PCODE-101 | S15 | v0.1.0] presence too, with a short debounce for quick tests
  const presence = opts.live ? new PresenceHub({ connectionString: db.url, debounceMs: 10 }) : null;
  await presence?.start();
  // [PCODE-234 | S15 | v0.1.0] conversations live
  const chat = opts.live ? new ChatHub({ pool: db.pool, connectionString: db.url }) : null;
  await chat?.start();
  // [PCODE-120 | S15 | v0.1.0] agent tests run the worker with the model they script
  const agents = opts.agents
    ? new AgentWorker(db.pool, { provider: opts.agents.provider, pollMs: 200 })
    : opts.aiFetch
      ? new AgentWorker(db.pool, { provider: providerResolver(opts.aiFetch), pollMs: 200 })
      : null;
  await agents?.start();
  const app = createApp({
    checkResponses: true,
    ...(opts.webDir ? { webDir: opts.webDir } : {}), // [PCODE-366 | S15 | v0.1.0]
    // [PCODE-150 | S15 | v0.1.0] limits and HTTPS-only, when a test asks for them
    ...(opts.rateLimit ? { rateLimit: opts.rateLimit } : {}),
    ...(opts.hsts ? { hsts: true } : {}),
    // [PCODE-107 | S15 | v0.1.0] PE_TEST_LOG=1 shows the server's own errors behind a 500
    ...(process.env['PE_TEST_LOG']
      ? {
          logger: {
            info: () => undefined,
            error: (msg: string, data?: unknown) => {
              console.error(msg, data);
            },
          },
        }
      : {}),
    auth: {
      pool: db.pool,
      secureCookies: false,
      limiter: new RateLimiter(1000, 60_000),
      // [PCODE-123 | S15 | v0.1.0] one-answer agent calls use the scripted model too
      ...(opts.agents ? { models: opts.agents.provider } : {}),
      ...(opts.aiFetch ? { aiFetch: opts.aiFetch } : {}),
      ...(opts.vulnFeeds ? { vulnFeeds: opts.vulnFeeds } : {}),
      // [PCODE-149 | S15 | v0.1.0] Stripe, faked by the test
      ...(opts.billing ? { billing: opts.billing } : {}),
      // [PCODE-151 | S15 | v0.1.0]
      ...(opts.push ? { push: opts.push } : {}),
      // [PCODE-169 | S15 | v0.1.0] the link check may reach the test server itself
      linkCheck: { allowPrivate: true },
      ...(opts.dns ? { status: opts.dns } : {}),
      // [PCODE-237 | S15 | v0.1.0]
      ...(opts.mail ? { mail: opts.mail, publicUrl: 'https://orqiva.example.test' } : {}),
    },
    ...(bus
      ? {
          live: {
            bus,
            allowedOrigins: ['https://orqiva.example.test'],
            ws: { heartbeatMs: 60_000 },
            ...(presence ? { presence } : {}),
            ...(chat ? { chat } : {}),
          },
        }
      : {}),
  });
  await listenFetchable(app.server);
  const base = 'http://127.0.0.1:' + String((app.server.address() as AddressInfo).port);

  async function call<T>(
    who: Person | null,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Reply<T>> {
    const headers: Record<string, string> = {};
    if (who) headers['cookie'] = who.cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
  }

  let n = 0;
  async function signup(name: string): Promise<Person> {
    n += 1;
    const email = name.toLowerCase().replace(/\W+/g, '.') + '.' + String(n) + '@example.test';
    const res = await fetch(base + '/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        name,
        password: 'a test password ' + String(n),
        workspaceName: name + ' Co',
      }),
    });
    if (res.status !== 201)
      throw new Error('signup failed: ' + String(res.status) + ' ' + (await res.text()));
    const body = (await res.json()) as { user: { id: string }; workspace: { id: string } };
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    return { id: body.user.id, email, name, cookie, workspaceId: body.workspace.id };
  }

  return {
    db,
    app,
    base,
    port: (app.server.address() as AddressInfo).port,
    call,
    signup,
    agents,
    // [PCODE-237 | S15 | v0.1.0] the mail queue's worker, rounds run by the test
    // [PCODE-241 | S15 | v0.1.0] the same blob store the app writes uploads to
    reader: opts.reads
      ? new FileReader({
          pool: db.pool,
          store: new BlobStore(join(tmpdir(), 'orqiva-data')),
          ...(opts.aiFetch ? { fetchImpl: opts.aiFetch } : {}),
        })
      : null,
    mailer: opts.mail
      ? new MailWorker({
          pool: db.pool,
          config: opts.mail,
          publicUrl: 'https://orqiva.example.test',
        })
      : null,
    async stop() {
      await agents?.stop();
      await app.close(100);
      await bus?.stop();
      await presence?.stop();
      await chat?.stop();
      if (!opts.db) await db.drop();
    },
  };
}
