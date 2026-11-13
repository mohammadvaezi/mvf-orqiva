// ── [PCODE-218 | S15 | v0.1.0] T20.1 Public docs site built from the repository (own Markdown renderer, CLI and API reference, link check) ──
//    Why:  the docs are Markdown in the repository, and the site is our own code like everything else. The
//          renderer covers what our docs use: headings (with anchors for the contents), paragraphs, lists,
//          tables, fenced code, quotes, rules, inline code, bold, italics and links. Text is escaped before
//          any markup is added, HTML comments (fingerprints) are dropped and raw HTML never passes through.
//          Links are handed to the caller, which turns `install-server.md` into the page's URL and records
//          every target for the link check.

export interface Heading {
  level: number;
  id: string;
  text: string;
}

export interface Rendered {
  html: string;
  /** the first level-1 heading, if any */
  title: string | undefined;
  headings: Heading[];
}

export const escapeHtml = (t: string): string =>
  t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** A heading's anchor: lower case, letters and digits joined by hyphens. */
export const slugify = (t: string): string =>
  t
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

/** Turns a link target as written into the href to use (or undefined to drop the link, keeping its text). */
export type LinkResolver = (href: string) => string | undefined;

const SAFE_SCHEME = /^(https?:|mailto:|#|\/|\.{1,2}\/|[\w-])/i;

function inline(text: string, link: LinkResolver): string {
  // code spans first, kept aside so nothing inside them becomes markup
  const codes: string[] = [];
  let t = text.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push('<code>' + escapeHtml(c) + '</code>');
    return '\u0000' + String(codes.length - 1) + '\u0000';
  });
  const links: string[] = [];
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    const to = SAFE_SCHEME.test(href) && !/^javascript:/i.test(href) ? link(href) : undefined;
    const inner = emphasis(escapeHtml(label));
    links.push(
      to === undefined
        ? inner
        : '<a href="' +
            escapeHtml(to) +
            '"' +
            (/^https?:/i.test(to) ? ' rel="noopener"' : '') +
            '>' +
            inner +
            '</a>',
    );
    return '\u0001' + String(links.length - 1) + '\u0001';
  });
  t = emphasis(escapeHtml(t));
  return t
    .replace(/\u0001(\d+)\u0001/g, (_m, i: string) => links[Number(i)] ?? '')
    .replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)] ?? '');
}

const emphasis = (escaped: string): string =>
  escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\s][^_]*?)_(?![\w])/g, '$1<em>$2</em>');

const cells = (row: string): string[] =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

const isTableRule = (l: string): boolean =>
  /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);

