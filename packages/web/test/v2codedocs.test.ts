// ── [PCODE-197 | S15 | v0.1.0] T16.1 Docs from code: API reference, system overview and built-by-task pages, drift warnings ──
//    Why:  the rebuild says plainly what changed (or that there is nothing to build from yet), and a drift
//          row names the file, the line and what happened to it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { driftText, rebuildFromCode } from '../src/v2/documents.js';

const answer = (body: unknown): void => {
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
};

describe('docs from code in the web app', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says what a rebuild changed', async () => {
    answer({ created: 1, updated: 2, unchanged: 0, removed: 1 });
    expect(await rebuildFromCode('w', 'p')).toBe('Rebuilt: 1 new, 2 changed, 1 removed');
    answer({ created: 0, updated: 0, unchanged: 0, removed: 0 });
    expect(await rebuildFromCode('w', 'p')).toContain('Nothing to build yet');
  });

  it('words a drift row', () => {
    expect(driftText({ path: 'src/a.ts', line: 88, state: 'changed', changedAt: null })).toBe(
      'src/a.ts:88 changed after the page',
    );
    expect(driftText({ path: 'src/b.ts', line: null, state: 'gone', changedAt: null })).toBe(
      'src/b.ts is gone',
    );
  });
});
