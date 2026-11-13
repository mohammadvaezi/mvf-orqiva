// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-18 | S03 | v0.1.0] Show the board offline from sprints.md when Plane is unreachable ──
//    Why:  with no API key, a linked project that synced once still shows its board in the tree.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

interface Node {
  kind: string;
  sprint?: { name: string; items: { ref: string }[] };
  item?: { ref: string };
}
interface Api {
  getSprintsTree(): { getChildren(node?: unknown): Node[] };
}

describe('sprints tree (offline)', () => {
  // ── [PCODE-18 | S03 | v0.1.0] two sprints and their items from sprints.md within two seconds ──
  it('shows the fixture sprints without a key', async () => {
    const ext = vscode.extensions.getExtension<Api>('broszio.orqiva');
    assert.ok(ext);
    const api = await ext.activate();
    const started = Date.now();
    let roots = api.getSprintsTree().getChildren();
    while (roots.length < 2 && Date.now() - started < 2000) {
      await new Promise((r) => setTimeout(r, 50));
      roots = api.getSprintsTree().getChildren();
    }
    assert.equal(roots.length, 2, 'two sprints expected');
    assert.equal(roots[0]?.sprint?.name, 'Sprint 01 - Foundation');
    const items = api.getSprintsTree().getChildren(roots[0]);
    assert.deepEqual(
      items.map((i) => i.item?.ref),
      ['FIX-1', 'FIX-2'],
    );
  });
});
