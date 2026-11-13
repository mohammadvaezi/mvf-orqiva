// ── [PCODE-201 | S15 | v0.1.0] T16.5 Docs and handover from the terminal and VS Code: orq docs scan/build/drift, orq handover ──
//    Why:  the handover pick offers sending only when nothing required is missing, lists the checks
//          without the checklist's own entries, and ticks or unticks an item; the rebuild says what changed.
import { describe, expect, it } from 'vitest';
import type { Api } from '../../../cli/src/loop/api';
import {
  handoverPicks,
  handoverTitle,
  rebuildDocs,
  toggleItem,
  type HandoverJson,
} from '../../src/server/handover';

const h: HandoverJson = {
  checks: [
    { key: 'readme', label: 'Handover readme', state: 'ok', detail: 'Handover readme' },
    { key: 'open-work', label: 'Open work', state: 'warn', detail: '2 tasks are still open' },
    { key: 'item:a', label: 'Access', state: 'ok', detail: 'Done' },
  ],
  ready: true,
  items: [{ id: 'a', label: 'Access', done: true }],
  client: 'Helio',
  packs: [{ number: 1, status: 'changes_requested', signedName: '', decisionNote: 'x' }],
};

function fakeApi(answer: unknown): { api: Api; calls: [string, string, unknown][] } {
  const calls: [string, string, unknown][] = [];
  return {
    calls,
    api: {
      call: <T>(method: string, path: string, body?: unknown): Promise<T> => {
        calls.push([method, path, body]);
        return Promise.resolve(answer as T);
      },
    },
  };
}

describe('the handover in VS Code', () => {
  it('offers sending first when ready, then the checks, then the checklist', () => {
    const picks = handoverPicks(h);
    expect(picks.map((p) => [p.label, p.action])).toEqual([
      ['$(mail) Send handover pack 2', 'send'],
      ['$(check) Handover readme', 'none'],
      ['$(warning) Open work', 'none'],
      ['$(pass-filled) Access', 'toggle'],
    ]);
    expect(handoverPicks({ ...h, ready: false })[0]?.action).toBe('none');
    expect(handoverTitle(h)).toBe('Ready to hand over · pack 1 needs changes');
  });

  it('ticks an item and rebuilds the docs', async () => {
    const f = fakeApi({ created: 0, updated: 1, unchanged: 3, removed: 0 });
    const src = { api: f.api, workspaceId: 'w', projectId: 'p' };
    await toggleItem(src, 'a', true);
    expect(f.calls[0]).toEqual(['PATCH', '/api/workspaces/w/handover-items/a', { done: false }]);
    expect(await rebuildDocs(src)).toBe('Docs from code rebuilt: 1 changed, 3 unchanged');
    expect(f.calls[1]).toEqual(['POST', '/api/workspaces/w/projects/p/docs/from-code', undefined]);
  });
});
