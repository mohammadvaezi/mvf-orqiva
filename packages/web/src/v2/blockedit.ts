// ── [PCODE-281 | S15 | v0.1.0] T29.3 Document embeds: live task lists, designs, Gantt, repo code; README import ──
// ── [PCODE-280 | S15 | v0.1.0] T29.2 Block editor for documents: edit in place, insert menu, drag to reorder, paste images ──
//    Why:  a page stays Markdown, so versions, diffs, search, agents and exports keep working; the editor
//          only cuts it into blocks people edit one at a time. A block is a paragraph, a heading, a list, a
//          table, a quote or callout, or a fenced block (code, math, diagram) that may hold blank lines.

/** The Markdown of a page, cut into blocks; fenced and $$ blocks stay whole. */
export function splitBlocks(md: string): string[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let cur: string[] = [];
  const flush = (): void => {
    if (cur.some((l) => l.trim())) out.push(cur.join('\n').replace(/\s+$/, ''));
    cur = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const fence = /^\s*(```|~~~)/.exec(line)?.[1];
    const math = /^\s*\$\$/.test(line) && !/^\s*\$\$.+\$\$\s*$/.test(line);
    if (fence || math) {
      flush();
      const block = [line];
      i++;
      while (i < lines.length) {
        const l = lines[i] ?? '';
        block.push(l);
        i++;
        if (fence ? l.trim().startsWith(fence) : /\$\$\s*$/.test(l)) break;
      }
      out.push(block.join('\n'));
      continue;
    }
    // a heading is a block of its own
    if (/^#{1,6}\s/.test(line)) {
      flush();
      out.push(line.trimEnd());
      i++;
      continue;
    }
    if (!line.trim()) flush();
    else cur.push(line);
    i++;
  }
  flush();
  return out;
}

export const joinBlocks = (blocks: readonly string[]): string => {
  const kept = blocks.map((b) => b.replace(/\s+$/, '')).filter((b) => b.trim());
  return kept.length ? kept.join('\n\n') + '\n' : '';
};

/** The blocks with one moved to another place. */
export function moveBlock<T>(blocks: readonly T[], from: number, to: number): T[] {
  const out = [...blocks];
  if (from < 0 || from >= out.length) return out;
  const [b] = out.splice(from, 1);
  if (b === undefined) return out;
  out.splice(Math.max(0, Math.min(out.length, to)), 0, b);
  return out;
}

/** A block replaced by what its editor holds: none (removed), one, or several when blank lines split it. */
export function replaceBlock(blocks: readonly string[], at: number, text: string): string[] {
  return [...blocks.slice(0, at), ...splitBlocks(text), ...blocks.slice(at + 1)];
}

export interface BlockKind {
  key: string;
  label: string;
  hint: string;
  template: string;
  /** where the cursor goes in the template */
  cursor: number;
}

const kind = (
  key: string,
  label: string,
  hint: string,
  template: string,
  mark = '',
): BlockKind => ({
  key,
  label,
  hint,
  template,
  cursor: mark ? template.indexOf(mark) : template.length,
});

/** What can be inserted, in the order of the menu. */
export const BLOCK_KINDS: readonly BlockKind[] = [
  kind('text', 'Text', 'A paragraph', ''),
  kind('h2', 'Heading', 'A section title', '## '),
  kind('h3', 'Subheading', 'A smaller title', '### '),
  kind('bullets', 'Bulleted list', 'Points in any order', '- '),
  kind('numbers', 'Numbered list', 'Steps in order', '1. '),
  kind('tasks', 'Task list', 'Things to tick off', '- [ ] '),
  kind('quote', 'Quote', 'What someone said', '> '),
  kind('note', 'Note callout', 'A box for something to know', '> [!NOTE]\n> '),
  kind('warning', 'Warning callout', 'A box for a risk', '> [!WARNING]\n> '),
  kind('code', 'Code', 'A code block with its language', '```ts\n\n```', '\n```'),
  kind('math', 'Math', 'A formula in TeX', '$$\n\n$$', '\n$$'),
  kind(
    'flowchart',
    'Flowchart',
    'A Mermaid flowchart',
    '```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```',
    '\n```',
  ),
  kind(
    'sequence',
    'Sequence diagram',
    'Messages between parts',
    '```mermaid\nsequenceDiagram\n  User->>App: request\n  App-->>User: answer\n```',
    '\n```',
  ),
  // [PCODE-281 | S15 | v0.1.0] live parts of the project
  kind(
    'etasks',
    'Task list (live)',
    'Tasks by a query, kept up to date',
    '```embed\ntasks: state:open\n```',
    '\n```',
  ),
  kind(
    'edesign',
    'Design',
    'A UI kit design, its latest version',
    '```embed\ndesign: \n```',
    '\n```',
  ),
  kind('egantt', 'Plan (Gantt)', 'The plan as a timeline', '```embed\ngantt\n```'),
  kind(
    'ecode',
    'Repository code',
    'Lines of a file from the last scan',
    '```embed\ncode: src/file.ts#L1-L20\n```',
    '\n```',
  ),
  kind(
    'table',
    'Table',
    'Rows and columns',
    '| Column | Column |\n| --- | --- |\n|  |  |',
    ' |  |',
  ),
  kind('divider', 'Divider', 'A line between parts', '---'),
];

/** The kinds a "/query" typed in an empty block asks for. */
export function slashKinds(text: string): BlockKind[] | null {
  const m = /^\/([\w -]*)$/.exec(text);
  if (!m) return null;
  const q = (m[1] ?? '').trim().toLowerCase();
  return BLOCK_KINDS.filter(
    (k) =>
      !q ||
      k.label.toLowerCase().includes(q) ||
      k.key.startsWith(q) ||
      k.hint.toLowerCase().includes(q),
  );
}

/** The Markdown of an uploaded image, as the renderer shows it. */
export const imageMarkdown = (workspaceId: string, fileId: string, name: string): string =>
  '![' +
  name.replace(/[[\]]/g, '') +
  '](/api/workspaces/' +
  workspaceId +
  '/files/' +
  fileId +
  '/content)';
