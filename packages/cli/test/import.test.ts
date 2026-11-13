// ── [PCODE-107 | S15 | v0.1.0] Build the Plane importer: projects, items, states, comments, cycles, history ──
import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToText } from '../src/import/html.js';
import { PlaneError, PlaneReader, chunks } from '../src/import/plane.js';

describe('HTML to text', () => {
  it('keeps the words and the structure of Plane descriptions and comments', () => {
    expect(
      htmlToText('<p><strong>Review</strong> by Claude — v0.1.0, commit <code>abc123</code></p>'),
    ).toBe('**Review** by Claude — v0.1.0, commit `abc123`');
    expect(
      htmlToText(
        '<h2>Acceptance</h2><ul><li data-checked="true">done thing</li><li data-checked="false">open thing</li></ul><p>Then <a href="https://x.test/a">the docs</a>.</p>',
      ),
    ).toBe(
      '## Acceptance\n\n- [x] done thing\n- [ ] open thing\n\nThen [the docs](https://x.test/a).',
    );
    expect(htmlToText('<ol><li><p>one</p></li><li><p>two</p></li></ol>')).toBe('- one\n\n- two');
    expect(htmlToText('<p>a<br>b</p><p></p><p>c &amp; d &lt;e&gt; &#8594; &#x2192;</p>')).toBe(
      'a\nb\n\nc & d <e> → →',
    );
    expect(htmlToText('<pre><code>if (a &lt; b) {\n  go();\n}</code></pre>')).toBe(
      '```\nif (a < b) {\n  go();\n}\n```',
    );
    expect(htmlToText(null)).toBe('');
    expect(decodeEntities('&unknown; &nbsp;')).toBe('&unknown;  ');
  });
});

describe('the Plane reader', () => {
  const page = (results: unknown[], next?: string): Response =>
    new Response(
      JSON.stringify({ results, next_cursor: next ?? null, next_page_results: !!next }),
      { status: 200 },
    );

  it('follows cursors, spaces its requests and waits out a 429', async () => {
    const urls: string[] = [];
    const slept: number[] = [];
    let limited = false;
    const fetchImpl = ((url: string, init: RequestInit) => {
      urls.push(url);
      expect((init.headers as Record<string, string>)['X-API-Key']).toBe('k');
      if (!limited) {
        limited = true;
        return Promise.resolve(
          new Response('slow down', { status: 429, headers: { 'retry-after': '3' } }),
        );
      }
      return Promise.resolve(
        url.includes('cursor=c2') ? page([{ id: 3 }]) : page([{ id: 1 }, { id: 2 }], 'c2'),
      );
    }) as unknown as typeof fetch;
    const r = new PlaneReader(
      { baseUrl: 'https://plane.test/', workspace: 'acme', apiKey: 'k' },
      {
        fetchImpl,
        spacingMs: 1000,
        sleep: (ms) => {
          slept.push(ms);
          return Promise.resolve();
        },
      },
    );
    expect(await r.all<{ id: number }>('/projects/p/issues/')).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    expect(urls[0]).toBe(
      'https://plane.test/api/v1/workspaces/acme/projects/p/issues/?per_page=100',
    );
    expect(urls.at(-1)).toContain('&cursor=c2');
    expect(slept).toContain(3000);
    expect(r.requests).toBe(3);
  });

  it('says plainly when Plane refuses the key', async () => {
    const r = new PlaneReader(
      { baseUrl: 'https://plane.test', workspace: 'acme', apiKey: 'bad' },
      {
        fetchImpl: (() =>
          Promise.resolve(new Response('', { status: 401 }))) as unknown as typeof fetch,
        spacingMs: 0,
      },
    );
    await expect(r.get('/members/')).rejects.toThrow(PlaneError);
  });
});

describe('chunks', () => {
  it('cut by count and by size', () => {
    expect(chunks([1, 2, 3, 4, 5], 2).map((c) => c.length)).toEqual([2, 2, 1]);
    const big = Array.from({ length: 10 }, () => 'x'.repeat(300));
    expect(chunks(big, 100, 1000).map((c) => c.length)).toEqual([3, 3, 3, 1]);
    expect(chunks(['y'.repeat(5000)], 100, 1000)).toHaveLength(1); // one oversized entry still goes alone
  });
});
