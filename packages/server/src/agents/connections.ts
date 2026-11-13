// ── [PCODE-332 | S15 | v0.1.0] T33.4a Nested traces with latency and commits, agent rate limits, provider limits and health ──
// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
//    Why:  which model answers is a setting of the workspace, not of the code. A connection is a provider
//          with its key and the models to use; the workspace names one for agents, one that takes over
//          when that one fails, one that reads documents and images, and one that writes transcripts.
//          An agent may have its own connection and model. A project's own key replaces the workspace's
//          key of the same provider, so a client can pay for its project's AI. Every answer says which
//          provider and model gave it, so the cost is priced and the connection's last use and last
//          error are kept, whoever called.
import type { Pool, PoolClient } from 'pg';
import { inWorkspace } from '../db/pool.js';
import type { ConnectionLimits } from './limits.js'; // [PCODE-332 | S15 | v0.1.0]
import { bedrockProvider } from './bedrock.js';
import { DEFAULT_MODEL } from './defaults.js';
import { geminiProvider } from './gemini.js';
import { azureProvider, openaiProvider, xaiProvider } from './openai.js';
import {
  anthropicProvider,
  demoProvider,
  ProviderError,
  type Answerer,
  type ModelProvider,
  type ModelReply,
} from './provider.js';
import { open, SecretKeyMissing } from './secrets.js';

export const PROVIDER_KINDS = [
  'anthropic',
  'openai',
  'azure',
  'gemini',
  'bedrock',
  'xai',
  'demo',
] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export interface ProviderInfo {
  label: string;
  /** what this provider reads besides text */
  reads: { images: boolean; pdf: boolean; audio: boolean };
  /** models to start with; the admin changes them */
  suggested: { model: string; reading: string; audio: string };
  /** a quick check of the key's shape, to catch a key pasted into the wrong provider */
  keyPattern?: RegExp;
  keyHelp: string;
}

export const PROVIDER_INFO: Record<ProviderKind, ProviderInfo> = {
  anthropic: {
    label: 'Anthropic',
    reads: { images: true, pdf: true, audio: false },
    suggested: { model: DEFAULT_MODEL, reading: DEFAULT_MODEL, audio: '' },
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    keyHelp: 'An Anthropic API key starts with sk-ant-',
  },
  openai: {
    label: 'OpenAI',
    reads: { images: true, pdf: true, audio: true },
    suggested: { model: 'gpt-5', reading: 'gpt-5-mini', audio: 'gpt-4o-transcribe' },
    keyPattern: /^sk-(?!ant-)[A-Za-z0-9_-]{20,}$/,
    keyHelp: 'An OpenAI API key starts with sk-',
  },
  azure: {
    label: 'Azure OpenAI',
    reads: { images: true, pdf: true, audio: true },
    suggested: { model: '', reading: '', audio: '' },
    keyHelp: 'The key of the Azure OpenAI resource; models are its deployment names',
  },
  gemini: {
    label: 'Google Gemini',
    reads: { images: true, pdf: true, audio: true },
    suggested: {
      model: 'gemini-2.5-flash',
      reading: 'gemini-2.5-flash',
      audio: 'gemini-2.5-flash',
    },
    keyHelp: 'A Gemini API key from Google AI Studio',
  },
  bedrock: {
    label: 'Amazon Bedrock',
    reads: { images: true, pdf: true, audio: false },
    suggested: { model: '', reading: '', audio: '' },
    keyHelp: 'A Bedrock API key, or an access key ID and secret access key',
  },
  xai: {
    label: 'xAI Grok',
    reads: { images: true, pdf: false, audio: true },
    suggested: { model: 'grok-4', reading: 'grok-4', audio: 'grok-voice-transcribe-2.0' },
    keyPattern: /^xai-[A-Za-z0-9_-]{20,}$/,
    keyHelp: 'An xAI API key starts with xai-',
  },
  demo: {
    label: 'Demo model',
    reads: { images: false, pdf: false, audio: false },
    suggested: { model: '', reading: '', audio: '' },
    keyHelp: 'No key: the demo model answers from fixed scripts',
  },
};

export interface ConnectionConfig {
  /** Azure: https://<resource>.openai.azure.com */
  endpoint?: string;
  /** Bedrock: us-east-1 and so on */
  region?: string;
  /** Bedrock: a Bedrock API key, or access keys that sign each request */
  auth?: 'apiKey' | 'accessKeys';
}

export interface ConnectionRow {
  id: string;
  provider: ProviderKind;
  label: string;
  config: ConnectionConfig;
  key_ciphertext: string | null;
  key_hint: string;
  default_model: string;
  reading_model: string;
  audio_model: string;
  last_used_at: Date | null;
  last_error: string;
  created_at: Date;
  // [PCODE-332 | S15 | v0.1.0] its own limits, and when it last failed
  requests_per_minute: number | null;
  tokens_per_minute: number | null;
  last_error_at: Date | null;
}

export const CONNECTION_SELECT = `SELECT id, provider, label, config, key_ciphertext, key_hint, default_model, reading_model,
       audio_model, last_used_at, last_error, created_at, requests_per_minute, tokens_per_minute, last_error_at
  FROM ai_connections`;

