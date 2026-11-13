// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-298 | S15 | v0.1.0] T30.11 T30 exit check, docs and sprint close ──
//    Why:  the T30 exit as one design team's path, end to end against the real server: tokens with a theme
//          and an alias come in as W3C and go out for iOS and Android; the brand book reads them; the kit
//          scan and the agent rule; a component's live preview in the theme; a mockup's handoff spec; an
//          asset's sizes offered in the client portal; the client's pin on a shared design; a visual check
//          that fails on a change; accessibility reports; and the Figma sync against recorded answers.
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { lintA11y } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodePng } from '../../src/files/png.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { listenFetchable } from '../ports.js'; // [PCODE-365 | S15 | v0.1.0]

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);
const FIGMA_TOKEN = 'figd_exit-test-token-for-the-stand-in';
const FILE = 'Ab12Cd34Ef56Gh78Ij90';
const fixture = (name: string): string =>
  readFileSync(new URL('../fixtures/figma/' + name, import.meta.url), 'utf8');

/** A real PNG of one colour, with a dark square where asked. */
const png = (w: number, h: number, mark?: [number, number, number]): Buffer => {
  const data = new Uint8Array(w * h * 4).fill(255);
  if (mark)
    for (let y = mark[1]; y < mark[1] + mark[2]; y += 1)
      for (let x = mark[0]; x < mark[0] + mark[2]; x += 1)
        data.set([20, 20, 20, 255], (y * w + x) * 4);
  return encodePng({ width: w, height: h, data });
};

