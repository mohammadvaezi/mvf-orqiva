// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
//    Why:  each provider translates our one request shape to its own API and back. Recorded answers in
//          each provider's documented shape stand in for the network: the request that leaves is checked
//          (address, key header, how tools, results, pictures and PDFs are written) and the answer that
//          comes back is read into text, tool calls, a stop reason and tokens. AWS's own example checks
//          the request signing.
import { describe, expect, it } from 'vitest';
import { bedrockProvider } from '../src/agents/bedrock.js';
import { buildProvider, withFallback } from '../src/agents/connections.js';
import { geminiProvider, geminiSchema } from '../src/agents/gemini.js';
import { azureProvider, openaiProvider, xaiProvider } from '../src/agents/openai.js';
import {
  anthropicProvider,
  callProvider,
  ProviderError,
  type ModelMessage,
  type ModelRequest,
} from '../src/agents/provider.js';
import { signRequest } from '../src/agents/sigv4.js';

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A fetch that records the request and answers with the given JSON. */
function recorded(answer: unknown, status = 200): typeof fetch & { sent: Sent[] } {
  const sent: Sent[] = [];
  const f = ((url: string, init?: RequestInit) => {
    sent.push({
      url,
      headers: { ...(init?.headers as Record<string, string>) },
      body: JSON.parse((init?.body as string | undefined) ?? '{}') as Record<string, unknown>,
    });
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch & { sent: Sent[] };
  f.sent = sent;
  return f;
}

const TOOL = {
  name: 'get_item',
  description: 'Read a task',
  input_schema: {
    type: 'object',
    properties: { ref: { type: 'string' }, extra: { type: ['string', 'null'] } },
    required: ['ref'],
    additionalProperties: false,
  },
};

/** A conversation with every kind of block: a question with a picture and a PDF, a tool call, its result. */
const CONVERSATION: ModelMessage[] = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Read HEL-1 and the attachments.' },
      { type: 'image', mime: 'image/png', data: 'iVBORw0K' },
      { type: 'document', mime: 'application/pdf', name: 'spec v2.pdf', data: 'JVBERi0x' },
    ],
  },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Reading it.' },
      {
        type: 'tool_use',
        id: 'call-1',
        name: 'get_item',
        input: { ref: 'HEL-1' },
        signature: 'sig-1',
      },
    ],
  },
  {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'HEL-1: PDF export empty' }],
  },
];

const req = (model: string, over: Partial<ModelRequest> = {}): ModelRequest => ({
  model,
  system: 'You are the Analyst.',
  messages: CONVERSATION,
  tools: [TOOL],
  maxTokens: 1000,
  temperature: 0.2,
  ...over,
});

describe('Anthropic', () => {
  it('writes pictures and PDFs as base64 sources and reads text and tool calls', async () => {
    const f = recorded({
      content: [
        { type: 'thinking', thinking: 'hidden' },
        { type: 'text', text: 'Done.' },
        { type: 'tool_use', id: 'tu_2', name: 'get_item', input: { ref: 'HEL-2' } },
      ],
      stop_reason: 'tool_use',
      // [PCODE-327 | S15 | v0.1.0] the cache read and written, and the reasoning
      usage: {
        input_tokens: 120,
        output_tokens: 30,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 40,
      },
    });
    const r = await anthropicProvider('sk-ant-test', f).complete(req('claude-sonnet-5-5'));
    const sent = f.sent[0];
    expect(sent?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent?.headers['x-api-key']).toBe('sk-ant-test');
    const first = (sent?.body['messages'] as { content: Record<string, unknown>[] }[])[0];
    expect(first?.content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0K' },
    });
    expect(first?.content[2]).toMatchObject({ type: 'document', source: { data: 'JVBERi0x' } });
    // the signature is Gemini's; Anthropic never sees it
    const second = (sent?.body['messages'] as { content: Record<string, unknown>[] }[])[1];
    expect(second?.content[1]).toEqual({
      type: 'tool_use',
      id: 'call-1',
      name: 'get_item',
      input: { ref: 'HEL-1' },
    });
    expect(r).toEqual({
      content: [
        { type: 'text', text: 'Done.' },
        { type: 'tool_use', id: 'tu_2', name: 'get_item', input: { ref: 'HEL-2' } },
      ],
      stopReason: 'tool_use',
      usage: { input: 120, output: 30, cacheRead: 900, cacheWrite: 40 },
    });
  });
});

