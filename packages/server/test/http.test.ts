// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-86 | S15 | v0.1.0] Write the HTTP server on Node built-ins: router, validation, error model, OpenAPI ──
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpError } from '../src/http/errors.js';
import { openApiDocument } from '../src/http/openapi.js';
import { Router, route, type Route } from '../src/http/router.js';
import { s, validate } from '../src/http/schema.js';
import { createHttpServer, type HttpServer } from '../src/http/server.js';
import { listenFetchable } from './ports.js'; // [PCODE-365 | S15 | v0.1.0]

const item = s.object({
  id: s.string({ format: 'uuid' }),
  title: s.string({ min: 1, max: 200 }),
  done: s.boolean(),
});
const ID = '0b6f2f43-7d6e-4f6c-9a39-2f1e3c4d5e6f';

const routes: Route[] = [
  route({
    method: 'GET',
    path: '/items/:id',
    summary: 'Read an item',
    params: s.object({ id: s.string({ format: 'uuid' }) }),
    query: s.object({ expand: s.optional(s.enum(['history', 'comments'])) }),
    response: item,
    handler: ({ params }) => {
      if (params.id !== ID) throw new HttpError(404, 'not_found', 'Item not found');
      return { body: { id: params.id, title: 'Write the router', done: false } };
    },
  }),
  route({
    method: 'POST',
    path: '/items',
    summary: 'Create an item',
    body: s.object({ title: s.string({ min: 1 }), labels: s.optional(s.array(s.string())) }),
    response: item,
    status: 201,
    handler: ({ body }) => ({ body: { id: ID, title: body.title, done: false } }),
  }),
  route({
    method: 'GET',
    path: '/broken',
    summary: 'Returns the wrong shape',
    response: item,
    handler: () => ({ body: { id: 'nope' } as never }),
  }),
  route({
    method: 'GET',
    path: '/boom',
    summary: 'Throws',
    response: s.anyObject(),
    handler: () => {
      throw new Error('database password is hunter2');
    },
  }),
  route({
    method: 'GET',
    path: '/slow',
    summary: 'Takes a while',
    response: s.object({ finished: s.boolean() }),
    handler: async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { body: { finished: true } };
    },
  }),
];

let app: HttpServer | null = null;
let base = '';

async function start(maxBodyBytes?: number): Promise<void> {
  app = createHttpServer({
    routes,
    checkResponses: true,
    ...(maxBodyBytes ? { maxBodyBytes } : {}),
  });
  const server = app.server;
  await listenFetchable(server); // [PCODE-365 | S15 | v0.1.0]
  base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
}

afterEach(async () => {
  if (app?.server.listening) await app.close(100);
  app = null;
});

async function call(
  method: string,
  path: string,
  body?: string,
  type = 'application/json',
): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
  const res = await fetch(base + path, {
    method,
    ...(body !== undefined ? { body, headers: { 'content-type': type } } : {}),
  });
  const text = await res.text();
  return {
    status: res.status,
    json: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
    headers: res.headers,
  };
}

describe('schemas', () => {
  it('names the path of every problem', () => {
    const r = validate(
      s.object({ a: s.array(s.object({ n: s.number({ integer: true }) })) }),
      { a: [{ n: 1 }, { n: 1.5 }, {}], b: 1 },
      'body',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toEqual([
        { path: 'body.a[1].n', message: 'must be an integer' },
        { path: 'body.a[2].n', message: 'is required' },
        { path: 'body.b', message: 'is not a known field' },
      ]);
    }
  });

  it('describes itself as JSON Schema', () => {
    expect(s.object({ x: s.string({ min: 1 }), y: s.optional(s.number()) }).json()).toEqual({
      type: 'object',
      properties: { x: { type: 'string', minLength: 1 }, y: { type: 'number' } },
      required: ['x'],
      additionalProperties: false,
    });
  });
});

describe('router', () => {
  it('refuses two routes for the same method and path shape', () => {
    expect(
      () => new Router([routes[0] as Route, { ...(routes[0] as Route), path: '/items/:other' }]),
    ).toThrow(/Duplicate route/);
  });
});