describe.skipIf(!hasDatabase)('T30 exit: UI kit and design (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let ines: Person;
  let figma: Server;
  let figmaUrl = '';
  let helio = '';
  let project = '';
  let button = '';
  let mockup = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const upload = async (name: string, data: Buffer, type = 'image/png'): Promise<string> =>
    (
      (await (
        await fetch(t.base + W('/files?name=' + name + '&projectId=' + project + '&read=0'), {
          method: 'POST',
          headers: { cookie: ada.cookie, 'content-type': type },
          body: data,
        })
      ).json()) as { id: string }
    ).id;
  const get = (who: Person, path: string): Promise<Response> =>
    fetch(t.base + path, { headers: { cookie: who.cookie } });

  beforeAll(async () => {
    figma = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.headers['x-figma-token'] !== FIGMA_TOKEN) {
        res.writeHead(403);
        res.end('{"status":403,"err":"Invalid token"}');
        return;
      }
      req.resume();
      req.on('end', () => {
        if (req.url?.endsWith('/variables/local')) res.end(fixture('variables-local.json'));
        else if (req.url?.endsWith('/components')) res.end(fixture('components.json'));
        else if (req.method === 'POST')
          res.end('{"status":200,"error":false,"meta":{"tempIdToRealId":{}}}');
        else {
          res.writeHead(404);
          res.end('{}');
        }
      });
    });
    await listenFetchable(figma); // [PCODE-365 | S15 | v0.1.0]
    figmaUrl = 'http://127.0.0.1:' + String((figma.address() as AddressInfo).port);

    t = await startTestApp();
    ada = await t.signup('Ada');
    helio = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' })).body.id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: helio });
    const inv = await t.call<{ invitation: { token: string } | null }>(
      ada,
      'POST',
      W('/clients/' + helio + '/contacts'),
      { email: 'ines@helio.example', portalRole: 'approver' },
    );
    const res = await fetch(
      t.base + '/auth/invitations/' + (inv.body.invitation?.token ?? '') + '/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ines', password: 'a client password 1' }),
      },
    );
    ines = {
      id: '',
      email: 'ines@helio.example',
      name: 'Ines',
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      workspaceId: ada.workspaceId,
    };
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    figma.close();
  });

  it('brings tokens in as W3C with a theme and an alias, and sends them out for iOS and Android', async () => {
    const text = JSON.stringify({
      $extensions: { 'com.orqiva.themes': [{ name: 'midnight', base: 'dark' }] },
      color: {
        $type: 'color',
        primary: {
          $value: '#4f46e5',
          $extensions: { 'com.orqiva.modes': { dark: '#818cf8', midnight: '#c4b5fd' } },
        },
        brand: { $value: '{color.primary}' },
        text: { $value: '#111827', $extensions: { 'com.orqiva.modes': { dark: '#f3f4f6' } } },
      },
      space: { $type: 'dimension', '4': { $value: '16px' } },
    });
    const dry = await t.call<{ added: string[] }>(ada, 'POST', P('/tokens/import'), {
      text,
      dryRun: true,
    });
    expect(dry.body.added).toEqual(['color.primary', 'color.brand', 'color.text', 'space.4']);
    expect((await t.call(ada, 'POST', P('/tokens/import'), { text })).status).toBe(201);
    const tokens = (
      await t.call<{ themes: { name: string }[]; aliasProblems: unknown[] }>(
        ada,
        'GET',
        P('/tokens'),
      )
    ).body;
    expect(tokens.themes.map((x) => x.name)).toEqual(['midnight']);
    expect(tokens.aliasProblems).toEqual([]);
    // iOS as one Swift file, Android as resource folders in a ZIP
    const ios = await get(ada, P('/tokens/export?format=ios'));
    expect(ios.headers.get('content-disposition')).toMatch(/\.swift/);
    expect(await ios.text()).toContain('midnight');
    const android = await get(ada, P('/tokens/export?format=android'));
    expect(android.headers.get('content-type')).toBe('application/zip');
  });

  it('shows the brand book from the tokens, and the kit in the code and in the agent rule', async () => {
    await t.call(ada, 'PUT', P('/brand/voice'), { body: 'Short sentences. We say **you**.' });
    const book = (await t.call<{ palette: { group: string }[] }>(ada, 'GET', P('/brand'))).body;
    expect(book.palette.map((g) => g.group)).toContain('color');
    expect(await (await get(ada, P('/brand/export'))).text()).toContain('Short sentences.');

    button = (
      await t.call<{ id: string }>(ada, 'POST', P('/components'), {
        name: 'Button',
        codePath: 'src/ui/Button.tsx',
      })
    ).body.id;
    await t.call(ada, 'POST', P('/kit-scan'), {
      files: 12,
      usage: [{ name: 'Button', count: 7, files: [{ path: 'src/pages/Cart.tsx', count: 4 }] }],
      findings: [
        {
          path: 'src/pages/Cart.tsx',
          line: 9,
          kind: 'colour',
          value: '#4f46e5',
          token: 'color.primary',
        },
      ],
    });
    const comps = (
      await t.call<{ name: string; usageCount: number }[]>(ada, 'GET', P('/components'))
    ).body;
    expect(comps.find((c) => c.name === 'Button')?.usageCount).toBe(7);
    const rule = (await t.call<{ rule: string }>(ada, 'GET', P('/kit-rule'))).body.rule;
    expect(rule).toContain('Components: Button (src/ui/Button.tsx).');
    expect(rule).toContain('Accessibility: every img has alt text');
  });

  it('previews a component in the theme, and hands a mockup over with its spec', async () => {
    await t.call(ada, 'PUT', W('/components/' + button + '/preview'), {
      html: '<button class="btn">Pay</button><script>steal()</script>',
      css: '.btn { background: var(--color-primary); }',
    });
    const page = await (
      await get(ada, W('/components/' + button + '/preview?theme=midnight'))
    ).text();
    expect(page).toContain('data-theme="midnight"');
    expect(page).toContain('--color-primary: #c4b5fd;');
    expect(page).not.toContain('<script>');

    mockup = (
      await t.call<{ id: string }>(ada, 'POST', P('/mockups'), {
        title: 'Cart',
        fileId: await upload('cart.png', png(400, 200)),
      })
    ).body.id;
    await t.call(ada, 'PUT', W('/mockups/' + mockup + '/handoff'), {
      version: 1,
      spec: {
        imageWidth: 400,
        imageHeight: 200,
        tokens: ['color.primary', 'space.4'],
        components: [button],
        states: [{ name: 'Empty', note: 'No items: show the empty cart' }],
        breakpoints: [{ name: 'Tablet', width: 768, note: '' }],
        measures: [{ x1: 0.1, y1: 0.5, x2: 0.14, y2: 0.5, label: 'Gap' }],
        exports: [
          { name: 'empty cart', x: 0, y: 0, w: 0.25, h: 0.5, formats: ['png'], scales: [1, 2] },
        ],
        notes: '',
      },
    });
    const md = await (await get(ada, W('/mockups/' + mockup + '/handoff/export'))).text();
    expect(md).toContain('# Handoff: Cart (version 1)');
    expect(md).toContain('| Gap | 16 px | 0 px | 16 px | space.4 |');
    expect(md).toContain('- Button (`src/ui/Button.tsx`)');
  });

  it('offers an asset with its sizes in the portal, and takes the client’s pin on a shared design', async () => {
    const asset = (
      await t.call<{ id: string }>(ada, 'POST', P('/assets'), {
        fileId: await upload('logo.png', png(300, 300)),
        name: 'Logo',
        kind: 'logo',
        licence: 'Own work',
        rights: 'All of Helio’s channels',
      })
    ).body.id;
    const size = await t.call(ada, 'POST', W('/assets/' + asset + '/renditions'), {
      fileId: await upload('logo-100.png', png(100, 100)),
      name: 'logo.png',
      preset: 'scales',
      width: 100,
      height: 100,
    });
    expect(size.status).toBe(201);
    await t.call(ada, 'PUT', W('/assets/' + asset + '/client'), { shared: true });
    const portal = (
      await t.call<{ assets: { name: string; sizes: unknown[] }[]; zipUrl: string }>(
        ines,
        'GET',
        W('/portal/assets'),
      )
    ).body;
    expect(portal.assets.map((a) => [a.name, a.sizes.length])).toEqual([['Logo', 1]]);
    expect((await get(ines, portal.zipUrl)).headers.get('content-type')).toBe('application/zip');

    await t.call(ada, 'PUT', W('/mockups/' + mockup + '/client'), { shared: true });
    expect(
      (
        await t.call(ines, 'POST', W('/portal/designs/' + mockup + '/pins'), {
          x: 0.3,
          y: 0.4,
          body: 'Bigger total, please',
        })
      ).status,
    ).toBe(201);
    const pins = (
      await t.call<{ pins: { body: string; fromClient: boolean }[] }>(
        ada,
        'GET',
        W('/mockups/' + mockup),
      )
    ).body.pins;
    expect(pins).toEqual([
      expect.objectContaining({ body: 'Bigger total, please', fromClient: true }),
    ]);
  });

  it('catches a visual change and keeps the accessibility reports', async () => {
    const check = async (data: Buffer) =>
      (
        await t.call<{ id: string; status: string; changed: number; diffUrl: string | null }>(
          ada,
          'POST',
          P('/visual/checks'),
          { name: 'Cart / desktop', fileId: await upload('shot.png', data), commit: 'c0ffee1' },
        )
      ).body;
    const first = await check(png(200, 100));
    expect(first.status).toBe('new');
    await t.call(ada, 'POST', W('/visual-runs/' + first.id + '/approve'), {});
    expect((await check(png(200, 100))).status).toBe('pass');
    const changed = await check(png(200, 100, [20, 20, 10]));
    expect(changed).toMatchObject({ status: 'fail', changed: 100 });
    expect((await get(ada, changed.diffUrl ?? '')).headers.get('content-type')).toBe('image/png');

    const findings = lintA11y(
      'src/pages/Cart.tsx',
      '<img src={logo} />\n<button><TrashIcon /></button>',
    );
    expect(findings.map((f) => f.rule)).toEqual(['alt-missing', 'name-missing']);
    await t.call(ada, 'POST', P('/a11y/code'), { files: 12, findings });
    await t.call(ada, 'POST', P('/a11y/pages'), {
      name: 'Cart',
      checked: { targets: 14, focusable: 14, images: 2 },
      findings: [{ rule: 'target-size', selector: 'button.qty', message: '16 × 16 px' }],
    });
    const a11y = (
      await t.call<{ code: { counts: Record<string, number> }; pages: { name: string }[] }>(
        ada,
        'GET',
        P('/a11y'),
      )
    ).body;
    expect(a11y.code.counts).toEqual({ 'alt-missing': 1, 'name-missing': 1 });
    expect(a11y.pages.map((p) => p.name)).toEqual(['Cart']);
  });

  it('syncs with Figma: compares, links the component, takes a variable', async () => {
    await t.call(ada, 'PUT', P('/figma'), {
      file: 'https://www.figma.com/design/' + FILE + '/Shop',
      token: FIGMA_TOKEN,
      apiUrl: figmaUrl,
    });
    const r = await t.call<{
      plan: {
        pull: { name: string }[];
        push: { name: string }[];
        conflicts: { name: string }[];
        inSync: number;
      };
      link: { componentsLinked: number };
    }>(ada, 'POST', P('/figma/check'), {});
    expect(r.status).toBe(200);
    // the alias and both colours are the same; Figma has a font family and weight, and a high-contrast mode
    expect(r.body.plan.pull.map((x) => x.name)).toEqual(['font.family.body', 'font.weight.bold']);
    expect(r.body.plan.inSync).toBe(2);
    expect(r.body.link.componentsLinked).toBe(1);
    const taken = await t.call<{ taken: number }>(ada, 'POST', P('/figma/apply'), {
      take: ['font.weight.bold'],
      send: [],
    });
    expect(taken.body.taken).toBe(1);
    const tokens = (
      await t.call<{ tokens: { name: string; valueLight: string }[] }>(ada, 'GET', P('/tokens'))
    ).body.tokens;
    expect(tokens.find((x) => x.name === 'font.weight.bold')?.valueLight).toBe('700');
  });
});
