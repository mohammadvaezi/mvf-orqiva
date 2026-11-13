// ── [PCODE-282 | S15 | v0.1.0] T29.4 Live co-editing of documents with our own three-way merge ──
// ── [PCODE-280 | S15 | v0.1.0] T29.2 Block editor for documents: edit in place, insert menu, drag to reorder, paste images ──
//    Why:  a page cut into blocks and joined again keeps its Markdown, fenced blocks stay whole, a kept
//          block may split or vanish, moves land where dropped, the menu answers "/", images render only
//          from our own store, and the editor draws every block with its handle.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BLOCK_KINDS,
  imageMarkdown,
  joinBlocks,
  moveBlock,
  replaceBlock,
  slashKinds,
  splitBlocks,
} from '../src/v2/blockedit.js';
import { BlockEditor, keep } from '../src/v2/blockeditor.js';
import { Markdown } from '../src/v2/markdown.js';

const page = [
  '# Title',
  'First paragraph',
  'still first.',
  '',
  '```ts',
  'const a = 1;',
  '',
  'const b = 2;',
  '```',
  '',
  '$$',
  'x^2',
  '$$',
  '- one',
  '- two',
].join('\n');

describe('the block editor', () => {
  it('cuts a page into blocks and joins it again', () => {
    const b = splitBlocks(page);
    expect(b).toEqual([
      '# Title',
      'First paragraph\nstill first.',
      '```ts\nconst a = 1;\n\nconst b = 2;\n```',
      '$$\nx^2\n$$',
      '- one\n- two',
    ]);
    expect(splitBlocks(joinBlocks(b))).toEqual(b);
    expect(joinBlocks(['a', '  ', 'b'])).toBe('a\n\nb\n');
    expect(joinBlocks([])).toBe('');
  });

  it('keeps an edited block as one, several or none, and inserts new ones in place', () => {
    const b = ['a', 'b', 'c'];
    expect(replaceBlock(b, 1, 'b1\n\nb2')).toEqual(['a', 'b1', 'b2', 'c']);
    expect(replaceBlock(b, 1, '   ')).toEqual(['a', 'c']);
    expect(keep(b, { after: -1 }, 'top')).toEqual(['top', 'a', 'b', 'c']);
    expect(keep(b, { after: 2 }, '')).toEqual(['a', 'b', 'c']);
    expect(keep(b, { edit: 0 }, 'A')).toEqual(['A', 'b', 'c']);
    expect(moveBlock(b, 0, 2)).toEqual(['b', 'c', 'a']);
    // [PCODE-282 | S15 | v0.1.0] others inserted a block above, or changed the block itself
    expect(keep(['new', 'a', 'b', 'c'], { edit: 0, orig: 'a' }, 'A')).toEqual([
      'new',
      'A',
      'b',
      'c',
    ]);
    expect(
      keep(
        ['We ship on Monday at noon.'],
        { edit: 0, orig: 'We ship on Monday.' },
        'We always ship on Monday.',
      ),
    ).toEqual(['We always ship on Monday at noon.']);
    expect(moveBlock(b, 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('answers / with the matching kinds of block', () => {
    expect(slashKinds('/')).toHaveLength(BLOCK_KINDS.length);
    expect(slashKinds('/dia')?.map((k) => k.key)).toEqual(['sequence']);
    expect(slashKinds('/call')?.map((k) => k.key)).toEqual(['note', 'warning']);
    expect(slashKinds('hello')).toBeNull();
    const code = BLOCK_KINDS.find((k) => k.key === 'code');
    expect(code?.template.slice(0, code.cursor)).toBe('```ts\n');
  });

  it('shows images only from the own file store', () => {
    const ws = '11111111-2222-3333-4444-555555555555';
    const own = imageMarkdown(ws, '66666666-7777-8888-9999-000000000000', 'shot [1].png');
    expect(own).toBe(
      '![shot 1.png](/api/workspaces/' +
        ws +
        '/files/66666666-7777-8888-9999-000000000000/content)',
    );
    expect(renderToString(<Markdown text={own} />)).toContain('<img src="/api/workspaces/');
    const outside = renderToString(<Markdown text="![x](https://example.com/x.png)" />);
    expect(outside).not.toContain('<img');
    expect(outside).toContain('href="https://example.com/x.png"');
  });

  it('draws each block with a handle and the add button', () => {
    const html = renderToString(
      <BlockEditor
        body={page}
        onChange={() => undefined}
        workspaceId="w"
        projectId="p"
        links={null}
      />,
    );
    expect(html.match(/class="v2-blk"/g)).toHaveLength(5);
    expect(html).toContain('aria-label="Move block 1"');
    expect(html).toContain('Add a block');
    // an empty page opens a new block at once
    const empty = renderToString(
      <BlockEditor body="" onChange={() => undefined} workspaceId="w" projectId="p" links={null} />,
    );
    expect(empty).toContain('aria-label="New block (Markdown)"');
  });
});
