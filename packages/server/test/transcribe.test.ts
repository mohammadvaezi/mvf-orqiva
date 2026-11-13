// ── [PCODE-241 | S15 | v0.1.0] T24.2 Reading files through the models: PDF, DOCX, images, audio ──
//    Why:  each provider that transcribes gets the recording in its own way (a form at OpenAI, Azure and
//          xAI, inline audio at Gemini) and answers with the text and either tokens or the length.
import { describe, expect, it } from 'vitest';
import { buildTranscriber, TRANSCRIBE_PROMPT } from '../src/agents/transcribe.js';

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: FormData | string;
}

function recorded(answer: unknown): typeof fetch & { sent: Sent[] } {
  const sent: Sent[] = [];
  const f = ((url: string, init?: RequestInit) => {
    sent.push({
      url,
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body as FormData | string,
    });
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch & { sent: Sent[] };
  f.sent = sent;
  return f;
}

const audio = { name: 'call.m4a', mime: 'audio/mp4', data: Buffer.from('fake-audio') };

describe('transcripts', () => {
  it('OpenAI: a form with the model and the file; the length when billed by duration', async () => {
    const f = recorded({ text: 'Hello.', usage: { type: 'duration', seconds: 42 } });
    const t = await buildTranscriber({ provider: 'openai', config: {} }, 'sk-x', f).transcribe(
      audio,
      'whisper-1',
    );
    expect(f.sent[0]?.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(f.sent[0]?.headers['authorization']).toBe('Bearer sk-x');
    const form = f.sent[0]?.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('response_format')).toBe('json');
    expect((form.get('file') as File).name).toBe('call.m4a');
    expect(t).toEqual({ text: 'Hello.', seconds: 42, usage: { input: 0, output: 0 } });
  });

  it('Azure: the resource’s v1 address and its key', async () => {
    const f = recorded({ text: 'Hallo.' });
    await buildTranscriber(
      { provider: 'azure', config: { endpoint: 'https://acme.openai.azure.com' } },
      'azure-key',
      f,
    ).transcribe(audio, 'acme-transcribe');
    expect(f.sent[0]?.url).toBe('https://acme.openai.azure.com/openai/v1/audio/transcriptions');
    expect(f.sent[0]?.headers['api-key']).toBe('azure-key');
  });

  it('xAI: /v1/stt with the file last; the length from the answer', async () => {
    const f = recorded({ text: 'Stand-up.', language: 'en', duration: 61.5 });
    const t = await buildTranscriber({ provider: 'xai', config: {} }, 'xai-k', f).transcribe(
      audio,
      'grok-voice-transcribe-2.0',
    );
    expect(f.sent[0]?.url).toBe('https://api.x.ai/v1/stt');
    expect([...(f.sent[0]?.body as FormData).keys()].at(-1)).toBe('file');
    expect(t.seconds).toBe(61.5);
  });

  it('Gemini: the audio inline with the instruction; thinking is not part of the text', async () => {
    const f = recorded({
      candidates: [
        { content: { parts: [{ text: 'hmm', thought: true }, { text: 'Ines: hello.' }] } },
      ],
      usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 10, thoughtsTokenCount: 5 },
    });
    const t = await buildTranscriber({ provider: 'gemini', config: {} }, 'g-key', f).transcribe(
      audio,
      'gemini-2.5-flash',
    );
    expect(f.sent[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    const body = JSON.parse(f.sent[0]?.body as string) as {
      contents: { parts: Record<string, unknown>[] }[];
    };
    expect(body.contents[0]?.parts).toEqual([
      { inlineData: { mimeType: 'audio/mp4', data: Buffer.from('fake-audio').toString('base64') } },
      { text: TRANSCRIBE_PROMPT },
    ]);
    expect(t).toEqual({ text: 'Ines: hello.', seconds: null, usage: { input: 900, output: 15 } });
  });

  it('providers without transcripts say so', () => {
    expect(() => buildTranscriber({ provider: 'anthropic', config: {} }, 'k')).toThrow(
      'does not write transcripts',
    );
  });
});
