// ── [PCODE-20 | S04 | v0.1.0] Build the task detail panel with description, acceptance, comments and badges ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  Plane HTML (descriptions, comments) is rendered inside a webview; only a small subset survives:
//          structure, emphasis, code, checkboxes and https links. No scripts, no handlers, no other attributes.

const ALLOWED = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'ul',
  'ol',
  'li',
  'strong',
  'b',
  'em',
  'i',
  'code',
  'pre',
  'br',
  'a',
  'input',
  'blockquote',
  'hr',
]);
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'template',
  'noscript',
]);
const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;

function escapeText(s: string): string {
  return s.replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'));
}

// ── [PCODE-20 | S04 | v0.1.0] sanitizeHtml: tag allow-list, attribute drop-list, https-only links ──
export function sanitizeHtml(html: string): string {
  // 1. remove dangerous elements together with their content
  let text = html;
  for (const t of DROP_WITH_CONTENT)
    text = text
      .replace(new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?<\\/${t}\\s*>`, 'gi'), '')
      .replace(new RegExp(`<${t}\\b[^>]*\\/?>`, 'gi'), '');
  // 2. comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  // 3. walk the tags
  return text.replace(TAG, (whole, rawName: string, rawAttrs: string) => {
    const name = rawName.toLowerCase();
    const closing = whole.startsWith('</');
    if (!ALLOWED.has(name)) return '';
    if (closing) return name === 'br' || name === 'input' || name === 'hr' ? '' : `</${name}>`;
    if (name === 'a') {
      const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(rawAttrs);
      const url = (href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim();
      return /^https:\/\//i.test(url) ? `<a href="${url.replace(/"/g, '&quot;')}">` : '<a>';
    }
    if (name === 'input') {
      if (!/type\s*=\s*["']?checkbox/i.test(rawAttrs)) return '';
      const checked = /\bchecked\b/i.test(rawAttrs) ? ' checked' : '';
      return `<input type="checkbox" disabled${checked}>`;
    }
    if (name === 'br' || name === 'hr') return `<${name}>`;
    return `<${name}>`;
  });
}

/** Plain text from Plane HTML - for titles, previews and offline fallbacks. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html)
    .replace(/<li>/g, '- ')
    .replace(/<\/(p|li|h\d|ul|ol|div|blockquote|pre)>/g, '\n')
    .replace(/<br>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export { escapeText };
