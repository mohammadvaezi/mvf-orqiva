// ── [PCODE-349 | S15 | v0.1.0] T35.2b Slack and Teams bridges, personal calendar feed, CI pipeline runs ──
// ── [PCODE-341 | S15 | v0.1.0] T34.2b Public status pages per client and environment; incident update templates ──
// ── [PCODE-337 | S15 | v0.1.0] T34.1b Request votes and duplicate merge, NPS survey, embeddable feedback widget ──
// ── [PCODE-216 | S15 | v0.1.0] T19.5 Own security review (authorization matrix over every route, headers, own scan) and the external pen-test brief ──
//    Why:  every route of the server, called by someone who should get nothing: without a session, and as
//          a person of another workspace, with made-up IDs and an empty body. None may succeed and none may
//          fail with a 500. The few routes that are public on purpose are named below; adding a route that
//          leaks makes this test fail, so the pen test meets an API that was checked route by route.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRoutes } from '../../src/app.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

/** Public on purpose: method + path, and why. */
const PUBLIC: Record<string, string> = {
  'GET /health': 'the load balancer asks it',
  // [PCODE-337 | S15 | v0.1.0]
  'GET /widget.js': 'the feedback widget’s script, loaded by the client’s own site',
  // [PCODE-341 | S15 | v0.1.0]
  'GET /api/public/status/:slug': 'a status page its client opened to everyone',
  // [PCODE-349 | S15 | v0.1.0]
  'GET /calendar/:file': 'a person’s calendar, read by their calendar app with the secret link',
  'GET /auth/providers': 'the sign-in page shows which sign-ins exist',
  'GET /openapi.json': 'the API description, generated from the route list',
  'GET /auth/saml/:workspaceId/metadata': 'SAML metadata is public by design (no secrets in it)',
  'GET /scim/v2/ServiceProviderConfig': 'SCIM discovery, the same for everyone',
  'GET /scim/v2/ResourceTypes': 'SCIM discovery',
  'GET /scim/v2/Schemas': 'SCIM discovery',
  // [PCODE-219 | S15 | v0.1.0] the pricing, for the buy page
  'GET /buy/offers': 'the plans and prices, the same for everyone',
};

const fill = (path: string, ws: string): string =>
  path.replace(/:workspaceId/g, ws).replace(/:[A-Za-z]+/g, '3fa85f64-5717-4562-b3fc-2c963f66afa6');

describe.skipIf(!hasDatabase)('authorization over every route (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let eve: Person;
  const routes = buildRoutes({ pool: undefined as never, secureCookies: false }).map((r) => ({
    method: r.method,
    path: r.path,
  }));

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    eve = await t.signup('Eve');
    // Ada's workspace has a project, so made-up IDs are not the only thing a leak could return
    await t.call(ada, 'POST', '/api/workspaces/' + ada.workspaceId + '/projects', {
      key: 'SEC',
      name: 'Secret',
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  const send = async (
    method: string,
    path: string,
    cookie?: string,
  ): Promise<{ status: number; body: string }> => {
    const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
    const res = await fetch(t.base + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
      },
      ...(hasBody ? { body: '{}' } : {}),
    });
    return { status: res.status, body: (await res.text()).slice(0, 300) };
  };

  it('covers every route', () => {
    expect(routes.length).toBeGreaterThan(400);
  });

  it('gives nothing to someone without a session', async () => {
    const leaks: string[] = [];
    for (const r of routes) {
      if (r.path.startsWith('/api/runner/')) continue; // runners use their own Bearer token (checked below)
      const key = r.method + ' ' + r.path;
      const res = await send(r.method, fill(r.path, ada.workspaceId));
      if (res.status >= 500) leaks.push(key + ' → ' + String(res.status) + ' ' + res.body);
      else if (res.status < 400 && !PUBLIC[key]) leaks.push(key + ' → ' + String(res.status));
    }
    expect(leaks).toEqual([]);
  }, 300_000);

  it('gives nothing of a workspace to a person of another one', async () => {
    const leaks: string[] = [];
    for (const r of routes) {
      if (!r.path.includes(':workspaceId')) continue;
      const key = r.method + ' ' + r.path;
      const res = await send(r.method, fill(r.path, ada.workspaceId), eve.cookie);
      if (res.status >= 500) leaks.push(key + ' → ' + String(res.status) + ' ' + res.body);
      else if (res.status < 400 && !PUBLIC[key]) leaks.push(key + ' → ' + String(res.status));
    }
    expect(leaks).toEqual([]);
  }, 300_000);

  it('refuses runner routes without a runner token', async () => {
    for (const r of routes.filter((x) => x.path.startsWith('/api/runner/'))) {
      // a session cookie is not a runner token: refused before the handler (400 on a body it takes no
      // part of) or by it (401), never served
      const res = await send(r.method, fill(r.path, ada.workspaceId), ada.cookie);
      expect([r.path, [400, 401].includes(res.status)]).toEqual([r.path, true]);
    }
  });

  it('sends the security headers on API answers', async () => {
    const res = await fetch(t.base + '/api/workspaces/' + ada.workspaceId + '/projects', {
      headers: { cookie: ada.cookie },
    });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control') ?? '').toContain('no-store');
  });
});
