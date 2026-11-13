// ── [PCODE-292 | S15 | v0.1.0] T30.6 Handoff specs per mockup: tokens, components, states, breakpoints, measures, export areas ──
//    Why:  the handoff spec on the server: one per mockup version, carried over to a newer version until it
//          gets its own, written by members only, components only of the project, problems when the kit
//          changed, and the Markdown and JSON export.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe.skipIf(!hasDatabase)('handoff specs (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let aud: Person;
  let project = '';
  let other = '';
  let button = '';
  let foreign = '';
  let mockup = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const upload = async (): Promise<string> =>
    (
      (await (
        await fetch(t.base + W('/files?name=screen.png&projectId=' + project), {
          method: 'POST',
          headers: { cookie: ada.cookie, 'content-type': 'image/png' },
          body: PNG,
        })
      ).json()) as { id: string }
    ).id;
  const spec = (over: Record<string, unknown> = {}) => ({
    imageWidth: 1000,
    imageHeight: 500,
    tokens: ['color.primary', 'space.6'],
    components: [button],
    states: [{ name: 'Loading', note: 'Spinner in the button' }],
    breakpoints: [{ name: 'Tablet', width: 768, note: '' }],
    measures: [{ x1: 0.1, y1: 0.2, x2: 0.124, y2: 0.2, label: 'Gap' }],
    exports: [
      { name: 'hero art', x: 0, y: 0, w: 0.5, h: 0.5, formats: ['png', 'svg'], scales: [2, 1, 2] },
    ],
    notes: '  Build on the card layout.  ',
    ...over,
  });
  type Out = {
    version: number;
    specVersion: number | null;
    carried: boolean;
    spec: { tokens: string[]; notes: string; exports: { scales: number[] }[] };
    problems: string[];
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    aud = await t.signup('Aud');
    await t.call(ada, 'POST', W('/members'), { email: aud.email, role: 'auditor' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HND', name: 'Handoff' })
    ).body.id;
    other = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OTH', name: 'Other' })
    ).body.id;
    await t.call(ada, 'PUT', P('/tokens/color.primary'), { type: 'color', valueLight: '#4f46e5' });
    await t.call(ada, 'PUT', P('/tokens/space.6'), { type: 'dimension', valueLight: '24px' });
    button = (
      await t.call<{ id: string }>(ada, 'POST', P('/components'), {
        name: 'Button',
        codePath: 'src/ui/Button.tsx',
      })
    ).body.id;
    foreign = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + other + '/components'), {
        name: 'Elsewhere',
      })
    ).body.id;
    mockup = (
      await t.call<{ id: string }>(ada, 'POST', P('/mockups'), {
        title: 'Checkout screen',
        fileId: await upload(),
      })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps a spec per version, carries it over and reports what left the kit', async () => {
    const H = W('/mockups/' + mockup + '/handoff');
    const empty = await t.call<Out>(aud, 'GET', H);
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ version: 1, specVersion: null, carried: false });
    expect((await t.call(aud, 'PUT', H, { version: 1, spec: spec() })).status).toBe(403);
    expect(
      (await t.call(ada, 'PUT', H, { version: 1, spec: spec({ components: [foreign] }) })).status,
    ).toBe(400);
    expect((await t.call(ada, 'PUT', H, { version: 7, spec: spec() })).status).toBe(404);
    const put = await t.call<Out>(ada, 'PUT', H, { version: 1, spec: spec() });
    expect(put.status).toBe(200);
    expect(put.body.spec.notes).toBe('Build on the card layout.');
    expect(put.body.spec.exports[0]?.scales).toEqual([1, 2]);
    expect(put.body.problems).toEqual([]);

    // a new version shows the spec of version 1 until it gets its own
    await t.call(ada, 'POST', W('/mockups/' + mockup + '/versions'), { fileId: await upload() });
    const carried = await t.call<Out>(aud, 'GET', H);
    expect(carried.body).toMatchObject({ version: 2, specVersion: 1, carried: true });
    await t.call(ada, 'PUT', H, { version: 2, spec: spec({ tokens: ['color.primary'] }) });
    expect((await t.call<Out>(aud, 'GET', H + '?version=1')).body.spec.tokens).toEqual([
      'color.primary',
      'space.6',
    ]);
    expect((await t.call<Out>(aud, 'GET', H + '?version=2')).body.carried).toBe(false);

    // the kit changes under the spec
    await t.call(ada, 'DELETE', P('/tokens/space.6'));
    await t.call(ada, 'DELETE', W('/components/' + button));
    expect((await t.call<Out>(aud, 'GET', H + '?version=1')).body.problems).toEqual([
      'Token space.6 no longer exists',
      '1 component was removed',
    ]);
  });

  it('exports the spec as Markdown and JSON', async () => {
    const E = t.base + W('/mockups/' + mockup + '/handoff/export');
    await t.call(ada, 'PUT', P('/tokens/space.6'), { type: 'dimension', valueLight: '24px' });
    const md = await fetch(E + '?version=1', { headers: { cookie: aud.cookie } });
    expect(md.headers.get('content-type')).toContain('text/markdown');
    expect(md.headers.get('content-disposition')).toContain('handoff-checkout-screen-v1.md');
    const text = await md.text();
    expect(text).toContain('# Handoff: Checkout screen (version 1)');
    expect(text).toContain('| `color.primary` | #4f46e5 | #4f46e5 |');
    expect(text).toContain('| Gap | 24 px | 0 px | 24 px | space.6 |');
    expect(text).toContain('**Loading**: Spinner in the button');
    expect(text).toContain('**Tablet** from 768 px');
    expect(text).toContain('hero-art.png, hero-art@2x.png, hero-art.svg');
    const json = (await (
      await fetch(E + '?format=json', { headers: { cookie: aud.cookie } })
    ).json()) as { specVersion: number; tokens: { name: string }[]; mockup: { version: number } };
    expect(json.specVersion).toBe(2);
    expect(json.mockup.version).toBe(2);
    expect(json.tokens.map((x) => x.name)).toEqual(['color.primary']);
  });
});
