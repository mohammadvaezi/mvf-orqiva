// ── [PCODE-451 | S15 | v0.1.0] Landing page: steady server-room loop, 3D Orqiva mark in the finale ──
// ── [PCODE-450 | S15 | v0.1.0] Landing page: background loops were frozen; media URLs carry their content hash ──
// ── [PCODE-449 | S15 | v0.1.0] Landing page: the product tour as real video of Orqiva in use ──
// ── [PCODE-448 | S15 | v0.1.0] Orqiva logo on the public site ──
// ── [PCODE-445 | S15 | v0.1.0] Landing page: fly through the real product, warmer sections ──
// ── [PCODE-443 | S15 | v0.1.0] Cinematic landing page for the public site ──
// ── [PCODE-218 | S15 | v0.1.0] T20.1 Public docs site built from the repository (own Markdown renderer, CLI and API reference, link check) ──
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFFERS, PRICING_DRAFT } from '@orqiva/shared';
import { buildSite, type PageDef } from '../src/build.js';
import { FREE_LINE, landingPage } from '../src/landing.js';
import { LOGO_SVG } from '../src/logo.js';
import { renderMarkdown } from '../src/markdown.js';
import { pricingPage } from '../src/pricing.js';
import { apiPage, parseCliHelp } from '../src/reference.js';

describe('markdown', () => {
  it('escapes everything, drops comments and never passes raw HTML or script links', () => {
    const r = renderMarkdown(
      '<!-- [PCODE-1 | S1 | v0] fingerprint -->\n# Title <b>x</b>\n\n<script>alert(1)</script> and [bad](javascript:alert(1)) and `<i>`',
    );
    expect(r.html).not.toContain('PCODE-1');
    expect(r.html).toContain('<h1 id="title-b-x-b">Title &lt;b&gt;x&lt;/b&gt;</h1>');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).not.toContain('javascript:');
    expect(r.html).toContain('<code>&lt;i&gt;</code>');
    expect(r.title).toBe('Title <b>x</b>');
  });

  it('renders tables, nested and task lists, code, quotes and unique anchors', () => {
    const r = renderMarkdown(
      [
        '## Setup',
        '',
        '| Option | Default |',
        '| ------ | ------: |',
        '| `--port` | 8080 |',
        '',
        '- one',
        '  - inner **bold**',
        '- [x] done',
        '',
        '1. first',
        '2. second',
        '',
        '```sh',
        'orq install <x>',
        '```',
        '',
        '> a *quote*',
        '',
        '## Setup',
      ].join('\n'),
    );
    expect(r.html).toContain('<th>Option</th><th style="text-align:right">Default</th>');
    expect(r.html).toContain('<td><code>--port</code></td>');
    expect(r.html).toContain('<li>one<ul><li>inner <strong>bold</strong></li></ul></li>');
    expect(r.html).toContain('<li class="task"><input type="checkbox" disabled checked> done</li>');
    expect(r.html).toContain('<ol><li>first</li><li>second</li></ol>');
    expect(r.html).toContain('<pre><code class="lang-sh">orq install &lt;x&gt;</code></pre>');
    expect(r.html).toContain('<blockquote><p>a <em>quote</em></p></blockquote>');
    expect(r.headings.map((h) => h.id)).toEqual(['setup', 'setup-1']);
  });

  it('hands links to the resolver, which may drop them', () => {
    const r = renderMarkdown('[a](install.md#https) [b](../LICENSE) [c](https://x.example)', (h) =>
      h.endsWith('LICENSE') ? undefined : h.replace('.md', '.html'),
    );
    expect(r.html).toBe(
      '<p><a href="install.html#https">a</a> b <a href="https://x.example" rel="noopener">c</a></p>',
    );
  });
});

