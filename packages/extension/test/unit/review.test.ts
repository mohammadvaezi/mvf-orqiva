// ── [PCODE-311 | S15 | v0.1.0] T31.9b Code review in VS Code: the queue, the diff and line comments ──
//    Why:  the diff's two sides keep every line at the number the host knows, so a comment lands where it
//          was written; the queue and file rows say what matters; each action sends the right call.
import { describe, expect, it } from 'vitest';
import type { Api } from '../../../cli/src/loop/api';
import {
  addComment,
  commentLabel,
  decide,
  fileLabel,
  queueLabel,
  shownOn,
  sidesOf,
  submitReview,
  submitSummary,
  type QueueEntry,
  type ReviewComment,
  type ReviewFile,
} from '../../src/server/review';

const PATCH = [
  '@@ -2,3 +2,4 @@ export function cart() {',
  '   const items = [];',
  '-  let total = 0;',
  '+  let total = 0n;',
  '+  save(items);',
  '   return items;',
].join('\n');

const comment = (c: Partial<ReviewComment>): ReviewComment => ({
  id: 'c1',
  path: 'src/cart.ts',
  line: 3,
  side: 'new',
  body: 'Hm.',
  source: 'person',
  state: 'draft',
  severity: null,
  author: 'Ada',
  mine: true,
  outdated: false,
  ...c,
});

describe('code review in VS Code', () => {
  it('draws both sides with each line at its own number', () => {
    const s = sidesOf(PATCH);
    expect(s.old.split('\n')).toEqual([
      '',
      '  const items = [];',
      '  let total = 0;',
      '  return items;',
    ]);
    expect(s.new.split('\n')).toEqual([
      '',
      '  const items = [];',
      '  let total = 0n;',
      '  save(items);',
      '  return items;',
    ]);
    // comments sit on the new side's lines of the patch, or on a removed line
    expect(s.newLines).toEqual([2, 3, 4, 5]);
    expect(s.oldLines).toEqual([3]);
    expect(sidesOf('')).toEqual({ old: '', new: '', newLines: [], oldLines: [] });
  });

  it('labels the queue, the files and the comments', () => {
    const q: QueueEntry = {
      id: 'p1',
      number: 7,
      title: 'Cart keeps items',
      url: 'https://github.com/acme/shop/pull/7',
      author: 'bob',
      repo: 'acme/shop',
      branch: 'feat/cart',
      base: 'main',
      draft: false,
      additions: 40,
      deletions: 3,
      changedFiles: 4,
      reviewState: 'none',
      checksState: 'failing',
      itemRef: null,
      risk: { level: 'high', reasons: ['checks fail', 'no task', 'touches auth'] },
      files: 4,
      viewed: 1,
      mergeable: 'conflicts',
    };
    expect(queueLabel(q)).toEqual({
      label: '$(warning) #7 Cart keeps items',
      description: 'acme/shop · bob · +40 −3',
      detail:
        'no task · not reviewed · $(error) checks fail · $(git-merge) conflicts · 1/4 viewed · checks fail, touches auth',
    });
    const f: ReviewFile = {
      path: 'src/cart.ts',
      oldPath: 'src/basket.ts',
      status: 'renamed',
      additions: 2,
      deletions: 1,
      binary: false,
      tooBig: false,
      patch: PATCH,
      viewed: false,
    };
    expect(fileLabel(f, 2)).toEqual({
      label: '$(circle-large-outline) src/cart.ts',
      description: 'renamed from src/basket.ts · +2 −1 · 2 comments',
    });
    expect(fileLabel({ ...f, viewed: true, status: 'modified' }, 0).label).toBe(
      '$(eye) src/cart.ts',
    );
    expect(commentLabel(comment({}))).toBe('Ada · draft, posted with your review');
    expect(
      commentLabel(comment({ source: 'ai', state: 'suggested', severity: 'risk', author: null })),
    ).toBe('Reviewer agent · suggestion, risk');
    expect(commentLabel(comment({ state: 'posted', outdated: true }))).toBe(
      'Ada · posted · outdated',
    );
  });

  it('shows what goes with the review', () => {
    const thread = {
      comments: [
        comment({}),
        comment({ id: 'c2', outdated: true }),
        comment({ id: 'c3', source: 'ai', state: 'suggested', mine: false }),
        comment({ id: 'c4', state: 'dismissed', source: 'ai', mine: false }),
        comment({ id: 'c5', path: 'src/other.ts', state: 'posted', mine: false }),
      ],
      reviews: [],
    };
    expect(submitSummary(thread)).toBe(
      '1 draft comment posted with it · 1 outdated draft kept back · 1 AI suggestion not decided',
    );
    expect(shownOn(thread, 'src/cart.ts').map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('sends each action to its endpoint', async () => {
    const calls: [string, string, unknown][] = [];
    const api = {
      call: (method: string, path: string, body?: unknown) => {
        calls.push([method, path, body]);
        return Promise.resolve({});
      },
    } as unknown as Api;
    const src = { api, workspaceId: 'w', projectId: 'p' };
    await addComment(src, 'p1', { path: 'src/cart.ts', line: 3, side: 'new', body: 'Hm.' });
    await decide(src, 'c3', false);
    await submitReview(src, 'p1', 'request_changes', '  Please save on remove.  ');
    await submitReview(src, 'p1', 'approve', ' ');
    expect(calls).toEqual([
      [
        'POST',
        '/api/workspaces/w/pull-requests/p1/comments',
        { path: 'src/cart.ts', line: 3, side: 'new', body: 'Hm.' },
      ],
      ['POST', '/api/workspaces/w/pull-request-comments/c3/decide', { accept: false }],
      [
        'POST',
        '/api/workspaces/w/pull-requests/p1/reviews',
        { decision: 'request_changes', body: 'Please save on remove.' },
      ],
      ['POST', '/api/workspaces/w/pull-requests/p1/reviews', { decision: 'approve' }],
    ]);
  });
});
