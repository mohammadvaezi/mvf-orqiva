// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-29 | S05 | v0.1.0] Add Forget key with confirmation and an e2e secrets test ──
//    Why:  guard for criticals #1 in the real host: a stored key lands in SecretStorage only - not in settings,
//          not under .plane/ - and Forget key removes it.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

const DUMMY = 'plane_api_e2e_dummy_key_0123456789';

interface Api {
  getServices():
    | {
        secrets: {
          setApiKey(k: string): Promise<void>;
          hasApiKey(): Promise<boolean>;
          getApiKey(): Promise<string | undefined>;
        };
        root(): string | null;
      }
    | undefined;
}

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
}

describe('secrets (e2e)', () => {
  // ── [PCODE-29 | S05 | v0.1.0] the key is in SecretStorage and nowhere else; Forget key empties it ──
  it('stores the key only in SecretStorage and forgets it on request', async () => {
    const ext = vscode.extensions.getExtension<Api>('broszio.orqiva');
    assert.ok(ext);
    const api = await ext.activate();
    const services = api.getServices();
    assert.ok(services);
    await services.secrets.setApiKey(DUMMY);
    assert.equal(await services.secrets.hasApiKey(), true);

    // settings: no orqiva setting carries the key, and no setting is named like a key
    const cfg = vscode.workspace.getConfiguration('orqiva');
    for (const key of [
      'engineHome',
      'pythonPath',
      'plane.baseUrl',
      'plane.workspace',
      'claudeCommand',
    ]) {
      const v = cfg.inspect<string>(key);
      for (const val of [v?.globalValue, v?.workspaceValue, v?.workspaceFolderValue])
        assert.notEqual(val, DUMMY);
    }
    assert.equal(cfg.has('plane.apiKey'), false);
    assert.equal(cfg.has('apiKey'), false);

    // nothing under .plane/ of the workspace holds it
    const root = services.root();
    assert.ok(root);
    for (const f of filesUnder(path.join(root, '.plane'))) {
      assert.ok(!fs.readFileSync(f, 'utf8').includes(DUMMY), `${f} contains the key`);
    }

    // forget without confirmation keeps it; with confirmation removes it
    await vscode.commands.executeCommand('orqiva.forgetKey', { confirm: false });
    assert.equal(await services.secrets.hasApiKey(), true);
    await vscode.commands.executeCommand('orqiva.forgetKey', { confirm: true });
    assert.equal(await services.secrets.hasApiKey(), false);
    assert.equal(await services.secrets.getApiKey(), undefined);
  });
});
