// ── [PCODE-241 | S15 | v0.1.0] T24.2 Reading files through the models: PDF, DOCX, images, audio ──
//    Why:  every upload that is not plain text gets its text in the background, so ideation intake,
//          documents, test evidence and client requests can use what a PDF, a Word file, a screenshot or a
//          recording says. Word files are read on the server; PDFs and pictures by the workspace's reading
//          connection; recordings by its audio connection. The read is governed like any agent work: the
//          Reader agent must be on, within its budget and not paused, and each model call is kept as a
//          Reader run with its tokens and cost. A passing failure (no network, a rate limit) is tried again
//          after 1, 5 and 30 minutes; anything else says why. Nothing here ever blocks an upload.
import type { Pool, PoolClient } from 'pg';
import {
  noteProviderUse,
  noteReply,
  openConnection,
  connectionProvider,
  modelFor,
  PROVIDER_INFO,
  type ProviderKind,
} from '../agents/connections.js';
import { ProviderError, textOfReply, type Block } from '../agents/provider.js';
import { buildTranscriber } from '../agents/transcribe.js';
import { ensureAgents } from '../api/agents.js';
import { inSystem, inWorkspace } from '../db/pool.js';
import { priceOf } from '../lib/money.js';
import type { BlobStore } from './blobstore.js';
import { docxText, DocxError } from './docx.js';

export type ReadMethod = 'docx' | 'pdf' | 'image' | 'audio';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|oga|opus|webm|flac|aac|mp4|mpeg|mpga)$/i;

/** How a file is read, or null when it has text already or cannot be read. */
export function readMethodOf(name: string, mime: string): ReadMethod | null {
  if (mime === DOCX_MIME || /\.docx$/i.test(name)) return 'docx';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (IMAGES.has(mime)) return 'image';
  if (mime.startsWith('audio/') || mime === 'video/mp4' || mime === 'video/webm') return 'audio';
  if (mime === 'application/octet-stream' && AUDIO_EXT.test(name)) return 'audio';
  return null;
}

const MB = 1024 * 1024;
/** What each provider takes in one request, in bytes of the file (base64 makes it a third larger). */
export const READ_LIMITS: Record<ProviderKind, { image: number; pdf: number; audio: number }> = {
  anthropic: { image: 5 * MB, pdf: 25 * MB, audio: 0 },
  openai: { image: 20 * MB, pdf: 25 * MB, audio: 25 * MB },
  azure: { image: 20 * MB, pdf: 25 * MB, audio: 25 * MB },
  gemini: { image: 14 * MB, pdf: 14 * MB, audio: 14 * MB },
  bedrock: { image: 3.75 * MB, pdf: 4.5 * MB, audio: 0 },
  xai: { image: 10 * MB, pdf: 0, audio: 25 * MB },
  demo: { image: 0, pdf: 0, audio: 0 },
};

export const READ_PROMPTS: Record<'pdf' | 'image', string> = {
  pdf:
    'Write out the full text of this document in reading order. Keep headings, lists and tables ' +
    '(tables as plain text with columns separated by " | "). Write nothing else.',
  image:
    'Write out all text in this picture exactly, line by line. Then write a line with three dashes ' +
    'and, after it, one to three sentences on what the picture shows.',
};

const TEXT_KIND: Record<ReadMethod, 'extracted' | 'ocr' | 'transcript'> = {
  docx: 'extracted',
  pdf: 'extracted',
  image: 'ocr',
  audio: 'transcript',
};
const MAX_TEXT = 200_000;
const BACKOFF_MINUTES = [1, 5, 30];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;
export const READ_CHANNEL = 'orqiva_reads';

interface Settings {
  reading_connection_id: string | null;
  audio_connection_id: string | null;
}

/** Why a file of this kind cannot be read in this workspace now, or null. */
async function blockedBy(c: PoolClient, method: ReadMethod): Promise<string | null> {
  if (method === 'docx') return null;
  const s = (
    await c.query<Settings>(
      'SELECT reading_connection_id, audio_connection_id FROM agent_provider_settings',
    )
  ).rows[0];
  if (method === 'audio')
    return s?.audio_connection_id
      ? null
      : 'No connection writes transcripts; an admin chooses one in Settings, AI providers';
  return s?.reading_connection_id
    ? null
    : 'No connection reads files; an admin chooses one in Settings, AI providers';
}

/**
 * Queues the read of a new file (in the upload's transaction), or records why it waits. Files with text
 * already, and kinds nobody reads, are left alone.
 */
