// ── [PCODE-19 | S04 | v0.1.0] Add the webview host helper with CSP nonce, theme CSS and a typed message bridge ──
//    Why:  guards for criticals #12: strict CSP with one nonce and no remote resources; invalid messages never
//          reach a handler.
import { describe, expect, it } from 'vitest';
import { buildHtml, escapeHtml, newNonce } from '../../src/webviews/host';
import { isWebviewMessage } from '../../src/webviews/protocol';

describe('buildHtml', () => {
  // ── [PCODE-19 | S04 | v0.1.0] csp_has_nonce_and_no_remote ──
  it('csp_has_nonce_and_no_remote', () => {
    const nonce = newNonce();
    const html = buildHtml({
      title: 'FIX-2 <Title>',
      nonce,
      cspSource: 'vscode-webview://abc',
      scriptUri: 'vscode-webview://abc/dist/webviews/taskDetail.js',
      styleUris: ['vscode-webview://abc/dist/media/webview.css'],
      body: '<p>hi</p>',
    });
    expect(html.match(/nonce-/g)).toHaveLength(1);
    expect(html.match(/nonce="/g)).toHaveLength(1);
    expect(html).toContain(`script-src 'nonce-${nonce}'`);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/\son\w+=/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('&lt;Title&gt;');
    expect(newNonce()).not.toBe(nonce);
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('protocol', () => {
  // ── [PCODE-19 | S04 | v0.1.0] rejects_unknown_messages ──
  it('rejects_unknown_messages', () => {
    expect(isWebviewMessage({ type: 'task/start' })).toBe(true);
    expect(isWebviewMessage({ type: 'task/status', state: 'review', note: 'x' })).toBe(true);
    expect(isWebviewMessage({ type: 'task/openFile', file: 'src/a.ts', line: 7 })).toBe(true);
    expect(
      isWebviewMessage({
        type: 'new/submit',
        input: {
          title: 't',
          sprint: 'today',
          label: 'feature',
          priority: 'medium',
          description: 'd',
          acceptance: ['a'],
        },
      }),
    ).toBe(true);

    expect(isWebviewMessage({ type: 'task/explode' })).toBe(false);
    expect(isWebviewMessage({ type: 'task/status', state: 'done' })).toBe(false);
    expect(isWebviewMessage({ type: 'task/note', text: '   ' })).toBe(false);
    expect(isWebviewMessage({ type: 'task/openFile', file: 'x', line: '7' })).toBe(false);
    expect(isWebviewMessage({ type: 'new/submit', input: { title: 't' } })).toBe(false);
    expect(isWebviewMessage('task/start')).toBe(false);
    expect(isWebviewMessage(null)).toBe(false);
    expect(isWebviewMessage({ type: 42 })).toBe(false);
  });
});
