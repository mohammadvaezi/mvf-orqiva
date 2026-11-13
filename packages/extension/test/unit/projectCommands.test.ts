// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-30 | S06 | v0.1.0] Add New project and Link project commands calling plane_init.py ──
//    Why:  identifier validation, the argv both commands hand to plane_init.py, folder selection in a
//          multi-root workspace, the parsed summary, and - against the fake engine - a temp folder that
//          becomes a project the store picks up without a reload.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProjectCommands,
  linkProjectArgs,
  newProjectArgs,
  parseInitSummary,
  pickFolder,
  suggestIdentifier,
  summaryMessage,
  validateIdentifier,
} from '../../src/commands/projectCommands';
import type { EngineRunner } from '../../src/engine/commands';
import { runEngine } from '../../src/engine/run';
import type { Services } from '../../src/services';
import { Store } from '../../src/state/store';
import { Logger, resetLoggerForTests } from '../../src/util/log';
import { recorded, resetRecorded, Uri, window, workspace } from '../mocks/vscode';

// [PCODE-453 | S15 | v0.1.0] no Orqiva sign-in here: these are the Plane-engine paths
const noHome = (): string => path.join(os.tmpdir(), 'orqiva-test-no-sign-in');
const FAKE_HOME = path.resolve(__dirname, '..', 'fixtures', 'fake-engine');

function fakeServices(runner: (cwd: string) => EngineRunner): {
  services: Services;
  store: Store;
  relocated: string[];
} {
  const store = new Store();
  const relocated: string[] = [];
  const services = {
    log: new Logger(),
    store,
    runAt: runner,
    relocate: (root: string) => {
      relocated.push(root);
      store.load(root);
    },
  } as unknown as Services;
  return { services, store, relocated };
}

function scripted(
  outputs: Record<string, string>,
  calls: { cwd: string; script: string; args: string[] }[],
): (cwd: string) => EngineRunner {
  return (cwd) => (script, args) => {
    calls.push({ cwd, script, args });
    return Promise.resolve({ code: 0, stdout: outputs[args[0] ?? ''] ?? '', stderr: '' });
  };
}

const CREATED =
  'Created Plane project Demo (DEMO)\nStates added: Backlog, Todo\nLabels added: feature, bug\nScaffolded: .plane/project.json, .plane/rules.md\nReady: C:\\x\\.plane\nBoard: https://plane.example.test/ws/projects/0/issues/\n';

describe('projectCommands (pure)', () => {
  it('suggests and validates identifiers', () => {
    expect(suggestIdentifier('letterman')).toBe('LETTE');
    expect(suggestIdentifier('Plane Code 2')).toBe('PLANE');
    expect(suggestIdentifier('x')).toBe('');
    expect(validateIdentifier('PCODE')).toBeUndefined();
    expect(validateIdentifier('AB')).toBeUndefined();
    expect(validateIdentifier('A')).toMatch(/Two to five/);
    expect(validateIdentifier('ABCDEF')).toMatch(/Two to five/);
    expect(validateIdentifier('pcode')).toMatch(/Two to five/);
    expect(validateIdentifier('PC-1')).toMatch(/Two to five/);
  });

  it('builds the argv for both commands', () => {
    expect(newProjectArgs('My App', 'MYAPP')).toEqual([
      '--name',
      'My App',
      '--identifier',
      'MYAPP',
    ]);
    expect(linkProjectArgs('LTR')).toEqual(['--project', 'LTR']);
  });

  it('parses the engine summary', () => {
    const s = parseInitSummary(CREATED);
    expect(s).toEqual({
      action: 'created',
      name: 'Demo',
      identifier: 'DEMO',
      states: ['Backlog', 'Todo'],
      labels: ['feature', 'bug'],
      scaffolded: ['.plane/project.json', '.plane/rules.md'],
      board: 'https://plane.example.test/ws/projects/0/issues/',
    });
    expect(summaryMessage(s)).toBe(
      'Created DEMO Demo · 2 states added · 2 labels added · scaffolded .plane/project.json, .plane/rules.md.',
    );
    const l = parseInitSummary('Linked Plane project Letterman (LTR)\nReady: /x/.plane\n');
    expect(l.action).toBe('linked');
    expect(l.board).toBeNull();
    expect(summaryMessage(l)).toBe('Linked LTR Letterman.');
  });

  // ── [PCODE-30 | S06 | v0.1.0] folder selection ──
  it('takes the only folder, offers several, refuses none', async () => {
    await expect(pickFolder([])).rejects.toThrow(/Open a folder first/);
    expect(await pickFolder([{ name: 'a', fsPath: 'C:\\a' }])).toBe('C:\\a');
    const offered: { label: string; description?: string }[][] = [];
    const two = [
      { name: 'a', fsPath: 'C:\\a' },
      { name: 'b', fsPath: 'C:\\b' },
    ];
    expect(
      await pickFolder(two, (items) => {
        offered.push(items);
        return Promise.resolve(items[1]);
      }),
    ).toBe('C:\\b');
    expect(offered[0]?.map((i) => i.label)).toEqual(['a', 'b']);
    expect(await pickFolder(two, () => Promise.resolve(undefined))).toBeUndefined();
  });
});

