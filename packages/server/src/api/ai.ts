// ── [PCODE-332 | S15 | v0.1.0] T33.4a Nested traces with latency and commits, agent rate limits, provider limits and health ──
// ── [PCODE-242 | S15 | v0.1.0] T24.3 AI providers and file reading in the web app ──
// ── [PCODE-241 | S15 | v0.1.0] T24.2 Reading files through the models: PDF, DOCX, images, audio ──
// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
//    Why:  the workspace's AI connections through the API. Admins add a connection per provider with only
//          the fields that provider needs, test it with a short question, and choose which connection
//          serves agents, which takes over when that one fails, which reads documents and images and which
//          writes transcripts. A key is sealed at once and never shown again; only its last four characters
//          are. Azure's endpoint must be an Azure address, so the server never calls an address an admin
//          typed by mistake (or on purpose) into the internal network.
import type { Pool, PoolClient } from 'pg';
import {
  CONNECTION_SELECT,
  connectionProvider,
  modelFor,
  noteProviderUse,
  PROVIDER_INFO,
  PROVIDER_KINDS,
  type ConnectionConfig,
  type ConnectionRow,
  type ProviderKind,
} from '../agents/connections.js';
import { ProviderError, textOfReply } from '../agents/provider.js';
import { SecretKeyMissing, seal } from '../agents/secrets.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, type Access } from './access.js';
import { requeueSkipped } from '../files/reading.js'; // [PCODE-241 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const ws = s.object({ workspaceId: uuid });
const one = s.object({ workspaceId: uuid, connectionId: uuid });

/** Azure OpenAI and Azure AI Foundry resources; nothing else is called as an Azure endpoint. */
export const AZURE_HOST =
  /^[a-z0-9][a-z0-9-]{0,62}\.(openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)$/;
const REGION = /^[a-z]{2}(-gov|-iso[a-z]*)?-[a-z]+-\d$/;

const connectionOut = s.object({
  id: s.string(),
  provider: s.string(),
  label: s.string(),
  endpoint: s.nullable(s.string()),
  region: s.nullable(s.string()),
  auth: s.nullable(s.string()),
  hasKey: s.boolean(),
  hint: s.string(),
  defaultModel: s.string(),
  readingModel: s.string(),
  audioModel: s.string(),
  /** the models actually used for each purpose, after the provider's suggestions */
  models: s.object({ agent: s.string(), reading: s.string(), audio: s.string() }),
  reads: s.object({ images: s.boolean(), pdf: s.boolean(), audio: s.boolean() }),
  uses: s.array(s.string()),
  agents: s.number({ integer: true }),
  lastUsedAt: s.nullable(s.string()),
  lastError: s.string(),
  createdAt: s.string(),
  // [PCODE-332 | S15 | v0.1.0] its limits, and its health over today and yesterday
  requestsPerMinute: s.nullable(s.number({ integer: true })),
  tokensPerMinute: s.nullable(s.number({ integer: true })),
  health: s.object({
    status: s.enum(['ok', 'degraded', 'down', 'unused']),
    calls: s.number({ integer: true }),
    failures: s.number({ integer: true }),
    avgMs: s.nullable(s.number({ integer: true })),
    maxMs: s.nullable(s.number({ integer: true })),
  }),
});

interface Health {
  calls: number;
  failures: number;
  total: number;
  max: number;
}
/**
 * [PCODE-332 | S15 | v0.1.0] Down when its last call failed, degraded when more than one call in ten
 * failed, unused without calls.
 */
export function healthStatus(
  h: { calls: number; failures: number },
  lastUsedAt: Date | null,
  lastErrorAt: Date | null,
): 'ok' | 'degraded' | 'down' | 'unused' {
  if (lastErrorAt && (!lastUsedAt || lastErrorAt > lastUsedAt)) return 'down';
  if (!h.calls) return 'unused';
  if (h.failures / h.calls > 0.1) return 'degraded';
  return 'ok';
}

const settingsOut = s.object({
  agentConnectionId: s.nullable(s.string()),
  fallbackConnectionId: s.nullable(s.string()),
  readingConnectionId: s.nullable(s.string()),
  audioConnectionId: s.nullable(s.string()),
});

