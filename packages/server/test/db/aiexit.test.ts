// ── [PCODE-243 | S15 | v0.1.0] T24.4 AI providers exit check, docs and sprint close ──
//    Why:  the T24 exit as one workspace's morning, with recorded answers of every provider: agents think
//          with Azure OpenAI and Gemini takes over when Azure fails; the Reviewer has its own connection to
//          Amazon Bedrock with signed requests; a Word file is read on the server, a PDF and a screenshot by
//          Gemini, a call recording by Grok; the idea's sources show the text the Analyst reads; and the AI
//          spend says what each provider cost.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileReader } from '../../src/files/reading.js';
import { sampleDocx } from '../docxfile.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = '7c'.repeat(32);

interface Sent {
  url: string;
  headers: Record<string, string>;
  json: Record<string, unknown> | null;
}

describe.skipIf(!hasDatabase)(
  'T24 exit: several providers, fallbacks and files (PostgreSQL)',
  () => {
    let t: TestApp & { reader: FileReader | null };
    let ada: Person;
    let project = '';
    const sent: Sent[] = [];
    let azureDown = true;

    const json = (x: unknown, status = 200) =>
      new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
    const answer = (url: string, init?: RequestInit): Response => {
      const body = init?.body;
      sent.push({
        url,
        headers: { ...(init?.headers as Record<string, string>) },
        json: typeof body === 'string' ? (JSON.parse(body) as Record<string, unknown>) : null,
      });
      if (url.startsWith('https://northwind.openai.azure.com/openai/v1/'))
        return azureDown
          ? json({ error: { message: 'Service unavailable' } }, 503)
          : json({
              choices: [{ message: { content: 'Azure here.' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 100, completion_tokens: 10 },
            });
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        const parts = (
          (
            sent.at(-1)?.json?.['contents'] as { parts: Record<string, unknown>[] }[] | undefined
          )?.[0]?.parts ?? []
        ).map((p) => (p['inlineData'] as { mimeType?: string } | undefined)?.mimeType ?? '');
        const text = parts.includes('application/pdf')
          ? 'Booking API requirements\nThe export must include cancelled appointments.'
          : parts.includes('image/png')
            ? 'Export failed\n---\nAn error dialog over the booking list.'
            : 'Gemini took over: the idea is clear.';
        return json({
          candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 200 },
        });
      }
      if (url.startsWith('https://bedrock-runtime.eu-central-1.amazonaws.com/'))
        return json({
          output: { message: { role: 'assistant', content: [{ text: 'RECOMMEND: approve' }] } },
          stopReason: 'end_turn',
          usage: { inputTokens: 900, outputTokens: 30 },
        });
      if (url === 'https://api.x.ai/v1/stt')
        return json({ text: 'Ines: the October export is empty.', duration: 120 });
      return json({ error: { message: 'unexpected ' + url } }, 404);
    };
    const aiFetch = ((url: string, init?: RequestInit) =>
      Promise.resolve(answer(url, init))) as typeof fetch;

    const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
    const connect = async (body: Record<string, unknown>): Promise<string> => {
      const r = await t.call<{ id: string }>(ada, 'POST', W('/ai/connections'), body);
      expect(r.status).toBe(201);
      return r.body.id;
    };
    const upload = async (name: string, mime: string, data: Buffer): Promise<string> => {
      const r = await fetch(
        t.base + W('/files?' + new URLSearchParams({ name, projectId: project }).toString()),
        {
          method: 'POST',
          headers: { cookie: ada.cookie, 'content-type': mime },
          body: new Uint8Array(data),
        },
      );
      expect(r.status).toBe(201);
      return ((await r.json()) as { id: string }).id;
    };
    const run = async (agentKey: string, instruction: string) => {
      const agent = (
        await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))
      ).body.find((a) => a.key === agentKey);
      const r = await t.call<{ id: string }>(
        ada,
        'POST',
        W('/projects/' + project + '/agent-runs'),
        {
          agentId: agent?.id,
          instruction,
        },
      );
      const end = Date.now() + 10_000;
      for (;;) {
        const d = await t.call<{
          run: { status: string; model: string };
          steps: { kind: string; content: Record<string, unknown> }[];
        }>(ada, 'GET', W('/agent-runs/' + r.body.id));
        if (['succeeded', 'failed'].includes(d.body.run.status)) return d.body;
        if (Date.now() > end) throw new Error('run stayed ' + d.body.run.status);
        await new Promise((res) => setTimeout(res, 50));
      }
    };

    beforeAll(async () => {
      t = await startTestApp({ aiFetch, reads: true });
      ada = await t.signup('Ada');
      project = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio' })
      ).body.id;
    }, 60_000);

    afterAll(async () => {
      await t.stop();
    });

    it('runs a morning on four providers and accounts for each', async () => {
      // the admin connects the providers and says what each does
      const azure = await connect({
        provider: 'azure',
        label: 'Azure (Northwind)',
        key: 'azure-key-0123456789abcdef',
        endpoint: 'https://northwind.openai.azure.com',
        defaultModel: 'nw-gpt5',
      });
      const gemini = await connect({ provider: 'gemini', key: 'AIzaSy-gemini-0123456789' });
      const bedrock = await connect({
        provider: 'bedrock',
        region: 'eu-central-1',
        auth: 'accessKeys',
        accessKeyId: 'AKIAEXAMPLE000000000',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      });
      const grok = await connect({ provider: 'xai', key: 'xai-test-0123456789abcdefghij' });
      const set = await t.call<Record<string, string | null>>(ada, 'PUT', W('/ai/settings'), {
        agentConnectionId: azure,
        fallbackConnectionId: gemini,
        readingConnectionId: gemini,
        audioConnectionId: grok,
      });
      expect(set.body).toEqual({
        agentConnectionId: azure,
        fallbackConnectionId: gemini,
        readingConnectionId: gemini,
        audioConnectionId: grok,
      });
      const reviewer = (
        await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))
      ).body.find((a) => a.key === 'reviewer');
      await t.call(ada, 'PATCH', W('/agents/' + String(reviewer?.id)), {
        connectionId: bedrock,
        model: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      });

      // 08:30 Azure is down: Gemini answers the Analyst, and the run says so
      const analyst = await run('analyst', 'Shape the export idea');
      expect(analyst.run).toMatchObject({ status: 'succeeded', model: 'gemini-2.5-flash' });
      expect(analyst.steps.find((s) => s.kind === 'note')?.content['text']).toContain(
        'azure (nw-gpt5) failed',
      );
      // 08:40 Azure is back and answers itself
      azureDown = false;
      expect((await run('analyst', 'Again')).run).toMatchObject({ model: 'nw-gpt5' });

      // 09:00 the Reviewer works on Bedrock, every request signed
      const review = await run('reviewer', 'Review HEL');
      expect(review.run).toMatchObject({
        status: 'succeeded',
        model: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      });
      const signed = sent.filter((s) => s.url.includes('bedrock-runtime')).pop();
      expect(signed?.url).toBe(
        'https://bedrock-runtime.eu-central-1.amazonaws.com/model/anthropic.claude-sonnet-4-5-20250929-v1%3A0/converse',
      );
      expect(signed?.headers['authorization']).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE000000000\/\d{8}\/eu-central-1\/bedrock\/aws4_request, /,
      );

      // 09:30 the client's material arrives: a Word file, a PDF, a screenshot and a call recording
      const docx = await upload(
        'Export notes.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sampleDocx(),
      );
      const pdf = await upload(
        'Booking API.pdf',
        'application/pdf',
        Buffer.from('%PDF-1.7\n%%EOF'),
      );
      const png = await upload(
        'error.png',
        'image/png',
        Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
      );
      const call = await upload('call.m4a', 'audio/mp4', Buffer.from('fake-audio'));
      expect(await t.reader?.round()).toBe(4);
      const read = async (id: string) =>
        (
          await t.call<{
            textKind: string;
            read: { status: string; provider: string; model: string; costMicros: number };
          }>(ada, 'GET', W('/files/' + id))
        ).body;
      expect(await read(docx)).toMatchObject({ textKind: 'extracted', read: { provider: '' } });
      expect(await read(pdf)).toMatchObject({
        textKind: 'extracted',
        read: { status: 'done', provider: 'gemini', model: 'gemini-2.5-flash' },
      });
      expect(await read(png)).toMatchObject({ textKind: 'ocr', read: { provider: 'gemini' } });
      // two minutes at 0.10 USD an hour
      expect(await read(call)).toMatchObject({
        textKind: 'transcript',
        read: { provider: 'xai', model: 'grok-voice-transcribe-2.0', costMicros: 3334 },
      });

      // the idea's sources: the Analyst reads what the files say
      const idea = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/ideas'), {
          title: 'Complete booking export',
        })
      ).body.id;
      for (const fileId of [docx, pdf, call])
        expect(
          (await t.call(ada, 'POST', W('/ideas/' + idea + '/sources'), { kind: 'file', fileId }))
            .status,
        ).toBe(201);
      const sources = (
        await t.call<{
          sources: { fileName: string; textLength: number; read: { status: string } | null }[];
        }>(ada, 'GET', W('/ideas/' + idea + '/workspace'))
      ).body.sources;
      expect(sources.map((s) => [s.fileName, s.read?.status, s.textLength > 20])).toEqual([
        ['Export notes.docx', 'done', true],
        ['Booking API.pdf', 'done', true],
        ['call.m4a', 'done', true],
      ]);

      // the AI spend, per provider: Gemini answered for Azure once and read two files
      const spend = await t.call<{ byProvider: { provider: string; tokens: number }[] }>(
        ada,
        'GET',
        W('/ai-spend'),
      );
      expect(Object.fromEntries(spend.body.byProvider.map((p) => [p.provider, p.tokens]))).toEqual({
        gemini: 6600,
        bedrock: 930,
        azure: 110,
        xai: 0,
      });
    });
  },
);