describe('projectCommands (commands)', () => {
  beforeEach(() => {
    resetRecorded();
    resetLoggerForTests();
    workspace.workspaceFolders = [{ uri: Uri.file('C:\\work\\demo'), name: 'demo', index: 0 }];
  });
  afterEach(() => {
    workspace.workspaceFolders = [];
  });

  it('New project runs plane_init.py --name --identifier in the folder and relocates the store', async () => {
    const calls: { cwd: string; script: string; args: string[] }[] = [];
    const { services, relocated } = fakeServices(scripted({ '--name': CREATED }, calls));
    recorded.inputBoxAnswers.push('Demo', 'demo');
    await createProjectCommands({ home: noHome, services })['orqiva.newProject']?.();
    expect(calls).toEqual([
      {
        cwd: path.resolve('C:\\work\\demo'),
        script: 'plane_init.py',
        args: ['--name', 'Demo', '--identifier', 'DEMO'],
      },
    ]);
    expect(relocated).toEqual([path.resolve('C:\\work\\demo')]);
    expect(recorded.infoMessages[0]).toMatch(/^Created DEMO Demo/);
    expect(recorded.errorMessages).toEqual([]);
  });

  // ── [PCODE-80 | S08 | v0.1.0] the Home tab waits for this command: it must not wait for the notification ──
  it('New project from the Home form finishes while the notification is still open', async () => {
    const calls: { cwd: string; script: string; args: string[] }[] = [];
    const { services } = fakeServices(scripted({ '--name': CREATED }, calls));
    const original = window.showInformationMessage;
    window.showInformationMessage = (message: string): Promise<string | undefined> => {
      recorded.infoMessages.push(message);
      return new Promise(() => undefined); // never clicked, never closed
    };
    try {
      const run = createProjectCommands({ home: noHome, services })['orqiva.newProject']?.({
        name: 'Demo',
        identifier: 'DEMO',
      });
      const settled = await Promise.race([
        run?.then(() => 'done'),
        new Promise((r) =>
          setTimeout(() => {
            r('hung');
          }, 500),
        ),
      ]);
      expect(settled).toBe('done');
      expect(calls[0]?.args).toEqual(['--name', 'Demo', '--identifier', 'DEMO']);
      expect(recorded.infoMessages[0]).toMatch(/^Created DEMO Demo/);
    } finally {
      window.showInformationMessage = original;
    }
  });

  it('New project refuses a bad identifier and a cancelled name without spawning', async () => {
    const calls: { cwd: string; script: string; args: string[] }[] = [];
    const { services } = fakeServices(scripted({}, calls));
    recorded.inputBoxAnswers.push('Demo', 'D');
    await createProjectCommands({ home: noHome, services })['orqiva.newProject']?.();
    expect(calls).toEqual([]);
    expect(recorded.errorMessages[0]).toMatch(/New project failed\. Identifier D: Two to five/);
    recorded.inputBoxAnswers.push(undefined);
    await createProjectCommands({ home: noHome, services })['orqiva.newProject']?.();
    expect(calls).toEqual([]);
  });

  it('Link project lists identifiers and names, then runs --project with the pick', async () => {
    const calls: { cwd: string; script: string; args: string[] }[] = [];
    const { services, relocated } = fakeServices(
      scripted(
        {
          '--list':
            '[{"identifier":"LTR","name":"Letterman"},{"identifier":"FIX","name":"Fixture"}]',
          '--project': 'Linked Plane project Letterman (LTR)\nReady: x\n',
        },
        calls,
      ),
    );
    recorded.quickPickAnswer = 1; // sorted: FIX, LTR
    let afterLink = 0;
    await createProjectCommands({
      home: noHome,
      services,
      afterLink: () => {
        afterLink++;
        return Promise.resolve();
      },
    })['orqiva.linkProject']?.();
    expect(calls.map((c) => c.args)).toEqual([['--list'], ['--project', 'LTR']]);
    expect(relocated).toHaveLength(1);
    expect(afterLink).toBe(1);
    expect(recorded.infoMessages[0]).toBe('Linked LTR Letterman.');
  });

  it('a multi-root workspace without a chosen folder does nothing', async () => {
    workspace.workspaceFolders = [
      { uri: Uri.file('C:\\a'), name: 'a', index: 0 },
      { uri: Uri.file('C:\\b'), name: 'b', index: 1 },
    ];
    const calls: { cwd: string; script: string; args: string[] }[] = [];
    const { services } = fakeServices(scripted({}, calls));
    recorded.quickPickAnswer = undefined;
    await createProjectCommands({ home: noHome, services })['orqiva.linkProject']?.();
    await createProjectCommands({ home: noHome, services })['orqiva.newProject']?.();
    expect(calls).toEqual([]);
    expect(recorded.errorMessages).toEqual([]);
  });
});

