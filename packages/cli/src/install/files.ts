// ── [PCODE-353 | S15 | v0.1.0] T35.4a System health page with backup, restore and upgrade wizards ──
// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-191 | S15 | v0.1.0] B7.6 Client status page with uptime probes, own portal domains with DNS verification and on-demand TLS ──
// ── [PCODE-168 | S15 | v0.1.0] B3.1 Ideation and files on the server: blob store, sources, requirements, questions, risks, assumptions, decisions, glossary, scores, extraction ──
// ── [PCODE-91 | S15 | v0.1.0] Package the server as a Docker Compose install started by `orq install` ──
//    Why:  what an install consists of, as text: the compose file, the database init script and the .env
//          that holds the generated secrets. Secrets live only in .env (readable by its owner), never in the
//          compose file. PostgreSQL's superuser is used once to create a normal owner role; the server
//          itself connects as that role, so row-level security binds it.
// ── [PCODE-120 | S15 | v0.1.0] Build the agent runtime: agents, queued runs, model providers, tools with approvals, budgets, streamed steps ──
//    Why:  the server's own secret key (ORQIVA_SECRET_KEY) seals provider keys; it is made once here and kept.
import { randomBytes } from 'node:crypto';

export interface InstallSettings {
  image: string;
  port: number;
  publicUrl: string;
  postgresPassword: string;
  dbPassword: string;
  /** 64 hex characters (32 bytes) for sealing provider keys */
  secretKey: string;
  /** [PCODE-192 | S15 | v0.1.0] the database, its owner role and the compose project: orqiva, or prodengine for an install made before the rename */
  dbName: string;
  projectName: string;
  /** [PCODE-191 | S15 | v0.1.0] set: a Caddy proxy in front gets certificates (Let's Encrypt) for this server and verified client domains */
  tlsEmail?: string;
  /** [PCODE-237 | S15 | v0.1.0] the mail server: ORQIVA_SMTP_* and ORQIVA_MAIL_FROM, kept as the admin wrote them */
  mail?: Record<string, string>;
}

export const DEFAULT_IMAGE = 'orqiva/server:0.1.0';

/** 32 hex characters: strong, and safe inside a URL and a shell without escaping. */
export function newSecret(): string {
  return randomBytes(16).toString('hex');
}

export function envFile(s: InstallSettings): string {
  return [
    '# Orqiva install settings. Keep this file private: it holds the database passwords.',
    '# Change PORT, PUBLIC_URL or IMAGE and run `orq install` again to apply; data is kept.',
    'ORQIVA_IMAGE=' + s.image,
    'ORQIVA_PORT=' + String(s.port),
    'ORQIVA_PUBLIC_URL=' + s.publicUrl,
    'POSTGRES_PASSWORD=' + s.postgresPassword,
    'ORQIVA_DB_PASSWORD=' + s.dbPassword,
    'ORQIVA_SECRET_KEY=' + s.secretKey,
    // [PCODE-192 | S15 | v0.1.0] kept as they were made: an install from before the rename keeps its database and volumes
    'ORQIVA_DB_NAME=' + s.dbName,
    'ORQIVA_PROJECT=' + s.projectName,
    // [PCODE-191 | S15 | v0.1.0]
    ...(s.tlsEmail ? ['ORQIVA_TLS_EMAIL=' + s.tlsEmail] : []),
    // [PCODE-237 | S15 | v0.1.0] mail; add ORQIVA_SMTP_HOST, ORQIVA_SMTP_PORT, ORQIVA_SMTP_SECURITY,
    // ORQIVA_SMTP_USER, ORQIVA_SMTP_PASSWORD and ORQIVA_MAIL_FROM to .env, then run orq install again
    ...Object.entries(s.mail ?? {}).map(([k, v]) => k + '=' + v),
    '',
  ].join('\n');
}

