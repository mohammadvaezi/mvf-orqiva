// ── [PCODE-285 | S15 | v0.1.0] T29.7 Documents import (Markdown, Notion, Confluence) and export (Markdown, HTML, PDF, ZIP) ──
//    Why:  pages from other wikis arrive as HTML (a Confluence export); the wiki keeps Markdown. A small
//          HTML reader builds a tree (void elements and unclosed tags forgiven), and the tree is written
//          as Markdown: headings, paragraphs, emphasis, code, links, images, lists (nested), tables,
//          quotes, rules, and Confluence's info/note/warning boxes as callouts. Scripts, styles and page
//          furniture are left out.

export interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: (HtmlNode | string)[];
}

const VOID = new Set([
  'br',
  'hr',
  'img',
  'meta',
  'link',
  'input',
  'col',
  'area',
  'base',
  'wbr',
  'source',
]);
const SKIP = new Set([
  'script',
  'style',
  'head',
  'noscript',
  'template',
  'svg',
  'iframe',
  'form',
  'button',
]);

const ENT: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  bull: '•',
  copy: '©',
  euro: '€',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
};
export const decodeHtml = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENT[e] ?? m;
  });

/** A forgiving HTML reader: a tree of elements and text. */
export function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = { tag: '#root', attrs: {}, children: [] };
  const stack: HtmlNode[] = [root];
  const re =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<\/\s*([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/gi;
  let at = 0;
  const top = (): HtmlNode => stack[stack.length - 1] ?? root;
  for (const m of html.matchAll(re)) {
    if (m.index > at) top().children.push(decodeHtml(html.slice(at, m.index)));
    at = m.index + m[0].length;
    if (m[1]) {
      const close = m[1].toLowerCase();
      // close up to the matching open tag, if there is one
      const i = stack.map((n) => n.tag).lastIndexOf(close);
      if (i > 0) stack.length = i;
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? '').matchAll(
      /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
    ))
      attrs[(a[1] ?? '').toLowerCase()] = decodeHtml(a[2] ?? a[3] ?? a[4] ?? '');
    const node: HtmlNode = { tag, attrs, children: [] };
    // a new item or row closes the open one
    if (tag === 'li' || tag === 'p' || tag === 'tr' || tag === 'td' || tag === 'th') {
      const own = tag === 'td' || tag === 'th' ? ['td', 'th'] : [tag];
      const i = stack
        .map((n) => n.tag)
        .lastIndexOf(own.find((t) => stack.some((n) => n.tag === t)) ?? '');
      const fence =
        tag === 'li'
          ? ['ul', 'ol']
          : tag === 'tr'
            ? ['table', 'tbody', 'thead']
            : ['tr', 'table', 'div'];
      const lastFence = Math.max(...fence.map((f) => stack.map((n) => n.tag).lastIndexOf(f)));
      if (i > 0 && i > lastFence) stack.length = i;
    }
    top().children.push(node);
    if (!VOID.has(tag) && m[4] !== '/') stack.push(node);
  }
  if (at < html.length) top().children.push(decodeHtml(html.slice(at)));
  return root;
}

/** The first element matching a test, depth first. */
export function findNode(n: HtmlNode, test: (x: HtmlNode) => boolean): HtmlNode | null {
  for (const c of n.children) {
    if (typeof c === 'string') continue;
    if (test(c)) return c;
    const f = findNode(c, test);
    if (f) return f;
  }
  return null;
}

export const textOf = (n: HtmlNode | string): string =>
  typeof n === 'string' ? n : n.children.map(textOf).join('');

