// ── [PCODE-287 | S15 | v0.1.0] T30.1 Design tokens: themes and modes, aliases, W3C import, iOS and Android export ──
//    Why:  a theme on the server: its values kept only where they differ, refused for a theme the project
//          lacks, gone with the theme; aliases accepted and their gaps named; contrast checked in each
//          theme; a W3C file previewed then imported with its themes; iOS and Android files to download.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zipEntries, zipRead } from '../../src/files/docx.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)(
  'token themes, aliases, import and native export (PostgreSQL)',
  () => {
    let t: TestApp;
    let ada: Person;
    let project = '';
    const P = (p: string): string =>
      '/api/workspaces/' + ada.workspaceId + '/projects/' + project + p;
    type Tokens = {
      tokens: { name: string; themeValues: Record<string, string> }[];
      themes: { name: string; base: string }[];
      aliasProblems: { name: string; target: string; problem: string }[];
      contrast: { foreground: string; background: string; mode: string; grade: string }[];
    };

    beforeAll(async () => {
      t = await startTestApp();
      ada = await t.signup('Ada');
      project = (
        await t.call<{ id: string }>(
          ada,
          'POST',
          '/api/workspaces/' + ada.workspaceId + '/projects',
          {
            key: 'KIT',
            name: 'Kit',
          },
        )
      ).body.id;
    }, 60_000);

    afterAll(async () => {
      await t.stop();
    });

    it('keeps theme values per token, follows aliases and checks contrast per theme', async () => {
      expect(
        (await t.call(ada, 'POST', P('/token-themes'), { name: 'High-Contrast', base: 'light' }))
          .status,
      ).toBe(201);
      expect(
        (await t.call(ada, 'POST', P('/token-themes'), { name: 'dark', base: 'dark' })).status,
      ).toBe(400);
      await t.call(ada, 'PUT', P('/tokens/color.grey.400'), {
        type: 'color',
        valueLight: '#9ca3af',
      });
      const fg = await t.call(ada, 'PUT', P('/tokens/color.text'), {
        type: 'color',
        valueLight: '{color.grey.400}',
        themeValues: { 'high-contrast': '#000000' },
      });
      expect(fg.status).toBe(200);
      await t.call(ada, 'PUT', P('/tokens/color.bg'), { type: 'color', valueLight: '#ffffff' });
      await t.call(ada, 'PUT', P('/tokens/color.link'), {
        type: 'color',
        valueLight: '{color.gone}',
      });
      const wrong = await t.call(ada, 'PUT', P('/tokens/color.x'), {
        type: 'color',
        valueLight: '#fff',
        themeValues: { sepia: '#eee' },
      });
      expect(wrong.status).toBe(400);
      const self = await t.call(ada, 'PUT', P('/tokens/color.y'), {
        type: 'color',
        valueLight: '{color.y}',
      });
      expect(self.status).toBe(400);

      const r = (await t.call<Tokens>(ada, 'GET', P('/tokens'))).body;
      expect(r.themes).toEqual([expect.objectContaining({ name: 'high-contrast', base: 'light' })]);
      expect(r.tokens.find((x) => x.name === 'color.text')?.themeValues).toEqual({
        'high-contrast': '#000000',
      });
      expect(r.aliasProblems).toEqual([
        expect.objectContaining({ name: 'color.link', target: 'color.gone', problem: 'missing' }),
      ]);
      const pairs = r.contrast.filter((x) => x.foreground === 'color.text');
      expect(pairs.map((x) => [x.mode, x.grade])).toEqual([
        ['light', 'fail'],
        ['high-contrast', 'AAA'],
      ]);

      await t.call(ada, 'DELETE', P('/token-themes/high-contrast'));
      const after = (await t.call<Tokens>(ada, 'GET', P('/tokens'))).body;
      expect(after.themes).toEqual([]);
      expect(after.tokens.find((x) => x.name === 'color.text')?.themeValues).toEqual({});
    });

    it('previews a W3C import, then imports it with its themes', async () => {
      const text = JSON.stringify({
        $extensions: { 'com.orqiva.themes': [{ name: 'midnight', base: 'dark' }] },
        color: {
          $type: 'color',
          bg: { $value: '#ffffff' },
          accent: {
            $value: '#7c3aed',
            $extensions: { 'com.orqiva.modes': { dark: '#a78bfa', midnight: '#c4b5fd' } },
          },
        },
        radius: { $type: 'borderRadius', $value: '6px' },
        ease: { $type: 'cubicBezier', $value: [0, 0, 1, 1] },
      });
      const dry = await t.call<{ added: string[]; changed: string[]; unchanged: number }>(
        ada,
        'POST',
        P('/tokens/import'),
        { text, dryRun: true },
      );
      expect(dry.status).toBe(200);
      expect(dry.body).toMatchObject({
        added: ['color.accent', 'radius'],
        changed: [],
        unchanged: 1,
      });
      expect(
        (await t.call<Tokens>(ada, 'GET', P('/tokens'))).body.tokens.map((x) => x.name),
      ).not.toContain('color.accent');
      const real = await t.call<{ themesAdded: string[]; skipped: { name: string }[] }>(
        ada,
        'POST',
        P('/tokens/import'),
        { text },
      );
      expect(real.status).toBe(201);
      expect(real.body.themesAdded).toEqual(['midnight']);
      expect(real.body.skipped.map((x) => x.name)).toEqual(['ease']);
      const r = (await t.call<Tokens>(ada, 'GET', P('/tokens'))).body;
      expect(r.tokens.find((x) => x.name === 'color.accent')?.themeValues).toEqual({
        midnight: '#c4b5fd',
      });
      expect((await t.call(ada, 'POST', P('/tokens/import'), { text: 'not json' })).status).toBe(
        400,
      );
    });

    it('exports Swift for iOS and an Android resource ZIP', async () => {
      const get = (f: string) =>
        fetch(t.base + P('/tokens/export?format=' + f), { headers: { cookie: ada.cookie } });
      const ios = await get('ios');
      expect(ios.headers.get('content-disposition')).toContain('kit-tokens.swift');
      const swift = await ios.text();
      expect(swift).toContain('public static var accent: UIColor { dynamic(light:');
      expect(swift).toContain(
        '"midnight": UIColor(red: 0.769, green: 0.710, blue: 0.992, alpha: 1.000)',
      );
      expect(swift).toContain('public static let radius: CGFloat = 6');
      const android = Buffer.from(await (await get('android')).arrayBuffer());
      const entries = zipEntries(android);
      expect(entries.map((e) => e.name)).toEqual([
        'res/values/tokens.xml',
        'res/values-night/tokens.xml',
        'res/values/tokens_midnight.xml',
      ]);
      const night = entries[1];
      expect(night && zipRead(android, night).toString('utf8')).toContain(
        '<color name="color_accent">#FFA78BFA</color>',
      );
      const css = await (await get('css')).text();
      expect(css).toContain(":root[data-theme='midnight']");
    });
  },
);
