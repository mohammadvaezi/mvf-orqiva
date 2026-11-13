// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-67 | S13 | v0.1.0] Add Open folder from the dashboard and a recent projects list on Welcome ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the list is only useful if every entry works. A folder that has been deleted, and the folder
//          already open in this window, are both offers that lead nowhere, so both are asserted absent.
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  openRecentProject,
  RECENT_CONTEXT,
  recentItems,
  refreshRecentContext,
  type RecentItem,
} from '../../src/commands/recentCommands';
import { FOLDERS_KEY, readFolders, type MementoLike } from '../../src/dashboard/folders';

function memento(
  initial: Record<string, string>,
): MementoLike & { store: Record<string, unknown> } {
  const store: Record<string, unknown> = { [FOLDERS_KEY]: initial };
  return {
    store,
    get: (k: string) => store[k],
    update: (k: string, v: unknown) => {
      store[k] = v;
      return Promise.resolve();
    },
  };
}

const FOLDERS = {
  PCODE: path.join('C:', 'Broszio Apps', 'orqiva'),
  LTR: path.join('C:', 'Broszio Apps', 'letterman'),
  GONE: path.join('C:', 'Broszio Apps', 'deleted'),
};
const exists = (p: string): boolean => p !== FOLDERS.GONE;

describe('recentItems', () => {
  it('lists the live folders by identifier', () => {
    expect(recentItems(memento(FOLDERS), exists)).toEqual([
      { identifier: 'LTR', folder: FOLDERS.LTR },
      { identifier: 'PCODE', folder: FOLDERS.PCODE },
    ]);
  });
});

describe('openRecentProject', () => {
  it('offers the others and opens the chosen one in this window', async () => {
    const opened: string[] = [];
    let offered: RecentItem[] = [];
    const chosen = await openRecentProject({
      memento: memento(FOLDERS),
      exists,
      currentRoot: () => FOLDERS.PCODE,
      pick: (items) => {
        offered = items.map((i) => ({ identifier: i.identifier, folder: i.folder }));
        return Promise.resolve(items[0]);
      },
      open: (f) => {
        opened.push(f);
        return Promise.resolve(undefined);
      },
    });
    // neither the deleted folder nor the one already open
    expect(offered.map((o) => o.identifier)).toEqual(['LTR']);
    expect(chosen?.identifier).toBe('LTR');
    expect(opened).toEqual([FOLDERS.LTR]);
  });

  it('opens nothing when the pick is dismissed, or when there is nothing to offer', async () => {
    const opened: string[] = [];
    const open = (f: string): Promise<unknown> => {
      opened.push(f);
      return Promise.resolve(undefined);
    };
    const dismissed = await openRecentProject({
      memento: memento(FOLDERS),
      exists,
      pick: () => Promise.resolve(undefined),
      open,
    });
    expect(dismissed).toBeUndefined();
    expect(opened).toEqual([]);

    let asked = false;
    const empty = await openRecentProject({
      memento: memento({ PCODE: FOLDERS.PCODE }),
      exists,
      currentRoot: () => FOLDERS.PCODE,
      pick: () => {
        asked = true;
        return Promise.resolve(undefined);
      },
      open,
    });
    expect(empty).toBeUndefined();
    expect(asked, 'no pick is shown when the only project is the one already open').toBe(false);
  });
});

describe('refreshRecentContext', () => {
  it('sets the key, and prunes the folder that has gone', async () => {
    const m = memento(FOLDERS);
    const set: [string, unknown][] = [];
    const count = await refreshRecentContext(
      m,
      (k, v) => {
        set.push([k, v]);
        return Promise.resolve();
      },
      exists,
      () => FOLDERS.PCODE,
    );
    expect(count).toBe(1);
    expect(set).toEqual([[RECENT_CONTEXT, true]]);
    expect(Object.keys(readFolders(m)).sort()).toEqual(['LTR', 'PCODE']);
  });

  it('is false when nothing is left to offer', async () => {
    const set: [string, unknown][] = [];
    const count = await refreshRecentContext(
      memento({ PCODE: FOLDERS.PCODE }),
      (k, v) => {
        set.push([k, v]);
        return Promise.resolve();
      },
      exists,
      () => FOLDERS.PCODE,
    );
    expect(count).toBe(0);
    expect(set).toEqual([[RECENT_CONTEXT, false]]);
  });
});
