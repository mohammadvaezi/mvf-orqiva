// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-60 | S12 | v0.1.0] Add the security checklist template and a panel with persistent checkboxes ──
//    Why:  the acceptance is about the real host: opening the panel writes .plane/security.md from the
//          packaged template exactly once, and the Docs tree then reports how much of it is ticked.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parseChecklist, toggleItem } from '../../../src/security/checklist';

interface DocNodeLike {
  kind: string;
  entry?: { key: string };
}
interface Api {
  getDocsTree(): { getChildren(node?: DocNodeLike): DocNodeLike[] } | undefined;
}

describe('security checklist (e2e)', () => {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const file = path.join(folder, '.plane', 'security.md');

  after(async () => {
    // the panel is closed first: a webview that becomes visible again reloads and asks for the file,
    // which would write it back after the delete and leave the fixture dirty
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    fs.rmSync(file, { force: true });
  });

  // ── [PCODE-60 | S12 | v0.1.0] the first open copies the template; a second one keeps the answers ──
  it('creates the checklist once and never writes over it', async () => {
    fs.rmSync(file, { force: true });
    await vscode.commands.executeCommand('orqiva.openSecurityPanel');
    assert.ok(fs.existsSync(file), '.plane/security.md was not created');
    const first = parseChecklist(fs.readFileSync(file, 'utf8'));
    assert.ok(first.total >= 30, `only ${String(first.total)} items`);
    assert.equal(first.sections.length, 9);

    // a tick, as the panel writes it, then open again
    fs.writeFileSync(file, toggleItem(fs.readFileSync(file, 'utf8'), 0, true), 'utf8');
    await vscode.commands.executeCommand('orqiva.openSecurityPanel');
    const second = parseChecklist(fs.readFileSync(file, 'utf8'));
    assert.equal(second.checked, 1, 'the tick was lost');
    assert.equal(second.total, first.total);
  });

  // ── [PCODE-60 | S12 | v0.1.0] the Docs entry carries the count ──
  it('shows the count on the Docs tree entry', async () => {
    const ext = vscode.extensions.getExtension('broszio.orqiva');
    const api = (await ext?.activate()) as Api | undefined;
    const tree = api?.getDocsTree();
    assert.ok(tree, 'docs tree not exposed');
    const node = tree.getChildren().find((n) => n.entry?.key === 'security');
    assert.ok(node, 'security entry missing from the Docs view');
    const item = await Promise.resolve(
      (tree as unknown as { getTreeItem(n: DocNodeLike): vscode.TreeItem }).getTreeItem(node),
    );
    assert.equal(item.command?.command, 'orqiva.openSecurityPanel');
    const list = parseChecklist(fs.readFileSync(file, 'utf8'));
    assert.equal(item.description, `${String(list.checked)}/${String(list.total)}`);
  });
});