export async function queueRead(
  c: PoolClient,
  file: { id: string; workspaceId: string; name: string; mime: string; userId: string | null },
): Promise<ReadMethod | null> {
  const method = readMethodOf(file.name, file.mime);
  if (!method) return null;
  const why = await blockedBy(c, method);
  await c.query(
    `INSERT INTO file_reads (workspace_id, file_id, method, status, error, requested_by) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (file_id) DO UPDATE SET status = $4, error = $5, attempts = 0, next_at = now(), requested_by = $6, finished_at = NULL`,
    [file.workspaceId, file.id, method, why ? 'skipped' : 'queued', why ?? '', file.userId],
  );
  if (!why) await c.query("SELECT pg_notify('" + READ_CHANNEL + "', '')");
  return method;
}

/** After an admin chose a reading or audio connection: the files that waited for one are read now. */
export async function requeueSkipped(c: PoolClient, methods: ReadMethod[]): Promise<number> {
  const r = await c.query(
    `UPDATE file_reads SET status = 'queued', error = '', attempts = 0, next_at = now()
      WHERE status = 'skipped' AND method = ANY($1::text[])`,
    [methods],
  );
  if (r.rowCount) await c.query("SELECT pg_notify('" + READ_CHANNEL + "', '')");
  return r.rowCount ?? 0;
}

interface ReadRow {
  workspace_id: string;
  file_id: string;
  method: ReadMethod;
  attempts: number;
  requested_by: string | null;
}
interface FileRow {
  name: string;
  mime: string;
  storage_key: string;
  project_id: string | null;
  uploaded_by: string | null;
  deleted_at: Date | null;
}

/** The outcome of one read: the text, or a reason, and what the model call cost. */
interface Outcome {
  text: string;
  provider: string;
  model: string;
  seconds: number | null;
}

class Skip extends Error {}

export interface FileReaderOptions {
  pool: Pool;
  store: BlobStore;
  fetchImpl?: typeof fetch;
  pollMs?: number;
  log?: (msg: string, data: Record<string, unknown>) => void;
}

export class FileReader {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<unknown> = Promise.resolve();
  private listener: PoolClient | null = null;

  constructor(private readonly opts: FileReaderOptions) {}

  async start(): Promise<void> {
    this.listener = await this.opts.pool.connect();
    this.listener.on('notification', () => {
      void this.kick();
    });
    await this.listener.query('LISTEN ' + READ_CHANNEL);
    this.timer = setInterval(() => {
      void this.kick();
    }, this.opts.pollMs ?? 30_000);
    this.timer.unref();
    void this.kick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const l = this.listener;
    this.listener = null;
    if (l) {
      await l.query('UNLISTEN *').catch(() => undefined);
      l.release();
    }
    await this.running;
  }

