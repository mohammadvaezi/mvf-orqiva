// ── [PCODE-29 | S05 | v0.1.0] Add Forget key with confirmation and an e2e secrets test ──
//    Why:  no confirmation keeps the key; confirmation (or a decided caller) removes it and goes offline.
import { beforeEach, describe, expect, it } from 'vitest';
import { FORGET_PROMPT, forgetKey } from '../../src/commands/setupCommands';
import type { Services } from '../../src/services';
import { Store } from '../../src/state/store';
import { recorded, resetRecorded } from '../mocks/vscode';

function services(): Services & { deleted: number } {
  const store = new Store();
  const s = {
    deleted: 0,
    store,
    log: { info: () => undefined },
    secrets: {
      deleteApiKey: () => {
        s.deleted++;
        return Promise.resolve();
      },
    },
  };
  return s as unknown as Services & { deleted: number };
}

describe('forgetKey', () => {
  beforeEach(() => {
    resetRecorded();
  });

  it('keeps the key when the prompt is dismissed, removes it on Remove', async () => {
    const s = services();
    let asked = 0;
    expect(
      await forgetKey(s, undefined, () => {
        asked++;
        return Promise.resolve(undefined);
      }),
    ).toBe(false);
    expect(s.deleted).toBe(0);
    expect(
      await forgetKey(s, undefined, () => {
        asked++;
        return Promise.resolve('Remove');
      }),
    ).toBe(true);
    expect(asked).toBe(2);
    expect(s.deleted).toBe(1);
    expect(s.store.state.online).toBe(false);
    expect(s.store.state.lastError).toBe('No API key stored');
    expect(recorded.infoMessages.at(-1)).toContain('removed');
    expect(FORGET_PROMPT).toContain('Projects and hooks are kept');
  });

  it('a decided caller skips the prompt', async () => {
    const s = services();
    let asked = 0;
    expect(await forgetKey(s, false, () => (asked++, Promise.resolve('Remove')))).toBe(false);
    expect(await forgetKey(s, true, () => (asked++, Promise.resolve(undefined)))).toBe(true);
    expect(asked).toBe(0);
    expect(s.deleted).toBe(1);
  });
});
