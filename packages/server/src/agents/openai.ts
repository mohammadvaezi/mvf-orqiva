// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
//    Why:  OpenAI, Azure OpenAI (its v1 API) and xAI Grok speak the same Chat Completions dialect, so one
//          translation serves all three: the system prompt becomes the first message, tool calls travel as
//          function calls with their arguments as a JSON string, and tool results come back as messages of
//          the role "tool". Pictures go as data URLs; PDFs as files where the provider reads them. What
//          differs is only the address, the header that carries the key and the name of the token limit.
import {
  callProvider,
  ProviderError,
  type Block,
  type ModelMessage,
  type ModelProvider,
  type ModelReply,
} from './provider.js';

export interface ChatCompletionsOptions {
  name: 'openai' | 'azure' | 'xai';
  /** up to and without "/chat/completions" */
  base: string;
  headers: Record<string, string>;
  /** reasoning models (GPT-5, o-series) take max_completion_tokens and only the default temperature */
  tokenField: 'max_tokens' | 'max_completion_tokens';
  pdf: boolean;
}

export const openaiProvider = (apiKey: string, fetchImpl: typeof fetch = fetch): ModelProvider =>
  chatCompletionsProvider(
    {
      name: 'openai',
      base: 'https://api.openai.com/v1',
      headers: { authorization: 'Bearer ' + apiKey },
      tokenField: 'max_completion_tokens',
      pdf: true,
    },
    fetchImpl,
  );

/** Azure OpenAI's v1 API: the model is the deployment's name. */
export const azureProvider = (
  endpoint: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): ModelProvider =>
  chatCompletionsProvider(
    {
      name: 'azure',
      base: azureBase(endpoint),
      headers: { 'api-key': apiKey },
      tokenField: 'max_completion_tokens',
      pdf: true,
    },
    fetchImpl,
  );

export const azureBase = (endpoint: string): string =>
  endpoint.replace(/\/+$/, '').replace(/\/openai(\/v1)?$/, '') + '/openai/v1';

export const xaiProvider = (apiKey: string, fetchImpl: typeof fetch = fetch): ModelProvider =>
  chatCompletionsProvider(
    {
      name: 'xai',
      base: 'https://api.x.ai/v1',
      headers: { authorization: 'Bearer ' + apiKey },
      tokenField: 'max_tokens',
      pdf: false,
    },
    fetchImpl,
  );

const REASONING = /^(o\d|gpt-5)/i;

export function chatCompletionsProvider(
  o: ChatCompletionsOptions,
  fetchImpl: typeof fetch = fetch,
): ModelProvider {
  return {
    name: o.name,
    async complete(req) {
      const reasoning = REASONING.test(req.model);
      const body = await callProvider(fetchImpl, o.base + '/chat/completions', {
        headers: { 'content-type': 'application/json', ...o.headers },
        body: JSON.stringify({
          model: req.model,
          messages: [
            ...(req.system ? [{ role: 'system', content: req.system }] : []),
            ...req.messages.flatMap((m) => chatMessages(m, o)),
          ],
          [reasoning ? 'max_completion_tokens' : o.tokenField]: req.maxTokens,
          ...(req.temperature !== undefined && !reasoning ? { temperature: req.temperature } : {}),
          ...(req.tools.length
            ? {
                tools: req.tools.map((t) => ({
                  type: 'function',
                  function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.input_schema,
                  },
                })),
              }
            : {}),
        }),
      });
      return chatReply(body);
    },
  };
}

function chatMessages(m: ModelMessage, o: ChatCompletionsOptions): Record<string, unknown>[] {
  if (m.role === 'assistant') {
    const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
    const calls = m.content.flatMap((b) =>
      b.type === 'tool_use'
        ? [
            {
              id: b.id,
              type: 'function',
              function: { name: b.name, arguments: JSON.stringify(b.input) },
            },
          ]
        : [],
    );
    return [
      {
        role: 'assistant',
        content: text || null,
        ...(calls.length ? { tool_calls: calls } : {}),
      },
    ];
  }
  // tool results first: they must follow the assistant's calls directly
  const results = m.content.flatMap((b) =>
    b.type === 'tool_result'
      ? [
          {
            role: 'tool',
            tool_call_id: b.tool_use_id,
            content: b.is_error ? 'Error: ' + b.content : b.content,
          },
        ]
      : [],
  );
  const parts = m.content.flatMap((b) => userPart(b, o));
  return [...results, ...(parts.length ? [{ role: 'user', content: parts }] : [])];
}

function userPart(b: Block, o: ChatCompletionsOptions): Record<string, unknown>[] {
  switch (b.type) {
    case 'text':
      return [{ type: 'text', text: b.text }];
    case 'image':
      return [{ type: 'image_url', image_url: { url: 'data:' + b.mime + ';base64,' + b.data } }];
    case 'document':
      if (!o.pdf)
        throw new ProviderError(
          (o.name === 'xai' ? 'Grok' : o.name) +
            ' does not read PDF files; choose another connection',
        );
      return [
        {
          type: 'file',
          file: { filename: b.name, file_data: 'data:application/pdf;base64,' + b.data },
        },
      ];
    default:
      return [];
  }
}

export function chatReply(body: Record<string, unknown>): ModelReply {
  const choice = ((body['choices'] ?? []) as Record<string, unknown>[])[0] ?? {};
  const msg = (choice['message'] ?? {}) as {
    content?: string | null;
    tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  };
  const content: Block[] = [];
  if (msg.content) content.push({ type: 'text', text: msg.content });
  for (const call of msg.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(call.function.arguments || '{}');
      if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>;
    } catch {
      input = { _unparsed: call.function.arguments };
    }
    content.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
  }
  const finish = choice['finish_reason'];
  // [PCODE-327 | S15 | v0.1.0] prompt_tokens includes the cached part, completion_tokens the reasoning
  const usage = (body['usage'] ?? {}) as {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    content,
    stopReason:
      finish === 'tool_calls' || (msg.tool_calls?.length ?? 0) > 0
        ? 'tool_use'
        : finish === 'stop'
          ? 'end_turn'
          : finish === 'length'
            ? 'max_tokens'
            : 'other',
    usage: {
      input: Math.max(0, (usage.prompt_tokens ?? 0) - cached),
      output: usage.completion_tokens ?? 0,
      cacheRead: cached,
      reasoning: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    },
  };
}