  /** One round after the one running now. */
  kick(): Promise<unknown> {
    this.running = this.running
      .then(() => this.round())
      .catch((err: unknown) => {
        this.opts.log?.('read round failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return this.running;
  }

  /** Reads what is due, one file after the other; returns how many were taken. */
  async round(): Promise<number> {
    let n = 0;
    for (;;) {
      const next = await this.claim();
      if (!next) return n;
      n += 1;
      await this.readOne(next);
    }
  }

  private claim(): Promise<ReadRow | undefined> {
    return inSystem(
      this.opts.pool,
      async (c) =>
        (
          await c.query<ReadRow>(
            `UPDATE file_reads SET status = 'reading', attempts = attempts + 1
              WHERE file_id = (SELECT file_id FROM file_reads WHERE status = 'queued' AND next_at <= now()
                                ORDER BY next_at LIMIT 1 FOR UPDATE SKIP LOCKED)
              RETURNING workspace_id, file_id, method, attempts, requested_by`,
          )
        ).rows[0],
    );
  }

  private async readOne(r: ReadRow): Promise<void> {
    const { pool } = this.opts;
    const file = await inSystem(
      pool,
      async (c) =>
        (
          await c.query<FileRow>(
            'SELECT name, mime, storage_key, project_id, uploaded_by, deleted_at FROM files WHERE id = $1',
            [r.file_id],
          )
        ).rows[0],
    );
    try {
      if (!file || file.deleted_at) throw new Skip('The file was deleted');
      const data = await this.opts.store.get(file.storage_key).catch(() => {
        throw new Skip('The file’s bytes are missing from the store');
      });
      const out =
        r.method === 'docx'
          ? { text: docxText(data), provider: '', model: '', seconds: null }
          : await this.withModel(r, file, data);
      await inSystem(pool, async (c) => {
        await c.query('UPDATE files SET text_content = $2, text_kind = $3 WHERE id = $1', [
          r.file_id,
          out.text.replace(/\u0000/g, '').slice(0, MAX_TEXT),
          TEXT_KIND[r.method],
        ]);
        await c.query(
          `UPDATE file_reads SET status = 'done', error = '', provider = $2, model = $3, seconds = $4, finished_at = now()
            WHERE file_id = $1`,
          [r.file_id, out.provider, out.model, out.seconds],
        );
      });
    } catch (e) {
      const retry =
        e instanceof ProviderError && e.retryable && r.attempts < MAX_ATTEMPTS
          ? BACKOFF_MINUTES[r.attempts - 1]
          : undefined;
      const message =
        e instanceof Skip || e instanceof ProviderError || e instanceof DocxError
          ? e.message
          : 'Reading failed: ' + (e instanceof Error ? e.message : String(e));
      await inSystem(pool, (c) =>
        c.query(
          `UPDATE file_reads SET status = $2, error = left($3, 500),
             next_at = CASE WHEN $4::int IS NULL THEN next_at ELSE now() + make_interval(mins => $4::int) END,
             finished_at = CASE WHEN $4::int IS NULL THEN now() END
           WHERE file_id = $1`,
          [
            r.file_id,
            retry !== undefined ? 'queued' : e instanceof Skip ? 'skipped' : 'failed',
            message,
            retry ?? null,
          ],
        ),
      );
    }
  }

  /** A PDF, a picture or a recording through the workspace's connection, kept as a Reader run. */
  private async withModel(r: ReadRow, file: FileRow, data: Buffer): Promise<Outcome> {
    const { pool } = this.opts;
    const ws = r.workspace_id;
    const method = r.method as 'pdf' | 'image' | 'audio';
    const ready = await inWorkspace(pool, ws, async (c) => {
      await ensureAgents(c, ws);
      const agent = (
        await c.query<{
          id: string;
          name: string;
          enabled: boolean;
          system_prompt: string;
          monthly_token_budget: string;
          used: string;
        }>(
          `SELECT a.id, a.name, a.enabled, a.system_prompt, a.monthly_token_budget,
                  (SELECT coalesce(sum(x.tokens_in + x.tokens_out), 0) FROM agent_runs x
                    WHERE x.agent_id = a.id AND x.created_at >= date_trunc('month', now())) AS used
             FROM agents a WHERE a.key = 'reader'`,
        )
      ).rows[0];
      if (!agent) throw new Skip('This workspace has no Reader agent');
      if (!agent.enabled)
        throw new Skip('The Reader agent is switched off; an admin can switch it on');
      if (Number(agent.used) >= Number(agent.monthly_token_budget))
        throw new Skip("The Reader agent's monthly budget is used up");
      const s = (
        await c.query<Settings & { paused_at: Date | null }>(
          'SELECT reading_connection_id, audio_connection_id, paused_at FROM agent_provider_settings',
        )
      ).rows[0];
      if (s?.paused_at) throw new Skip('All agents are paused; an admin can resume them');
      const id = method === 'audio' ? s?.audio_connection_id : s?.reading_connection_id;
      const why = await blockedBy(c, method);
      if (!id || why) throw new Skip(why ?? 'No connection reads files');
      const opened = await openConnection(c, id, file.project_id);
      const kind = opened.row.provider;
      const can =
        method === 'audio'
          ? PROVIDER_INFO[kind].reads.audio
          : method === 'pdf'
            ? PROVIDER_INFO[kind].reads.pdf
            : PROVIDER_INFO[kind].reads.images;
      if (!can)
        throw new Skip(
          PROVIDER_INFO[kind].label +
            (method === 'audio'
              ? ' does not write transcripts'
              : method === 'pdf'
                ? ' does not read PDF files'
                : ' does not read pictures'),
        );
      const limit = READ_LIMITS[kind][method];
      if (data.length > limit)
        throw new Skip(
          PROVIDER_INFO[kind].label +
            ' reads files up to ' +
            String(Math.round((limit / MB) * 10) / 10) +
            ' MB in one go; this one has ' +
            String(Math.round((data.length / MB) * 10) / 10) +
            ' MB',
        );
      const provider =
        method === 'audio'
          ? null
          : await connectionProvider(c, id, 'reading', {
              projectId: file.project_id,
              ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
            });
      return {
        agent,
        opened,
        provider,
        model: modelFor(opened.row, method === 'audio' ? 'audio' : 'reading'),
      };
    });

    const by = {
      provider: ready.opened.row.provider,
      model: ready.model,
      connectionId: ready.opened.row.id,
      ...(ready.opened.projectId ? { projectId: ready.opened.projectId } : {}),
    };
    if (!ready.model) throw new Skip('The connection names no model to read with');
    const run = {
      workspaceId: ws,
      projectId: file.project_id,
      agentId: ready.agent.id,
      requestedBy: r.requested_by ?? file.uploaded_by,
      instruction: 'Read ' + file.name,
      fileId: r.file_id,
      method,
    };
    try {
      if (method === 'audio') {
        const t = await buildTranscriber(
          ready.opened.row,
          ready.opened.secret,
          this.opts.fetchImpl,
        ).transcribe({ name: file.name, mime: file.mime, data }, ready.model);
        await noteProviderUse(pool, ws, by);
        const p = await inWorkspace(pool, ws, (c) => priceOf(c, ws, by.provider, by.model));
        const tokens = t.usage.input * p.in + t.usage.output * p.out;
        const cost = Math.round(
          tokens > 0 ? tokens / 1_000_000 : ((t.seconds ?? 0) / 60) * p.minute,
        );
        const runId = await recordRead(pool, run, by, t.usage, cost, t.text, '', t.seconds);
        await linkRun(pool, r.file_id, runId);
        return { text: t.text, provider: by.provider, model: by.model, seconds: t.seconds };
      }
      const p = ready.provider;
      if (!p) throw new Error('no provider');
      const block: Block =
        method === 'pdf'
          ? {
              type: 'document',
              mime: 'application/pdf',
              name: file.name,
              data: data.toString('base64'),
            }
          : { type: 'image', mime: file.mime, data: data.toString('base64') };
      const reply = await p.complete({
        model: ready.model,
        system: ready.agent.system_prompt,
        messages: [
          { role: 'user', content: [block, { type: 'text', text: READ_PROMPTS[method] }] },
        ],
        tools: [],
        maxTokens: 16_000,
      });
      const answered = await noteReply(pool, ws, p, ready.model, reply);
      const prices = await inWorkspace(pool, ws, (c) =>
        priceOf(c, ws, answered.provider, answered.model),
      );
      const cost = Math.round(
        (reply.usage.input * prices.in + reply.usage.output * prices.out) / 1_000_000,
      );
      let text = textOfReply(reply);
      if (reply.stopReason === 'max_tokens')
        text += '\n\n[The text goes on; the model stopped at its limit for one answer.]';
      const runId = await recordRead(pool, run, answered, reply.usage, cost, text, '', null);
      await linkRun(pool, r.file_id, runId);
      return { text, provider: answered.provider, model: answered.model, seconds: null };
    } catch (e) {
      if (e instanceof ProviderError) {
        await noteProviderUse(pool, ws, by, e.message);
        const runId = await recordRead(
          pool,
          run,
          by,
          { input: 0, output: 0 },
          0,
          '',
          e.message,
          null,
        );
        await linkRun(pool, r.file_id, runId);
      }
      throw e;
    }
  }
}

async function linkRun(pool: Pool, fileId: string, runId: string): Promise<void> {
  await inSystem(pool, (c) =>
    c.query('UPDATE file_reads SET run_id = $2 WHERE file_id = $1', [fileId, runId]),
  );
}

/** The read as a finished Reader run with its one step, like every one-answer agent call. */
async function recordRead(
  pool: Pool,
  o: {
    workspaceId: string;
    projectId: string | null;
    agentId: string;
    requestedBy: string | null;
    instruction: string;
    fileId: string;
    method: string;
  },
  by: { provider: string; model: string },
  usage: { input: number; output: number },
  cost: number,
  text: string,
  error: string,
  seconds: number | null,
): Promise<string> {
  return inWorkspace(pool, o.workspaceId, async (c) => {
    const id = (
      await c.query<{ id: string }>(
        `INSERT INTO agent_runs (workspace_id, project_id, agent_id, requested_by, instruction, status, model,
                                 tokens_in, tokens_out, cost_micros, error, started_at, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now()) RETURNING id`,
        [
          o.workspaceId,
          o.projectId,
          o.agentId,
          o.requestedBy,
          o.instruction.slice(0, 20_000),
          error ? 'failed' : 'succeeded',
          by.model,
          usage.input,
          usage.output,
          cost,
          error,
        ],
      )
    ).rows[0]?.id;
    if (!id) throw new Error('run insert returned nothing');
    await c.query(
      `INSERT INTO agent_steps (workspace_id, run_id, seq, kind, content, tokens_in, tokens_out, cost_micros)
       VALUES ($1, $2, 1, $3, $4, $5, $6, $7)`,
      [
        o.workspaceId,
        id,
        error ? 'error' : 'model',
        JSON.stringify(
          error
            ? { message: error, provider: by.provider }
            : {
                // the beginning of the text; the whole text is the file's
                blocks: [
                  { type: 'text', text: text.slice(0, 600) + (text.length > 600 ? ' …' : '') },
                ],
                stopReason: 'end_turn',
                provider: by.provider,
                model: by.model,
                file: { id: o.fileId, method: o.method, chars: text.length, seconds },
              },
        ),
        usage.input,
        usage.output,
        cost,
      ],
    );
    return id;
  });
}
