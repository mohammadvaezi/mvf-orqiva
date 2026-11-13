// ── [PCODE-349 | S15 | v0.1.0] T35.2b Slack and Teams bridges, personal calendar feed, CI pipeline runs ──
// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-241 | S15 | v0.1.0] T24.2 Reading files through the models: PDF, DOCX, images, audio ──
// ── [PCODE-212 | S15 | v0.1.0] T19.1 SAML 2.0 single sign-on per workspace, own XML signature verification with wrapping defences ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-183 | S15 | v0.1.0] B6.1 Activity at scale live: search, query language, facets, histogram, saved views, export, archive, hash chain, webhooks ──
// ── [PCODE-168 | S15 | v0.1.0] B3.1 Ideation and files on the server: blob store, sources, requirements, questions, risks, assumptions, decisions, glossary, scores, extraction ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
// ── [PCODE-84 | S08 | v0.1.0] Set up the platform monorepo with npm workspaces, own build scripts and CI ──
// ── [PCODE-86 | S15 | v0.1.0] Write the HTTP server on Node built-ins: router, validation, error model, OpenAPI ──
// ── [PCODE-87 | S15 | v0.1.0] Create the PostgreSQL schema v1 with our own migration runner and row-level security ──
// ── [PCODE-88 | S15 | v0.1.0] Implement authentication: email and password, sessions, OIDC login ──
// ── [PCODE-95 | S15 | v0.1.0] Build our own WebSocket gateway (RFC 6455) with typed protocol and SSE fallback ──
// ── [PCODE-101 | S15 | v0.1.0] Add presence: heartbeats, avatars on cards, who-is-where ──
// ── [PCODE-120 | S15 | v0.1.0] Build the agent runtime: agents, queued runs, model providers, tools with approvals, budgets, streamed steps ──
// ── [PCODE-150 | S15 | v0.1.0] Add the cloud tenant and harden sign-in, rate limits and headers ──
// [PCODE-192 | S15 | v0.1.0] PRODENGINE_* variables first become ORQIVA_*
import './legacyenv.js';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { OidcClient } from './auth/oidc.js';
import { AgentWorker } from './agents/worker.js';
import { ActivityWorker } from './activity/worker.js';
import { EventBus } from './events/bus.js';
// [PCODE-151 | S15 | v0.1.0]
import { PUSH_SUBJECT, PushWorker } from './push/dispatch.js';
import { ChatHub } from './live/chat.js'; // [PCODE-234 | S15 | v0.1.0]
import { BlobStore } from './files/blobstore.js'; // [PCODE-241 | S15 | v0.1.0]
import { FileReader } from './files/reading.js'; // [PCODE-241 | S15 | v0.1.0]
import { MailWorker, mailConfigFromEnv } from './mail/outbox.js'; // [PCODE-237 | S15 | v0.1.0]
import { PresenceHub } from './live/presence.js';
import { migrate } from './db/migrate.js';
import { assertNotSuperuser, createPool } from './db/pool.js';
import { consoleLogger } from './http/server.js';
import { DEFAULT_FX } from './lib/fx.js'; // [PCODE-327 | S15 | v0.1.0]

const env = process.env;
const port = Number(env['ORQIVA_PORT'] ?? 8080);
const databaseUrl = env['DATABASE_URL'];
// the address people reach Orqiva at; plain http only for local development
const publicUrl = (env['ORQIVA_PUBLIC_URL'] ?? 'http://localhost:' + String(port)).replace(
  /\/$/,
  '',
);

/** OIDC is on when issuer and client id are set. */
function oidcFromEnv(): OidcClient | undefined {
  const issuer = env['ORQIVA_OIDC_ISSUER'];
  const clientId = env['ORQIVA_OIDC_CLIENT_ID'];
  if (!issuer || !clientId) return undefined;
  const secret = env['ORQIVA_OIDC_CLIENT_SECRET'];
  return new OidcClient({
    issuer,
    clientId,
    redirectUri: publicUrl + '/auth/oidc/callback',
    ...(secret ? { clientSecret: secret } : {}),
  });
}

