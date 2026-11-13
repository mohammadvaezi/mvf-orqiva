// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-62 | S12 | v0.1.0] Surface engine and Plane errors as actionable notifications with Open output ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the table is copy, and copy rots silently. Each line the engine can print is asserted here with
//          the text a person will read and the button they will press, so a reworded engine message shows
//          up as a failing test rather than as a notification that tells them to type a command.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEDUPE_MS, resetErrorDedupe, showError } from '../../src/commands/notify';
import { describeError, FALLBACK_NEXT, OrqivaError } from '../../src/util/errors';
import type { Logger } from '../../src/util/log';

function logger(): Logger & { errors: string[]; shown: number } {
  const errors: string[] = [];
  const l = {
    errors,
    shown: 0,
    info: () => undefined,
    warn: () => undefined,
    error: (m: string) => errors.push(m),
    show: () => {
      l.shown++;
    },
  };
  return l as unknown as Logger & { errors: string[]; shown: number };
}

// ── [PCODE-62 | S12 | v0.1.0] every mapped line: the text, and the button that does the next step ──
describe('describeError: the engine lines', () => {
  const cases: {
    name: string;
    action: string;
    raw: string;
    message: string;
    button?: string;
    command?: string;
    args?: string[];
  }[] = [
    {
      name: 'still active',
      action: 'Start',
      raw: 'FIX-1 is still active. First: plane status FIX-1 review|test|blocked|todo  (or plane done FIX-1)',
      message: 'Start failed. FIX-1 is still active. Move it first: Status → Review, or Done.',
      button: 'Open task',
      command: 'orqiva.openTask',
      args: ['FIX-1'],
    },
    {
      name: 'already done',
      action: 'Start',
      raw: 'PCODE-60 is Done. Create a new task for follow-up work.',
      message: 'Start failed. PCODE-60 is Done. Create a new task for the follow-up work.',
      button: 'New task',
      command: 'orqiva.newTask',
    },
    {
      name: 'no usable description',
      action: 'Start',
      raw: 'PCODE-7 has no usable description. Add what/why/acceptance in Plane (or a comment) before starting.',
      message:
        'Start failed. PCODE-7 has no usable description. Add what, why and the acceptance checks in Orqiva, then start it again.',
      button: 'Open task',
      command: 'orqiva.openTask',
      args: ['PCODE-7'],
    },
    {
      name: 'no fingerprint',
      action: 'Done',
      raw: 'no file carries the fingerprint [FIX-2 | ...]. Add the marker to the code written for this task (or --force for a task with no code, e.g. a check).',
      message:
        'Done failed. no file carries the fingerprint [FIX-2 | ...]. Add the marker above the code you wrote for this task.',
      button: 'Copy fingerprint',
      command: 'orqiva.copyFingerprint',
    },
    {
      name: 'description too short',
      action: 'New task',
      raw: 'a task needs a complete description (>= 40 characters): what, why, how to verify. Use --desc-file or --desc.',
      message:
        'New task failed. a task needs a complete description (>= 40 characters): what, why, how to verify. Fill in what, why and how to verify, then create it again.',
      button: 'New task',
      command: 'orqiva.newTask',
    },
    {
      name: 'not linked',
      action: 'Sync',
      raw: 'this folder is not linked to a Plane project (no .plane/project.json). Run plane_init.py here.',
      message:
        'Sync failed. this folder is not linked to a Plane project (no .plane/project.json). Link this folder to a project first.',
      button: 'Link project',
      command: 'orqiva.linkProject',
    },
    {
      name: 'no such state',
      action: 'Status',
      raw: "no state named 'Review' in Plane - run plane_init.py to add the standard states",
      message:
        "Status failed. no state named 'Review' in Plane - run plane_init.py to add the standard states. Run the project set-up to add the standard states.",
      button: 'Open setup',
      command: 'orqiva.openSetup',
    },
    {
      name: 'no such sprint',
      action: 'New task',
      raw: "no sprint matching 'Sprint 99'. Use today, next, or a sprint name.",
      message:
        "New task failed. no sprint matching 'Sprint 99'. Name today, next, or the sprint's own name.",
    },
    {
      name: 'unknown task',
      action: 'Start',
      raw: 'no task FIX-99 in Plane',
      message:
        'Start failed. no task FIX-99 in Plane. Sync and try again; the item may be new or may have been renamed.',
      button: 'Sync now',
      command: 'orqiva.sync',
    },
    {
      name: 'malformed ref',
      action: 'Start',
      raw: 'task id looks wrong: fix2 (expected e.g. FIX-12)',
      message:
        'Start failed. task id looks wrong: fix2 (expected e.g. FIX-12). Write the reference the way Orqiva does, for example PCODE-12.',
    },
    {
      name: 'git refused',
      action: 'Done',
      raw: 'git commit failed: nothing to commit, working tree clean',
      message:
        'Done failed. git commit failed: nothing to commit, working tree clean. Fix what git reports, then run Done again.',
    },
    {
      name: 'rate limited',
      action: 'Sync',
      raw: 'Plane: 429 Too Many Requests',
      message:
        'Sync failed. Plane: 429 Too Many Requests. Wait a moment and try again; the tracker allows 60 requests a minute.',
      button: 'Sync now',
      command: 'orqiva.sync',
    },
    {
      name: 'key refused',
      action: 'Sync',
      raw: 'Plane: 401 Unauthorized',
      message:
        'Sync failed. Plane: 401 Unauthorized. The tracker refused the key. Enter it again in Set-up.',
      button: 'Open setup',
      command: 'orqiva.openSetup',
    },
    {
      name: 'no access',
      action: 'Sync',
      raw: 'Plane: 403 Forbidden',
      message:
        'Sync failed. Plane: 403 Forbidden. The key has no access to this project. Check workspace and project in Set-up.',
      button: 'Open setup',
      command: 'orqiva.openSetup',
    },
    {
      name: 'gone',
      action: 'Note',
      raw: 'Plane: 404 for /issues/abc/comments/',
      message:
        'Note failed. Plane: 404 for /issues/abc/comments/. Orqiva has no such item; sync and try again.',
      button: 'Sync now',
      command: 'orqiva.sync',
    },
    {
      name: 'offline',
      action: 'Sync',
      raw: 'getaddrinfo ENOTFOUND plan.broszio.com',
      message:
        'Sync failed. getaddrinfo ENOTFOUND plan.broszio.com. Check the server address and your connection; updates are queued meanwhile.',
      button: 'Open setup',
      command: 'orqiva.openSetup',
    },
  ];

  for (const c of cases) {
    it(`maps ${c.name}`, () => {
      const d = describeError(c.action, new OrqivaError(c.raw, 'engine'));
      expect(d.message).toBe(c.message);
      expect(d.action?.label).toBe(c.button);
      expect(d.action?.command).toBe(c.command);
      if (c.args) expect(d.action?.args).toEqual(c.args);
      // never a stack trace, never a CLI instruction in the part we wrote
      expect(d.message).not.toMatch(/\n| at |plane_task\.py/);
    });
  }

  it('falls back with the first line and Open output', () => {
    const d = describeError('Something', new Error('boom\n  at somewhere.ts:1'));
    expect(d.message).toBe(`Something failed. boom. ${FALLBACK_NEXT}`);
    expect(d.action).toBeUndefined();
  });

  it('keeps the kind-specific next step when no line matched', () => {
    expect(describeError('Install', new OrqivaError('python is missing', 'config')).message).toBe(
      'Install failed. python is missing. Fix the setting or the connection, then try again.',
    );
    expect(describeError('Publish', new OrqivaError('Cancelled', 'cancelled')).message).toBe(
      'Publish failed. Cancelled. Nothing was changed.',
    );
  });

  it('strips the ERROR: prefix the engine prints and runs the redactor over the line', () => {
    const d = describeError('Sync', new Error('ERROR: key plane_api_leak_value_123 bad'), (s) =>
      s.replace(/plane_api_\w+/g, '***'),
    );
    expect(d.message).toBe(`Sync failed. key *** bad. ${FALLBACK_NEXT}`);
  });
});

