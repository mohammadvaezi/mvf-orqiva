// ── [PCODE-319 | S15 | v0.1.0] T32.5a Bug capture on the server: a report with page, device, console, network and actions becomes a bug ──
//    Why:  the extension's path: a personal API token uploads the screenshot and files the report; the bug
//          has the sections and the screenshot inline, personal data masked; a file of another project or a
//          guest is refused.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodePng } from '../../src/files/png.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const REPORT = {
  title: 'Pay does nothing',
  note: 'Paid as ada@example.org, nothing happened.',
  page: { url: 'https://shop.test/checkout', title: 'Checkout' },
  device: {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
    platform: 'Linux',
    language: 'en-GB',
    viewport: { width: 1280, height: 720 },
    screen: { width: 1920, height: 1080, pixelRatio: 1 },
    timeZone: 'Europe/London',
  },
  console: [
    { level: 'error', text: 'TypeError: total is undefined', at: '2026-10-14T10:00:05.000Z' },
  ],
  network: [
    {
      method: 'POST',
      url: 'https://shop.test/api/pay?mail=ada@example.org',
      status: 502,
      ms: 1200,
      at: '2026-10-14T10:00:05.000Z',
    },
  ],
  actions: [{ kind: 'click', target: 'button "Pay"', at: '2026-10-14T10:00:04.000Z' }],
};

describe.skipIf(!hasDatabase)('bugs captured in the browser (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let gus: Person;
  let project = '';
  let other = '';
  let token = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const bearer = (path: string, init: RequestInit = {}) =>
    fetch(t.base + path, {
      ...init,
      headers: { authorization: 'Bearer ' + token, ...(init.headers as Record<string, string>) },
    });
  const upload = async (projectId: string): Promise<string> =>
    (
      (await (
        await bearer(W('/files?name=shot.png&projectId=' + projectId + '&read=0'), {
          method: 'POST',
          headers: { 'content-type': 'image/png' },
          body: encodePng({ width: 2, height: 2, data: new Uint8Array(16).fill(200) }),
        })
      ).json()) as { id: string }
    ).id;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    other = (await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OPS', name: 'Ops' }))
      .body.id;
    await t.call(ada, 'POST', W('/projects/' + project + '/guests'), { userId: gus.id });
    const res = await fetch(t.base + '/auth/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'capture', email: ada.email, password: 'a test password 1' }),
    });
    token = ((await res.json()) as { token: string }).token;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('files the capture as a bug with the screenshot and the sections, masked', async () => {
    const shot = await upload(project);
    const r = await bearer(W('/projects/' + project + '/bug-reports'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...REPORT, screenshotFileId: shot }),
    });
    expect(r.status).toBe(201);
    const made = (await r.json()) as { itemId: string; ref: string; url: string };
    expect(made.ref).toBe('SHOP-1');
    const item = await t.call<{
      title: string;
      kind: string;
      priority: string;
      description: string;
    }>(ada, 'GET', W('/items/' + made.itemId));
    expect(item.body).toMatchObject({ title: 'Pay does nothing', kind: 'bug', priority: 'medium' });
    const d = item.body.description;
    expect(d).toContain('Paid as [email], nothing happened.');
    expect(d).toContain('- Browser: Firefox 131 on Linux');
    expect(d).toContain(
      '![Screenshot](/api/workspaces/' + ada.workspaceId + '/files/' + shot + '/content)',
    );
    expect(d).toContain('- `POST https://shop.test/api/pay?mail=[email]` → 502 after 1200 ms');
    expect(d).not.toContain('ada@example.org');
  });

  it('refuses a file of another project and a guest', async () => {
    const elsewhere = await upload(other);
    const r = await bearer(W('/projects/' + project + '/bug-reports'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...REPORT, screenshotFileId: elsewhere }),
    });
    expect(r.status).toBe(400);
    expect(
      (await t.call(gus, 'POST', W('/projects/' + project + '/bug-reports'), REPORT)).status,
    ).toBe(403);
  });
});