interface SettingsRow {
  agent_connection_id: string | null;
  fallback_connection_id: string | null;
  reading_connection_id: string | null;
  audio_connection_id: string | null;
}

async function settingsOf(c: PoolClient): Promise<SettingsRow> {
  return (
    (
      await c.query<SettingsRow>(
        'SELECT agent_connection_id, fallback_connection_id, reading_connection_id, audio_connection_id FROM agent_provider_settings',
      )
    ).rows[0] ?? {
      agent_connection_id: null,
      fallback_connection_id: null,
      reading_connection_id: null,
      audio_connection_id: null,
    }
  );
}

const settingsJson = (r: SettingsRow) => ({
  agentConnectionId: r.agent_connection_id,
  fallbackConnectionId: r.fallback_connection_id,
  readingConnectionId: r.reading_connection_id,
  audioConnectionId: r.audio_connection_id,
});

async function listConnections(c: PoolClient) {
  const rows = (await c.query<ConnectionRow>(CONNECTION_SELECT + ' ORDER BY created_at')).rows;
  const set = await settingsOf(c);
  const agents = new Map(
    (
      await c.query<{ connection_id: string; n: string }>(
        'SELECT connection_id, count(*) AS n FROM agents WHERE connection_id IS NOT NULL GROUP BY connection_id',
      )
    ).rows.map((r) => [r.connection_id, Number(r.n)]),
  );
  // [PCODE-332 | S15 | v0.1.0] calls of today and yesterday
  const health = new Map(
    (
      await c.query<{
        connection_id: string;
        calls: string;
        failures: string;
        total: string;
        max: string;
      }>(
        `SELECT connection_id, sum(calls) AS calls, sum(failures) AS failures, sum(total_ms) AS total, max(max_ms) AS max
           FROM ai_connection_health WHERE day >= current_date - 1 GROUP BY connection_id`,
      )
    ).rows.map((h) => [
      h.connection_id,
      {
        calls: Number(h.calls),
        failures: Number(h.failures),
        total: Number(h.total),
        max: Number(h.max),
      },
    ]),
  );
  return rows.map((r) => connectionJson(r, set, agents.get(r.id) ?? 0, health.get(r.id)));
}

function connectionJson(r: ConnectionRow, set: SettingsRow, agents: number, h?: Health) {
  const calls = h ?? { calls: 0, failures: 0, total: 0, max: 0 };
  const uses = [
    ...(set.agent_connection_id === r.id ? ['agents'] : []),
    ...(set.fallback_connection_id === r.id ? ['fallback'] : []),
    ...(set.reading_connection_id === r.id ? ['reading'] : []),
    ...(set.audio_connection_id === r.id ? ['audio'] : []),
  ];
  return {
    id: r.id,
    provider: r.provider,
    label: r.label,
    endpoint: r.config.endpoint ?? null,
    region: r.config.region ?? null,
    auth: r.config.auth ?? null,
    hasKey: Boolean(r.key_ciphertext),
    hint: r.key_hint,
    defaultModel: r.default_model,
    readingModel: r.reading_model,
    audioModel: r.audio_model,
    models: {
      agent: modelFor(r, 'agent'),
      reading: modelFor(r, 'reading'),
      audio: PROVIDER_INFO[r.provider].reads.audio ? modelFor(r, 'audio') : '',
    },
    reads: PROVIDER_INFO[r.provider].reads,
    uses,
    agents,
    lastUsedAt: r.last_used_at?.toISOString() ?? null,
    lastError: r.last_error,
    createdAt: r.created_at.toISOString(),
    requestsPerMinute: r.requests_per_minute,
    tokensPerMinute: r.tokens_per_minute,
    health: {
      status: healthStatus(calls, r.last_used_at, r.last_error_at),
      calls: calls.calls,
      failures: calls.failures,
      avgMs: calls.calls ? Math.round(calls.total / calls.calls) : null,
      maxMs: calls.calls ? calls.max : null,
    },
  };
}

