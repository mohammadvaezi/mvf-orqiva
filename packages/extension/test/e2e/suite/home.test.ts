// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-78 | S08 | v0.1.0] Add the Orqiva Home tab: guided setup steps and a visual task board ──
//    Why:  the Home tab is the front door: it must open from its command as one tab, never two.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

async function waitForTab(label: string, timeoutMs: number): Promise<number> {
  const started = Date.now();
  for (;;) {
    const n = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((t) => t.label === label).length;
    if (n > 0 || Date.now() - started > timeoutMs) return n;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('Home tab', () => {
  it('opens as one Orqiva tab, and reopening reveals it', async () => {
    await vscode.commands.executeCommand('orqiva.openHome');
    assert.equal(await waitForTab('Orqiva', 5000), 1);
    await vscode.commands.executeCommand('orqiva.openHome');
    assert.equal(await waitForTab('Orqiva', 1000), 1);
  });
});
