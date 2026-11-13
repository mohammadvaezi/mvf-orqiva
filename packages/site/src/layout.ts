// ── [PCODE-448 | S15 | v0.1.0] Orqiva logo on the public site ──
// ── [PCODE-218 | S15 | v0.1.0] T20.1 Public docs site built from the repository (own Markdown renderer, CLI and API reference, link check) ──
//    Why:  one page frame for every page: a top bar, the section navigation on the left, the page and its
//          contents on the right. Plain HTML and one stylesheet, no script, so the site works under a strict
//          CSP and from a file share. The scale is the product's compact one (13 px body, 32 px bars),
//          light and dark from the reader's system setting; below 900 px the navigation folds into a
//          <details> menu above the page.
import { escapeHtml, type Heading } from './markdown.js';

export interface NavEntry {
  slug: string;
  title: string;
  section: string;
}

export interface PageFrame {
  slug: string;
  title: string;
  description: string;
  body: string;
  headings: Heading[];
  nav: NavEntry[];
  version: string;
}

/** The URL of a page (all pages live in one folder; index.html too, so the site works from a file share). */
export const hrefOf = (slug: string): string => slug + '.html';

function navHtml(nav: NavEntry[], current: string): string {
  const sections: string[] = [];
  for (const e of nav) if (!sections.includes(e.section)) sections.push(e.section);
  return sections
    .map(
      (s) =>
        '<p class="nav-h">' +
        escapeHtml(s) +
        '</p><ul>' +
        nav
          .filter((e) => e.section === s)
          .map(
            (e) =>
              '<li><a href="' +
              hrefOf(e.slug) +
              '"' +
              (e.slug === current ? ' aria-current="page"' : '') +
              '>' +
              escapeHtml(e.title) +
              '</a></li>',
          )
          .join('') +
        '</ul>',
    )
    .join('');
}

function tocHtml(headings: Heading[]): string {
  const h2 = headings.filter((h) => h.level === 2 || h.level === 3);
  if (h2.length < 3) return '';
  return (
    '<nav class="toc" aria-label="On this page"><p class="nav-h">On this page</p><ul>' +
    h2
      .map(
        (h) =>
          '<li class="l' +
          String(h.level) +
          '"><a href="#' +
          h.id +
          '">' +
          escapeHtml(h.text) +
          '</a></li>',
      )
      .join('') +
    '</ul></nav>'
  );
}

export function page(p: PageFrame): string {
  const nav = navHtml(p.nav, p.slug);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + escapeHtml(p.slug === 'index' ? 'Orqiva' : p.title + ' · Orqiva') + '</title>',
    '<meta name="description" content="' + escapeHtml(p.description) + '">',
    '<link rel="stylesheet" href="site.css">',
    '<link rel="icon" href="favicon.svg" type="image/svg+xml">',
    '</head>',
    '<body>',
    '<a class="skip" href="#main">Skip to the content</a>',
    // [PCODE-448 | S15 | v0.1.0] the Orqiva mark
    '<header class="top"><a class="brand" href="index.html"><img class="mark" src="logo.svg" alt="" width="18" height="18">Orqiva</a>' +
      '<span class="ver">v' +
      escapeHtml(p.version) +
      '</span><nav class="top-links" aria-label="Main"><a href="getting-started.html">Get started</a>' +
      '<a href="pricing.html">Pricing</a><a href="cli.html">CLI</a><a href="api.html">API</a></nav></header>',
    '<div class="wrap">',
    '<details class="nav-fold"><summary>Menu</summary><nav aria-label="Documentation">' +
      nav +
      '</nav></details>',
    '<aside class="side"><nav aria-label="Documentation">' + nav + '</nav></aside>',
    '<main id="main" class="doc">' + p.body + '</main>',
    tocHtml(p.headings),
    '</div>',
    '<footer class="foot">Orqiva v' +
      escapeHtml(p.version) +
      ' · self-hosted engineering command center</footer>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export const STYLE = `/* [PCODE-218 | S15 | v0.1.0] the docs site: compact scale, light and dark */
:root {
  --bg: #ffffff; --bg2: #f6f7f9; --fg: #1c2129; --fg2: #59636e; --line: #e2e5ea;
  --accent: #2f5bd3; --code: #f1f3f6; --mark: #2f5bd3;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #111418; --bg2: #171b21; --fg: #e3e6ea; --fg2: #98a1ac; --line: #2a3038;
    --accent: #7ea2ff; --code: #1d232b; }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 13px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.skip { position: absolute; left: -999px; }
.skip:focus { left: 8px; top: 8px; background: var(--bg); padding: 4px 8px; z-index: 2; }
.top { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 12px; height: 40px;
  padding: 0 16px; border-bottom: 1px solid var(--line); background: var(--bg); }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--fg); }
.mark { display: block; width: 18px; height: 18px; } /* [PCODE-448 | S15 | v0.1.0] logo.svg */
.ver { color: var(--fg2); font-size: 11px; }
.top-links { margin-left: auto; display: flex; gap: 16px; }
.top-links a { color: var(--fg2); }
.top-links a:hover { color: var(--fg); }
.wrap { display: grid; grid-template-columns: 220px minmax(0, 1fr) 200px; gap: 32px; max-width: 1320px;
  margin: 0 auto; padding: 0 16px; }
