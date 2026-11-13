// ── [PCODE-285 | S15 | v0.1.0] T29.7 Documents import (Markdown, Notion, Confluence) and export (Markdown, HTML, PDF, ZIP) ──
//    Why:  a page exported as one HTML file reads like it does in the app, without the app: the same
//          blocks (callouts, tables, task lists, code), math as MathML, Mermaid diagrams as SVG, images
//          wherever the caller puts them (embedded as data). Everything from the page is escaped; only
//          what this writer makes is markup.
import { layoutDiagram, readDiagram, textWidth, type Box, type Layout } from './mermaid.js';
import { mathXml, texToMath } from './texmath.js';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface MdHtmlOptions {
  /** the address an image or link should have in the export; null drops an image */
  url?: (href: string, kind: 'link' | 'image') => string | null;
}

const SAFE = /^(https?:|mailto:|#|\/|data:image\/)/i;

function inline(text: string, o: MdHtmlOptions): string {
  const re =
    /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|!\[([^\]]*)\]\(([^)\s]+)\)|\[\[([^\]]{1,200})\]\]|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w$])\$([^$\s](?:[^$]*[^$\s])?)\$(?![\w$])|(https?:\/\/[^\s<>()"]+[^\s<>()".,;:!?])/g;
  let out = '';
  let at = 0;
  for (const m of text.matchAll(re)) {
    out += esc(text.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[1] !== undefined) out += '<code>' + esc(m[1]) + '</code>';
    else if (m[2] !== undefined) out += '<strong>' + inline(m[2], o) + '</strong>';
    else if (m[3] !== undefined) out += '<em>' + inline(m[3], o) + '</em>';
    else if (m[5] !== undefined) {
      const src = o.url ? o.url(m[5], 'image') : m[5];
      if (src && SAFE.test(src))
        out += '<img src="' + esc(src) + '" alt="' + esc(m[4] ?? '') + '">';
    } else if (m[6] !== undefined) out += '<span class="page">' + esc(m[6]) + '</span>';
    else if (m[7] !== undefined && m[8] !== undefined) {
      const href = o.url ? (o.url(m[8], 'link') ?? m[8]) : m[8];
      out += SAFE.test(href)
        ? '<a href="' + esc(href) + '">' + inline(m[7], o) + '</a>'
        : inline(m[7], o);
    } else if (m[9] !== undefined) {
      try {
        out += mathXml(texToMath(m[9]));
      } catch {
        out += '<code>$' + esc(m[9]) + '$</code>';
      }
    } else if (m[10] !== undefined) out += '<a href="' + esc(m[10]) + '">' + esc(m[10]) + '</a>';
  }
  return out + esc(text.slice(at));
}

const shape = (b: Box): string => {
  const { x, y, w, h } = b;
  const st = 'fill="#fff" stroke="#8a8aa3" stroke-width="1.2"';
  switch (b.shape) {
    case 'round':
    case 'actor':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" ${st}/>`;
    case 'diamond':
      return `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" ${st}/>`;
    case 'circle':
      return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${st}/>`;
    case 'flag':
      return `<polygon points="${x},${y} ${x + w},${y} ${x + w},${y + h} ${x},${y + h} ${x + 12},${y + h / 2}" ${st}/>`;
    case 'note':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#fff4dc" stroke="#d9a400"/>`;
    default:
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" ${st}/>`;
  }
};

/** A laid-out diagram as SVG text. */
export function diagramSvg(l: Layout): string {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${l.width} ${l.height}" width="${l.width}" font-family="system-ui, sans-serif" font-size="13">`,
    '<defs><marker id="h" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#6b6b85"/></marker></defs>',
  ];
  for (const ln of l.lifelines)
    parts.push(
      `<line x1="${ln.x}" y1="${ln.y1}" x2="${ln.x}" y2="${ln.y2}" stroke="#c9c9d6" stroke-dasharray="4 4"/>`,
    );
  for (const ln of l.lines) {
    const dash =
      ln.style === 'dotted'
        ? ' stroke-dasharray="3 3"'
        : ln.style === 'dashed'
          ? ' stroke-dasharray="6 4"'
          : '';
    parts.push(
      `<polyline points="${ln.points.map((p) => String(p.x) + ',' + String(p.y)).join(' ')}" fill="none" stroke="#6b6b85" stroke-width="${ln.style === 'thick' ? 2.6 : 1.3}"${dash}${ln.arrow ? ' marker-end="url(#h)"' : ''}/>`,
    );
    if (ln.label)
      parts.push(
        `<rect x="${ln.lx - textWidth(ln.label) / 2 - 3}" y="${ln.ly - 12}" width="${textWidth(ln.label) + 6}" height="16" fill="#fff"/><text x="${ln.lx}" y="${ln.ly}" text-anchor="middle" font-size="12">${esc(ln.label)}</text>`,
      );
  }
  for (const b of l.boxes)
    parts.push(
      shape(b) +
        `<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + 4.5}" text-anchor="middle">${esc(b.label)}</text>`,
    );
  parts.push('</svg>');
  return parts.join('');
}

const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i;