const bad = (path: string, message: string, text: string): HttpError =>
  new HttpError(400, 'invalid_request', text, [{ path: 'body.' + path, message }]);

interface ConnectionInput {
  label?: string;
  key?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  endpoint?: string;
  region?: string;
  auth?: 'apiKey' | 'accessKeys';
  defaultModel?: string;
  readingModel?: string;
  audioModel?: string;
}

/** The config and, when a key is given, the sealed secret and its hint. Throws on fields that do not fit. */
function checkInput(
  provider: ProviderKind,
  b: ConnectionInput,
  current: ConnectionConfig | null,
): { config: ConnectionConfig; sealed?: string; hint?: string } {
  const config: ConnectionConfig = { ...(current ?? {}) };
  if (provider === 'azure') {
    const raw = (b.endpoint ?? config.endpoint ?? '').trim();
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw bad('endpoint', 'is not an address', 'Azure needs the endpoint of the resource');
    }
    if (url.protocol !== 'https:' || !AZURE_HOST.test(url.hostname))
      throw bad(
        'endpoint',
        'is not an Azure OpenAI address',
        'The endpoint is the https address of an Azure OpenAI resource, e.g. https://name.openai.azure.com',
      );
    config.endpoint = 'https://' + url.hostname;
  }
  if (provider === 'bedrock') {
    const region = (b.region ?? config.region ?? '').trim();
    if (!REGION.test(region))
      throw bad('region', 'is not an AWS region', 'Bedrock needs a region such as us-east-1');
    config.region = region;
    config.auth = b.auth ?? config.auth ?? 'apiKey';
  }
  let plain: string | undefined;
  let hint: string | undefined;
  if (provider === 'bedrock' && config.auth === 'accessKeys') {
    if (b.accessKeyId !== undefined || b.secretAccessKey !== undefined) {
      const id = (b.accessKeyId ?? '').trim();
      const secret = (b.secretAccessKey ?? '').trim();
      if (!/^(AKIA|ASIA)[A-Z0-9]{12,}$/.test(id))
        throw bad(
          'accessKeyId',
          'is not an access key ID',
          'An AWS access key ID starts with AKIA or ASIA',
        );
      if (secret.length < 30)
        throw bad('secretAccessKey', 'is too short', 'The secret access key has 40 characters');
      plain = JSON.stringify({
        accessKeyId: id,
        secretAccessKey: secret,
        ...(b.sessionToken?.trim() ? { sessionToken: b.sessionToken.trim() } : {}),
      });
      hint = id.slice(-4);
    }
  } else if (b.key !== undefined && provider !== 'demo') {
    plain = b.key.trim();
    const info = PROVIDER_INFO[provider];
    if (plain.length < 16 || (info.keyPattern && !info.keyPattern.test(plain)))
      throw bad('key', 'does not look like a key of ' + info.label, info.keyHelp);
    hint = plain.slice(-4);
  }
  if (plain === undefined) return { config };
  try {
    return { config, sealed: seal(plain), ...(hint ? { hint } : {}) };
  } catch (e) {
    if (e instanceof SecretKeyMissing) throw new HttpError(409, 'conflict', e.message);
    throw e;
  }
}

const model = s.optional(s.string({ max: 120, pattern: /^[A-Za-z0-9._:/@-]*$/ }));
const inputFields = {
  label: s.optional(s.string({ min: 1, max: 80 })),
  key: s.optional(s.string({ max: 4000 })),
  accessKeyId: s.optional(s.string({ max: 128 })),
  secretAccessKey: s.optional(s.string({ max: 128 })),
  sessionToken: s.optional(s.string({ max: 4000 })),
  endpoint: s.optional(s.string({ max: 300 })),
  region: s.optional(s.string({ max: 40 })),
  auth: s.optional(s.enum(['apiKey', 'accessKeys'])),
  defaultModel: model,
  readingModel: model,
  audioModel: model,
  // [PCODE-332 | S15 | v0.1.0] null takes a limit away
  requestsPerMinute: s.optional(s.nullable(s.number({ integer: true, min: 1, max: 100_000 }))),
  tokensPerMinute: s.optional(s.nullable(s.number({ integer: true, min: 100, max: 100_000_000 }))),
};