.side, .toc { position: sticky; top: 40px; align-self: start; max-height: calc(100vh - 40px); overflow: auto;
  padding: 16px 0; font-size: 12px; }
.side ul, .toc ul { list-style: none; margin: 0 0 12px; padding: 0; }
.side a, .toc a { display: block; padding: 3px 8px; border-radius: 4px; color: var(--fg2); }
.side a:hover, .toc a:hover { background: var(--bg2); color: var(--fg); text-decoration: none; }
.side a[aria-current="page"] { background: var(--bg2); color: var(--fg); font-weight: 600; }
.toc .l3 a { padding-left: 18px; }
.nav-h { margin: 8px 8px 4px; font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .04em; color: var(--fg2); }
.nav-fold { display: none; }
.doc { min-width: 0; padding: 16px 0 48px; max-width: 820px; }
.doc h1 { font-size: 22px; line-height: 1.3; margin: 8px 0 12px; }
.doc h2 { font-size: 16px; margin: 28px 0 8px; padding-top: 8px; border-top: 1px solid var(--line); }
.doc h3 { font-size: 14px; margin: 20px 0 6px; }
.doc h4 { font-size: 13px; margin: 16px 0 4px; }
.doc p, .doc ul, .doc ol { margin: 0 0 10px; }
.doc ul, .doc ol { padding-left: 20px; }
.doc li { margin: 2px 0; }
.doc li.task { list-style: none; margin-left: -18px; }
.doc code { font: 12px/1.4 ui-monospace, "Cascadia Code", Consolas, monospace; background: var(--code);
  padding: 1px 4px; border-radius: 3px; }
.doc pre { background: var(--code); padding: 10px 12px; border-radius: 6px; overflow: auto; margin: 0 0 12px; }
.doc pre code { padding: 0; background: none; }
.doc blockquote { margin: 0 0 12px; padding: 4px 12px; border-left: 3px solid var(--accent);
  background: var(--bg2); color: var(--fg2); }
.doc hr { border: 0; border-top: 1px solid var(--line); margin: 20px 0; }
.table { overflow-x: auto; margin: 0 0 12px; }
.doc table { border-collapse: collapse; font-size: 12px; width: 100%; }
.doc th, .doc td { border: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top; }
.doc th { background: var(--bg2); font-weight: 600; }
.lead { font-size: 14px; color: var(--fg2); max-width: 680px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin: 16px 0; }
.card { border: 1px solid var(--line); border-radius: 6px; padding: 12px; background: var(--bg); }
.card h3 { margin: 0 0 4px; font-size: 13px; }
.card p { margin: 0; color: var(--fg2); }
.cmd { margin: 0 0 10px; }
.cmd dt { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 12px; padding: 6px 8px 0;
  border-top: 1px solid var(--line); }
.cmd dd { margin: 0; padding: 2px 8px 6px 24px; color: var(--fg2); }
.op { border: 1px solid var(--line); border-radius: 6px; margin: 0 0 6px; }
.op > summary { display: flex; gap: 8px; align-items: baseline; padding: 5px 8px; cursor: pointer; list-style: none; }
.op > summary::-webkit-details-marker { display: none; }
.op .m { flex: none; width: 52px; font: 600 11px ui-monospace, Consolas, monospace; }
.op .p { flex: none; font: 12px ui-monospace, "Cascadia Code", Consolas, monospace; white-space: nowrap; }
.op .s { flex: 1; min-width: 0; color: var(--fg2); font-size: 12px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.op .b { padding: 4px 8px 8px 68px; border-top: 1px solid var(--line); }
.m-get { color: #1a7f37; } .m-post { color: #2f5bd3; } .m-put, .m-patch { color: #9a6700; } .m-delete { color: #cf222e; }
@media (prefers-color-scheme: dark) {
  .m-get { color: #56d364; } .m-post { color: #7ea2ff; } .m-put, .m-patch { color: #e3b341; } .m-delete { color: #ff7b72; }
}
.foot { border-top: 1px solid var(--line); padding: 12px 16px; color: var(--fg2); font-size: 11px; text-align: center; }
@media (max-width: 1100px) { .wrap { grid-template-columns: 200px minmax(0, 1fr); } .toc { display: none; } }
@media (max-width: 900px) {
  .wrap { display: block; }
  .side { display: none; }
  .nav-fold { display: block; margin: 8px 0 0; border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; }
  .nav-fold summary { cursor: pointer; font-weight: 600; }
  .nav-fold ul { list-style: none; padding: 0; margin: 0 0 8px; }
  .nav-fold a { display: block; padding: 4px 0; }
  .top-links { gap: 10px; }
  .op .s { display: none; }
  .op .p { flex: 1; white-space: normal; word-break: break-all; }
  .op .b { padding-left: 8px; }
}
@media (max-width: 480px) { .top-links a:nth-child(n+3) { display: none; } }
`;
