// ── [PCODE-285 | S15 | v0.1.0] T29.7 Documents import (Markdown, Notion, Confluence) and export (Markdown, HTML, PDF, ZIP) ──
//    Why:  a Markdown archive keeps its folders and images, a Notion export loses its id suffixes and nests
//          sub-pages under their page with links kept, a Confluence export nests by breadcrumbs; a page
//          leaves as Markdown and as one HTML file with its image embedded, a folder as a ZIP.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importKind, markdownTitle, resolvePath } from '../../src/api/docio.js';
import { zip } from '../../src/export/zip.js';
import { zipEntries, zipRead } from '../../src/files/docx.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const z = (files: Record<string, string | Buffer>): Buffer =>
  zip(
    Object.entries(files).map(([name, d]) => ({
      name,
      data: Buffer.isBuffer(d) ? d : Buffer.from(d, 'utf8'),
    })),
  );

describe('reading archives', () => {
  it('tells the kinds apart, resolves paths and takes titles', () => {
    expect(importKind(['a.md', 'b/c.md'])).toBe('markdown');
    expect(importKind(['Plan 0123456789abcdef0123456789abcdef.md'])).toBe('notion');
    expect(importKind(['index.html', 'Page_1.html', 'attachments/1/x.png'])).toBe('confluence');
    expect(resolvePath('docs/a/page.md', '../img/x%20y.png')).toBe('docs/img/x y.png');
    expect(resolvePath('page.md', '../../out.png')).toBeNull();
    expect(resolvePath('page.md', 'https://example.com')).toBeNull();
    expect(markdownTitle('x/Plan 0123456789abcdef0123456789abcdef.md', 'no heading', true)).toEqual(
      {
        title: 'Plan',
        body: 'no heading',
      },
    );
    expect(markdownTitle('a.md', '# Real title\n\nText', false)).toEqual({
      title: 'Real title',
      body: 'Text',
    });
  });
});

