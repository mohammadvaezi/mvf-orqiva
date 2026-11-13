// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-24 | S04 | v0.1.0] Add an e2e test opening the task panel from the fixture workspace ──
//    Why:  the panel opens for the fixture's active task offline, becomes the active tab, and Copy
//          fingerprint puts the task's marker on the clipboard.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

async function activeTabLabel(timeoutMs: number, match: (l: string) => boolean): Promise<string> {
  const started = Date.now();
  for (;;) {
    const label = vscode.window.tabGroups.activeTabGroup.activeTab?.label ?? '';
    if (match(label) || Date.now() - started > timeoutMs) return label;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('task panel (offline fixture)', () => {
  // ── [PCODE-24 | S04 | v0.1.0] orqiva.openTask('FIX-2') -> a webview tab titled "FIX-2 …" is active ──
  it('opens FIX-2 as the active webview tab', async () => {
    await vscode.commands.executeCommand('orqiva.openTask', 'FIX-2');
    const label = await activeTabLabel(5000, (l) => l.startsWith('FIX-2'));
    assert.ok(label.startsWith('FIX-2'), `active tab is "${label}"`);
    assert.ok(label.includes('greeting'), `title carries the task title: "${label}"`);
    // opening it again reveals the same tab (no duplicate)
    await vscode.commands.executeCommand('orqiva.openTask', 'FIX-2');
    const tabs = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((t) => t.label.startsWith('FIX-2'));
    assert.equal(tabs.length, 1);
  });

  it('copyFingerprint puts the active task marker on the clipboard', async () => {
    await vscode.env.clipboard.writeText('');
    await vscode.commands.executeCommand('orqiva.copyFingerprint');
    const text = await vscode.env.clipboard.readText();
    assert.ok(
      text.includes('[FIX-2 | S01 | v0.1.0] Add the greeting function'),
      `clipboard: ${text}`,
    );
  });
});
