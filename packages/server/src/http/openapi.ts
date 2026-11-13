// ── [PCODE-86 | S15 | v0.1.0] Write the HTTP server on Node built-ins: router, validation, error model, OpenAPI ──
//    Why:  the API documentation is generated from the route list, so it always matches what the server
//          accepts and returns. OpenAPI 3.1 is an open specification; the generator is ours.
import type { Route } from './router.js';

const ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'requestId'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        requestId: { type: 'string' },
        details: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'message'],
            properties: { path: { type: 'string' }, message: { type: 'string' } },
          },
        },
      },
    },
  },
};

/** Query or path parameters from an object schema's JSON form. */
function parameters(where: 'path' | 'query', json: Record<string, unknown> | undefined): unknown[] {
  const props = (json?.['properties'] ?? {}) as Record<string, unknown>;
  const required = new Set((json?.['required'] ?? []) as string[]);
  return Object.entries(props).map(([name, schema]) => ({
    name,
    in: where,
    required: where === 'path' || required.has(name),
    schema,
  }));
}

export function openApiDocument(
  routes: readonly Route[],
  info: { title: string; version: string },
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const path = r.path.replace(/:([^/]+)/g, '{$1}');
    const op: Record<string, unknown> = {
      summary: r.summary,
      operationId:
        r.method.toLowerCase() +
        r.path.replace(/[/:]+(\w)/g, (_m: string, c: string) => c.toUpperCase()),
      ...(r.tags ? { tags: r.tags } : {}),
      parameters: [
        ...parameters('path', r.params?.json()),
        ...parameters('query', r.query?.json()),
      ],
      responses: {
        [String(r.status ?? 200)]: {
          description: 'Success',
          content: { 'application/json': { schema: r.response.json() } },
        },
        default: {
          description: 'Error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    };
    if (r.body) {
      op['requestBody'] = {
        required: !r.body.optional,
        content: { 'application/json': { schema: r.body.json() } },
      };
    }
    paths[path] ??= {};
    paths[path][r.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.1.0',
    info,
    paths,
    components: { schemas: { Error: ERROR_SCHEMA } },
  };
}