/** Markdown as HTML (the body only). */
export function markdownToHtml(md: string, o: MdHtmlOptions = {}): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) body.push(lines[i++] ?? '');
      i++;
      const lang = fence[1] ?? '';
      const text = body.join('\n');
      if (lang === 'mermaid') {
        try {
          out.push(
            '<figure class="diagram">' + diagramSvg(layoutDiagram(readDiagram(text))) + '</figure>',
          );
          continue;
        } catch {
          // shown as code below
        }
      }
      if (lang === 'math' || lang === 'latex') {
        try {
          out.push('<div class="math">' + mathXml(texToMath(text, true)) + '</div>');
          continue;
        } catch {
          // shown as code below
        }
      }
      out.push(
        '<pre><code' +
          (lang ? ' class="language-' + esc(lang) + '"' : '') +
          '>' +
          esc(text) +
          '</code></pre>',
      );
      continue;
    }
    if (/^\s*\$\$/.test(line)) {
      const one = /^\s*\$\$(.+)\$\$\s*$/.exec(line);
      let tex = '';
      if (one) {
        tex = one[1] ?? '';
        i++;
      } else {
        const body = [line.replace(/^\s*\$\$/, '')];
        i++;
        while (i < lines.length && !/\$\$\s*$/.test(lines[i] ?? '')) body.push(lines[i++] ?? '');
        body.push((lines[i] ?? '').replace(/\$\$\s*$/, ''));
        i++;
        tex = body.join(' ');
      }
      try {
        out.push('<div class="math">' + mathXml(texToMath(tex.trim(), true)) + '</div>');
      } catch {
        out.push('<pre><code>$$' + esc(tex) + '$$</code></pre>');
      }
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const n = String((h[1] ?? '#').length);
      out.push('<h' + n + '>' + inline(h[2] ?? '', o) + '</h' + n + '>');
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] ?? '')
    ) {
      const cells = (l: string): string[] =>
        l
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split(/(?<!\\)\|/)
          .map((c) => c.trim().replace(/\\\|/g, '|'));
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] ?? ''))
        rows.push(cells(lines[i++] ?? ''));
      out.push(
        '<table><thead><tr>' +
          head.map((c) => '<th>' + inline(c, o) + '</th>').join('') +
          '</tr></thead><tbody>' +
          rows
            .map(
              (r) =>
                '<tr>' +
                head.map((_, k) => '<td>' + inline(r[k] ?? '', o) + '</td>').join('') +
                '</tr>',
            )
            .join('') +
          '</tbody></table>',
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? ''))
        body.push((lines[i++] ?? '').replace(/^>\s?/, ''));
      const c = CALLOUT.exec(body[0] ?? '');
      if (c) {
        const kind = (c[1] ?? 'NOTE').toLowerCase();
        out.push(
          '<aside class="callout ' +
            kind +
            '"><strong>' +
            esc(c[2] || kind.charAt(0).toUpperCase() + kind.slice(1)) +
            '</strong>' +
            markdownToHtml(body.slice(1).join('\n'), o) +
            '</aside>',
        );
      } else out.push('<blockquote>' + markdownToHtml(body.join('\n'), o) + '</blockquote>');
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i] ?? '');
        if (!m) break;
        const task = /^\[( |x|X)\]\s*(.*)$/.exec(m[2] ?? '');
        items.push(
          task
            ? '<li class="task"><input type="checkbox" disabled' +
                (task[1] !== ' ' ? ' checked' : '') +
                '> ' +
                inline(task[2] ?? '', o) +
                '</li>'
            : '<li>' + inline(m[2] ?? '', o) + '</li>',
        );
        i++;
      }
      out.push((ordered ? '<ol>' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>'));
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !/^(#{1,6}\s|```|>|\s*\$\$|\s*([-*+]|\d+[.)])\s)/.test(lines[i] ?? '')
    )
      para.push((lines[i++] ?? '').trim());
    out.push('<p>' + inline(para.join(' '), o) + '</p>');
  }
  return out.join('\n');
}

/** A whole HTML document for one page, readable on its own. */
export function htmlDocument(title: string, bodyHtml: string, meta = ''): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' +
    esc(title) +
    '</title><style>' +
    'body{font:15px/1.6 system-ui,sans-serif;color:#1d1d2c;max-width:860px;margin:32px auto;padding:0 16px}' +
    'h1,h2,h3{line-height:1.25}pre{background:#f5f5fa;padding:10px 12px;border-radius:6px;overflow:auto}' +
    'code{font:13px ui-monospace,monospace;background:#f5f5fa;padding:1px 4px;border-radius:4px}pre code{padding:0;background:none}' +
    'table{border-collapse:collapse}th,td{border:1px solid #dcdce6;padding:4px 8px;text-align:left}' +
    'blockquote{border-left:3px solid #dcdce6;margin:0;padding:0 12px;color:#55556e}' +
    '.callout{border-left:3px solid #3e7bd9;background:#eef4fd;padding:8px 12px;margin:10px 0;border-radius:0 6px 6px 0}' +
    '.callout.tip{border-color:#1f9d55;background:#eaf7ef}.callout.warning{border-color:#d9a400;background:#fff8e1}' +
    '.callout.caution{border-color:#e5484d;background:#fdecec}.callout.important{border-color:#7c4dd6;background:#f2edfc}' +
    '.callout strong{display:block}img{max-width:100%}.diagram{margin:12px 0;overflow:auto}.math{margin:10px 0;overflow-x:auto}' +
    'li.task{list-style:none}.meta{color:#77778f;font-size:13px}.page{text-decoration:underline dotted}' +
    '</style></head><body><h1>' +
    esc(title) +
    '</h1>' +
    (meta ? '<p class="meta">' + esc(meta) + '</p>' : '') +
    bodyHtml +
    '</body></html>'
  );
}
