// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-106 | S15 | v0.1.0] Add the team activity feed panel to VS Code ──
import type { ActivityData, ActivityEvent } from '@orqiva/shared';
import { describe, expect, it } from 'vitest';
import {
  ActivityFeed,
  FEED_SIZE,
  describe as sentence,
  itemOf,
  whenText,
} from '../../src/server/feed';
import { ActivityTreeProvider } from '../../src/views/activityTree';

const ev = (
  sequence: number,
  data: Partial<ActivityData> = {},
  time = '2026-10-03T14:02:00',
): ActivityEvent => ({
  specversion: '1.0',
  id: 'e' + String(sequence),
  source: '/workspaces/w',
  type: 'orqiva.item.moved',
  time,
  subject: 'i1',
  datacontenttype: 'application/json',
  workspaceid: 'w',
  sequence,
  data: {
    actor: { kind: 'user', id: 'u', name: 'Ada' },
    verb: 'moved',
    object: { type: 'item', id: 'i1', label: 'APP-3 Export' },
    ...data,
  },
});

describe('feed sentences', () => {
  it('say who did what on which task', () => {
    expect(sentence(ev(1, { changes: { state: { from: 'Todo', to: 'Review' } } }))).toBe(
      'Ada moved APP-3 Export → Review',
    );
    expect(sentence(ev(1, { verb: 'started' }))).toBe('Ada started APP-3 Export');
    expect(
      sentence(
        ev(1, { verb: 'completed', changes: { state: { from: 'In Progress', to: 'Review' } } }),
      ),
    ).toBe('Ada finished APP-3 Export → Review');
    expect(
      sentence(
        ev(1, { verb: 'progressed', changes: { files: { from: null, to: ['a.ts', 'b.ts'] } } }),
      ),
    ).toBe('Ada edited 2 files on APP-3 Export');
    expect(
      sentence(
        ev(1, { verb: 'progressed', changes: { commit: { from: null, to: 'abcdef1234' } } }),
      ),
    ).toBe('Ada committed abcdef1 on APP-3 Export');
    expect(
      sentence(ev(1, { verb: 'progressed', changes: { tests: { from: null, to: 'green' } } })),
    ).toBe('Ada ran tests on APP-3 Export: green');
    // [PCODE-108 | S15 | v0.1.0] Git hosts
    expect(
      sentence(
        ev(1, {
          verb: 'progressed',
          actor: { kind: 'integration', id: 'gitea', name: 'bob via Gitea' },
          changes: {
            pullRequest: { from: 'open', to: { number: '4', state: 'merged', title: 'x' } },
          },
        }),
      ),
    ).toBe('bob via Gitea merged PR #4 on APP-3 Export');
    expect(sentence(ev(1, { verb: 'updated', changes: { title: { from: 'a', to: 'b' } } }))).toBe(
      'Ada changed the title of APP-3 Export', // [PCODE-229 | S15 | v0.1.0] fields read as words
    );
    const comment = ev(1, {
      verb: 'commented',
      object: { type: 'comment', id: 'c1' },
      parent: { type: 'item', id: 'i9', label: 'APP-9 Fix' },
    });
    expect(sentence(comment)).toBe('Ada commented on APP-9 Fix');
    expect(itemOf(comment)).toBe('i9');
    expect(
      sentence(
        ev(1, {
          verb: 'approved',
          object: { type: 'gate', id: 'g', label: 'Security gate' },
          actor: { kind: 'system', id: 's' },
        }),
      ),
    ).toBe('Orqiva approved Security gate');
  });

  it('give the time, with the date when it is not today', () => {
    const now = new Date('2026-10-03T18:00:00');
    expect(whenText('2026-10-03T14:02:00', now)).toBe('14:02');
    expect(whenText('2026-10-02T09:05:00', now)).toBe('2 Oct 09:05');
  });
});

describe('the feed', () => {
  it('shows newest first, drops copies of the same event and keeps the last hundred', () => {
    const feed = new ActivityFeed(() => new Date('2026-10-03T18:00:00'));
    let changes = 0;
    feed.onDidChange(() => changes++);
    feed.reset([ev(1), ev(2), ev(3)]);
    feed.add(ev(3)); // the overlap of history and live stream
    feed.add(ev(4, { actor: { kind: 'agent', id: 'a', name: 'Builder agent' }, verb: 'started' }));
    const entries = feed.entries();
    expect(entries.map((e) => e.sequence)).toEqual([4, 3, 2, 1]);
    expect(entries[0]).toMatchObject({
      actorKind: 'agent',
      text: 'Builder agent started APP-3 Export',
      when: '14:02',
      itemId: 'i1',
    });
    expect(changes).toBe(3);
    for (let n = 5; n < 200; n++) feed.add(ev(n));
    expect(feed.entries()).toHaveLength(FEED_SIZE);
    expect(feed.entries().at(-1)?.sequence).toBe(200 - FEED_SIZE);
  });

  it('draws in the view with an icon per kind of actor and a click that opens the task', () => {
    const feed = new ActivityFeed();
    feed.reset([ev(1), ev(2, { actor: { kind: 'agent', id: 'a', name: 'Builder agent' } })]);
    const view = new ActivityTreeProvider(feed);
    const [agent, person] = view.getChildren();
    expect(agent && view.getTreeItem(agent)).toMatchObject({
      iconPath: { id: 'hubot' },
      command: { command: 'orqiva.openActivityItem', arguments: ['i1'] },
    });
    expect(person && view.getTreeItem(person)).toMatchObject({ iconPath: { id: 'person' } });
    expect(agent ? (view.getTreeItem(agent).tooltip as string) : '').toContain(
      'AI agent: Builder agent',
    );
    view.dispose();
  });
});
