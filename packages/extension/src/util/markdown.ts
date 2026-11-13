// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
//    Why:  task descriptions and comments in Orqiva are Markdown; the task panel shows HTML. Everything is
//          escaped first, then a small subset becomes markup: headings, lists, checkboxes, code, bold,
//          italics and https links. The result still goes through sanitizeHtml before it reaches the panel.

const escape = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(t: string): string {
  return escape(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

/** Markdown (the subset tasks use) as HTML. */
export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let code: string[] | null = null;
  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length) out.push('<p>' + para.map(inline).join(' ') + '</p>');
    para = [];
  };
  const closeList = (): void => {
    if (list) out.push('</' + list + '>');
    list = null;
  };
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    if (code) {
      if (line.startsWith('```')) {
        out.push('<pre><code>' + escape(code.join('\n')) + '</code></pre>');
        code = null;
      } else code.push(line);
      continue;
    }
    if (line.startsWith('```')) {
      flushPara();
      closeList();
      code = [];
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(?:\[( |x|X)\]\s+)?(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      closeList();
      const level = Math.min(6, (h[1]?.length ?? 1) + 2);
      out.push('<h' + String(level) + '>' + inline(h[2] ?? '') + '</h' + String(level) + '>');
    } else if (ul) {
      flushPara();
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      const box = ul[1] === undefined ? '' : ul[1] === ' ' ? '☐ ' : '☑ ';
      out.push('<li>' + box + inline(ul[2] ?? '') + '</li>');
    } else if (ol) {
      flushPara();
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push('<li>' + inline(ol[1] ?? '') + '</li>');
    } else if (!line.trim()) {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  if (code) out.push('<pre><code>' + escape(code.join('\n')) + '</code></pre>');
  flushPara();
  closeList();
  return out.join('\n');
}
