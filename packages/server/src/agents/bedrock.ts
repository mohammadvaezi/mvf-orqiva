// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
//    Why:  Amazon Bedrock's Converse API serves Claude, Llama, Mistral, Nova and others through one shape,
//          so a company that buys its models through AWS uses them here. Its blocks are keyed by kind
//          ({ text }, { toolUse }, { toolResult }, { image }, { document }), pictures and PDFs travel as
//          base64 bytes. A Bedrock API key goes as a bearer token; access keys sign each request (SigV4).
import {
  callProvider,
  type Block,
  type ModelMessage,
  type ModelProvider,
  type ModelReply,
} from './provider.js';
import { signRequest, type AwsCredentials } from './sigv4.js';

export type BedrockAuth = { apiKey: string } | { credentials: AwsCredentials };

export const bedrockBase = (region: string): string =>
  'https://bedrock-runtime.' + region + '.amazonaws.com';

export function bedrockProvider(
  region: string,
  auth: BedrockAuth,
  fetchImpl: typeof fetch = fetch,
  base = bedrockBase(region),
): ModelProvider {
  return {
    name: 'bedrock',
    async complete(req) {
      const url = base + '/model/' + encodeURIComponent(req.model) + '/converse';
      const body = JSON.stringify({
        ...(req.system ? { system: [{ text: req.system }] } : {}),
        messages: req.messages.map(bedrockMessage),
        inferenceConfig: {
          maxTokens: req.maxTokens,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        },
        ...(req.tools.length
          ? {
              toolConfig: {
                tools: req.tools.map((t) => ({
                  toolSpec: {
                    name: t.name,
                    description: t.description,
                    inputSchema: { json: t.input_schema },
                  },
                })),
              },
            }
          : {}),
      });
      const headers = { 'content-type': 'application/json', accept: 'application/json' };
      const signed =
        'apiKey' in auth
          ? { ...headers, authorization: 'Bearer ' + auth.apiKey }
          : signRequest({
              method: 'POST',
              url,
              region,
              service: 'bedrock',
              headers,
              body,
              credentials: auth.credentials,
            });
      // fetch sets Host itself
      delete signed['host'];
      return bedrockReply(await callProvider(fetchImpl, url, { headers: signed, body }));
    },
  };
}

const IMAGE_FORMATS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** Bedrock allows letters, digits, single spaces, hyphens, parentheses and square brackets in a name. */
const documentName = (name: string): string =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9 \-()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) || 'document';

function bedrockMessage(m: ModelMessage): Record<string, unknown> {
  return {
    role: m.role,
    content: m.content.flatMap((b): Record<string, unknown>[] => {
      switch (b.type) {
        case 'text':
          return b.text ? [{ text: b.text }] : [];
        case 'tool_use':
          return [{ toolUse: { toolUseId: b.id, name: b.name, input: b.input } }];
        case 'tool_result':
          return [
            {
              toolResult: {
                toolUseId: b.tool_use_id,
                content: [{ text: b.content }],
                status: b.is_error ? 'error' : 'success',
              },
            },
          ];
        case 'image':
          return [{ image: { format: IMAGE_FORMATS[b.mime] ?? 'png', source: { bytes: b.data } } }];
        case 'document':
          return [
            { document: { format: 'pdf', name: documentName(b.name), source: { bytes: b.data } } },
          ];
      }
    }),
  };
}

export function bedrockReply(body: Record<string, unknown>): ModelReply {
  const msg = ((body['output'] as { message?: { content?: unknown[] } } | undefined)?.message
    ?.content ?? []) as Record<string, unknown>[];
  const content: Block[] = [];
  for (const b of msg) {
    if (typeof b['text'] === 'string') content.push({ type: 'text', text: b['text'] });
    const use = b['toolUse'] as
      { toolUseId: string; name: string; input?: Record<string, unknown> } | undefined;
    if (use)
      content.push({ type: 'tool_use', id: use.toolUseId, name: use.name, input: use.input ?? {} });
  }
  const stop = body['stopReason'];
  // [PCODE-327 | S15 | v0.1.0] Converse counts the cache apart from the input
  const u = (body['usage'] ?? {}) as {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
  };
  return {
    content,
    stopReason:
      stop === 'end_turn' || stop === 'tool_use' || stop === 'max_tokens' ? stop : 'other',
    usage: {
      input: u.inputTokens ?? 0,
      output: u.outputTokens ?? 0,
      cacheRead: u.cacheReadInputTokens ?? 0,
      cacheWrite: u.cacheWriteInputTokens ?? 0,
    },
  };
}
