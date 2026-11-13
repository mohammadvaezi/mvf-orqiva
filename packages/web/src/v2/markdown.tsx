// ── [PCODE-281 | S15 | v0.1.0] T29.3 Document embeds: live task lists, designs, Gantt, repo code; README import ──
// ── [PCODE-280 | S15 | v0.1.0] T29.2 Block editor for documents: edit in place, insert menu, drag to reorder, paste images ──
// ── [PCODE-279 | S15 | v0.1.0] T29.1 Document blocks: callouts, math and Mermaid diagrams rendered by our own code ──
// ── [PCODE-171 | S15 | v0.1.0] B3.4 Documents live in the web app: page tree, Markdown pages with editor, versions and diff, comments, templates, knowledge, health ──
//    Why:  pages are Markdown; this renders them as React elements, never as HTML strings, so nothing a
//          page holds can run in the browser. It covers what the templates and agents write: headings,
//          paragraphs, lists and task lists, tables, fenced code, quotes, rules, bold, italic, code, links
//          to the web (http and https only), to other pages (/docs/<id>) and [[Title]] links.
import { Fragment, type ReactNode } from 'react';
import { Callout, CALLOUTS, MathView, MermaidView, type CalloutKind } from './richblocks.js';
import { EmbedView, type EmbedCtx } from './embeds.js'; // [PCODE-281 | S15 | v0.1.0] // [PCODE-279 | S15 | v0.1.0]

export interface MdLinks {
  /** an in-app address for a page link, or null when the page is not known */
  page: (target: { id?: string; title?: string }) => string | null;
  go: (path: string) => void;
  /** [PCODE-281 | S15 | v0.1.0] inside a project: embeds are drawn live */
  embed?: EmbedCtx;
}

const UUID = /\/docs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'list'; ordered: boolean; items: { text: string; done: boolean | null }[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; text: string }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'hr' }
  // [PCODE-279 | S15 | v0.1.0] callouts and display math
  | { t: 'callout'; kind: CalloutKind; title: string; text: string }
  | { t: 'math'; tex: string };

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** The blocks of a Markdown text. */
export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: Block[] = [];
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
      out.push({ t: 'code', lang: fence[1] ?? '', text: body.join('\n') });
      continue;
    }
    // [PCODE-279 | S15 | v0.1.0] $$ … $$ on one line or around lines
    if (/^\s*\$\$/.test(line)) {
      const one = /^\s*\$\$(.+)\$\$\s*$/.exec(line);
      if (one) {
        out.push({ t: 'math', tex: one[1] ?? '' });
        i++;
        continue;
      }
      const body: string[] = [line.replace(/^\s*\$\$/, '')];
      i++;
      while (i < lines.length && !/\$\$\s*$/.test(lines[i] ?? '')) body.push(lines[i++] ?? '');
      body.push((lines[i] ?? '').replace(/\$\$\s*$/, ''));
      i++;
      out.push({ t: 'math', tex: body.join(' ').trim() });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ t: 'h', level: (h[1] ?? '#').length, text: h[2] ?? '' });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push({ t: 'hr' });
      i++;
      continue;
    }
    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] ?? '')
    ) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] ?? ''))
        rows.push(cells(lines[i++] ?? ''));
      out.push({ t: 'table', head, rows });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? ''))
        body.push((lines[i++] ?? '').replace(/^>\s?/, ''));
      // [PCODE-279 | S15 | v0.1.0] > [!NOTE] Title … is a callout
      const c = /^\[!(\w+)\]\s*(.*)$/.exec(body[0] ?? '');
      const kind = (c?.[1] ?? '').toLowerCase();
      if (c && (CALLOUTS as readonly string[]).includes(kind))
        out.push({
          t: 'callout',
          kind: kind as CalloutKind,
          title: c[2] ?? '',
          text: body.slice(1).join(' '),
        });
      else out.push({ t: 'quote', text: body.join(' ') });
      continue;
    }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[1] ?? '');
      const items: { text: string; done: boolean | null }[] = [];
      while (i < lines.length) {
        const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i] ?? '');
        if (!m) break;
        const task = /^\[( |x|X)\]\s*(.*)$/.exec(m[2] ?? '');
        items.push(
          task ? { text: task[2] ?? '', done: task[1] !== ' ' } : { text: m[2] ?? '', done: null },
        );
        i++;
      }
      out.push({ t: 'list', ordered, items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !/^(#{1,6}\s|```|>|\s*\$\$|\s*([-*+]|\d+[.)])\s)/.test(lines[i] ?? '')
    )
      para.push((lines[i++] ?? '').trim());
    out.push({ t: 'p', text: para.join(' ') });
  }
  return out;
}

