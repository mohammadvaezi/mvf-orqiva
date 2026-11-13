// ── [PCODE-291 | S15 | v0.1.0] T30.5 Live component preview with the project's tokens and themes ──
//    Why:  the preview page on the server: the tokens of the project in the theme asked for (an unknown
//          theme falls back to light), the example without anything that runs, a policy and a sandbox
//          of its own, framed only by Orqiva; only members change the example.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('component previews (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let aud: Person;
  let project = '';
  let comp = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    aud = await t.signup('Aud');
    await t.call(ada, 'POST', W('/members'), { email: aud.email, role: 'auditor' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'PRV', name: 'Preview' })
    ).body.id;
    await t.call(ada, 'POST', P('/token-themes'), { name: 'midnight', base: 'dark' });
    await t.call(ada, 'PUT', P('/tokens/color.primary'), {
      type: 'color',
      valueLight: '#4f46e5',
      valueDark: '#818cf8',
      themeValues: { midnight: '#c4b5fd' },
    });
    comp = (await t.call<{ id: string }>(ada, 'POST', P('/components'), { name: 'Button' })).body
      .id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('shows the example with the tokens in a theme, inert and framed only here', async () => {
    const set = await t.call<{ previewHtml: string }>(
      ada,
      'PUT',
      W('/components/' + comp + '/preview'),
      {
        html: '<button class="btn" onclick="x()">Save</button><script>steal()</script>',
        css: '.btn { background: var(--color-primary); color: white; }',
      },
    );
    expect(set.status).toBe(200);
    expect(set.body.previewHtml).toContain('onclick'); // kept as written, made safe when shown
    expect(
      (await t.call(aud, 'PUT', W('/components/' + comp + '/preview'), { html: '', css: '' }))
        .status,
    ).toBe(403);
    const get = (theme: string) =>
      fetch(t.base + W('/components/' + comp + '/preview?theme=' + theme), {
        headers: { cookie: aud.cookie },
      });
    const r = await get('midnight');
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(r.headers.get('content-disposition')).toMatch(/^inline/);
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(r.headers.get('content-security-policy')).toContain('sandbox');
    expect(r.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    const page = await r.text();
    expect(page).toContain('data-theme="midnight"');
    expect(page).toContain(":root[data-theme='midnight']");
    expect(page).toContain('--color-primary: #c4b5fd;');
    expect(page).toContain('<button class="btn">Save</button>');
    expect(page).not.toContain('<script>');
    expect(page).not.toContain('onclick');
    expect(await (await get('nope')).text()).toContain('data-theme="light"');
  });
});
