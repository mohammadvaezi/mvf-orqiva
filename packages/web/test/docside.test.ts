// ── [PCODE-284 | S15 | v0.1.0] T29.6 Documents: tree drag and drop, files, image annotation, read analytics, per-task knowledge, checked citations ──
//    Why:  a page dropped on another goes last under it, dropped on an edge goes between its siblings, and
//          it never lands inside itself.
import { describe, expect, it } from 'vitest';
import { dropTarget } from '../src/v2/docside.js';

const nodes = [
  { id: 'f', parentId: null, kind: 'folder', rank: 1 },
  { id: 'a', parentId: 'f', kind: 'page', rank: 1 },
  { id: 'b', parentId: 'f', kind: 'page', rank: 2 },
  { id: 'c', parentId: null, kind: 'page', rank: 2 },
  { id: 'a1', parentId: 'a', kind: 'page', rank: 1 },
];

describe('dragging in the page tree', () => {
  it('puts a page last inside the one it is dropped on', () => {
    expect(dropTarget(nodes, 'c', 'f', 'inside')).toEqual({ parentId: 'f', rank: 3 });
    expect(dropTarget(nodes, 'c', 'b', 'inside')).toEqual({ parentId: 'b', rank: 1 });
  });

  it('puts a page between siblings when dropped on an edge', () => {
    expect(dropTarget(nodes, 'c', 'b', 'before')).toEqual({ parentId: 'f', rank: 1.5 });
    expect(dropTarget(nodes, 'c', 'a', 'before')).toEqual({ parentId: 'f', rank: 0 });
  });

  it('never moves a page into itself or below it', () => {
    expect(dropTarget(nodes, 'a', 'a', 'inside')).toBeNull();
    expect(dropTarget(nodes, 'a', 'a1', 'inside')).toBeNull();
    expect(dropTarget(nodes, 'f', 'a1', 'before')).toBeNull();
  });
});