describe('references', () => {
  it('reads the CLI help into sections', () => {
    const s = parseCliHelp(
      [
        'Usage: orq <command>',
        '',
        'Commands:',
        '  install [--dir DIR]',
        '              install or upgrade',
        '',
        'The task loop:',
        '  sync                       send waiting updates',
        '  new "Title" --desc-file F',
        '',
        '  --help      print this help',
      ].join('\n'),
    );
    expect(s).toEqual([
      {
        title: 'Server and install',
        commands: [{ usage: 'install [--dir DIR]', text: 'install or upgrade' }],
      },
      {
        title: 'The task loop',
        commands: [
          { usage: 'sync', text: 'send waiting updates' },
          { usage: 'new "Title" --desc-file F', text: '' },
        ],
      },
      { title: 'Options', commands: [{ usage: '--help', text: 'print this help' }] },
    ]);
  });

  it('lists every API operation by tag, escaped', () => {
    const p = apiPage({
      paths: {
        '/api/x/{id}': {
          get: {
            summary: 'One <x>',
            tags: ['items'],
            parameters: [{ name: 'id', in: 'path', required: true }],
          },
          put: {
            summary: 'Change it',
            tags: ['items'],
            parameters: [],
            requestBody: {
              content: {
                'application/json': {
                  schema: { properties: { title: {}, note: {} }, required: ['title'] },
                },
              },
            },
          },
        },
      },
    });
    expect(p.body).toContain('2 operations');
    expect(p.body).toContain('One &lt;x&gt;');
    expect(p.body).toContain('<code>title</code> <code>note?</code>');
    expect(p.headings.map((h) => h.id)).toEqual(['api', 'tag-items']);
  });
});

describe('the site build', () => {
  const pages: PageDef[] = [
    {
      slug: 'index',
      title: 'Home',
      section: 'Start',
      description: 'd',
      source: { md: 'docs/a.md' },
    },
    { slug: 'b', title: 'B', section: 'Start', description: 'd', source: { md: 'docs/b.md' } },
    { slug: 'cli', title: 'CLI', section: 'Ref', description: 'd', source: { generated: 'cli' } },
  ];
  const files: Record<string, string> = {
    'docs/a.md': '# A\n\n[b](b.md#two) [cli](cli.html) [own](#a) [file](../LICENSE)',
    'docs/b.md': '# B\n\n## Two',
  };
  const build = (f: Record<string, string>) => {
    const out = join(mkdtempSync(join(tmpdir(), 'orq-site-')), 'site');
    const r = buildSite({
      root: '.',
      out,
      version: '0.1.0',
      cliHelp: 'Commands:\n  sync   send',
      openapi: { paths: {} },
      pages,
      read: (p) => {
        const t = f[p];
        if (t === undefined) throw new Error('missing');
        return t;
      },
    });
    return { r, out };
  };

  it('writes every page, the stylesheet and links between pages', () => {
    const { r, out } = build(files);
    expect(r.errors).toEqual([]);
    expect(r.pages).toEqual(['index', 'b', 'cli']);
    for (const f of ['index.html', 'b.html', 'cli.html', 'site.css', 'favicon.svg', 'openapi.json'])
      expect(existsSync(join(out, f))).toBe(true);
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    expect(html).toContain('<a href="b.html#two">b</a>');
    expect(html).toContain(' file</p>');
    expect(html).toContain('<a href="b.html">B</a>');
    expect(html).not.toMatch(/<script/);
  });

  it('fails on a missing page, a Markdown link off the site and a missing anchor', () => {
    const { r } = build({
      'docs/a.md': '# A\n\n[b](b.md#three) [x](other.md) [gone](nope.html)',
    });
    expect(r.errors).toEqual([
      'index: links to other.md, which is not a page of the site',
      'b: the page docs/b.md is missing',
      'index: links to b.html#three, but that page has no heading #three',
      'index: links to nope.html, which does not exist',
    ]);
  });
});