describe('OpenAI, Azure OpenAI and Grok (Chat Completions)', () => {
  const answer = {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: 'call_9',
              type: 'function',
              function: { name: 'get_item', arguments: '{"ref":"HEL-3"}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    // [PCODE-327 | S15 | v0.1.0] prompt_tokens includes the cached part
    usage: {
      prompt_tokens: 200,
      completion_tokens: 15,
      prompt_tokens_details: { cached_tokens: 150 },
      completion_tokens_details: { reasoning_tokens: 9 },
    },
  };

  it('OpenAI: system first, tool results as tool messages, a reasoning model without temperature', async () => {
    const f = recorded(answer);
    const r = await openaiProvider('sk-test-0123456789abcdefghij', f).complete(req('gpt-5'));
    const sent = f.sent[0];
    expect(sent?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(sent?.headers['authorization']).toBe('Bearer sk-test-0123456789abcdefghij');
    expect(sent?.body['max_completion_tokens']).toBe(1000);
    expect(sent?.body['temperature']).toBeUndefined();
    const msgs = sent?.body['messages'] as Record<string, unknown>[];
    expect(msgs.map((m) => m['role'])).toEqual(['system', 'user', 'assistant', 'tool']);
    expect((msgs[1]?.['content'] as Record<string, unknown>[])[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,iVBORw0K' },
    });
    expect((msgs[1]?.['content'] as Record<string, unknown>[])[2]).toEqual({
      type: 'file',
      file: { filename: 'spec v2.pdf', file_data: 'data:application/pdf;base64,JVBERi0x' },
    });
    expect(msgs[2]).toEqual({
      role: 'assistant',
      content: 'Reading it.',
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'get_item', arguments: '{"ref":"HEL-1"}' },
        },
      ],
    });
    expect(msgs[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: 'HEL-1: PDF export empty',
    });
    expect((sent?.body['tools'] as Record<string, unknown>[])[0]).toEqual({
      type: 'function',
      function: { name: 'get_item', description: 'Read a task', parameters: TOOL.input_schema },
    });
    expect(r).toEqual({
      content: [{ type: 'tool_use', id: 'call_9', name: 'get_item', input: { ref: 'HEL-3' } }],
      stopReason: 'tool_use',
      usage: { input: 50, output: 15, cacheRead: 150, reasoning: 9 },
    });
  });

  it('Azure: the resource’s v1 address and the api-key header; the model is the deployment', async () => {
    const f = recorded(answer);
    await azureProvider('https://acme.openai.azure.com/', 'azure-key-0123456789', f).complete(
      req('acme-gpt4o', { tools: [] }),
    );
    expect(f.sent[0]?.url).toBe('https://acme.openai.azure.com/openai/v1/chat/completions');
    expect(f.sent[0]?.headers['api-key']).toBe('azure-key-0123456789');
    expect(f.sent[0]?.body['model']).toBe('acme-gpt4o');
    expect(f.sent[0]?.body['temperature']).toBe(0.2);
    expect(f.sent[0]?.body['tools']).toBeUndefined();
  });

  it('Grok: max_tokens, and a PDF is refused before anything is sent', async () => {
    const f = recorded({
      choices: [{ message: { content: 'A login screen.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 50, completion_tokens: 5 },
    });
    const grok = xaiProvider('xai-0123456789abcdefghijk', f);
    const picture: ModelMessage[] = [
      { role: 'user', content: [{ type: 'image', mime: 'image/jpeg', data: '/9j/' }] },
    ];
    const r = await grok.complete(req('grok-4', { messages: picture, tools: [] }));
    expect(f.sent[0]?.url).toBe('https://api.x.ai/v1/chat/completions');
    expect(f.sent[0]?.body['max_tokens']).toBe(1000);
    expect(r.content).toEqual([{ type: 'text', text: 'A login screen.' }]);
    expect(r.stopReason).toBe('end_turn');
    await expect(grok.complete(req('grok-4'))).rejects.toThrow('Grok does not read PDF files');
    expect(f.sent).toHaveLength(1);
  });
});

describe('Gemini', () => {
  it('names the function in its response, signs calls back and counts thinking as output', async () => {
    const f = recorded({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { text: 'thinking…', thought: true },
              { text: 'I read the next one.' },
              {
                functionCall: { name: 'get_item', args: { ref: 'HEL-4' } },
                thoughtSignature: 'sig-2',
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      // [PCODE-327 | S15 | v0.1.0] the cache read and written, and the reasoning
      usageMetadata: {
        promptTokenCount: 300,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 40,
        cachedContentTokenCount: 100,
      },
    });
    const r = await geminiProvider('gemini-key', f).complete(req('gemini-2.5-flash'));
    const sent = f.sent[0];
    expect(sent?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect(sent?.headers['x-goog-api-key']).toBe('gemini-key');
    expect(sent?.body['systemInstruction']).toEqual({ parts: [{ text: 'You are the Analyst.' }] });
    const contents = sent?.body['contents'] as { role: string; parts: Record<string, unknown>[] }[];
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(contents[0]?.parts[1]).toEqual({
      inlineData: { mimeType: 'image/png', data: 'iVBORw0K' },
    });
    expect(contents[1]?.parts[1]).toEqual({
      functionCall: { name: 'get_item', args: { ref: 'HEL-1' } },
      thoughtSignature: 'sig-1',
    });
    expect(contents[2]?.parts[0]).toEqual({
      functionResponse: { name: 'get_item', response: { content: 'HEL-1: PDF export empty' } },
    });
    const decl = (sent?.body['tools'] as { functionDeclarations: Record<string, unknown>[] }[])[0]
      ?.functionDeclarations[0];
    expect(decl?.['parameters']).toEqual({
      type: 'object',
      properties: { ref: { type: 'string' }, extra: { type: 'string', nullable: true } },
      required: ['ref'],
    });
    expect(sent?.body['generationConfig']).toEqual({ maxOutputTokens: 1000, temperature: 0.2 });
    expect(r.content[0]).toEqual({ type: 'text', text: 'I read the next one.' });
    expect(r.content[1]).toMatchObject({
      type: 'tool_use',
      name: 'get_item',
      input: { ref: 'HEL-4' },
      signature: 'sig-2',
    });
    expect(r.stopReason).toBe('tool_use');
    expect(r.usage).toEqual({ input: 200, output: 60, cacheRead: 100, reasoning: 40 });
  });

  it('cuts JSON Schema down to what function declarations accept', () => {
    expect(
      geminiSchema({
        type: 'object',
        $schema: 'x',
        properties: { list: { type: 'array', items: { type: 'string', pattern: '^a' } } },
      }),
    ).toEqual({
      type: 'object',
      properties: { list: { type: 'array', items: { type: 'string' } } },
    });
  });
});

describe('Amazon Bedrock (Converse)', () => {
  const answer = {
    output: {
      message: {
        role: 'assistant',
        content: [
          { text: 'Looking.' },
          { toolUse: { toolUseId: 'tooluse_1', name: 'get_item', input: { ref: 'HEL-5' } } },
        ],
      },
    },
    stopReason: 'tool_use',
    // [PCODE-327 | S15 | v0.1.0] Converse counts the cache apart
    usage: {
      inputTokens: 400,
      outputTokens: 25,
      totalTokens: 425,
      cacheReadInputTokens: 300,
      cacheWriteInputTokens: 0,
    },
  };
  const model = 'anthropic.claude-sonnet-4-5-20250929-v1:0';

  it('with a Bedrock API key: a bearer token, blocks keyed by kind', async () => {
    const f = recorded(answer);
    const r = await bedrockProvider('eu-central-1', { apiKey: 'bedrock-api-key' }, f).complete(
      req(model),
    );
    const sent = f.sent[0];
    expect(sent?.url).toBe(
      'https://bedrock-runtime.eu-central-1.amazonaws.com/model/anthropic.claude-sonnet-4-5-20250929-v1%3A0/converse',
    );
    expect(sent?.headers['authorization']).toBe('Bearer bedrock-api-key');
    expect(sent?.body['system']).toEqual([{ text: 'You are the Analyst.' }]);
    const msgs = sent?.body['messages'] as { role: string; content: Record<string, unknown>[] }[];
    expect(msgs[0]?.content[1]).toEqual({
      image: { format: 'png', source: { bytes: 'iVBORw0K' } },
    });
    expect(msgs[0]?.content[2]).toEqual({
      document: { format: 'pdf', name: 'spec v2', source: { bytes: 'JVBERi0x' } },
    });
    expect(msgs[1]?.content[1]).toEqual({
      toolUse: { toolUseId: 'call-1', name: 'get_item', input: { ref: 'HEL-1' } },
    });
    expect(msgs[2]?.content[0]).toEqual({
      toolResult: {
        toolUseId: 'call-1',
        content: [{ text: 'HEL-1: PDF export empty' }],
        status: 'success',
      },
    });
    expect(sent?.body['toolConfig']).toEqual({
      tools: [
        {
          toolSpec: {
            name: 'get_item',
            description: 'Read a task',
            inputSchema: { json: TOOL.input_schema },
          },
        },
      ],
    });
    expect(sent?.body['inferenceConfig']).toEqual({ maxTokens: 1000, temperature: 0.2 });
    expect(r).toEqual({
      content: [
        { type: 'text', text: 'Looking.' },
        { type: 'tool_use', id: 'tooluse_1', name: 'get_item', input: { ref: 'HEL-5' } },
      ],
      stopReason: 'tool_use',
      usage: { input: 400, output: 25, cacheRead: 300, cacheWrite: 0 },
    });
  });

  it('with access keys: each request signed (SigV4), the session token sent along', async () => {
    const f = recorded(answer);
    await bedrockProvider(
      'us-east-1',
      {
        credentials: {
          accessKeyId: 'AKIAEXAMPLE000000000',
          secretAccessKey: 'secret',
          sessionToken: 'session',
        },
      },
      f,
    ).complete(req(model, { tools: [] }));
    const h = f.sent[0]?.headers ?? {};
    expect(h['authorization']).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE000000000\/\d{8}\/us-east-1\/bedrock\/aws4_request, SignedHeaders=accept;content-type;host;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/,
    );
    expect(h['x-amz-security-token']).toBe('session');
    expect(h['host']).toBeUndefined();
  });

  it('signs as AWS’s own example does', () => {
    const h = signRequest({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      region: 'us-east-1',
      service: 'iam',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: '',
      credentials: {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      },
      now: new Date('2015-08-30T12:36:00Z'),
    });
    expect(h['authorization']).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
  });
});

describe('errors and fallbacks', () => {
  it('reports the provider’s own words, and says when another provider may succeed', async () => {
    const limited = recorded({ error: { message: 'Rate limit reached' } }, 429);
    const e = await callProvider(limited, 'https://x.example/v1', {
      headers: {},
      body: '{}',
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect((e as ProviderError).message).toBe(
      'The model provider answered 429: Rate limit reached',
    );
    expect((e as ProviderError).retryable).toBe(true);
    // Gemini wraps its error in a list
    const bad = recorded([{ error: { code: 400, message: 'API key not valid' } }], 400);
    const e2 = (await callProvider(bad, 'https://x.example', { headers: {}, body: '{}' }).catch(
      (x: unknown) => x,
    )) as ProviderError;
    expect(e2.message).toBe('The model provider answered 400: API key not valid');
    expect(e2.retryable).toBe(false);
    const down = (() =>
      Promise.reject(new Error('getaddrinfo ENOTFOUND'))) as unknown as typeof fetch;
    const e3 = (await callProvider(down, 'https://x.example', { headers: {}, body: '{}' }).catch(
      (x: unknown) => x,
    )) as ProviderError;
    expect(e3.retryable).toBe(true);
  });

  it('the fallback answers with its own model and the reply says who failed', async () => {
    const primary = Object.assign(
      openaiProvider('sk-test-0123456789abcdefghij', recorded({ error: { message: 'down' } }, 503)),
      { connectionId: 'c-1' },
    );
    const fallback = Object.assign(
      geminiProvider(
        'g',
        recorded({
          candidates: [{ content: { parts: [{ text: 'Fine.' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
        }),
      ),
      { connectionId: 'c-2', model: 'gemini-2.5-flash' },
    );
    const r = await withFallback(primary, fallback).complete(req('gpt-5', { tools: [] }));
    expect(r.content).toEqual([{ type: 'text', text: 'Fine.' }]);
    expect(r.by).toEqual({ provider: 'gemini', model: 'gemini-2.5-flash', connectionId: 'c-2' });
    expect(r.failed).toEqual({
      by: { provider: 'openai', model: 'gpt-5', connectionId: 'c-1' },
      error: 'The model provider answered 503: down',
    });
  });

  it('a connection without its key or address says what is missing', () => {
    expect(() => buildProvider({ provider: 'openai', config: {} }, null)).toThrow('has no key');
    expect(() => buildProvider({ provider: 'azure', config: {} }, 'k')).toThrow('no endpoint');
    expect(buildProvider({ provider: 'demo', config: {} }, null).name).toBe('demo');
  });
});