async function main(): Promise<void> {
  // [PCODE-87 | S15 | v0.1.0] the schema moves forward before the first request is served
  const pool = databaseUrl ? createPool(databaseUrl) : null;
  if (pool) {
    await assertNotSuperuser(pool);
    const r = await migrate(pool);
    consoleLogger.info('database ready', { applied: r.applied, schema: r.current });
  } else {
    consoleLogger.info('no DATABASE_URL: running without a database');
  }

  // [PCODE-95 | S15 | v0.1.0] the event bus feeds every live screen
  const bus =
    pool && databaseUrl
      ? new EventBus(pool, {
          connectionString: databaseUrl,
          log: (m, f) => {
            consoleLogger.error(m, f);
          },
        })
      : null;
  await bus?.start();
  // [PCODE-101 | S15 | v0.1.0] who is where, shared between server nodes
  const presence =
    databaseUrl && pool
      ? new PresenceHub({
          connectionString: databaseUrl,
          log: (m, f) => {
            consoleLogger.error(m, f);
          },
        })
      : null;
  await presence?.start();
  // [PCODE-234 | S15 | v0.1.0] conversations, live on every node
  const chat =
    databaseUrl && pool
      ? new ChatHub({
          pool,
          connectionString: databaseUrl,
          log: (m, f) => {
            consoleLogger.error(m, f);
          },
        })
      : null;
  await chat?.start();
  // [PCODE-237 | S15 | v0.1.0] mail: the settings from the environment, the queue's worker
  const mail = mailConfigFromEnv(env);
  consoleLogger.info(
    mail
      ? 'mail via ' + mail.host + ':' + String(mail.port)
      : 'no mail server set: links instead of mail',
  );
  const mailer = pool
    ? new MailWorker({
        pool,
        config: mail,
        publicUrl,
        log: (m, f) => {
          consoleLogger.error(m, f);
        },
      })
    : null;
  await mailer?.start();
  // [PCODE-120 | S15 | v0.1.0] the worker that runs agents, on our own queue in PostgreSQL
  const agents = pool
    ? new AgentWorker(pool, {
        log: (m, f) => {
          consoleLogger.error(m, f);
        },
      })
    : null;
  await agents?.start();
  // [PCODE-241 | S15 | v0.1.0] the worker that reads files through the models
  const reader = pool
    ? new FileReader({
        pool,
        store: new BlobStore(env['ORQIVA_DATA_DIR'] ?? 'data'),
        log: (m, f) => {
          consoleLogger.error(m, f);
        },
      })
    : null;
  await reader?.start();
  // [PCODE-151 | S15 | v0.1.0] notifications to people's phones and desktops
  const push = pool
    ? new PushWorker(pool, {
        subject: PUSH_SUBJECT,
        mail: Boolean(mailConfigFromEnv(env)), // [PCODE-237 | S15 | v0.1.0]
        publicUrl,
        // [PCODE-327 | S15 | v0.1.0] the ECB's daily rate; ORQIVA_FX=off for a server without internet
        ...(env['ORQIVA_FX'] === 'off' ? {} : { fx: DEFAULT_FX }),
        log: (m, f) => {
          consoleLogger.error(m, f);
        },
      })
    : null;
  await push?.start();
  // [PCODE-183 | S15 | v0.1.0] webhooks and the archive of old activity
  const activity = pool
    ? new ActivityWorker(pool, {
        publicUrl, // [PCODE-349 | S15 | v0.1.0]
        log: (m, f) => {
          consoleLogger.error(m, f);
        },
      })
    : null;
  activity?.start();
  const oidc = oidcFromEnv();
  const app = createApp({
    logger: consoleLogger,
    // [PCODE-150 | S15 | v0.1.0] per client: 1200 requests and 300 writes a minute unless set otherwise; behind a proxy, its header
    rateLimit: {
      requestsPerMinute: Number(env['ORQIVA_RATE_REQUESTS'] ?? 1200),
      writesPerMinute: Number(env['ORQIVA_RATE_WRITES'] ?? 300),
      trustProxy: env['ORQIVA_TRUST_PROXY'] === '1',
    },
    hsts: publicUrl.startsWith('https://'),
    // [PCODE-90 | S15 | v0.1.0] the web app: next to the server in an install, packages/web/dist in the repo
    webDir: env['ORQIVA_WEB_DIR'] ?? fileURLToPath(new URL('../../web/dist', import.meta.url)),
    ...(pool
      ? {
          auth: {
            pool,
            secureCookies: publicUrl.startsWith('https://'),
            publicUrl, // [PCODE-212 | S15 | v0.1.0] SAML addresses
            mail, // [PCODE-237 | S15 | v0.1.0]
            // [PCODE-168 | S15 | v0.1.0] the blob store's directory
            dataDir: env['ORQIVA_DATA_DIR'] ?? 'data',
            ...(oidc ? { oidc } : {}),
          },
        }
      : {}),
    ...(bus
      ? {
          live: {
            bus,
            allowedOrigins: [new URL(publicUrl).origin],
            ...(presence ? { presence } : {}),
            ...(chat ? { chat } : {}),
          },
        }
      : {}),
  });
  app.server.listen(port, () => {
    consoleLogger.info('Orqiva server listening', { port });
  });

  // docker stop sends SIGTERM, Ctrl+C sends SIGINT: stop accepting, let running requests finish
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      consoleLogger.info('shutting down', { signal });
      void app
        .close()
        .then(() => agents?.stop())
        .then(() => reader?.stop())
        .then(() => push?.stop())
        .then(() => activity?.stop())
        .then(() => bus?.stop())
        .then(() => presence?.stop())
        .then(() => chat?.stop())
        .then(() => mailer?.stop())
        .then(() => pool?.end())
        .then(() => process.exit(0));
    });
  }
}

main().catch((err: unknown) => {
  consoleLogger.error('startup failed', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