const SAFE = /^(https?:\/\/|\/|#)/i;
/** [PCODE-280 | S15 | v0.1.0] an uploaded file of this server */
export const OWN_FILE = /^\/api\/workspaces\/[0-9a-f-]{36}\/files\/[0-9a-f-]{36}\/content$/i;

/** Inline Markdown: code, bold, italic, links, [[Title]] and bare web addresses. */
export function inline(text: string, links: MdLinks | null, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re =
    /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[\[([^\]]{1,200})\]\]|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()"]+[^\s<>()".,;:!?])|(?<![\w$])\$([^$\s](?:[^$]*[^$\s])?)\$(?![\w$])|!\[([^\]]*)\]\(([^)\s]+)\)/g;
  let at = 0;
  let n = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index;
    if (idx > at) out.push(text.slice(at, idx));
    const k = key + '-' + String(n++);
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={k}>{inline(m[2], links, k)}</strong>);
    else if (m[3] !== undefined) out.push(<em key={k}>{inline(m[3], links, k)}</em>);
    else if (m[4] !== undefined) {
      const to = links?.page({ title: m[4].trim() }) ?? null;
      out.push(
        to ? (
          <a
            key={k}
            href={to}
            className="v2-md-page"
            onClick={(e) => {
              e.preventDefault();
              links?.go(to);
            }}
          >
            {m[4]}
          </a>
        ) : (
          <span key={k} className="v2-md-missing" title="No page with this title yet">
            {m[4]}
          </span>
        ),
      );
    } else if (m[5] !== undefined && m[6] !== undefined) {
      const href = m[6];
      const page = UUID.exec(href)?.[1];
      const to = page ? (links?.page({ id: page }) ?? null) : null;
      if (to)
        out.push(
          <a
            key={k}
            href={to}
            className="v2-md-page"
            onClick={(e) => {
              e.preventDefault();
              links?.go(to);
            }}
          >
            {inline(m[5], links, k)}
          </a>,
        );
      else if (SAFE.test(href) && !page)
        out.push(
          <a
            key={k}
            href={href}
            target={href.startsWith('http') ? '_blank' : undefined}
            rel="noreferrer noopener"
          >
            {inline(m[5], links, k)}
          </a>,
        );
      else out.push(<span key={k}>{inline(m[5], links, k)}</span>);
    } else if (m[8] !== undefined) out.push(<MathView key={k} tex={m[8]} />);
    // [PCODE-280 | S15 | v0.1.0] images from our own file store; anything else stays a link
    else if (m[10] !== undefined) {
      const src = m[10];
      if (OWN_FILE.test(src))
        out.push(<img key={k} src={src} alt={m[9] ?? ''} className="v2-md-img" loading="lazy" />);
      else if (/^https?:\/\//i.test(src))
        out.push(
          <a key={k} href={src} target="_blank" rel="noreferrer noopener">
            {m[9] || src}
          </a>,
        );
      else out.push(<span key={k}>{m[9]}</span>);
    }
    // [PCODE-279 | S15 | v0.1.0] $…$ above
    else if (m[7] !== undefined)
      out.push(
        <a key={k} href={m[7]} target="_blank" rel="noreferrer noopener">
          {m[7]}
        </a>,
      );
    at = idx + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function Markdown(props: { text: string; links?: MdLinks | null }): ReactNode {
  const blocks = parseBlocks(props.text);
  const links = props.links ?? null;
  return (
    <div className="v2-md">
      {blocks.map((b, i) => {
        const k = 'b' + String(i);
        switch (b.t) {
          case 'h': {
            const level = Math.min(4, b.level + 1);
            const H = ('h' + String(level)) as 'h2' | 'h3' | 'h4';
            return <H key={k}>{inline(b.text, links, k)}</H>;
          }
          case 'p':
            return <p key={k}>{inline(b.text, links, k)}</p>;
          case 'quote':
            return <blockquote key={k}>{inline(b.text, links, k)}</blockquote>;
          case 'hr':
            return <hr key={k} />;
          // [PCODE-279 | S15 | v0.1.0]
          case 'callout':
            return (
              <Callout key={k} kind={b.kind} title={b.title}>
                {inline(b.text, links, k)}
              </Callout>
            );
          case 'math':
            return <MathView key={k} tex={b.tex} display />;
          case 'code':
            if (b.lang === 'mermaid') return <MermaidView key={k} src={b.text} />;
            if (b.lang === 'embed') return <EmbedView key={k} src={b.text} ctx={links?.embed} />;
            if (b.lang === 'math' || b.lang === 'latex')
              return <MathView key={k} tex={b.text} display />;
            return (
              <figure key={k} className="v2-md-code">
                {b.lang ? (
                  <figcaption>
                    {b.lang === 'mermaid' ? 'Mermaid diagram (source)' : b.lang}
                  </figcaption>
                ) : null}
                <pre>
                  <code>{b.text}</code>
                </pre>
              </figure>
            );
          case 'table':
            return (
              <div key={k} className="v2-scroll">
                <table className="pv-table">
                  <thead>
                    <tr>
                      {b.head.map((h, j) => (
                        <th key={j}>{inline(h, links, k + 'h' + String(j))}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {b.head.map((_, c) => (
                          <td key={c}>
                            {inline(r[c] ?? '', links, k + 'r' + String(j) + String(c))}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'list': {
            const items = b.items.map((it, j) => (
              <li key={j} className={it.done === null ? undefined : 'v2-md-task'}>
                {it.done === null ? null : (
                  <input
                    type="checkbox"
                    checked={it.done}
                    readOnly
                    aria-label={it.done ? 'done' : 'open'}
                  />
                )}
                <Fragment>{inline(it.text, links, k + 'l' + String(j))}</Fragment>
              </li>
            ));
            return b.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>;
          }
        }
      })}
    </div>
  );
}