describe('HTTP pipeline', () => {
  it('routes with params and query, and sets a request id', async () => {
    await start();
    const r = await call('GET', '/items/' + ID + '?expand=history');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ id: ID, title: 'Write the router', done: false });
    expect(r.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers 404 for an unknown path and 405 with Allow for a wrong method', async () => {
    await start();
    expect((await call('GET', '/nowhere')).json).toMatchObject({ error: { code: 'not_found' } });
    const r = await call('DELETE', '/items');
    expect(r.status).toBe(405);
    expect(r.headers.get('allow')).toBe('POST');
  });

  it('returns 400 with field paths for invalid params, query and body together', async () => {
    await start();
    const bad = await call('GET', '/items/not-a-uuid?expand=everything');
    expect(bad.status).toBe(400);
    expect((bad.json['error'] as { details: unknown[] }).details).toEqual([
      { path: 'params.id', message: 'must be a valid uuid' },
      { path: 'query.expand', message: 'must be one of history, comments' },
    ]);
    const body = await call('POST', '/items', JSON.stringify({ title: '', colour: 'red' }));
    expect((body.json['error'] as { details: unknown[] }).details).toEqual([
      { path: 'body.title', message: 'must be at least 1 characters' },
      { path: 'body.colour', message: 'is not a known field' },
    ]);
  });

  it('creates with the route status', async () => {
    await start();
    const r = await call('POST', '/items', JSON.stringify({ title: 'New' }));
    expect(r.status).toBe(201);
  });

  it('refuses broken JSON, the wrong content type and an oversized body', async () => {
    await start(64);
    expect((await call('POST', '/items', '{"title":')).json).toMatchObject({
      error: { code: 'invalid_json' },
    });
    expect(
      (await call('POST', '/items', 'title=x', 'application/x-www-form-urlencoded')).status,
    ).toBe(415);
    expect((await call('POST', '/items', JSON.stringify({ title: 'x'.repeat(100) }))).status).toBe(
      413,
    );
  });

  it('hides internal errors behind a generic 500 and never leaks the message', async () => {
    await start();
    const r = await call('GET', '/boom');
    expect(r.status).toBe(500);
    expect(r.json).toMatchObject({
      error: { code: 'internal', message: 'Something went wrong on our side' },
    });
    expect(JSON.stringify(r.json)).not.toContain('hunter2');
  });

  it('turns a reply that breaks its own schema into a 500', async () => {
    await start();
    expect((await call('GET', '/broken')).status).toBe(500);
  });

  it('lets a running request finish during shutdown, then stops listening', async () => {
    await start();
    const pending = call('GET', '/slow');
    await new Promise((r) => setTimeout(r, 30));
    const closing = app?.close(2000);
    expect((await pending).json).toEqual({ finished: true });
    await closing;
    expect(app?.server.listening).toBe(false);
  });

  it('accepts no new connections once closing', async () => {
    await start();
    const port = (app?.server.address() as AddressInfo).port;
    await app?.close(100);
    await expect(
      new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path: '/health' }, resolve);
        req.on('error', reject);
        req.end();
      }),
    ).rejects.toThrow();
  });
});

describe('OpenAPI', () => {
  it('documents every route with its parameters, body and responses', () => {
    const doc = openApiDocument(routes, { title: 'T', version: '1' }) as {
      openapi: string;
      paths: Record<
        string,
        Record<
          string,
          {
            parameters: { name: string; in: string; required: boolean }[];
            requestBody?: unknown;
            responses: Record<string, unknown>;
          }
        >
      >;
    };
    expect(doc.openapi).toBe('3.1.0');
    const get = doc.paths['/items/{id}']?.['get'];
    expect(get?.parameters).toEqual([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
      expect.objectContaining({ name: 'expand', in: 'query', required: false }),
    ]);
    const post = doc.paths['/items']?.['post'];
    expect(post?.requestBody).toBeDefined();
    expect(Object.keys(post?.responses ?? {})).toEqual(['201', 'default']);
  });
});
