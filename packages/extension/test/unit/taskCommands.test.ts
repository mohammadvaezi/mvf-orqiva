// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-14 | S03 | v0.1.0] Add Sync, Start, Done, Status and Note commands wired to the engine ──
//    Why:  success notifications, the three-part error mapping and the "no state chosen does nothing" rule.
import { beforeEach, describe, expect, it } from 'vitest';
import { EngineCommands } from '../../src/engine/commands';
import { errorMessage, OPEN_OUTPUT } from '../../src/commands/notify';
import { createTaskCommands } from '../../src/commands/taskCommands';
import type { Services } from '../../src/services';
import { Store } from '../../src/state/store';
import { OrqivaError } from '../../src/util/errors';
import { Logger, resetLoggerForTests } from '../../src/util/log';
import { recorded, resetRecorded } from '../mocks/vscode';

function servicesWith(
  stdout: Record<string, string | Error>,
  store = new Store(),
): { services: Services; calls: string[][] } {
  const calls: string[][] = [];
  const run = (_script: string, args: string[]) => {
    calls.push(args);
    const key = args[0] ?? '';
    const out = stdout[key];
    if (out instanceof Error) return Promise.reject(out);
    return Promise.resolve({ code: 0, stdout: out ?? '', stderr: '' });
  };
  const services = {
    log: new Logger(),
    store,
    engine: new EngineCommands(run),
    client: { webUrl: () => 'https://plane.example.test/ws/projects/p/issues/' },
  } as unknown as Services;
  return { services, calls };
}

describe('taskCommands', () => {
  let refreshed = 0;
  beforeEach(() => {
    resetRecorded();
    resetLoggerForTests();
    refreshed = 0;
  });
  const refresh = (): Promise<void> => {
    refreshed++;
    return Promise.resolve();
  };

  // ── [PCODE-14 | S03 | v0.1.0] Start on a Todo item calls the engine with [start, REF] and refreshes ──
  it('start runs the engine with [start, FIX-3] and shows the engine result', async () => {
    const { services, calls } = servicesWith({
      start:
        'Active: FIX-3 Add a farewell function  [Todo -> In Progress]\nFingerprint for every file/block you write: [FIX-3 | S02 | v0.1.0] Add a farewell function\n',
    });
    const cmds = createTaskCommands({ services, refresh });
    await cmds['orqiva.startTask']?.({ kind: 'item', item: { ref: 'FIX-3' }, sprint: {} });
    expect(calls).toEqual([['start', 'FIX-3']]);
    expect(recorded.infoMessages[0]).toBe(
      'FIX-3 started (Todo → In Progress). Fingerprint: [FIX-3 | S02 | v0.1.0] Add a farewell function',
    );
    expect(refreshed).toBe(1);
  });

  it('done without fingerprints shows the three-part error with an Open output button', async () => {
    const { services } = servicesWith({
      done: new OrqivaError(
        'no file carries the fingerprint [FIX-2 | ...]. Add the marker to the code written for this task (or --force for a task with no code, e.g. a check)',
        'engine',
        'exit 2',
      ),
    });
    const cmds = createTaskCommands({ services, refresh });
    await cmds['orqiva.doneTask']?.('FIX-2');
    // [PCODE-62 | S12 | v0.1.0] the engine's CLI advice is replaced by the button that performs it
    expect(recorded.errorMessages[0]).toBe(
      'Done failed. no file carries the fingerprint [FIX-2 | ...]. Add the marker above the code you wrote for this task.',
    );
    expect(recorded.errorItems[0]).toEqual(['Copy fingerprint', OPEN_OUTPUT]);
    // the mock answers with the first item, so that button's command ran
    await new Promise((r) => setTimeout(r, 0));
    expect(recorded.executedCommands.at(-1)?.command).toBe('orqiva.copyFingerprint');
    expect(refreshed).toBe(1);
  });

  it('status without a chosen state does nothing', async () => {
    const { services, calls } = servicesWith({});
    recorded.quickPickAnswer = undefined;
    const cmds = createTaskCommands({ services, refresh });
    await cmds['orqiva.setStatus']?.('FIX-2');
    expect(calls).toEqual([]);
    expect(refreshed).toBe(0);
  });

  it('status with a state and note calls the engine and sync reports counts', async () => {
    const { services, calls } = servicesWith({
      status: 'FIX-2 -> Blocked. No active task now.\n',
      sync: 'Synced. 1 carried over, 2 moved to Todo. No active task.\n',
    });
    recorded.quickPickAnswer = 2; // Blocked
    recorded.inputBoxAnswers = ['waiting for API key'];
    const cmds = createTaskCommands({ services, refresh });
    await cmds['orqiva.setStatus']?.('FIX-2');
    expect(calls[0]).toEqual(['status', 'FIX-2', 'blocked', '--note', 'waiting for API key']);
    expect(recorded.infoMessages[0]).toBe('FIX-2 → Blocked.');
    await cmds['orqiva.sync']?.();
    expect(recorded.infoMessages[1]).toBe('Synced. 1 carried over, 2 moved to Todo.');
  });

  // [PCODE-62 | S12 | v0.1.0] the mapping itself lives in errors.test.ts; this keeps the redaction guard
  it('errorMessage maps kinds to next steps and keeps secrets out', () => {
    expect(
      errorMessage('Sync', new OrqivaError('Plane unreachable: ECONNREFUSED', 'network')),
    ).toBe(
      'Sync failed. Plane unreachable: ECONNREFUSED. Check the server address and your connection; updates are queued meanwhile.',
    );
    expect(
      errorMessage(
        'Start',
        new OrqivaError('FIX-1 is still active. First: plane status FIX-1 review', 'engine'),
      ),
    ).toBe('Start failed. FIX-1 is still active. Move it first: Status → Review, or Done.');
    expect(errorMessage('Note', new Error('key plane_api_leak_value_123 bad'))).toBe(
      'Note failed. key *** bad. Open output for details.',
    );
  });
});
