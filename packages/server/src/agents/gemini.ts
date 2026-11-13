// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
//    Why:  Google's Gemini API (generateContent) in our request shape. The assistant is "model", a tool call is
//          a functionCall part and its result a functionResponse part that names the function, not the
//          call, so the names are looked up from the earlier turns. Gemini's thinking models sign their
//          function calls; the signature goes back with the call on the next turn, or the API refuses it.
//          Gemini reads only a subset of JSON Schema in tool parameters, so the rest is left out.
import {
  callProvider,
  type Block,
  type ModelMessage,
  type ModelProvider,
  type ModelReply,
} from './provider.js';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function geminiProvider(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  base = GEMINI_BASE,
): ModelProvider {
  return {
    name: 'gemini',
    async complete(req) {
      const names = new Map<string, string>();
      for (const m of req.messages)
        for (const b of m.content) if (b.type === 'tool_use') names.set(b.id, b.name);
      const body = await callProvider(
        fetchImpl,
        base + '/models/' + encodeURIComponent(req.model) + ':generateContent',
        {
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
            contents: req.messages.map((m) => geminiContent(m, names)),
            ...(req.tools.length
              ? {
                  tools: [
                    {
                      functionDeclarations: req.tools.map((t) => ({
                        name: t.name,
                        description: t.description,
                        parameters: geminiSchema(t.input_schema),
                      })),
                    },
                  ],
                }
              : {}),
            generationConfig: {
              maxOutputTokens: req.maxTokens,
              ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
            },
          }),
        },
      );
      return geminiReply(body);
    },
  };
}

function geminiContent(m: ModelMessage, names: Map<string, string>): Record<string, unknown> {
  return {
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: m.content.flatMap((b): Record<string, unknown>[] => {
      switch (b.type) {
        case 'text':
          return b.text ? [{ text: b.text }] : [];
        case 'tool_use':
          return [
            {
              functionCall: { name: b.name, args: b.input },
              ...(b.signature ? { thoughtSignature: b.signature } : {}),
            },
          ];
        case 'tool_result':
          return [
            {
              functionResponse: {
                name: names.get(b.tool_use_id) ?? 'tool',
                response: b.is_error ? { error: b.content } : { content: b.content },
              },
            },
          ];
        case 'image':
          return [{ inlineData: { mimeType: b.mime, data: b.data } }];
        case 'document':
          return [{ inlineData: { mimeType: 'application/pdf', data: b.data } }];
      }
    }),
  };
}

const SCHEMA_KEYS = new Set([
  'type',
  'description',
  'properties',
  'required',
  'items',
  'enum',
  'format',
  'nullable',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
]);

/** JSON Schema cut down to what Gemini's function declarations accept. */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (!SCHEMA_KEYS.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([p, s]) => [p, geminiSchema(s)]),
      );
    } else if (k === 'items') out[k] = geminiSchema(v);
    // a union of types ("string" or null) becomes the type with nullable
    else if (k === 'type' && Array.isArray(v)) {
      const types = v.filter((t) => t !== 'null');
      out['type'] = types[0] ?? 'string';
      if (types.length < v.length) out['nullable'] = true;
    } else out[k] = v;
  }
  return out;
}

export function geminiReply(body: Record<string, unknown>): ModelReply {
  const cand = ((body['candidates'] ?? []) as Record<string, unknown>[])[0] ?? {};
  const parts = (cand['content'] as { parts?: Record<string, unknown>[] } | undefined)?.parts ?? [];
  const content: Block[] = [];
  let n = 0;
  for (const p of parts) {
    if (p['thought'] === true) continue;
    const call = p['functionCall'] as
      { id?: string; name: string; args?: Record<string, unknown> } | undefined;
    if (call) {
      n += 1;
      content.push({
        type: 'tool_use',
        id: call.id ?? 'gemini-' + String(Date.now()) + '-' + String(n),
        name: call.name,
        input: call.args ?? {},
        ...(typeof p['thoughtSignature'] === 'string' ? { signature: p['thoughtSignature'] } : {}),
      });
    } else if (typeof p['text'] === 'string' && p['text']) {
      content.push({ type: 'text', text: p['text'] });
    }
  }
  const finish = cand['finishReason'];
  const u = (body['usageMetadata'] ?? {}) as {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    // [PCODE-327 | S15 | v0.1.0] part of the prompt, read from the context cache
    cachedContentTokenCount?: number;
  };
  const cached = u.cachedContentTokenCount ?? 0;
  return {
    content,
    stopReason: n
      ? 'tool_use'
      : finish === 'STOP'
        ? 'end_turn'
        : finish === 'MAX_TOKENS'
          ? 'max_tokens'
          : 'other',
    // thinking is billed as output
    usage: {
      input: Math.max(0, (u.promptTokenCount ?? 0) - cached),
      output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      cacheRead: cached,
      reasoning: u.thoughtsTokenCount ?? 0,
    },
  };
}
