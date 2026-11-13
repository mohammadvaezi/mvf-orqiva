// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-4 | S01 | v0.1.0] Add the @vscode/test-electron activation smoke test with a fixture workspace ──
// ── [PCODE-11 | S02 | v0.1.0] Add the state store with a .plane file watcher and change events ──
//    Why:  guard for criticals #10 - the extension activates on the fixture, fast, with no network.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXTENSION_ID = 'broszio.orqiva';

describe('activation', () => {
  // ── [PCODE-4 | S01 | v0.1.0] activates on a linked workspace in under one second ──
  it('activates in under 1000 ms', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found`);
    const started = Date.now();
    await ext.activate();
    const took = Date.now() - started;
    assert.equal(ext.isActive, true);
    assert.ok(took < 1000, `activation took ${took} ms`);
  });

  // ── [PCODE-4 | S01 | v0.1.0] the fixture is a linked project and the hello command is registered ──
  it('registers orqiva.hello', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('orqiva.hello'), 'orqiva.hello missing');
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'fixture workspace not opened');
    const link = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(folder.uri, '.plane', 'project.json'),
    );
    const parsed = JSON.parse(Buffer.from(link).toString('utf8')) as { identifier: string };
    assert.equal(parsed.identifier, 'FIX');
  });

  // ── [PCODE-11 | S02 | v0.1.0] the store is populated from files at activation, before any network call ──
  it('populates the store from the fixture files', async () => {
    const ext = vscode.extensions.getExtension<{
      getServices():
        | {
            store: {
              state: {
                link: { identifier: string } | null;
                active: { task: string } | null;
                queueLength: number;
                online: boolean;
              };
            };
          }
        | undefined;
    }>(EXTENSION_ID);
    assert.ok(ext);
    const api = await ext.activate();
    const state = api.getServices()?.store.state;
    assert.ok(state, 'services not built');
    assert.equal(state.link?.identifier, 'FIX');
    assert.equal(state.active?.task, 'FIX-2');
    assert.equal(state.queueLength, 0);
    assert.equal(state.online, false, 'no network call may have happened during activation');
  });
});
