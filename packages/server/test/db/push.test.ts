// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-273 | S15 | v0.1.0] T28.2 Interview steered by coverage; handed-over questions notify their owner ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
//    Why:  the message encryption against RFC 8291's own example, the VAPID token checked with the public
//          key as a push service would, and the four notifications end to end against a fake push service
//          on this machine: who gets them, who does not, choices, and devices that went away.
import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mentionsIn } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  scriptedProvider,
  type ModelProvider,
  type ModelReply,
} from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { allowedEndpoint, pumpWorkspace, vapidKeys } from '../../src/push/dispatch.js';
import { decryptPush, encryptPush, newVapidKeys, vapidHeader } from '../../src/push/webpush.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { listenFetchable } from '../ports.js'; // [PCODE-365 | S15 | v0.1.0]

process.env['ORQIVA_SECRET_KEY'] = '6c'.repeat(32);

const b64 = (s: string): Buffer => Buffer.from(s, 'base64url');

describe('Web Push encryption and VAPID', () => {
  it('encrypts RFC 8291 section 5 byte for byte', () => {
    const out = encryptPush(
      {
        p256dh:
          'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
      Buffer.from('When I grow up, I want to be a watermelon'),
      {
        senderPrivate: b64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
        salt: b64('DGv6ra1nlYgDCS1FRnbzlw'),
      },
    );
    expect(out.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
    // and the browser's side opens it
    expect(
      decryptPush(
        b64('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94'),
        'BTBZMqHH6r4Tts7J_aSIgg',
        out,
      ).toString(),
    ).toBe('When I grow up, I want to be a watermelon');
  });

  it('signs a VAPID token for the push service origin that verifies with the public key', () => {
    const keys = newVapidKeys();
    const now = new Date('2026-10-04T12:00:00Z');
    const h = vapidHeader(
      'https://fcm.googleapis.com/fcm/send/abc',
      keys,
      'mailto:ops@example.test',
      now,
    );
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h);
    expect(m).not.toBeNull();
    const [, head = '', claims = '', sig = '', k = ''] = m ?? [];
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(b64(head).toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(b64(claims).toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
      sub: 'mailto:ops@example.test',
    });
    const point = b64(k);
    const pub = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    expect(
      verify(
        'sha256',
        Buffer.from(head + '.' + claims),
        { key: pub, dsaEncoding: 'ieee-p1363' },
        b64(sig),
      ),
    ).toBe(true);
  });

  it('sends only to the known push services over HTTPS', () => {
    const ok = (u: string): boolean => allowedEndpoint(new URL(u));
    expect(ok('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(ok('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(ok('https://web.push.apple.com/x')).toBe(true);
    expect(ok('https://db5p.notify.windows.com/w/?token=x')).toBe(true);
    expect(ok('http://fcm.googleapis.com/fcm/send/x')).toBe(false);
    expect(ok('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(ok('https://fcm.googleapis.com.evil.example/x')).toBe(false);
  });

  it('finds mentions by address or by name without spaces', () => {
    const people = [
      { id: '1', name: 'Ada Lovelace', email: 'ada@example.test' },
      { id: '2', name: 'Bob', email: 'bob.2@example.test' },
      { id: '3', name: 'Cy', email: 'cy@example.test' },
    ];
    expect(mentionsIn('@AdaLovelace and @bob.2, please.', people).map((p) => p.id)).toEqual([
      '1',
      '2',
    ]);
    expect(mentionsIn('mail cy@example.test, no @nobody', people)).toEqual([]);
    expect(mentionsIn('(@CY)', people).map((p) => p.id)).toEqual(['3']);
  });
});

describe.skipIf(!hasDatabase)('notifications (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person; // owner, starts agents
  let bob: Person; // member, gets mentioned
  let cy: Person; // member, does the work
  let project = '';
  let item = '';
  let service: Server;
  let serviceBase = '';
  let current: ModelProvider | null = null;
  const received: { path: string; headers: Record<string, unknown>; body: Buffer }[] = [];
  const devices = new Map<string, { priv: Buffer; auth: string }>();
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const L = (p = ''): string => W('/projects/' + project + '/lifecycle' + p);

  const subscribe = async (who: Person, name: string) => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const auth = randomBytes(16).toString('base64url');
    devices.set('/push/' + name, { priv: ecdh.getPrivateKey(), auth });
    return t.call<{ id: string }>(who, 'POST', '/api/push/subscriptions', {
      endpoint: serviceBase + '/push/' + name,
      keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth },
      device: name,
    });
  };
  const pump = () =>
    pumpWorkspace(t.db.pool, ada.workspaceId, {
      allowEndpoint: () => true,
      subject: 'mailto:ops@example.test',
      keys: () => vapidKeys(t.db.pool),
    });
  /** what each device was told since the last call: path → titles */
  const inbox = (): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const r of received.splice(0)) {
      const dev = devices.get(r.path);
      if (!dev) continue;
      const msg = JSON.parse(decryptPush(dev.priv, dev.auth, r.body).toString()) as {
        title: string;
      };
      (out[r.path.slice(6)] ??= []).push(msg.title);
    }
    return out;
  };

  beforeAll(async () => {
    service = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) });
        res.statusCode = req.url?.startsWith('/push/gone') ? 410 : 201;
        res.end();
      });
    });
    await listenFetchable(service); // [PCODE-365 | S15 | v0.1.0]
    serviceBase = 'http://127.0.0.1:' + String((service.address() as AddressInfo).port);
    t = await startTestApp({
      push: { allowEndpoint: (u) => u.hostname === '127.0.0.1' },
      agents: {
        provider: () => {
          if (!current) throw new Error('no script');
          return Promise.resolve(current);
        },
      },
    });
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Export the report',
      })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    await new Promise((r) => service.close(r));
  });

  it('adds devices with our key, and refuses addresses that are not push services', async () => {
    const before = await t.call<{ publicKey: string; devices: unknown[] }>(ada, 'GET', '/api/push');
    expect(b64(before.body.publicKey)).toHaveLength(65);
    expect(before.body.devices).toEqual([]);
    expect((await subscribe(ada, 'ada-phone')).status).toBe(201);
    expect((await subscribe(bob, 'bob-laptop')).status).toBe(201);
    const evil = await t.call(cy, 'POST', '/api/push/subscriptions', {
      endpoint: 'https://metadata.example/latest',
      keys: { p256dh: 'BCVx', auth: 'x' },
    });
    expect(evil.status).toBe(400);
    const mine = await t.call<{ devices: { device: string }[]; preferences: unknown }>(
      ada,
      'GET',
      '/api/push',
    );
    expect(mine.body.devices.map((d) => d.device)).toEqual(['ada-phone']);
    expect(mine.body.preferences).toEqual({
      approvals: true,
      gates: true,
      deploys: true,
      mentions: true,
    });
    // the test message reaches the device and carries a VAPID token for the service
    expect((await t.call(ada, 'POST', '/api/push/test')).body).toEqual({ sent: 1, devices: 1 });
    const r = received[0];
    expect(String(r?.headers['authorization'])).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    expect(r?.headers['content-encoding']).toBe('aes128gcm');
    expect(inbox()).toEqual({ 'ada-phone': ['Orqiva notifications work'] });
  });

  it('tells the people mentioned in a comment, not the writer, and only about new mentions on edit', async () => {
    const c = await t.call<{ id: string }>(cy, 'POST', W('/items/' + item + '/comments'), {
      body: 'Could @' + (bob.email.split('@')[0] ?? '') + ' and @cy.3 look at this?',
    });
    expect(c.status).toBe(201);
    expect(await pump()).toBe(1);
    expect(inbox()).toEqual({ 'bob-laptop': ['Cy mentioned you on APP-1 Export the report'] });
    await t.call(cy, 'PATCH', W('/comments/' + c.body.id), {
      body: 'Could @' + (bob.email.split('@')[0] ?? '') + ' and @ada.1 look at this?',
    });
    await pump();
    expect(inbox()).toEqual({ 'ada-phone': ['Cy mentioned you on APP-1 Export the report'] });
  });

  // [PCODE-273 | S15 | v0.1.0]
  it('tells the person a question or risk of an idea is handed to, once, never the one handing it', async () => {
    const idea = (
      await t.call<{ id: string }>(cy, 'POST', W('/projects/' + project + '/ideas'), {
        title: 'Live tracking',
      })
    ).body.id;
    const q = await t.call<{ id: string }>(cy, 'POST', W('/ideas/' + idea + '/questions'), {
      text: 'Which carriers send positions?',
      ownerId: bob.id,
    });
    expect(q.status).toBe(201);
    expect(await pump()).toBe(1);
    expect(inbox()).toEqual({ 'bob-laptop': ['Cy handed you a question on APP Live tracking'] });
    const entry = (
      await t.call<{ items: { title: string; detail: string; objectId: string; url: string }[] }>(
        bob,
        'GET',
        W('/inbox'),
      )
    ).body.items.find((i) => i.objectId === idea);
    expect(entry).toMatchObject({
      title: 'Cy handed you a question on APP Live tracking',
      detail: 'Which carriers send positions?',
      url: '/projects/' + project + '/ideas?idea=' + idea + '&sub=questions',
    });
    // the answer, or handing it to oneself, tells nobody
    await t.call(cy, 'PATCH', W('/idea-questions/' + q.body.id), { answer: 'DHL and UPS' });
    await t.call(cy, 'POST', W('/ideas/' + idea + '/risks'), { text: 'Mine', ownerId: cy.id });
    expect(await pump()).toBe(0);
    await t.call(cy, 'POST', W('/ideas/' + idea + '/risks'), {
      text: 'Carriers stop sending',
      ownerId: ada.id,
    });
    await pump();
    expect(inbox()).toEqual({ 'ada-phone': ['Cy handed you a risk on APP Live tracking'] });
  });

  it('respects what each person turned off', async () => {
    const off = await t.call(bob, 'PUT', '/api/push/preferences', {
      approvals: true,
      gates: true,
      deploys: true,
      mentions: false,
    });
    expect(off.status).toBe(200);
    await t.call(cy, 'POST', W('/items/' + item + '/comments'), { body: '@bob.2 again' });
    expect(await pump()).toBe(0);
    expect(inbox()).toEqual({});
    await t.call(bob, 'PUT', '/api/push/preferences', {
      approvals: true,
      gates: true,
      deploys: true,
      mentions: true,
    });
  });

  it('tells the requester when an agent waits for approval', async () => {
    const use = (name: string, input: Record<string, unknown>): ModelReply['content'][number] => ({
      type: 'tool_use',
      id: name + '-1',
      name,
      input,
    });
    current = scriptedProvider([
      {
        content: [use('move_item', { ref: 'APP-1', state: 'In Progress' })],
        stopReason: 'tool_use',
        usage: { input: 10, output: 5 },
      },
    ]);
    const agents = await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'));
    const analyst = agents.body.find((a) => a.key === 'analyst')?.id ?? '';
    await t.call(ada, 'PUT', W('/agents/provider'), { provider: 'anthropic' });
    const run = await t.call<{ id: string }>(
      ada,
      'POST',
      W('/projects/' + project + '/agent-runs'),
      {
        agentId: analyst,
        instruction: 'Start APP-1',
        itemId: item,
      },
    );
    expect(run.status).toBe(201);
    const end = Date.now() + 10_000;
    for (;;) {
      const r = await t.call<{ run: { status: string } }>(
        ada,
        'GET',
        W('/agent-runs/' + run.body.id),
      );
      if (r.body.run.status === 'waiting') break;
      if (Date.now() > end) throw new Error('run stayed ' + r.body.run.status);
      await new Promise((res) => setTimeout(res, 50));
    }
    await pump();
    expect(inbox()).toEqual({ 'ada-phone': ['Analyst agent is waiting for your approval'] });
  });

  it('tells the signers once when a gate becomes ready, not the one who ticked it', async () => {
    await t.call(ada, 'POST', L(), {});
    type Life = {
      phases: {
        stages: { id: string; key: string }[];
        gate: { key: string; criteria: { id: string }[] } | null;
      }[];
    };
    let life = (await t.call<{ lifecycle: Life }>(ada, 'GET', L())).body.lifecycle;
    const stages = life.phases[0]?.stages ?? [];
    for (const st of stages) {
      await t.call(cy, 'POST', L('/stages/' + st.id), { status: 'active' });
      await t.call(cy, 'POST', L('/stages/' + st.id), { status: 'done' });
    }
    await pump();
    expect(inbox()).toEqual({});
    life = (await t.call<{ lifecycle: Life }>(ada, 'GET', L())).body.lifecycle;
    for (const c of life.phases[0]?.gate?.criteria ?? [])
      await t.call(cy, 'POST', L('/criteria/' + c.id), { met: true, evidence: 'yes' });
    await pump();
    // G1 is the owner's to sign: Ada, not Bob
    expect(inbox()).toEqual({ 'ada-phone': ['APP G1 Go / no-go is ready to sign'] });
    // a criterion ticked off and on again does not repeat it
    const first = life.phases[0]?.gate?.criteria[0]?.id ?? '';
    await t.call(cy, 'POST', L('/criteria/' + first), { met: false });
    await t.call(cy, 'POST', L('/criteria/' + first), { met: true });
    await pump();
    expect(inbox()).toEqual({});
  });

  it('tells the starter and the admins about a failed deploy, and forgets devices that went away', async () => {
    const env = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/environments'), {
        key: 'staging',
        name: 'Staging',
        kind: 'compose',
        settings: { dir: '/srv/app' },
      })
    ).body.id;
    const token = (await t.call<{ token: string }>(ada, 'POST', W('/runners'), { name: 'box' }))
      .body.token;
    const runner = (path: string, body?: unknown) =>
      fetch(t.base + path, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const d = await t.call<{ id: string }>(bob, 'POST', W('/environments/' + env + '/deploys'), {});
    expect((await runner('/api/runner/claim')).status).toBe(200);
    const fin = await runner('/api/runner/deploys/' + d.body.id + '/finish', {
      status: 'failed',
      error: 'docker compose up exited 1',
    });
    expect(fin.status).toBe(200);
    expect((await subscribe(ada, 'gone')).status).toBe(201);
    await pump();
    expect(inbox()).toEqual({
      'ada-phone': ['The deploy to Staging failed'],
      'bob-laptop': ['The deploy to Staging failed'],
      gone: ['The deploy to Staging failed'],
    });
    const left = await inSystem(t.db.pool, (c) =>
      c.query<{ device: string }>('SELECT device FROM push_subscriptions ORDER BY device'),
    );
    expect(left.rows.map((r) => r.device)).toEqual(['ada-phone', 'bob-laptop']);
    // removing this device
    const out = await t.call(bob, 'POST', '/api/push/unsubscribe', {
      endpoint: serviceBase + '/push/bob-laptop',
    });
    expect(out.body).toEqual({ removed: 1 });
  });
});
