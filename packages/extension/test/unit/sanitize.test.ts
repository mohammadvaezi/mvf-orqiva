// ── [PCODE-20 | S04 | v0.1.0] Build the task detail panel with description, acceptance, comments and badges ──
//    Why:  Plane HTML is untrusted input to a webview; scripts, handlers, javascript: links and iframes must go,
//          checkboxes and code must survive. Plus the pure TaskData assembly from fixture-shaped objects.
import { describe, expect, it } from 'vitest';
import { htmlToText, sanitizeHtml } from '../../src/util/sanitize';
import {
  splitAcceptance,
  taskDataFromPlane,
  taskDataOffline,
} from '../../src/webviews/taskDetail/data';

describe('sanitizeHtml', () => {
  it('strips script, handlers, javascript: links and iframes', () => {
    const dirty =
      '<p onclick="x()">Hi <script>alert(1)</script><a href="javascript:evil()">bad</a> <a href="https://plan.broszio.com/x">ok</a></p><iframe src="https://evil"></iframe><img src=x onerror=alert(1)><style>p{}</style>';
    const clean = sanitizeHtml(dirty);
    expect(clean).toBe('<p>Hi <a>bad</a> <a href="https://plan.broszio.com/x">ok</a></p>');
    expect(clean).not.toMatch(/script|onerror|onclick|javascript:|iframe|img|style/);
  });

  it('keeps checkboxes and code blocks, drops other attributes', () => {
    const html =
      '<ul><li><input type="checkbox" checked class="x"> done</li><li><input type="checkbox"> todo</li></ul><pre><code class="lang-ts">const a = 1;</code></pre><h3 id="a">T</h3><input type="text">';
    expect(sanitizeHtml(html)).toBe(
      '<ul><li><input type="checkbox" disabled checked> done</li><li><input type="checkbox" disabled> todo</li></ul><pre><code>const a = 1;</code></pre><h3>T</h3>',
    );
    expect(htmlToText('<p>a &amp; b</p><ul><li>x</li></ul>')).toBe('a & b\n- x');
  });
});

describe('task data', () => {
  const ENGINE_DESC =
    "<p>Add greet(name) so the fixture has one function.</p>\n<h3>Acceptance</h3>\n<ul>\n<li>&#9744; greet('x') returns 'Hello x'</li>\n<li>&#9745; exported from the module</li>\n</ul>";

  // ── [PCODE-20 | S04 | v0.1.0] the engine's description splits into body + acceptance checks ──
  it('splits the engine description into body and acceptance', () => {
    const { body, acceptance } = splitAcceptance(ENGINE_DESC);
    expect(body).toBe('<p>Add greet(name) so the fixture has one function.</p>');
    expect(acceptance).toEqual([
      { text: "greet('x') returns 'Hello x'", done: false },
      { text: 'exported from the module', done: true },
    ]);
    expect(splitAcceptance('<p>no section</p>').acceptance).toEqual([]);
  });

  it('assembles TaskData from Plane objects with three comments, newest last', () => {
    const data = taskDataFromPlane(
      {
        id: 'i2',
        sequence_id: 2,
        name: 'Add the greeting function',
        description_html: ENGINE_DESC,
        state: 's-todo',
        priority: 'high',
        labels: ['l1'],
      },
      [
        {
          id: 'c2',
          comment_html: '<p><strong>Working</strong> — edited: <code>src/sample.ts</code></p>',
          created_at: '2026-01-02T10:00:00Z',
        },
        {
          id: 'c1',
          comment_html: '<p><strong>Started</strong> by Claude Code</p>',
          created_at: '2026-01-01T09:00:00Z',
          actor_detail: { display_name: 'bot' },
        },
        {
          id: 'c3',
          comment_html: '<p>Tests green</p><script>x</script>',
          created_at: '2026-01-03T10:00:00Z',
        },
      ],
      [{ id: 's-todo', name: 'Todo', group: 'unstarted', color: '' }],
      [{ id: 'l1', name: 'feature', color: '' }],
      'FIX',
      'https://x/2/',
      [{ file: 'src/sample.ts', line: 1, kind: 'header' }],
      'FIX-2',
    );
    expect(data).toMatchObject({
      ref: 'FIX-2',
      title: 'Add the greeting function',
      state: { name: 'Todo', group: 'unstarted' },
      priority: 'high',
      labels: ['feature'],
      offline: false,
      isActive: true,
    });
    expect(data.acceptance).toHaveLength(2);
    expect(data.comments.map((c) => c.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(data.comments[0]?.who).toBe('bot');
    expect(data.comments[0]?.html).toContain('<strong>Started</strong>');
    expect(data.comments[2]?.html).toBe('<p>Tests green</p>');
    expect(data.files).toHaveLength(1);
  });

  it('builds the offline shape from a board item', () => {
    const d = taskDataOffline(
      {
        ref: 'FIX-3',
        title: 'C',
        state: { name: 'Todo', group: 'unstarted' },
        priority: 'low',
        labels: [],
        done: false,
      },
      [],
      null,
      'https://board/',
    );
    expect(d).toMatchObject({
      ref: 'FIX-3',
      offline: true,
      isActive: false,
      url: 'https://board/',
      descriptionHtml: '',
    });
  });
});