export type Purpose = 'agent' | 'reading' | 'audio';

/** The provider behind a connection, with the key opened. */
export function buildProvider(
  row: Pick<ConnectionRow, 'provider' | 'config'>,
  secret: string | null,
  fetchImpl: typeof fetch = fetch,
): ModelProvider {
  if (row.provider === 'demo') return demoProvider();
  if (!secret) throw new ProviderError('The connection has no key; enter it again in Settings');
  switch (row.provider) {
    case 'anthropic':
      return anthropicProvider(secret, fetchImpl);
    case 'openai':
      return openaiProvider(secret, fetchImpl);
    case 'xai':
      return xaiProvider(secret, fetchImpl);
    case 'gemini':
      return geminiProvider(secret, fetchImpl);
    case 'azure':
      if (!row.config.endpoint) throw new ProviderError('The Azure connection has no endpoint');
      return azureProvider(row.config.endpoint, secret, fetchImpl);
    case 'bedrock': {
      const region = row.config.region ?? 'us-east-1';
      if (row.config.auth === 'accessKeys') {
        const k = JSON.parse(secret) as {
          accessKeyId: string;
          secretAccessKey: string;
          sessionToken?: string;
        };
        return bedrockProvider(region, { credentials: k }, fetchImpl);
      }
      return bedrockProvider(region, { apiKey: secret }, fetchImpl);
    }
  }
}

/** The model a connection uses for a purpose: its own setting, else the provider's suggestion. */
export function modelFor(row: ConnectionRow, purpose: Purpose): string {
  const s = PROVIDER_INFO[row.provider].suggested;
  if (purpose === 'reading') return row.reading_model || s.reading || row.default_model;
  if (purpose === 'audio') return row.audio_model || s.audio;
  return row.default_model;
}

const openSecret = (sealed: string, what: string): string => {
  try {
    return open(sealed);
  } catch (e) {
    if (e instanceof SecretKeyMissing) throw new ProviderError(e.message);
    throw new ProviderError(what + ' cannot be read; enter it again');
  }
};

/** A connection as a provider for a purpose, with a project's own key when the project has one. */
export async function connectionProvider(
  c: PoolClient,
  connectionId: string,
  purpose: Purpose,
  o: { projectId?: string | null; fetchImpl?: typeof fetch; model?: string } = {},
): Promise<ModelProvider & { row: ConnectionRow }> {
  const { row, secret, projectId } = await openConnection(c, connectionId, o.projectId);
  const inner = buildProvider(row, secret, o.fetchImpl);
  const model = o.model || modelFor(row, purpose);
  return {
    ...inner,
    complete: inner.complete.bind(inner),
    ...(model ? { model } : {}),
    connectionId: row.id,
    ...(projectId ? { projectId } : {}),
    row,
  };
}

/** [PCODE-241 | S15 | v0.1.0] A connection with its key opened: the project's own key when it has one. */
export async function openConnection(
  c: PoolClient,
  connectionId: string,
  forProject?: string | null,
): Promise<{ row: ConnectionRow; secret: string | null; projectId?: string }> {
  const row = (await c.query<ConnectionRow>(CONNECTION_SELECT + ' WHERE id = $1', [connectionId]))
    .rows[0];
  if (!row)
    throw new ProviderError('The AI connection no longer exists; choose another in Settings');
  if (forProject && row.provider !== 'demo') {
    const own = (
      await c.query<{ key_ciphertext: string }>(
        'SELECT key_ciphertext FROM project_provider_keys WHERE project_id = $1 AND provider = $2',
        [forProject, row.provider],
      )
    ).rows[0];
    if (own)
      return {
        row,
        secret: openSecret(own.key_ciphertext, "The project's provider key"),
        projectId: forProject,
      };
  }
  return {
    row,
    secret: row.key_ciphertext ? openSecret(row.key_ciphertext, 'The key of ' + row.label) : null,
  };
}

/** Tries the first provider; when it fails, the second answers and the reply says so. */
export function withFallback(primary: ModelProvider, fallback: ModelProvider): ModelProvider {
  return {
    ...primary,
    async complete(req) {
      try {
        return await primary.complete(req);
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e;
        const model = fallback.model ?? req.model;
        const reply = await fallback.complete({ ...req, model });
        return {
          ...reply,
          by: answererOf(fallback, model),
          failed: { by: answererOf(primary, req.model), error: e.message },
        };
      }
    },
  };
}

export const answererOf = (p: ModelProvider, model: string): Answerer => ({
  provider: p.name,
  model,
  ...(p.connectionId ? { connectionId: p.connectionId } : {}),
  ...(p.projectId ? { projectId: p.projectId } : {}),
});

// [PCODE-332 | S15 | v0.1.0] a connection's own limits, none for a project key or the demo
export async function limitsOf(
  c: PoolClient,
  connectionId: string | undefined,
): Promise<ConnectionLimits> {
  if (!connectionId) return { requestsPerMinute: null, tokensPerMinute: null };
  const r = (
    await c.query<{ rpm: number | null; tpm: number | null }>(
      'SELECT requests_per_minute AS rpm, tokens_per_minute AS tpm FROM ai_connections WHERE id = $1',
      [connectionId],
    )
  ).rows[0];
  return { requestsPerMinute: r?.rpm ?? null, tokensPerMinute: r?.tpm ?? null };
}

