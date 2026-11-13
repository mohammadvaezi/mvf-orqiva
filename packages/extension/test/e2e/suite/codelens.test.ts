// ── [PCODE-39 | S07 | v0.1.0] Refresh docs tree, CodeLens and task panel on .plane file changes ──
//    Why:  in the real host, a marker typed into a file gets its lens within two seconds, and a change of
//          .plane/state/active.json (what `plane start` writes) relabels the lens without reopening the file.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

async function lensTitles(uri: vscode.Uri, timeoutMs: number, want: (t: string) => boolean) {
  const started = Date.now();
  let titles: string[] = [];
  for (;;) {
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      uri,
    );
    titles = lenses.map((l) => l.command?.title ?? '');
    if (titles.some(want) || Date.now() - started > timeoutMs) return titles;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('fingerprint CodeLens (e2e)', () => {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const file = path.join(folder, 'src', 'e2e-marker.ts');
  const activeJson = path.join(folder, '.plane', 'state', 'active.json');
  let originalActive = '';

  before(() => {
    originalActive = fs.readFileSync(activeJson, 'utf8');
  });
  after(() => {
    fs.writeFileSync(activeJson, originalActive, 'utf8');
    if (fs.existsSync(file)) fs.unlinkSync(file);
  });

  // ── [PCODE-39 | S07 | v0.1.0] a new marker line -> lens for FIX-3 within two seconds ──
  it('shows a lens for a marker written into a new file, then relabels it when active.json changes', async () => {
    fs.writeFileSync(
      file,
      '// ── [FIX-3 | S02 | v0.1.0] Add a farewell function ──\nexport const bye = 1;\n',
      'utf8',
    );
    const uri = vscode.Uri.file(file);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    const titles = await lensTitles(uri, 2000, (t) => t.startsWith('FIX-3'));
    assert.deepEqual(titles, ['FIX-3 Add a farewell function · Todo']);

    // plane start FIX-3 writes active.json; the fake engine does not, so write what it would write
    const active = JSON.parse(originalActive) as Record<string, unknown>;
    fs.writeFileSync(
      activeJson,
      JSON.stringify({ ...active, task: 'FIX-3', title: 'Add a farewell function', sprint: 'S02' }),
      'utf8',
    );
    const relabelled = await lensTitles(uri, 3000, (t) => t.endsWith('In Progress'));
    assert.deepEqual(relabelled, ['FIX-3 Add a farewell function · In Progress']);
  });
});
