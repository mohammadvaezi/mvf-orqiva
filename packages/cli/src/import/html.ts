// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-107 | S15 | v0.1.0] Build the Plane importer: projects, items, states, comments, cycles, history ──
//    Why:  Plane stores descriptions and comments as HTML; Orqiva keeps plain text with Markdown habits.
//          A small converter of our own (no HTML library): paragraphs and line breaks, headings, lists and
//          task lists, code, links, emphasis, and the entities that occur in practice. Anything else keeps
//          its text and loses its tags, never its words.

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rarr: '→',
  larr: '←',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X'))
      return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  let s = html.replace(/\r\n?/g, '\n');
  // code blocks keep their content as it is
  const blocks: string[] = [];
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, body: string) => {
    blocks.push(
      '```\n' + decodeEntities(body.replace(/<[^>]+>/g, '')).replace(/\n$/, '') + '\n```',
    );
    return '\n\n\u0000' + String(blocks.length - 1) + '\u0000\n\n';
  });
  s = s
    .replace(/\n/g, ' ')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])[^>]*>/gi, (_m, n: string) => '\n\n' + '#'.repeat(Number(n)) + ' ')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li[^>]*data-checked="true"[^>]*>/gi, '\n- [x] ')
    .replace(/<li[^>]*data-checked="false"[^>]*>/gi, '\n- [ ] ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(ul|ol)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|blockquote|tr)>/gi, '\n\n')
    .replace(/<(strong|b)>/gi, '**')
    .replace(/<\/(strong|b)>/gi, '**')
    .replace(/<(em|i)>/gi, '_')
    .replace(/<\/(em|i)>/gi, '_')
    .replace(/<code[^>]*>/gi, '`')
    .replace(/<\/code>/gi, '`')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const t = text.replace(/<[^>]+>/g, '').trim();
      return t && t !== href ? '[' + t + '](' + href + ')' : href;
    })
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s)
    .split('\n')
    .map((l) =>
      l
        .replace(/[ \t]+/g, ' ')
        .trimEnd()
        .replace(/^ (?=\S)/, ''),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => blocks[Number(i)] ?? '');
}