// ── [PCODE-30 | S06 | v0.1.0] the fake engine writes a real .plane/project.json into an empty temp folder ──
describe('projectCommands (fake engine, real python)', () => {
  const python = (() => {
    for (const c of [['py', '-3'], ['python3'], ['python']]) {
      const r = spawnSync(c[0] ?? '', [...c.slice(1), '--version'], { encoding: 'utf8' });
      if (r.status === 0 && /Python 3/.test(r.stdout + r.stderr)) return c;
    }
    return null;
  })();
  let tmp = '';
  beforeEach(() => {
    resetRecorded();
    resetLoggerForTests();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-newproject-'));
    workspace.workspaceFolders = [{ uri: Uri.file(tmp), name: path.basename(tmp), index: 0 }];
  });
  afterEach(() => {
    workspace.workspaceFolders = [];
    fs.rmSync(tmp, { recursive: true, force: true });
    const calls = path.join(FAKE_HOME, 'init-calls.jsonl');
    if (fs.existsSync(calls)) fs.unlinkSync(calls);
  });

  it.skipIf(!python)('an empty folder becomes a linked project the store sees', async () => {
    const { services, store } = fakeServices(
      (cwd) => (script, args) =>
        runEngine({ python: python ?? [], home: FAKE_HOME }, script, args, { cwd }),
    );
    expect(store.state.link).toBeNull();
    recorded.inputBoxAnswers.push('Temp Demo', 'TDEMO');
    await createProjectCommands({ home: noHome, services })['orqiva.newProject']?.();
    expect(recorded.errorMessages).toEqual([]);
    expect(fs.existsSync(path.join(tmp, '.plane', 'project.json'))).toBe(true);
    expect(store.state.root).toBe(tmp);
    expect(store.state.link?.identifier).toBe('TDEMO');
    expect(store.state.link?.name).toBe('Temp Demo');
    expect(recorded.infoMessages[0]).toMatch(/^Created TDEMO Temp Demo · 8 states added/);
  });
});

// ── [PCODE-453 | S15 | v0.1.0] signed in to Orqiva: link and create on the server, no engine call ──
describe('projectCommands (signed in to an Orqiva server)', () => {
  const SERVER = 'http://orqiva.test:8490';
  let home = '';
  let tmp = '';
  const posted: unknown[] = [];
  beforeEach(() => {
    resetRecorded();
    resetLoggerForTests();
    posted.length = 0;
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-home-'));
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-linkserver-'));
    fs.mkdirSync(path.join(home, '.orqiva'));
    fs.writeFileSync(
      path.join(home, '.orqiva', 'credentials.json'),
      JSON.stringify({ servers: { [SERVER]: { token: 'orq_t', email: 'ada@example.test' } } }),
    );
    workspace.workspaceFolders = [{ uri: Uri.file(tmp), name: path.basename(tmp), index: 0 }];
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      const p = url.slice(SERVER.length);
      const json = (v: unknown): Promise<Response> =>
        Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
      if (p === '/auth/me')
        return json({
          user: { email: 'a', name: 'A' },
          workspaces: [{ id: 'w1', name: 'Orqiva', role: 'owner' }],
        });
      if (init.method === 'POST') {
        posted.push(JSON.parse(init.body as string));
        return json({ id: 'p9', key: 'DEMO', name: 'Demo' });
      }
      return json([{ id: 'p1', key: 'APP', name: 'The App', archived: false }]);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    workspace.workspaceFolders = [];
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const linkOf = (): unknown =>
    JSON.parse(fs.readFileSync(path.join(tmp, '.orqiva', 'project.json'), 'utf8'));

  it('Link project offers the server projects and writes the orq link', async () => {
    const calls: { cwd: string; script: string; args: string[] }[] = [];
    const { services, relocated } = fakeServices(scripted({}, calls));
    recorded.quickPickAnswer = 0;
    await createProjectCommands({ home: () => home, services })['orqiva.linkProject']?.();
    expect(calls).toEqual([]);
    expect(recorded.errorMessages).toEqual([]);
    expect(linkOf()).toEqual({
      server: SERVER,
      workspaceId: 'w1',
      projectId: 'p1',
      projectKey: 'APP',
      projectName: 'The App',
    });
    expect(relocated).toEqual([tmp]);
    expect(recorded.infoMessages[0]).toBe('Linked APP The App (Orqiva).');
  });

  it('New project from the Home form creates it on the server and links the folder', async () => {
    const calls: { cwd: string; script: string; args: string[] }[] = [];
    const { services } = fakeServices(scripted({}, calls));
    await createProjectCommands({ home: () => home, services })['orqiva.newProject']?.({
      name: 'Demo',
      identifier: 'demo',
    });
    expect(calls).toEqual([]);
    expect(posted).toEqual([{ key: 'DEMO', name: 'Demo' }]);
    expect(linkOf()).toMatchObject({ projectId: 'p9', projectKey: 'DEMO' });
    expect(recorded.infoMessages[0]).toBe('Created DEMO Demo (Orqiva).');
  });
});
