// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-63 | S12 | v0.1.0] Add activation and offline e2e tests: no key, no engine, unreachable Plane ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  criticals #10 - the extension is usable with nothing configured and nothing reachable. The three
//          states a new installation actually passes through are exercised in the real host: nothing set up,
//          a key pointing at a Plane that does not answer, and an engine present without a key. What is
//          asserted in each is the same: no command rejects, no promise is left unhandled, and the tree
//          still shows the board, because it is read from .plane/sprints.md and never from the network.
import * as assert from 'node:assert/strict';
import * as net from 'node:net';
import * as path from 'node:path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'broszio.orqiva';
const DUMMY_KEY = 'plane_api_offline_dummy_0123456789';

interface StoreState {
  link: { identifier: string } | null;
  active: { task: string } | null;
  sprints: { name: string; items: { ref: string }[] }[];
  online: boolean;
  queueLength: number;
}
interface Api {
  getServices():
    | {
        store: { state: StoreState };
        root(): string | null;
        location(refresh?: boolean): Promise<{ home: string; problems: string[] }>;
        secrets: {
          setApiKey(k: string): Promise<void>;
          clearApiKey?(): Promise<void>;
          hasApiKey(): Promise<boolean>;
        };
        engine: { start(ref: string): Promise<{ ref: string }> };
      }
    | undefined;
  getSprintsTree(): { getChildren(node?: unknown): unknown[] } | undefined;
}

/** a port nothing listens on: bind it, read the number, close it again */
async function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => {
        if (port) resolve(port);
        else reject(new Error('no port'));
      });
    });
    srv.on('error', reject);
  });
}

async function services(): Promise<NonNullable<ReturnType<Api['getServices']>>> {
  const ext = vscode.extensions.getExtension<Api>(EXTENSION_ID);
  assert.ok(ext, 'extension missing');
  const api = await ext.activate();
  const s = api.getServices();
  assert.ok(s, 'services not built');
  return s;
}

describe('offline (e2e)', () => {
  const config = () => vscode.workspace.getConfiguration('orqiva');
  const rejections: unknown[] = [];
  const onRejection = (r: unknown): void => {
    rejections.push(r);
  };
  const fakeEngine = path.resolve(
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
    '..',
    'fake-engine',
  );

  before(() => {
    // ── [PCODE-63 | S12 | v0.1.0] an unhandled rejection in the host is the failure being hunted ──
    process.on('unhandledRejection', onRejection);
  });
  after(async () => {
    process.off('unhandledRejection', onRejection);
    await config().update('engineHome', undefined, vscode.ConfigurationTarget.Global);
    await config().update('plane.baseUrl', undefined, vscode.ConfigurationTarget.Global);
  });

  // ── [PCODE-63 | S12 | v0.1.0] (a) nothing configured: no key, no engine folder ──
  it('(a) runs with no key and no engine: the board is there, commands answer, nothing throws', async () => {
    await config().update('engineHome', '', vscode.ConfigurationTarget.Global);
    const s = await services();
    const loc = await s.location(true);
    assert.equal(loc.home, '', 'no engine may be resolved');
    assert.ok(
      loc.problems.some((p) => p.includes('orqiva.engineHome')),
      `the problem must name the setting that fixes it: ${loc.problems.join(' | ')}`,
    );

    // the board comes from .plane/sprints.md, so it is there before anything is configured
    assert.equal(s.store.state.link?.identifier, 'FIX');
    assert.ok(s.store.state.sprints.length > 0, 'the fixture board is empty');
    assert.equal(s.store.state.online, false);

    // every command that needs the engine answers instead of rejecting
    for (const id of ['orqiva.sync', 'orqiva.startTask', 'orqiva.doneTask']) {
      await vscode.commands.executeCommand(id, 'FIX-3');
    }
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(rejections, [], 'unhandled rejection in the extension host');
  });

  // ── [PCODE-63 | S12 | v0.1.0] (b) a key, and a Plane that does not answer ──
  it('(b) survives a Plane that refuses the connection', async () => {
    const port = await closedPort();
    await config().update(
      'plane.baseUrl',
      `http://127.0.0.1:${String(port)}`,
      vscode.ConfigurationTarget.Global,
    );
    const s = await services();
    await s.secrets.setApiKey(DUMMY_KEY);
    assert.equal(await s.secrets.hasApiKey(), true);

    // the refresh fails, repeatedly, and the window keeps working
    for (let i = 0; i < 3; i++) await vscode.commands.executeCommand('orqiva.sync');
    await new Promise((r) => setTimeout(r, 500));

    assert.equal(s.store.state.online, false, 'a dead Plane must leave the store offline');
    // the tree is still the board read from the file
    const ext = vscode.extensions.getExtension<Api>(EXTENSION_ID);
    const tree = (await ext?.activate())?.getSprintsTree();
    assert.ok(tree, 'sprints tree missing');
    assert.ok(tree.getChildren().length > 0, 'the tree went empty when Plane went away');
    assert.deepEqual(rejections, [], 'unhandled rejection in the extension host');
  });

  // ── [PCODE-63 | S12 | v0.1.0] (c) the engine is there, the key is not ──
  //    The engine keeps its own key, so the work goes on: this is the normal state of a machine that ran
  //    the installer but never opened the extension's Set-up.
  it('(c) starts a task through the engine without a key in the extension', async () => {
    await config().update('engineHome', fakeEngine, vscode.ConfigurationTarget.Global);
    const s = await services();
    const loc = await s.location(true);
    assert.ok(loc.home.endsWith('fake-engine'), `engine home is ${loc.home}`);
    assert.deepEqual(loc.problems, [], loc.problems.join(' | '));

    const started = await s.engine.start('FIX-2');
    assert.equal(started.ref, 'FIX-2');
    // the board still comes from the file, not from Plane
    assert.ok(s.store.state.sprints.some((sp) => sp.items.some((i) => i.ref === 'FIX-2')));
    assert.equal(s.store.state.online, false);
    assert.deepEqual(rejections, [], 'unhandled rejection in the extension host');
  });
});