async function event(c: PoolClient, a: Access, label: string, to: unknown, from: unknown = null) {
  await recordEvent(c, a.workspaceId, {
    actor: actorOf(a),
    verb: 'updated',
    object: { type: 'workspace', id: a.workspaceId, label: 'AI settings' },
    changes: { [label]: { from, to } },
  });
}

export function aiRoutes(pool: Pool, fetchImpl: typeof fetch = fetch): Route[] {
  const providers = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/ai/providers',
    summary: 'The AI providers a connection can use: what each reads and the models it starts with',
    tags: ['ai'],
    params: ws,
    response: s.array(
      s.object({
        provider: s.string(),
        label: s.string(),
        reads: s.object({ images: s.boolean(), pdf: s.boolean(), audio: s.boolean() }),
        suggested: s.object({ model: s.string(), reading: s.string(), audio: s.string() }),
        keyHelp: s.string(),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', () =>
        Promise.resolve({
          body: PROVIDER_KINDS.map((p) => ({
            provider: p,
            label: PROVIDER_INFO[p].label,
            reads: PROVIDER_INFO[p].reads,
            suggested: PROVIDER_INFO[p].suggested,
            keyHelp: PROVIDER_INFO[p].keyHelp,
          })),
        }),
      ),
  });

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/ai/connections',
    summary: 'The workspace’s AI connections and what each is used for; never the keys (admin)',
    tags: ['ai'],
    params: ws,
    response: s.object({ connections: s.array(connectionOut), settings: settingsOut }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({
        body: {
          connections: await listConnections(c),
          settings: settingsJson(await settingsOf(c)),
        },
      })),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/ai/connections',
    summary:
      'Add an AI connection: the provider, its key (sealed at once) and what else it needs (admin)',
    tags: ['ai'],
    params: ws,
    body: s.object({ provider: s.enum([...PROVIDER_KINDS]), ...inputFields }),
    response: connectionOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const provider = body.provider;
        const checked = checkInput(provider, body, null);
        if (provider !== 'demo' && !checked.sealed)
          throw bad(
            provider === 'bedrock' && checked.config.auth === 'accessKeys' ? 'accessKeyId' : 'key',
            'is missing',
            PROVIDER_INFO[provider].keyHelp,
          );
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO ai_connections (workspace_id, provider, label, config, key_ciphertext, key_hint, default_model, reading_model, audio_model, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [
              a.workspaceId,
              provider,
              (body.label ?? PROVIDER_INFO[provider].label).trim(),
              JSON.stringify(checked.config),
              checked.sealed ?? null,
              checked.hint ?? '',
              (body.defaultModel ?? PROVIDER_INFO[provider].suggested.model).trim(),
              (body.readingModel ?? '').trim(),
              (body.audioModel ?? '').trim(),
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('connection insert returned nothing');
        // [PCODE-332 | S15 | v0.1.0] its limits from the start
        if (body.requestsPerMinute != null || body.tokensPerMinute != null)
          await c.query(
            'UPDATE ai_connections SET requests_per_minute = $2, tokens_per_minute = $3 WHERE id = $1',
            [id, body.requestsPerMinute ?? null, body.tokensPerMinute ?? null],
          );
        // the first connection serves agents at once
        await c.query(
          `INSERT INTO agent_provider_settings (workspace_id, agent_connection_id) VALUES ($1, $2)
           ON CONFLICT (workspace_id) DO UPDATE SET agent_connection_id = coalesce(agent_provider_settings.agent_connection_id, $2)`,
          [a.workspaceId, id],
        );
        await event(c, a, 'connections', PROVIDER_INFO[provider].label + ' added');
        const row = (await listConnections(c)).find((r) => r.id === id);
        if (!row) throw new Error('connection vanished');
        return { status: 201, body: row };
      }),
  });

  const update = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/ai/connections/:connectionId',
    summary: 'Change a connection: its name, key, models, endpoint or region (admin)',
    tags: ['ai'],
    params: one,
    body: s.object(inputFields),
    response: connectionOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const cur = (
          await c.query<ConnectionRow>(CONNECTION_SELECT + ' WHERE id = $1', [params.connectionId])
        ).rows[0];
        if (!cur) throw new HttpError(404, 'not_found', 'Connection not found');
        const checked = checkInput(cur.provider, body, cur.config);
        await c.query(
          `UPDATE ai_connections SET label = coalesce($2, label), config = $3,
             key_ciphertext = CASE WHEN $4::text IS NULL THEN key_ciphertext ELSE $4 END,
             key_hint = coalesce($5, key_hint), default_model = coalesce($6, default_model),
             reading_model = coalesce($7, reading_model), audio_model = coalesce($8, audio_model),
             last_error = CASE WHEN $4::text IS NULL THEN last_error ELSE '' END, updated_at = now()
           WHERE id = $1`,
          [
            cur.id,
            body.label?.trim() ?? null,
            JSON.stringify(checked.config),
            checked.sealed ?? null,
            checked.hint ?? null,
            body.defaultModel?.trim() ?? null,
            body.readingModel?.trim() ?? null,
            body.audioModel?.trim() ?? null,
          ],
        );
        // [PCODE-332 | S15 | v0.1.0] its limits
        if (body.requestsPerMinute !== undefined || body.tokensPerMinute !== undefined)
          await c.query(
            `UPDATE ai_connections SET
               requests_per_minute = CASE WHEN $2 THEN requests_per_minute ELSE $3::int END,
               tokens_per_minute = CASE WHEN $4 THEN tokens_per_minute ELSE $5::int END
             WHERE id = $1`,
            [
              cur.id,
              body.requestsPerMinute === undefined,
              body.requestsPerMinute ?? null,
              body.tokensPerMinute === undefined,
              body.tokensPerMinute ?? null,
            ],
          );
        if (checked.sealed)
          await event(c, a, 'connectionKey', cur.label + ' …' + (checked.hint ?? ''));
        const row = (await listConnections(c)).find((r) => r.id === cur.id);
        if (!row) throw new Error('connection vanished');
        return { body: row };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/ai/connections/:connectionId',
    summary:
      'Remove a connection and its key; agents with it follow the workspace’s connection again (admin)',
    tags: ['ai'],
    params: one,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const r = (
          await c.query<{ label: string }>(
            'DELETE FROM ai_connections WHERE id = $1 RETURNING label',
            [params.connectionId],
          )
        ).rows[0];
        if (r) await event(c, a, 'connections', r.label + ' removed');
        return { body: { removed: Boolean(r) } };
      }),
  });

  const test = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/ai/connections/:connectionId/test',
    summary:
      'Ask the connection’s model a one-word question, to see that the key, address and model work (admin)',
    tags: ['ai'],
    params: one,
    body: s.object({ purpose: s.optional(s.enum(['agent', 'reading'])) }),
    response: s.object({
      ok: s.boolean(),
      provider: s.string(),
      model: s.string(),
      answer: s.string(),
      ms: s.number({ integer: true }),
      error: s.string(),
    }),
    handler: async ({ params, body, req }) => {
      const purpose = body.purpose ?? 'agent';
      const p = await asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        try {
          return await connectionProvider(c, params.connectionId, purpose, { fetchImpl });
        } catch (e) {
          if (e instanceof ProviderError) throw new HttpError(409, 'conflict', e.message);
          throw e;
        }
      });
      const m = p.model ?? '';
      if (!m && p.name !== 'demo')
        throw new HttpError(
          409,
          'conflict',
          'Name the model this connection uses first' +
            (p.name === 'azure' ? ' (the deployment’s name)' : ''),
        );
      const started = Date.now();
      try {
        const reply = await p.complete({
          model: m,
          system: '',
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'Answer with the word OK.' }] },
          ],
          tools: [],
          maxTokens: 256,
        });
        await noteProviderUse(pool, params.workspaceId, {
          provider: p.name,
          model: m,
          connectionId: params.connectionId,
        });
        return {
          body: {
            ok: true,
            provider: p.name,
            model: m,
            answer: textOfReply(reply).slice(0, 200),
            ms: Date.now() - started,
            error: '',
          },
        };
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e;
        await noteProviderUse(
          pool,
          params.workspaceId,
          { provider: p.name, model: m, connectionId: params.connectionId },
          e.message,
        );
        return {
          body: {
            ok: false,
            provider: p.name,
            model: m,
            answer: '',
            ms: Date.now() - started,
            error: e.message,
          },
        };
      }
    },
  });

  const getSettings = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/ai/settings',
    summary:
      'Which connection serves agents, takes over, reads files and writes transcripts (member)',
    tags: ['ai'],
    params: ws,
    response: settingsOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => ({
        body: settingsJson(await settingsOf(c)),
      })),
  });

  const nullableId = s.optional(s.nullable(uuid));
  const putSettings = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/ai/settings',
    summary:
      'Choose the connections for agents, the fallback, reading files and transcripts; null clears one (admin)',
    tags: ['ai'],
    params: ws,
    body: s.object({
      agentConnectionId: nullableId,
      fallbackConnectionId: nullableId,
      readingConnectionId: nullableId,
      audioConnectionId: nullableId,
    }),
    response: settingsOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const rows = (await c.query<ConnectionRow>(CONNECTION_SELECT)).rows;
        const byId = new Map(rows.map((r) => [r.id, r]));
        const pick = (field: keyof typeof body, need?: 'images' | 'audio') => {
          const v = body[field];
          if (v === undefined || v === null) return v;
          const row = byId.get(v);
          if (!row)
            throw bad(
              field,
              'is not a connection of this workspace',
              'There is no such connection',
            );
          if (need && !PROVIDER_INFO[row.provider].reads[need])
            throw bad(
              field,
              'cannot do this',
              PROVIDER_INFO[row.provider].label +
                (need === 'audio' ? ' does not write transcripts' : ' does not read files'),
            );
          return v;
        };
        const values = [
          pick('agentConnectionId'),
          pick('fallbackConnectionId'),
          pick('readingConnectionId', 'images'),
          pick('audioConnectionId', 'audio'),
        ];
        const before = await settingsOf(c);
        await c.query(
          `INSERT INTO agent_provider_settings (workspace_id) VALUES ($1) ON CONFLICT (workspace_id) DO NOTHING`,
          [a.workspaceId],
        );
        await c.query(
          `UPDATE agent_provider_settings SET
             agent_connection_id = CASE WHEN $2 THEN agent_connection_id ELSE $3::uuid END,
             fallback_connection_id = CASE WHEN $4 THEN fallback_connection_id ELSE $5::uuid END,
             reading_connection_id = CASE WHEN $6 THEN reading_connection_id ELSE $7::uuid END,
             audio_connection_id = CASE WHEN $8 THEN audio_connection_id ELSE $9::uuid END,
             updated_at = now()
           WHERE workspace_id = $1`,
          [a.workspaceId, ...values.flatMap((v) => [v === undefined, v ?? null])],
        );
        const after = await settingsOf(c);
        // [PCODE-241 | S15 | v0.1.0] files that waited for a reading or audio connection are read now
        if (
          after.reading_connection_id &&
          after.reading_connection_id !== before.reading_connection_id
        )
          await requeueSkipped(c, ['pdf', 'image']);
        if (after.audio_connection_id && after.audio_connection_id !== before.audio_connection_id)
          await requeueSkipped(c, ['audio']);
        const name = (id: string | null) => (id ? (byId.get(id)?.label ?? id) : null);
        for (const [k, from, to] of [
          // [PCODE-242 | S15 | v0.1.0] field names that read well in the activity feed
          ['connectionForAgents', before.agent_connection_id, after.agent_connection_id],
          ['fallbackConnection', before.fallback_connection_id, after.fallback_connection_id],
          ['readingConnection', before.reading_connection_id, after.reading_connection_id],
          ['transcriptConnection', before.audio_connection_id, after.audio_connection_id],
        ] as const)
          if (from !== to) await event(c, a, k, name(to), name(from));
        return { body: settingsJson(after) };
      }),
  });

  return [providers, list, create, update, remove, test, getSettings, putSettings];
}