describe.skipIf(!hasDatabase)('import and export (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Node = {
    id: string;
    parentId: string | null;
    kind: string;
    title: string;
    files: { name: string }[];
  };
  const tree = async () =>
    (await t.call<Node[]>(ada, 'GET', W('/projects/' + project + '/docs'))).body;
  const upload = async (name: string, data: Buffer) =>
    (
      (await (
        await fetch(
          t.base + W('/files?name=' + encodeURIComponent(name) + '&projectId=' + project),
          {
            method: 'POST',
            headers: { cookie: ada.cookie, 'content-type': 'application/zip' },
            body: data,
          },
        )
      ).json()) as { id: string }
    ).id;
  const body = async (id: string) =>
    (await t.call<{ body: string }>(ada, 'GET', W('/docs/' + id))).body.body;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'IMP', name: 'Imports' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('imports Markdown files with their folders and images', async () => {
    const fileId = await upload(
      'wiki.zip',
      z({
        'wiki/Guide.md':
          '# Getting started\n\nSee [the API](api/Reference.md).\n\n![shot](img/shot.png)\n',
        'wiki/api/Reference.md': '# API reference\n\nGET /orders\n',
        'wiki/img/shot.png': PNG,
      }),
    );
    const r = await t.call<{ kind: string; pages: number; folders: number; files: number }>(
      ada,
      'POST',
      W('/projects/' + project + '/docs/import'),
      { fileId },
    );
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ kind: 'markdown', pages: 2, folders: 1, files: 1 });
    const nodes = await tree();
    const guide = nodes.find((n) => n.title === 'Getting started');
    const api = nodes.find((n) => n.title === 'api');
    expect(api?.kind).toBe('folder');
    expect(nodes.find((n) => n.title === 'API reference')?.parentId).toBe(api?.id);
    expect(guide?.files.map((f) => f.name)).toEqual(['shot.png']);
    const text = await body(guide?.id ?? '');
    expect(text).toContain('See [[API reference]].');
    expect(text).toMatch(/!\[shot\]\(\/api\/workspaces\/[0-9a-f-]+\/files\/[0-9a-f-]+\/content\)/);
  });

  it('imports a Notion export: ids off, sub-pages under their page', async () => {
    const id = '0123456789abcdef0123456789abcdef';
    const sub = 'fedcba9876543210fedcba9876543210';
    const fileId = await upload(
      'notion.zip',
      z({
        ['Roadmap ' + id + '.md']:
          '# Roadmap\n\nSee [Q1](Roadmap%20' + id + '/Q1%20' + sub + '.md)\n',
        ['Roadmap ' + id + '/Q1 ' + sub + '.md']: '# Q1\n\nShip it.\n',
      }),
    );
    const r = await t.call<{ kind: string; pages: number; folders: number }>(
      ada,
      'POST',
      W('/projects/' + project + '/docs/import'),
      { fileId },
    );
    expect(r.body).toMatchObject({ kind: 'notion', pages: 2, folders: 0 });
    const nodes = await tree();
    const road = nodes.find((n) => n.title === 'Roadmap');
    expect(nodes.find((n) => n.title === 'Q1')?.parentId).toBe(road?.id);
    expect(await body(road?.id ?? '')).toContain('See [[Q1]]');
  });

  it('imports a Confluence export nested by its breadcrumbs, with info boxes and attachments', async () => {
    const page = (title: string, crumbs: string, content: string) =>
      `<html><head><title>Ops : ${title}</title></head><body><div id="breadcrumb-section"><ol id="breadcrumbs">${crumbs}</ol></div><div id="main-content">${content}</div></body></html>`;
    const fileId = await upload(
      'confluence.zip',
      z({
        'OPS/index.html': page('Ops', '', '<p>Space home</p>'),
        'OPS/Runbooks_10.html': page(
          'Runbooks',
          '<li><a href="index.html">Ops</a></li>',
          '<p>All runbooks.</p>',
        ),
        'OPS/Restart_11.html': page(
          'Restart',
          '<li><a href="index.html">Ops</a></li><li><a href="Runbooks_10.html">Runbooks</a></li>',
          '<div class="confluence-information-macro confluence-information-macro-note"><p>Tell ops first.</p></div><p><img src="attachments/11/flow.png"></p>',
        ),
        'OPS/attachments/11/flow.png': PNG,
        'OPS/styles/site.css': 'x{}',
      }),
    );
    const r = await t.call<{ kind: string; pages: number; files: number; skipped: string[] }>(
      ada,
      'POST',
      W('/projects/' + project + '/docs/import'),
      { fileId },
    );
    expect(r.body).toMatchObject({ kind: 'confluence', pages: 3, files: 1, skipped: [] });
    const nodes = await tree();
    const runbooks = nodes.find((n) => n.title === 'Runbooks');
    const restart = nodes.find((n) => n.title === 'Restart');
    expect(restart?.parentId).toBe(runbooks?.id);
    const text = await body(restart?.id ?? '');
    expect(text).toContain('> [!IMPORTANT]\n> Tell ops first.');
    expect(text).toMatch(/!\[\]\(\/api\/workspaces\/.+\/content\)/);
  });

  it('exports a page as Markdown and HTML, and the wiki as a ZIP', async () => {
    const guide = (await tree()).find((n) => n.title === 'Getting started')?.id ?? '';
    const get = (p: string) => fetch(t.base + W(p), { headers: { cookie: ada.cookie } });
    const md = await get('/docs/' + guide + '/export?format=md');
    expect(md.headers.get('content-disposition')).toContain('Getting_started.md');
    expect(await md.text()).toContain('# Getting started\n\nSee [[API reference]].');
    const html = await (await get('/docs/' + guide + '/export?format=html')).text();
    expect(html).toContain('<title>Getting started</title>');
    expect(html).toContain('src="data:image/png;base64,');
    const zipped = Buffer.from(
      await (await get('/projects/' + project + '/docs/export')).arrayBuffer(),
    );
    const names = zipEntries(zipped).map((e) => e.name);
    expect(names).toContain('Getting started.md');
    expect(names).toContain('api/API reference.md');
    expect(names.some((n) => /^files\/[0-9a-f]{6}-shot\.png$/.test(n))).toBe(true);
    const entry = zipEntries(zipped).find((e) => e.name === 'Getting started.md');
    expect(entry && zipRead(zipped, entry).toString('utf8')).toMatch(
      /!\[shot\]\(files\/[0-9a-f]{6}-shot\.png\)/,
    );
  });
});