export function renderMarkdown(source: string, link: LinkResolver = (h) => h): Rendered {
  const md = source.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  const lines = md.split('\n');
  const out: string[] = [];
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  let title: string | undefined;
  let i = 0;

  const anchor = (text: string): string => {
    const base = slugify(text) || 'section';
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n ? base + '-' + String(n) : base;
  };
  const blank = (l: string | undefined): boolean => l === undefined || l.trim() === '';

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (blank(line)) {
      i++;
      continue;
    }
    // fenced code
    const fence = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(fence[1] ?? '```'))
        body.push(lines[i++] ?? '');
      i++;
      const lang = fence[2] ? ' class="lang-' + escapeHtml(fence[2]) + '"' : '';
      out.push('<pre><code' + lang + '>' + escapeHtml(body.join('\n')) + '</code></pre>');
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = (h[1] ?? '#').length;
      const text = h[2] ?? '';
      const plain = text.replace(/[`*_]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
      const id = anchor(plain);
      if (level === 1 && title === undefined) title = plain;
      headings.push({ level, id, text: plain });
      out.push(
        '<h' +
          String(level) +
          ' id="' +
          id +
          '">' +
          inline(text, link) +
          '</h' +
          String(level) +
          '>',
      );
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    // table: a header row, then a rule
    if (line.includes('|') && isTableRule(lines[i + 1] ?? '')) {
      const head = cells(line);
      const align = cells(lines[i + 1] ?? '').map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : '',
      );
      const td = (tag: string, c: string, k: number): string =>
        '<' +
        tag +
        (align[k] ? ' style="text-align:' + (align[k] ?? '') + '"' : '') +
        '>' +
        inline(c, link) +
        '</' +
        tag +
        '>';
      const rows: string[] = [];
      i += 2;
      while (i < lines.length && !blank(lines[i]) && (lines[i] ?? '').includes('|')) {
        rows.push(
          '<tr>' +
            cells(lines[i] ?? '')
              .map((c, k) => td('td', c, k))
              .join('') +
            '</tr>',
        );
        i++;
      }
      out.push(
        '<div class="table"><table><thead><tr>' +
          head.map((c, k) => td('th', c, k)).join('') +
          '</tr></thead><tbody>' +
          rows.join('') +
          '</tbody></table></div>',
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? ''))
        body.push((lines[i++] ?? '').replace(/^\s*>\s?/, ''));
      out.push('<blockquote>' + renderMarkdown(body.join('\n'), link).html + '</blockquote>');
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    if (item.test(line)) {
      out.push(list(lines, i, link, (next) => (i = next)));
      continue;
    }
    // paragraph
    const para: string[] = [];
    while (
      i < lines.length &&
      !blank(lines[i]) &&
      !/^(#{1,6}\s|\s*(```|~~~)|\s*>|\s*([-*+]|\d+[.)])\s)/.test(lines[i] ?? '') &&
      !((lines[i] ?? '').includes('|') && isTableRule(lines[i + 1] ?? ''))
    )
      para.push((lines[i++] ?? '').trim());
    out.push('<p>' + inline(para.join(' '), link) + '</p>');
  }
  return { html: out.join('\n'), title, headings };
}

/** A list starting at line `from`, with nested lists by indentation; reports where it ended. */
function list(
  lines: string[],
  from: number,
  link: LinkResolver,
  done: (next: number) => void,
): string {
  const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const first = item.exec(lines[from] ?? '');
  const indent = (first?.[1] ?? '').length;
  const ordered = /\d/.test(first?.[2] ?? '');
  const items: string[] = [];
  let i = from;
  while (i < lines.length) {
    const m = item.exec(lines[i] ?? '');
    // a list of the other kind (bullets after numbers) starts a new list
    if (!m || (m[1] ?? '').length !== indent || /\d/.test(m[2] ?? '') !== ordered) break;
    let text = m[3] ?? '';
    i++;
    // continuation lines, and nested lists deeper than this one
    let nested = '';
    while (i < lines.length && (lines[i] ?? '').trim() !== '') {
      const l = lines[i] ?? '';
      const sub = item.exec(l);
      if (sub && (sub[1] ?? '').length > indent) {
        nested += list(lines, i, link, (next) => (i = next));
        continue;
      }
      if (sub || !/^\s+/.test(l)) break;
      text += ' ' + l.trim();
      i++;
    }
    const box = /^\[( |x|X)\]\s+(.*)$/.exec(text);
    items.push(
      '<li' +
        (box ? ' class="task"' : '') +
        '>' +
        (box
          ? '<input type="checkbox" disabled' +
            ((box[1] ?? ' ') !== ' ' ? ' checked' : '') +
            '> ' +
            inline(box[2] ?? '', link)
          : inline(text, link)) +
        nested +
        '</li>',
    );
    // a blank line between items keeps the list going
    const next = item.exec(lines[i + 1] ?? '');
    if (
      (lines[i] ?? '').trim() === '' &&
      next?.[1]?.length === indent &&
      /\d/.test(next[2] ?? '') === ordered
    )
      i++;
  }
  done(i);
  const tag = ordered ? 'ol' : 'ul';
  return '<' + tag + '>' + items.join('') + '</' + tag + '>';
}
