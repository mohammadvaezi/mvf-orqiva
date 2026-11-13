// ── [PCODE-241 | S15 | v0.1.0] T24.2 Reading files through the models: PDF, DOCX, images, audio ──
//    Why:  recordings become text through the providers that transcribe (owner decision 11 Oct 2026: text
//          and audio through the LLM providers, no local engine). OpenAI and Azure OpenAI take the file at
//          /audio/transcriptions; xAI at /v1/stt; Gemini hears audio given inline and writes it out when
//          asked. Each answer says how long the recording was or how many tokens it took, which prices it.
import { azureBase } from './openai.js';
import { GEMINI_BASE } from './gemini.js';
import { callProvider, ProviderError } from './provider.js';

export interface AudioFile {
  name: string;
  mime: string;
  data: Buffer;
}

export interface Transcript {
  text: string;
  /** the recording's length, when the provider says it */
  seconds: number | null;
  usage: { input: number; output: number };
}

export interface Transcriber {
  name: string;
  transcribe(file: AudioFile, model: string): Promise<Transcript>;
}

const form = (file: AudioFile, fields: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  // the file goes last (xAI requires it there)
  f.append('file', new Blob([new Uint8Array(file.data)], { type: file.mime }), file.name);
  return f;
};

/** OpenAI's /audio/transcriptions; Azure's v1 API has the same shape under the resource's address. */
export function openaiTranscriber(
  o: { name: 'openai' | 'azure'; base: string; headers: Record<string, string> },
  fetchImpl: typeof fetch = fetch,
): Transcriber {
  return {
    name: o.name,
    async transcribe(file, model) {
      const body = await callProvider(fetchImpl, o.base + '/audio/transcriptions', {
        headers: o.headers,
        body: form(file, { model, response_format: 'json' }),
        timeoutMs: 600_000,
      });
      const u = (body['usage'] ?? {}) as {
        type?: string;
        seconds?: number;
        input_tokens?: number;
        output_tokens?: number;
      };
      return {
        text: typeof body['text'] === 'string' ? body['text'] : '',
        seconds: u.type === 'duration' && typeof u.seconds === 'number' ? u.seconds : null,
        usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0 },
      };
    },
  };
}

export function xaiTranscriber(apiKey: string, fetchImpl: typeof fetch = fetch): Transcriber {
  return {
    name: 'xai',
    async transcribe(file) {
      const body = await callProvider(fetchImpl, 'https://api.x.ai/v1/stt', {
        headers: { authorization: 'Bearer ' + apiKey },
        body: form(file, {}),
        timeoutMs: 600_000,
      });
      return {
        text: typeof body['text'] === 'string' ? body['text'] : '',
        seconds: typeof body['duration'] === 'number' ? body['duration'] : null,
        usage: { input: 0, output: 0 },
      };
    },
  };
}

export const TRANSCRIBE_PROMPT =
  'Write out everything that is said in this recording, word for word, in the language spoken. ' +
  'Start a new paragraph when the speaker changes. Write nothing else.';

export function geminiTranscriber(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  base = GEMINI_BASE,
): Transcriber {
  return {
    name: 'gemini',
    async transcribe(file, model) {
      const body = await callProvider(
        fetchImpl,
        base + '/models/' + encodeURIComponent(model) + ':generateContent',
        {
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { inlineData: { mimeType: file.mime, data: file.data.toString('base64') } },
                  { text: TRANSCRIBE_PROMPT },
                ],
              },
            ],
            generationConfig: { maxOutputTokens: 32_000 },
          }),
          timeoutMs: 600_000,
        },
      );
      const cand = ((body['candidates'] ?? []) as Record<string, unknown>[])[0] ?? {};
      const content = cand['content'] as
        { parts?: { text?: string; thought?: boolean }[] } | undefined;
      const parts = content?.parts ?? [];
      const u = (body['usageMetadata'] ?? {}) as {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
      };
      return {
        text: parts
          .filter((p) => !p.thought)
          .map((p) => p.text ?? '')
          .join('')
          .trim(),
        seconds: null,
        usage: {
          input: u.promptTokenCount ?? 0,
          output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        },
      };
    },
  };
}

/** The transcriber of a connection, or why it has none. */
export function buildTranscriber(
  row: { provider: string; config: { endpoint?: string } },
  secret: string | null,
  fetchImpl: typeof fetch = fetch,
): Transcriber {
  if (!secret) throw new ProviderError('The connection has no key; enter it again in Settings');
  switch (row.provider) {
    case 'openai':
      return openaiTranscriber(
        {
          name: 'openai',
          base: 'https://api.openai.com/v1',
          headers: { authorization: 'Bearer ' + secret },
        },
        fetchImpl,
      );
    case 'azure':
      if (!row.config.endpoint) throw new ProviderError('The Azure connection has no endpoint');
      return openaiTranscriber(
        { name: 'azure', base: azureBase(row.config.endpoint), headers: { 'api-key': secret } },
        fetchImpl,
      );
    case 'xai':
      return xaiTranscriber(secret, fetchImpl);
    case 'gemini':
      return geminiTranscriber(secret, fetchImpl);
    default:
      throw new ProviderError('This connection does not write transcripts');
  }
}
