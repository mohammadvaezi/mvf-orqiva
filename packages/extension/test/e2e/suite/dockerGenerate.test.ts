// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-52 | S10 | v0.1.0] Generate Dockerfile and compose through a Plane task run by Claude Code ──
//    Why:  in the real host the command must call the engine in the order new -> start and leave a Claude
//          Code terminal behind, with the fixture's own engine recording every call.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

interface Call {
  script: string;
  argv: string[];
}

interface Api {
  getServices():
    | {
        store: { state: { active: { task: string } | null; link: unknown } };
        location(refresh?: boolean): Promise<{ home: string; python: string[] }>;
      }
    | undefined;
}

describe('docker generate (e2e)', () => {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const calls = path.join(folder, '..', 'fake-engine', 'calls.jsonl');
  const activeJson = path.join(folder, '.plane', 'state', 'active.json');
  let originalActive = '';

  const config = () => vscode.workspace.getConfiguration('orqiva');

  before(async function () {
    this.timeout(20000);
    originalActive = fs.readFileSync(activeJson, 'utf8');
    // the fixture has FIX-2 active; the flow refuses that, so park it for this test
    fs.unlinkSync(activeJson);
    if (fs.existsSync(calls)) fs.unlinkSync(calls);
    // the host inherits PLANE_CLAUDE_HOME from the developer machine: point it at the fake engine
    await config().update(
      'engineHome',
      path.resolve(folder, '..', 'fake-engine'),
      vscode.ConfigurationTarget.Global,
    );
    await new Promise((r) => setTimeout(r, 500)); // the location cache refreshes on the setting change
  });
  after(async () => {
    await config().update('engineHome', undefined, vscode.ConfigurationTarget.Global);
    fs.writeFileSync(activeJson, originalActive, 'utf8');
    if (fs.existsSync(calls)) fs.unlinkSync(calls);
  });

  // ── [PCODE-52 | S10 | v0.1.0] new -> start -> a terminal named Claude Code ──
  it('creates the task, starts it and opens Claude Code', async function () {
    this.timeout(30000);
    const before = vscode.window.terminals.length;
    // the preconditions the flow checks, made explicit: no active task, and the fake engine in reach
    const ext = vscode.extensions.getExtension<Api>('broszio.orqiva');
    assert.ok(ext);
    const api = await ext.activate();
    const services = api.getServices();
    assert.ok(services);
    for (let i = 0; i < 40 && services.store.state.active !== null; i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.equal(services.store.state.active, null, 'no task may be active');
    const loc = await services.location(true);
    assert.ok(loc.home.endsWith('fake-engine'), `engine home is ${loc.home}`);
    assert.ok(loc.python.length > 0, 'a python was found');

    await vscode.commands.executeCommand('orqiva.generateDockerFiles');
    const started = Date.now();
    let recorded: Call[] = [];
    while (Date.now() - started < 15000) {
      recorded = (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : [])
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Call);
      if (recorded.length >= 2) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(recorded.length, 2, `engine calls: ${JSON.stringify(recorded)}`);
    const [first, second] = recorded;
    assert.ok(first && second);
    assert.equal(first.argv[0], 'new');
    assert.equal(first.argv[1], 'Add Dockerfile and docker-compose from architecture.md');
    assert.ok(first.argv.includes('--desc-file'));
    assert.deepEqual(second.argv, ['start', 'FIX-9']);

    const terminal = vscode.window.terminals.find((t) => t.name === 'Claude Code');
    assert.ok(terminal, 'a Claude Code terminal was opened');
    assert.ok(vscode.window.terminals.length >= before);
    // the description file is written into .plane/state and removed again
    assert.equal(fs.existsSync(path.join(folder, '.plane', 'state', 'docker-task.md')), false);
  });
});
