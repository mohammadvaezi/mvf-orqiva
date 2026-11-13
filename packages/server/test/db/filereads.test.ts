// ── [PCODE-241 | S15 | v0.1.0] T24.2 Reading files through the models: PDF, DOCX, images, audio ──
//    Why:  files get their text through the real upload, queue and worker, with recorded provider answers:
//          a Word file is read on the server; a screenshot waits until an admin chooses a reading
//          connection and is then read by OpenAI; a PDF follows; a recording is transcribed by OpenAI and,
//          after the audio connection changes, by Grok, priced per token or per minute; a rate limit is
//          tried again; a connection that cannot read a kind says so; every model read is a Reader run with
//          its cost, also for a file outside any project; anyone on the team may ask for a read again.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import type { FileReader } from '../../src/files/reading.js';
import { sampleDocx } from '../docxfile.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = '6b'.repeat(32);

interface Sent {
  url: string;
  json: Record<string, unknown> | null;
  form: FormData | null;
}

interface FileOut {
  id: string;
  hasText: boolean;
  textKind: string;
  read: {
    method: string;
    status: string;
    provider: string;
    model: string;
    error: string;
    costMicros: number;
  } | null;
}

describe.skipIf(!hasDatabase)('reading files through the models (PostgreSQL)', () => {
  let t: TestApp & { reader: FileReader | null };
  let ada: Person;
  let cy: Person;
  let project = '';
  const sent: Sent[] = [];
  let limited = 0;

  const json = (x: unknown, status = 200) =>
    new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
  const answer = (url: string, init?: RequestInit): Response => {
    const body = init?.body;
    const form = body instanceof FormData ? body : null;
    sent.push({
      url,
      form,
      json: typeof body === 'string' ? (JSON.parse(body) as Record<string, unknown>) : null,
    });
    if (url === 'https://api.openai.com/v1/chat/completions') {
      if (limited > 0) {
        limited -= 1;
        return json({ error: { message: 'Rate limit reached for gpt-5-mini' } }, 429);
      }
      const parts = ((sent.at(-1)?.json?.['messages'] as { role: string; content: unknown }[]).find(
        (m) => m.role === 'user',
      )?.content ?? []) as { type: string }[];
      const pdf = parts.some((p) => p.type === 'file');
      return json({
        choices: [
          {
            message: {
              content: pdf
                ? 'Booking API\nThe p95 must stay below 800 ms.'
                : 'Sign in\nPassword\n---\nThe sign-in screen with an error under the password.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1200, completion_tokens: 80 },
      });
    }
    if (url === 'https://api.openai.com/v1/audio/transcriptions')
      return json({
        text: 'Ines: the export is empty for October.',
        usage: { type: 'tokens', input_tokens: 600, output_tokens: 120 },
      });
    if (url === 'https://api.x.ai/v1/stt')
      return json({ text: 'Grok heard the stand-up.', language: 'en', duration: 90 });
    return json({ error: { message: 'unexpected ' + url } }, 404);
  };
  const aiFetch = ((url: string, init?: RequestInit) =>
    Promise.resolve(answer(url, init))) as typeof fetch;

  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const upload = async (
    name: string,
    mime: string,
    data: Buffer,
    inProject = true,
  ): Promise<FileOut> => {
    const q = new URLSearchParams({ name, ...(inProject ? { projectId: project } : {}) });
    const r = await fetch(t.base + W('/files?' + q.toString()), {
      method: 'POST',
      headers: { cookie: ada.cookie, 'content-type': mime },
      body: new Uint8Array(data),
    });
    expect(r.status).toBe(201);
    return (await r.json()) as FileOut;
  };
  const file = async (id: string): Promise<FileOut> =>
    (await t.call<FileOut>(ada, 'GET', W('/files/' + id))).body;
  const textOf = async (id: string): Promise<string> =>
    (
      await inSystem(t.db.pool, (c) =>
        c.query<{ text_content: string }>('SELECT text_content FROM files WHERE id = $1', [id]),
      )
    ).rows[0]?.text_content ?? '';
  const addConnection = async (body: Record<string, unknown>): Promise<string> => {
    const r = await t.call<{ id: string }>(ada, 'POST', W('/ai/connections'), body);
    expect(r.status).toBe(201);
    return r.body.id;
  };

  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
  const MP3 = Buffer.from('4944330300000000000f', 'hex');

  beforeAll(async () => {
    t = await startTestApp({ aiFetch, reads: true });
    ada = await t.signup('Ada');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('reads a Word file on the server, without any model', async () => {
    const f = await upload(
      'Export spec.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sampleDocx(),
    );
    expect(f).toMatchObject({ hasText: false, read: { method: 'docx', status: 'queued' } });
    expect(await t.reader?.round()).toBe(1);
    expect(await file(f.id)).toMatchObject({
      hasText: true,
      textKind: 'extracted',
      read: { status: 'done', provider: '', costMicros: 0 },
    });
    expect(await textOf(f.id)).toContain('The export must include cancelled appointments');
    expect(sent).toHaveLength(0);
  });

  it('lets a screenshot wait for a reading connection, then reads it with OpenAI as a Reader run', async () => {
    const shot = await upload('sign-in.png', 'image/png', PNG);
    expect(shot.read).toMatchObject({
      method: 'image',
      status: 'skipped',
      error: 'No connection reads files; an admin chooses one in Settings, AI providers',
    });
    const openai = await addConnection({ provider: 'openai', key: 'sk-test-reading-0123456789ab' });
    const set = await t.call(ada, 'PUT', W('/ai/settings'), {
      readingConnectionId: openai,
      audioConnectionId: openai,
    });
    expect(set.status).toBe(200);
    expect((await file(shot.id)).read?.status).toBe('queued');
    expect(await t.reader?.round()).toBe(1);
    const req = sent.at(-1);
    expect(req?.json?.['model']).toBe('gpt-5-mini');
    const content = (
      req?.json?.['messages'] as { role: string; content: Record<string, unknown>[] }[]
    ).find((m) => m.role === 'user')?.content;
    expect(content?.[0]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,' + PNG.toString('base64') },
    });
    // 1200 in at 0.25 USD and 80 out at 2 USD per million tokens
    expect(await file(shot.id)).toMatchObject({
      textKind: 'ocr',
      read: { status: 'done', provider: 'openai', model: 'gpt-5-mini', costMicros: 460 },
    });
    expect(await textOf(shot.id)).toContain('The sign-in screen with an error');
    const runs = (
      await inSystem(t.db.pool, (c) =>
        c.query<{ key: string; project_id: string | null; status: string; cost_micros: string }>(
          `SELECT a.key, r.project_id, r.status, r.cost_micros FROM agent_runs r JOIN agents a ON a.id = r.agent_id
            WHERE r.workspace_id = $1 ORDER BY r.created_at`,
          [ada.workspaceId],
        ),
      )
    ).rows;
    expect(runs).toEqual([
      { key: 'reader', project_id: project, status: 'succeeded', cost_micros: '460' },
    ]);
  });

  it('reads a PDF, tries again after a rate limit, and reads a file outside any project', async () => {
    limited = 1;
    const pdf = await upload('Booking API.pdf', 'application/pdf', PDF, false);
    await t.reader?.round();
    expect((await file(pdf.id)).read).toMatchObject({
      status: 'queued',
      error: 'The model provider answered 429: Rate limit reached for gpt-5-mini',
    });
    // a minute later
    await inSystem(t.db.pool, (c) =>
      c.query("UPDATE file_reads SET next_at = now() - interval '1 second' WHERE file_id = $1", [
        pdf.id,
      ]),
    );
    expect(await t.reader?.round()).toBe(1);
    const parts = (
      sent.at(-1)?.json?.['messages'] as { role: string; content: Record<string, unknown>[] }[]
    ).find((m) => m.role === 'user')?.content;
    expect(parts?.[0]).toMatchObject({
      type: 'file',
      file: { filename: 'Booking API.pdf' },
    });
    expect(await file(pdf.id)).toMatchObject({ textKind: 'extracted', read: { status: 'done' } });
    expect(await textOf(pdf.id)).toBe('Booking API\nThe p95 must stay below 800 ms.');
    // the failed attempt and the read are both Reader runs; neither belongs to a project
    const runs = (
      await inSystem(t.db.pool, (c) =>
        c.query<{ status: string; project_id: string | null }>(
          "SELECT status, project_id FROM agent_runs WHERE instruction = 'Read Booking API.pdf' ORDER BY created_at",
        ),
      )
    ).rows;
    expect(runs).toEqual([
      { status: 'failed', project_id: null },
      { status: 'succeeded', project_id: null },
    ]);
  });

  it('transcribes a recording with OpenAI by tokens, then with Grok by the minute', async () => {
    const call = await upload('call.mp3', 'audio/mpeg', MP3);
    await t.reader?.round();
    const req = sent.at(-1);
    expect(req?.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(req?.form?.get('model')).toBe('gpt-4o-transcribe');
    expect((req?.form?.get('file') as File | null)?.name).toBe('call.mp3');
    // 600 in at 2.50 USD and 120 out at 10 USD per million tokens
    expect(await file(call.id)).toMatchObject({
      textKind: 'transcript',
      read: { status: 'done', provider: 'openai', model: 'gpt-4o-transcribe', costMicros: 2700 },
    });
    expect(await textOf(call.id)).toBe('Ines: the export is empty for October.');

    const grok = await addConnection({ provider: 'xai', key: 'xai-test-0123456789abcdefghij' });
    await t.call(ada, 'PUT', W('/ai/settings'), { audioConnectionId: grok });
    const standup = await upload('stand-up.wav', 'audio/wav', MP3);
    await t.reader?.round();
    expect(sent.at(-1)?.url).toBe('https://api.x.ai/v1/stt');
    // 90 seconds at 0.10 USD an hour
    expect(await file(standup.id)).toMatchObject({
      read: {
        status: 'done',
        provider: 'xai',
        model: 'grok-voice-transcribe-2.0',
        costMicros: 2501,
      },
    });
    expect(await textOf(standup.id)).toBe('Grok heard the stand-up.');
  });

  it('says when the connection cannot read a kind, and reads again on request', async () => {
    const grok = (
      await t.call<{ connections: { id: string; provider: string }[] }>(
        ada,
        'GET',
        W('/ai/connections'),
      )
    ).body.connections.find((c) => c.provider === 'xai')?.id;
    await t.call(ada, 'PUT', W('/ai/settings'), { readingConnectionId: grok });
    const pdf = await upload('scan.pdf', 'application/pdf', PDF);
    await t.reader?.round();
    expect((await file(pdf.id)).read).toMatchObject({
      status: 'skipped',
      error: 'xAI Grok does not read PDF files',
    });
    const openai = (
      await t.call<{ connections: { id: string; provider: string }[] }>(
        ada,
        'GET',
        W('/ai/connections'),
      )
    ).body.connections.find((c) => c.provider === 'openai')?.id;
    await t.call(ada, 'PUT', W('/ai/settings'), { readingConnectionId: openai });
    // a member asks for the read again
    const again = await t.call<FileOut>(cy, 'POST', W('/files/' + pdf.id + '/read'));
    expect(again.body.read?.status).toBe('queued');
    await t.reader?.round();
    expect((await file(pdf.id)).read).toMatchObject({ status: 'done', provider: 'openai' });
    // a file with text of its own is not read by a model
    const notes = await upload('notes.md', 'text/markdown', Buffer.from('# Notes'));
    expect(notes).toMatchObject({ hasText: true, read: null });
    expect((await t.call(ada, 'POST', W('/files/' + notes.id + '/read'))).status).toBe(409);
  });

  it('respects the Reader agent: switched off, nothing is read', async () => {
    const reader = (
      await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))
    ).body.find((a) => a.key === 'reader');
    await t.call(ada, 'PATCH', W('/agents/' + String(reader?.id)), { enabled: false });
    const shot = await upload('later.png', 'image/png', PNG);
    const before = sent.length;
    await t.reader?.round();
    expect((await file(shot.id)).read).toMatchObject({
      status: 'skipped',
      error: 'The Reader agent is switched off; an admin can switch it on',
    });
    expect(sent).toHaveLength(before);
  });
});