const esc = (s: string): string => s.replace(/([\\`*_[\]])/g, '\\$1');

export interface HtmlToMdOptions {
  /** where a link or image goes in the wiki; null keeps it as it is */
  url?: (href: string, kind: 'link' | 'image') => string | null;
}

/** HTML as Markdown. */
export function htmlToMarkdown(html: string | HtmlNode, opts: HtmlToMdOptions = {}): string {
  const root = typeof html === 'string' ? parseHtml(html) : html;
  const fix = (href: string, kind: 'link' | 'image'): string => opts.url?.(href, kind) ?? href;
  const inline = (n: HtmlNode | string): string => {
    if (typeof n === 'string') return esc(n.replace(/\s+/g, ' '));
    const inner = (): string => n.children.map(inline).join('');
    switch (n.tag) {
      case 'strong':
      case 'b': {
        const t = inner().trim();
        return t ? '**' + t + '**' : '';
      }
      case 'em':
      case 'i': {
        const t = inner().trim();
        return t ? '*' + t + '*' : '';
      }
      case 'code':
        return '`' + textOf(n).replace(/`/g, "'") + '`';
      case 'br':
        return '  \n';
      case 'a': {
        const t = inner().trim();
        const href = n.attrs['href'] ?? '';
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return t;
        return '[' + (t || href) + '](' + fix(href, 'link') + ')';
      }
      case 'img': {
        const src = n.attrs['src'] ?? '';
        return src ? '![' + esc(n.attrs['alt'] ?? '') + '](' + fix(src, 'image') + ')' : '';
      }
      default:
        return SKIP.has(n.tag) ? '' : inner();
    }
  };
  const blocks: string[] = [];
  const cell = (n: HtmlNode): string =>
    n.children.map(inline).join('').replace(/\|/g, '\\|').trim();
  const list = (n: HtmlNode, depth: number): string[] => {
    const out: string[] = [];
    let k = 0;
    for (const li of n.children) {
      if (typeof li === 'string' || li.tag !== 'li') continue;
      k += 1;
      const mark = n.tag === 'ol' ? String(k) + '. ' : '- ';
      const own = li.children
        .filter((c) => typeof c === 'string' || (c.tag !== 'ul' && c.tag !== 'ol'))
        .map((c) =>
          typeof c !== 'string' && c.tag === 'p' ? c.children.map(inline).join('') : inline(c),
        )
        .join('')
        .trim();
      out.push('  '.repeat(depth) + mark + own);
      for (const c of li.children)
        if (typeof c !== 'string' && (c.tag === 'ul' || c.tag === 'ol'))
          out.push(...list(c, depth + 1));
    }
    return out;
  };
  const block = (n: HtmlNode | string): void => {
    if (typeof n === 'string') {
      const t = esc(n.replace(/\s+/g, ' ')).trim();
      if (t) blocks.push(t);
      return;
    }
    if (SKIP.has(n.tag)) return;
    const h = /^h([1-6])$/.exec(n.tag);
    if (h) {
      const t = n.children.map(inline).join('').trim();
      if (t) blocks.push('#'.repeat(Number(h[1])) + ' ' + t);
      return;
    }
    switch (n.tag) {
      case 'p': {
        const t = n.children.map(inline).join('').trim();
        if (t) blocks.push(t);
        return;
      }
      case 'pre': {
        const code = findNode(n, (x) => x.tag === 'code');
        const lang =
          /language-([\w-]+)/.exec(code?.attrs['class'] ?? '')?.[1] ??
          n.attrs['data-syntaxhighlighter-params']?.match(/brush:\s*([\w-]+)/)?.[1] ??
          '';
        blocks.push('```' + lang + '\n' + textOf(n).replace(/\n+$/, '') + '\n```');
        return;
      }
      case 'ul':
      case 'ol': {
        const l = list(n, 0);
        if (l.length) blocks.push(l.join('\n'));
        return;
      }
      case 'blockquote': {
        const inner = htmlToMarkdown({ tag: '#root', attrs: {}, children: n.children }, opts);
        if (inner.trim())
          blocks.push(
            inner
              .trim()
              .split('\n')
              .map((l) => '> ' + l)
              .join('\n'),
          );
        return;
      }
      case 'hr':
        blocks.push('---');
        return;
      case 'img':
        blocks.push(inline(n));
        return;
      case 'table': {
        const rows: HtmlNode[] = [];
        const walk = (x: HtmlNode): void => {
          for (const c of x.children)
            if (typeof c !== 'string') {
              if (c.tag === 'tr') rows.push(c);
              else if (c.tag !== 'table') walk(c);
            }
        };
        walk(n);
        const cells = rows.map((r) =>
          r.children
            .filter(
              (c): c is HtmlNode => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th'),
            )
            .map(cell),
        );
        const width = Math.max(0, ...cells.map((r) => r.length));
        if (!width) return;
        const pad = (r: string[]): string[] => [...r, ...Array<string>(width - r.length).fill('')];
        const [head, ...body] = cells;
        blocks.push(
          [
            '| ' + pad(head ?? []).join(' | ') + ' |',
            '|' + ' --- |'.repeat(width),
            ...body.map((r) => '| ' + pad(r).join(' | ') + ' |'),
          ].join('\n'),
        );
        return;
      }
      case 'div':
      case 'section':
      case 'article':
      case 'main':
      case 'span':
      case 'body':
      case 'html':
      case '#root':
      case 'tbody':
      case 'center': {
        // Confluence's boxes become callouts
        const cls = n.attrs['class'] ?? '';
        const box = /confluence-information-macro-(information|note|warning|tip)/.exec(cls)?.[1];
        if (box) {
          const kind =
            box === 'information'
              ? 'NOTE'
              : box === 'note'
                ? 'IMPORTANT'
                : box === 'tip'
                  ? 'TIP'
                  : 'WARNING';
          const inner = htmlToMarkdown(
            { tag: '#root', attrs: {}, children: n.children },
            opts,
          ).trim();
          blocks.push(['> [!' + kind + ']', ...inner.split('\n').map((l) => '> ' + l)].join('\n'));
          return;
        }
        // inline content directly in a container is a paragraph of its own
        let run: (HtmlNode | string)[] = [];
        const flush = (): void => {
          const t = run.map(inline).join('').trim();
          if (t) blocks.push(t);
          run = [];
        };
        for (const c of n.children) {
          const isInline =
            typeof c === 'string' ||
            [
              'a',
              'strong',
              'b',
              'em',
              'i',
              'code',
              'span',
              'br',
              'img',
              'small',
              'sup',
              'sub',
              'u',
              'mark',
            ].includes(c.tag);
          if (
            isInline &&
            !(
              typeof c !== 'string' &&
              c.tag === 'span' &&
              findNode(c, (x) => /^(p|div|ul|ol|table|h[1-6])$/.test(x.tag))
            )
          )
            run.push(c);
          else {
            flush();
            block(c);
          }
        }
        flush();
        return;
      }
      default:
        for (const c of n.children) block(c);
    }
  };
  block(root);
  return (
    blocks
      .join('\n\n')
      .replace(/[ \t]+\n/g, (m) => (m.startsWith('  ') ? '  \n' : '\n'))
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}