// ── [PCODE-62 | S12 | v0.1.0] the same sentence is shown once, whatever asks for it ──
describe('showError deduplication', () => {
  const offline = new OrqivaError('getaddrinfo ENOTFOUND plan.broszio.com', 'network');

  it('shows one notification for a whole series of failing polls', async () => {
    resetErrorDedupe();
    const log = logger();
    const shown: string[] = [];
    let clock = 1_000;
    const deps = {
      now: () => clock,
      show: (m: string) => {
        shown.push(m);
        return Promise.resolve(undefined);
      },
    };
    // twenty poll cycles inside half a minute
    for (let i = 0; i < 20; i++) {
      await showError('Refresh', offline, log, deps);
      clock += 1_000;
    }
    expect(shown).toHaveLength(1);
    // but the log has every one of them: the output channel is the record
    expect(log.errors).toHaveLength(20);

    // once the window has passed, the user is told again
    clock += DEDUPE_MS;
    await showError('Refresh', offline, log, deps);
    expect(shown).toHaveLength(2);
  });

  it('does not swallow a different error in the meantime', async () => {
    resetErrorDedupe();
    const shown: string[] = [];
    const deps = {
      now: () => 5_000,
      show: (m: string) => {
        shown.push(m);
        return Promise.resolve(undefined);
      },
    };
    await showError('Refresh', offline, logger(), deps);
    await showError('Done', new OrqivaError('git commit failed: x', 'engine'), logger(), deps);
    await showError('Refresh', offline, logger(), deps);
    expect(shown).toHaveLength(2);
    expect(shown[1]).toContain('Fix what git reports');
  });

  it('runs the action command when its button is pressed, and shows the log for Open output', async () => {
    resetErrorDedupe();
    const log = logger();
    const ran: { command: string; args: unknown[] }[] = [];
    await showError('Start', new OrqivaError('FIX-1 is still active', 'engine'), log, {
      show: (_m, ...items) => Promise.resolve(items[0]), // the "Open task" button
      run: (command: string, ...args: unknown[]) => {
        ran.push({ command, args });
        return Promise.resolve(undefined);
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(ran).toEqual([{ command: 'orqiva.openTask', args: ['FIX-1'] }]);
    expect(log.shown).toBe(0);

    resetErrorDedupe();
    await showError('Done', new OrqivaError('git commit failed: x', 'engine'), log, {
      show: (_m, ...items) => Promise.resolve(items[items.length - 1]), // "Open output"
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(log.shown).toBe(1);
  });
});

// ── [PCODE-62 | S12 | v0.1.0] no bare notification anywhere else (the eslint rule, asserted as text) ──
describe('one place raises an error notification', () => {
  it('only notify.ts names showErrorMessage', () => {
    const src = path.resolve(__dirname, '..', '..', 'src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && entry.name !== 'notify.ts') {
          if (fs.readFileSync(full, 'utf8').includes('showErrorMessage'))
            offenders.push(path.relative(src, full));
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });

  it('the eslint config carries the rule that enforces it', () => {
    const config = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'eslint.config.mjs'),
      'utf8',
    );
    expect(config).toContain('no-restricted-syntax');
    expect(config).toContain("callee.property.name='showErrorMessage'");
    expect(config).toContain('src/commands/notify.ts');
  });
});