/** Who answered a reply from this provider. */
export const answeredBy = (p: ModelProvider, model: string, reply: ModelReply): Answerer =>
  reply.by ?? answererOf(p, model);

/** Keeps a connection's (or a project key's) last use and last error. Never fails the caller. */
export async function noteProviderUse(
  pool: Pool,
  workspaceId: string,
  by: Answerer,
  error = '',
  ms: number | null = null,
): Promise<void> {
  if (!by.connectionId && !by.projectId) return;
  await inWorkspace(pool, workspaceId, async (c) => {
    // [PCODE-332 | S15 | v0.1.0] every call counts toward the connection's health of the day
    if (by.connectionId)
      await c.query(
        `INSERT INTO ai_connection_health (workspace_id, connection_id, day, calls, failures, total_ms, max_ms)
         VALUES ($1, $2, current_date, 1, $3::int, $4::int, $4::int)
         ON CONFLICT (connection_id, day) DO UPDATE SET calls = ai_connection_health.calls + 1,
           failures = ai_connection_health.failures + $3::int, total_ms = ai_connection_health.total_ms + $4::int,
           max_ms = greatest(ai_connection_health.max_ms, $4::int)`,
        [workspaceId, by.connectionId, error ? 1 : 0, Math.max(0, Math.round(ms ?? 0))],
      );
    if (by.projectId)
      await c.query(
        error
          ? 'UPDATE project_provider_keys SET last_error = left($3, 500) WHERE project_id = $1 AND provider = $2'
          : "UPDATE project_provider_keys SET last_used_at = now(), last_error = '' WHERE project_id = $1 AND provider = $2",
        error ? [by.projectId, by.provider, error] : [by.projectId, by.provider],
      );
    else
      await c.query(
        error
          ? 'UPDATE ai_connections SET last_error = left($2, 500), last_error_at = now() WHERE id = $1'
          : "UPDATE ai_connections SET last_used_at = now(), last_error = '' WHERE id = $1",
        error ? [by.connectionId, error] : [by.connectionId],
      );
  }).catch(() => undefined);
}

/** After a call: the answer's connection is fine, the one that failed before it is not. */
export async function noteReply(
  pool: Pool,
  workspaceId: string,
  p: ModelProvider,
  model: string,
  reply: ModelReply,
  ms: number | null = null, // [PCODE-332 | S15 | v0.1.0]
): Promise<Answerer> {
  const by = answeredBy(p, model, reply);
  await noteProviderUse(pool, workspaceId, by, '', ms);
  if (reply.failed) await noteProviderUse(pool, workspaceId, reply.failed.by, reply.failed.error);
  return by;
}

export interface AgentChoice {
  /** the agent's own connection, if it has one */
  connectionId: string | null;
  model: string;
}

interface Settings {
  provider: string;
  key_ciphertext: string | null;
  agent_connection_id: string | null;
  fallback_connection_id: string | null;
}

/**
 * The provider an agent uses: its own connection with its own model, or the workspace's connection for
 * agents with that connection's model (the agent's model when the connection names none), and the
 * fallback connection behind it. Without any connection: the demo model when ORQIVA_AGENT_DEMO=1.
 */
export function providerResolver(fetchImpl: typeof fetch = fetch) {
  return async (
    c: PoolClient,
    workspaceId: string,
    projectId?: string,
    agent?: AgentChoice,
  ): Promise<ModelProvider> => {
    const s = (
      await c.query<Settings>(
        'SELECT provider, key_ciphertext, agent_connection_id, fallback_connection_id FROM agent_provider_settings WHERE workspace_id = $1',
        [workspaceId],
      )
    ).rows[0];
    const own = agent?.connectionId ?? null;
    const id = own ?? s?.agent_connection_id ?? null;
    if (!id) {
      if (process.env['ORQIVA_AGENT_DEMO'] === '1') return demoProvider();
      throw new ProviderError(
        'No model provider is set up. An admin adds a connection (or picks the demo model) in Settings, AI providers.',
      );
    }
    const primary = await connectionProvider(c, id, 'agent', {
      fetchImpl,
      ...(projectId ? { projectId } : {}),
      ...(own && agent?.model ? { model: agent.model } : {}),
    });
    // the workspace connection names no model: the agent's own
    if (!primary.model && agent?.model) primary.model = agent.model;
    const fid = s?.fallback_connection_id;
    if (!fid || fid === id) return primary;
    const fallback = await connectionProvider(c, fid, 'agent', {
      fetchImpl,
      ...(projectId ? { projectId } : {}),
    }).catch(() => null);
    if (!fallback) return primary;
    const fm =
      fallback.model ?? (PROVIDER_INFO[fallback.row.provider].suggested.model || primary.model);
    if (fm) fallback.model = fm;
    return withFallback(primary, fallback);
  };
}