// ── [PCODE-443 | S15 | v0.1.0] the landing page ──
describe('landing page', () => {
  const html = (media: string[] = []) =>
    landingPage({
      version: '0.1.0',
      media: new Set(media),
      scriptHref: 'landing.js?v=abc',
      styleHref: 'landing.css?v=def',
    });

  it('sends every install button to the install guide, and states the free plan from the offers', () => {
    const h = html();
    const free = OFFERS.find((o) => o.plan === 'free');
    expect(FREE_LINE).toContain('up to ' + String(free?.maxSeats) + ' people');
    expect(h).toContain(FREE_LINE);
    const installs = [...h.matchAll(/<a class="btn btn--primary[^"]*" href="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(installs.length).toBeGreaterThanOrEqual(4);
    expect(new Set(installs)).toEqual(new Set(['getting-started.html']));
    // every offer is listed with what it includes, and the draft note follows the shared flag
    for (const o of OFFERS) {
      expect(h).toContain('<h3 class="plan__name">' + o.name + '</h3>');
      for (const x of o.includes) expect(h).toContain('<li>' + x + '</li>');
    }
    expect(h.includes('These prices are a draft')).toBe(PRICING_DRAFT);
  });

  it('loads one script from the site and executes nothing inline', () => {
    const h = html();
    const scripts = [...h.matchAll(/<script([^>]*)>/g)].map((m) => m[1]);
    expect(scripts).toEqual([
      ' type="module" src="landing.js?v=abc"',
      ' type="application/ld+json"',
    ]);
    expect(h).not.toMatch(/\son[a-z]+="/);
    expect(h).not.toMatch(/style="/);
    expect(h).toContain('<html lang="en" class="no-js">');
  });

  it('shows footage only when it was generated', () => {
    expect(html()).not.toContain('<video');
    const withFilm = html(['owned.webm', 'owned.webp']);
    expect(withFilm).toContain('data-film="media/owned.webm"');
    expect(withFilm).toContain('preload="none"');
    // [PCODE-444 | S15 | v0.1.0] a still alone is shown without a video
    const stillOnly = html(['owned.webp']);
    expect(stillOnly).toContain('src="media/owned.webp"');
    expect(stillOnly).not.toContain('<video');
  });

  // ── [PCODE-445 | S15 | v0.1.0] the tour through the real screens ──
  const screens = [
    'home',
    'ideation',
    'canvas',
    'agents',
    'test',
    'security',
    'releases',
    'command',
  ];
  const all = screens.map((s) => 'screen-' + s + '.webp');

  it('puts one real screen per stop into the deck and the rail, in order, described and marked as sample data', () => {
    const h = html(all);
    const shots = [
      ...h.matchAll(
        /<figure class="shot" data-shot="(\d+)"><div class="shot__frame"><img class="shot__img" src="media\/screen-([a-z]+)\.webp" alt="([^"]+)"/g,
      ),
    ];
    expect(shots.map((m) => m[2])).toEqual(screens);
    expect(shots.map((m) => Number(m[1]))).toEqual(screens.map((_, i) => i));
    for (const m of shots) expect((m[3] ?? '').length).toBeGreaterThan(40);
    expect([...h.matchAll(/data-rail="(\d+)"/g)].length).toBe(screens.length);
    expect(h).toContain('Screens from Orqiva with sample data');
    // the first screen is the page's largest picture: loaded first, not lazily
    expect(h).toContain('<link rel="preload" as="image" href="media/screen-home.webp">');
    expect(h).toMatch(/class="shot__img" src="media\/screen-home\.webp"[^>]*fetchpriority="high"/);
  });

  it('gives every chapter its screen inline too (phones, no JavaScript), and links the chapter to its stop', () => {
    const h = html(all);
    for (const [id, i] of [
      ['idea', 1],
      ['agents', 3],
      ['command', 7],
    ] as const)
      expect(h).toMatch(
        new RegExp(
          '<section class="chapter" id="' +
            id +
            '" data-chapter="' +
            String(i) +
            '"[\\s\\S]*?<img class="chapter__img" src="media/screen-',
        ),
      );
  });

  it('leaves out a stop whose screen was not captured, and keeps the chapter text', () => {
    const h = html(all.filter((f) => f !== 'screen-security.webp'));
    expect(h).not.toContain('screen-security.webp');
    expect(h).toContain('The riskiest finding is always at the top.');
    expect([...h.matchAll(/data-shot="/g)].length).toBe(screens.length - 1);
  });

  it('keeps the approval demo usable by keyboard, with its outcome in the page', () => {
    const h = html(all);
    expect(h).toContain('<button type="button" class="btn btn--approve" data-approve');
    expect(h).toContain('<button type="button" class="btn btn--quiet" data-hold');
    expect(h).toMatch(/data-approved hidden>/);
  });

  it('shows the real install output in the terminal', () => {
    const h = html();
    expect(h).toContain('ok    Docker: running, version');
    expect(h).toContain(
      'Orqiva is running at https://orqiva.your-company.example . Open it and create the first account.',
    );
  });

  // [PCODE-449 | S15 | v0.1.0] the product in use: a clip over a screen, only when it was recorded
  it('puts a recorded clip over a screen, loaded on demand, with a pause button for all of them', () => {
    const h = html([...all, 'clip-home.webm', 'clip-agents.webm']);
    expect(h).toMatch(
      /data-shot="0">[\s\S]*?<video class="shot__video" data-clip="media\/clip-home\.webm" muted loop playsinline preload="none"/,
    );
    expect(h).toMatch(
      /id="agents"[\s\S]*?<video class="chapter__video" data-clip="media\/clip-agents\.webm"/,
    );
    expect(h).not.toContain('clip-test.webm');
    expect(h).toContain('data-motion aria-pressed="false"');
    expect(html(all)).not.toContain('data-motion');
  });

  // [PCODE-451 | S15 | v0.1.0] the finale: the mark in 3D with its SVG still, and the name
  it('ends with the 3D mark (the SVG as its still) and the name, without the old light-line film', () => {
    const h = html([...all, 'hero.webp', 'hero.webm']);
    expect(h).toMatch(
      /<section class="finale"[\s\S]*?<img class="mark3d__still" src="logo\.svg"[\s\S]*?<canvas class="mark3d__canvas" data-mark3d-canvas>/,
    );
    expect(h).toContain('<p class="wordmark" aria-label="Orqiva">');
    expect(h.match(/wordmark__l--\d/g)?.length).toBe(6);
    expect(h).not.toContain('hero.webm');
  });

  // [PCODE-450 | S15 | v0.1.0] a changed file gets a new URL
  it('names every media URL by its content when the build gives the hashes', () => {
    const h = landingPage({
      version: '0.1.0',
      media: new Set([...all, 'owned.webp', 'owned.webm', 'og.jpg']),
      mediaHash: (f) => (f === 'owned.webm' ? 'abc123' : 'h-' + String(f.length)),
      scriptHref: 'landing.js',
      styleHref: 'landing.css',
    });
    expect(h).toContain('data-film="media/owned.webm?v=abc123"');
    expect(h).toContain('src="media/screen-home.webp?v=h-16"');
    expect(h).toContain('content="media/og.jpg?v=h-6"');
    expect(h).not.toMatch(/"media\/[\w.-]+"/);
  });

  // [PCODE-448 | S15 | v0.1.0] the mark in the bar and the footer
  it('shows the Orqiva mark in the bar and the footer', () => {
    expect(html().match(/<img class="mark" src="logo\.svg" alt=""/g)?.length).toBe(2);
    expect(LOGO_SVG).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[\d ]+">/);
    expect(LOGO_SVG).not.toMatch(/metadata|c2pa|#fff"/i);
  });

  it('never names the sample data’s real-world bank', () => {
    expect(html(all)).not.toMatch(/KFW|Förderbank/i);
  });
});

describe('the site build with the landing page', () => {
  const pages: PageDef[] = [
    {
      slug: 'index',
      title: 'Home',
      section: 'Start',
      description: 'd',
      source: { generated: 'landing' },
    },
  ];
  const run = (script: string) => {
    const out = join(mkdtempSync(join(tmpdir(), 'orq-site-')), 'site');
    const r = buildSite({
      root: '.',
      out,
      version: '0.1.0',
      cliHelp: '',
      openapi: { paths: {} },
      pages,
      landing: { script, media: new Map([['owned.jpg', Buffer.from('x')]]) },
    });
    return { r, out };
  };

  it('writes the page whole, with its stylesheet, script and media, and checks its links', () => {
    const { r, out } = run('console.log(1)');
    for (const f of ['index.html', 'landing.css', 'landing.js', 'media/owned.jpg'])
      expect(existsSync(join(out, f))).toBe(true);
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toMatch(/landing\.js\?v=[0-9a-f]{12}/);
    // only the landing page exists here, so its links to the docs are reported, in-page anchors are not
    expect(r.errors).toContain('index: links to getting-started.html, which does not exist');
    expect(r.errors.some((e) => e.includes('#'))).toBe(false);
  });

  it('fails without the bundled script', () => {
    expect(run('').r.errors).toContain(
      'index: the landing script is missing (run node build-client.mjs)',
    );
  });
});

// ── [PCODE-219 | S15 | v0.1.0] the pricing page from the shared offers ──
describe('pricing page', () => {
  it('shows every offer, the draft note, and buy links only with a buy page', () => {
    const withUrl = pricingPage('https://vendor.example/buy').body;
    expect(withUrl).toContain('<strong>Draft.</strong>');
    expect(withUrl).toContain('href="https://vendor.example/buy?plan=team"');
    expect(withUrl).toContain('href="https://vendor.example/buy?plan=business"');
    expect(withUrl).not.toContain('plan=enterprise');
    for (const name of ['Free', 'Team', 'Business', 'Enterprise'])
      expect(withUrl).toContain('<h3>' + name + '</h3>');
    const without = pricingPage(undefined).body;
    expect(without).not.toContain('?plan=');
    expect(without).toContain('Online purchase opens at launch');
  });
});
