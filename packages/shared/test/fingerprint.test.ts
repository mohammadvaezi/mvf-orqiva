// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-103 | S15 | v0.1.0] Build the CLI `orq` and the Claude Code hooks against the new server ──
import { describe, expect, it } from 'vitest';
import {
  commentLines,
  extOf,
  headerBlock,
  indexMarkdown,
  isCode,
  markerText,
  scanText,
  walkDir,
} from '../src/index.js';

describe('fingerprints', () => {
  it('reads markers in every comment style, header first then blocks', () => {
    const ts =
      '// ── [APP-12 | S03 | v0.1.0] Order editing ──\nconst x = 1;\n// [APP-12 | S03 | v0.1.0] reprice\n// [OPS-4 | S01 | v0.2.0] other task';
    const hits = scanText(ts, 'src/a.ts');
    expect(hits.map((h) => [h.task, h.kind, h.line, h.title])).toEqual([
      ['APP-12', 'header', 1, 'Order editing'],
      ['APP-12', 'block', 3, 'reprice'],
      ['OPS-4', 'header', 4, 'other task'],
    ]);
    expect(scanText('<!-- [PCODE-84 | S08 | v0.1.0] Set up the monorepo -->')[0]?.title).toBe(
      'Set up the monorepo',
    );
    expect(scanText('/* [WEB-1 | S01 | v1.0.0] styles */')[0]?.title).toBe('styles');
    expect(
      scanText('# ── [PCODE-12 | S03 | v0.1.0] Order editing: reprice from POS payload ──')[0]
        ?.title,
    ).toBe('Order editing: reprice from POS payload');
  });

  it('accepts the platform’s longer project keys and the engine’s', () => {
    expect(scanText('// [PRODUCT9-1 | S01 | v0.1.0] x')[0]?.task).toBe('PRODUCT9-1');
    expect(scanText('// [PCODE-80 | S08 | v0.1.0] x')[0]?.task).toBe('PCODE-80');
    expect(scanText('// [app-1 | S01 | v0.1.0] lower case is not a key')).toEqual([]);
  });

  it('knows what is code and how to comment it', () => {
    expect(isCode('src/a.ts')).toBe(true);
    expect(isCode('Dockerfile')).toBe(true);
    expect(isCode('README.md')).toBe(false);
    expect(isCode('dist/app.min.js')).toBe(false);
    expect(isCode('package.json')).toBe(false);
    expect(extOf('C:\repo\templates\page.html.j2')).toBe('jinja');
    expect(commentLines('a.py', ['x'])).toEqual(['# x']);
    expect(commentLines('a.css', ['x'])).toEqual(['/* x */']);
    expect(walkDir('node_modules')).toBe(false);
    expect(walkDir('.github')).toBe(true);
    expect(walkDir('.cache')).toBe(false);
  });

  it('writes the header the hooks suggest', () => {
    expect(
      headerBlock('src/a.ts', {
        task: 'APP-1',
        sprint: 'S01',
        version: '0.1.0',
        title: 'Login',
        url: 'https://x/items/1',
      }),
    ).toBe(
      '// ── ' +
        markerText('APP-1', 'S01', '0.1.0', 'Login') +
        ' ──\n//    Task: https://x/items/1',
    );
  });

  it('writes an index by sprint and by file', () => {
    const md = indexMarkdown(
      [
        ...scanText('// [APP-2 | S01 | v0.1.0] b', 'b.ts'),
        ...scanText('// [APP-10 | S01 | v0.1.0] j', 'a.ts'),
      ],
      { name: 'App', key: 'APP' },
    );
    expect(md.indexOf('**APP-2**')).toBeLessThan(md.indexOf('**APP-10**'));
    expect(md).toContain('- `a.ts` — APP-10');
  });
});