/** Reads KEY=value lines; comments and blank lines are skipped. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m?.[1]) out[m[1]] = m[2] ?? '';
  }
  return out;
}

export const COMPOSE = `# Orqiva: written by \`orq install\`. Settings and secrets are in .env next to this file.
name: \${ORQIVA_PROJECT:-orqiva}
services:
  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      ORQIVA_DB_PASSWORD: \${ORQIVA_DB_PASSWORD}
      ORQIVA_DB_NAME: \${ORQIVA_DB_NAME:-orqiva}
    volumes:
      - db-data:/var/lib/postgresql/data
      - ./initdb:/docker-entrypoint-initdb.d:ro
    healthcheck:
      # over TCP: during first-time setup PostgreSQL listens on its socket only, so this waits for the real start
      test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U postgres -d \${ORQIVA_DB_NAME:-orqiva}']
      interval: 5s
      timeout: 5s
      retries: 30
  server:
    image: \${ORQIVA_IMAGE}
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://\${ORQIVA_DB_NAME:-orqiva}:\${ORQIVA_DB_PASSWORD}@db:5432/\${ORQIVA_DB_NAME:-orqiva}
      ORQIVA_PUBLIC_URL: \${ORQIVA_PUBLIC_URL}
      ORQIVA_PORT: '8080'
      ORQIVA_SECRET_KEY: \${ORQIVA_SECRET_KEY}
      ORQIVA_DATA_DIR: /data
      ORQIVA_SMTP_HOST: \${ORQIVA_SMTP_HOST:-}
      ORQIVA_SMTP_PORT: \${ORQIVA_SMTP_PORT:-}
      ORQIVA_SMTP_SECURITY: \${ORQIVA_SMTP_SECURITY:-starttls}
      ORQIVA_SMTP_USER: \${ORQIVA_SMTP_USER:-}
      ORQIVA_SMTP_PASSWORD: \${ORQIVA_SMTP_PASSWORD:-}
      ORQIVA_MAIL_FROM: \${ORQIVA_MAIL_FROM:-}
      # [PCODE-353 | S15 | v0.1.0] the system page lists what orq backup wrote
      ORQIVA_BACKUP_DIR: /backups
    volumes:
      - files-data:/data
      - ./backups:/backups:ro
    ports:
      - '\${ORQIVA_PORT}:8080'
volumes:
  db-data:
  files-data:
`;

/** [PCODE-191 | S15 | v0.1.0] The proxy that terminates TLS: one certificate per name, asked from the server first. */
export const COMPOSE_TLS_SERVICE = `  proxy:
    image: caddy:2
    restart: unless-stopped
    depends_on:
      - server
    environment:
      ORQIVA_TLS_EMAIL: \${ORQIVA_TLS_EMAIL}
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
`;

/** [PCODE-191 | S15 | v0.1.0] Caddy gets a certificate on the first visit of a name the server allows: its own and verified portal domains. */
export const CADDYFILE = `# Orqiva: written by \`orq install --tls-email\`. Certificates come on demand, only for names the server allows.
{
	email {$ORQIVA_TLS_EMAIL}
	on_demand_tls {
		ask http://server:8080/internal/tls/allow
	}
}

https:// {
	tls {
		on_demand
	}
	reverse_proxy server:8080
}

http:// {
	redir https://{host}{uri} permanent
}
`;

/** The compose file, with the TLS proxy when the install asks for it. */
export function composeFor(s: Pick<InstallSettings, 'tlsEmail'>): string {
  if (!s.tlsEmail) return COMPOSE;
  return COMPOSE.replace(
    'volumes:\n  db-data:',
    COMPOSE_TLS_SERVICE + 'volumes:\n  caddy-data:\n  db-data:',
  );
}

/** Runs once, when the database volume is new: the owner role Orqiva connects as, and its database. */
export const INIT_DB = `#!/bin/sh
# Orqiva: written by \`orq install\`. Creates the role the server connects as: an owner, not a superuser,
# so the row-level security that separates workspaces applies to it.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v pw="$ORQIVA_DB_PASSWORD" -v name="\${ORQIVA_DB_NAME:-orqiva}" <<'EOSQL'
CREATE ROLE :"name" LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE PASSWORD :'pw';
CREATE DATABASE :"name" OWNER :"name";
EOSQL
`;
