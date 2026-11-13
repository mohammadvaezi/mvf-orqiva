// ── [PCODE-35 | S07 | v0.1.0] Add the Docs tree view listing .plane documents with open and preview actions ──
//    Why:  the node list and order, the missing-file state (dimmed, hint, no command), the icons from
//          design-system.md (book, shield, fingerprint), preview vs open, and the refresh on a watcher change.
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { Store } from '../../src/state/store';
import { WATCHED_FILES } from '../../src/state/watcher';
import {
  DOC_ENTRIES,
  DocsTreeProvider,
  docNodes,
  generatedNodes,
  openCommand,
} from '../../src/views/docsTree';

const WORKSPACE = path.resolve(__dirname, '..', 'fixtures', 'workspace');

const io = (present: string[]) => ({
  existsSync: (p: string) => present.some((x) => p.replace(/\\/g, '/').endsWith(x)),
  readdirSync: () => ['b.md', 'a.md', 'notes.txt'],
});

describe('docsTree', () => {
  it('lists the nine documents and the generated folder, in order', () => {
    const nodes = docNodes('C:\\p', io(['rules.md', 'fingerprints.md']));
    expect(nodes.map((n) => (n.kind === 'doc' ? n.entry.label : n.kind))).toEqual([
      'Rules',
      'Criticals',
      'Architecture',
      'Design system',
      'Security checklist',
      'Description',
      'Sprints',
      'Fingerprint index',
      'Plan',
      'generated',
    ]);
    expect(
      nodes.filter((n) => n.kind === 'doc' && n.exists).map((n) => n.kind === 'doc' && n.entry.key),
    ).toEqual(['rules', 'fingerprints']);
    expect(docNodes(null)[0]).toMatchObject({ kind: 'empty' });
  });

  // ── [PCODE-35 | S07 | v0.1.0] missing files are dimmed with the hint and cannot be opened ──
  it('renders a missing file dimmed with its hint and no command', () => {
    const store = new Store();
    const provider = new DocsTreeProvider(store, io(['rules.md']));
    const nodes = docNodes('C:\\p', io(['rules.md']));
    const node = (k: string) =>
      nodes.find((n) => n.kind === 'doc' && n.entry.key === k) ?? {
        kind: 'empty' as const,
        message: '',
      };
    const [rules, security, index] = [node('rules'), node('security'), node('fingerprints')];
    const rulesItem = provider.getTreeItem(rules);
    expect(rulesItem.label).toBe('Rules');
    expect((rulesItem.iconPath as vscode.ThemeIcon).id).toBe('book');
    expect((rulesItem.iconPath as vscode.ThemeIcon).color).toBeUndefined();
    expect(rulesItem.command?.command).toBe('markdown.showPreview');
    expect(rulesItem.contextValue).toBe('doc');
    const indexItem = provider.getTreeItem(index);
    expect((indexItem.iconPath as vscode.ThemeIcon).id).toBe('fingerprint');
    expect((indexItem.iconPath as vscode.ThemeIcon).color).toBeDefined();
    expect(indexItem.description).toBe('missing');
    expect(indexItem.tooltip).toBe('Written when a task is done');
    expect(indexItem.command).toBeUndefined();
    expect(indexItem.contextValue).toBe('doc-missing');
    expect((provider.getTreeItem(security).iconPath as vscode.ThemeIcon).id).toBe('shield');
    provider.dispose();
  });

  it('previews markdown and opens everything else', () => {
    expect(openCommand('C:\\p\\.plane\\rules.md').command).toBe('markdown.showPreview');
    expect(openCommand('C:\\p\\.plane\\plan.json').command).toBe('vscode.open');
    expect(openCommand('C:\\p\\docs\\generated\\x.html').command).toBe('vscode.open');
  });

  it('lists generated docs sorted, markdown and html only', () => {
    expect(
      generatedNodes('C:\\p\\docs\\generated', io(['generated'])).map(
        (n) => n.kind === 'generatedFile' && n.name,
      ),
    ).toEqual(['a.md', 'b.md']);
    expect(generatedNodes('C:\\p\\docs\\generated', io([]))[0]).toMatchObject({ kind: 'empty' });
  });

  // ── [PCODE-35 | S07 | v0.1.0] the fixture workspace through the real file system ──
  it('reads the fixture: rules present, fingerprints.md missing', () => {
    const store = new Store();
    store.load(WORKSPACE);
    const provider = new DocsTreeProvider(store);
    const nodes = provider.getChildren();
    const byKey = (k: string) => nodes.find((n) => n.kind === 'doc' && n.entry.key === k);
    expect(byKey('rules')).toMatchObject({ exists: true });
    expect(byKey('description')).toMatchObject({ exists: true });
    expect(byKey('plan')).toMatchObject({ exists: true });
    expect(byKey('fingerprints')).toMatchObject({ exists: false });
    expect(byKey('architecture')).toMatchObject({ exists: false });
    provider.dispose();
    store.dispose();
  });

  it('refreshes when the store reports a document change and the watcher covers every entry', () => {
    const store = new Store();
    const provider = new DocsTreeProvider(store, io([]));
    let fired = 0;
    provider.onDidChangeTreeData(() => {
      fired++;
    });
    store.load(null); // emits link + others
    const before = fired;
    (store as unknown as { emit: (k: string[]) => void }).emit(['docs']);
    expect(fired).toBe(before + 1);
    (store as unknown as { emit: (k: string[]) => void }).emit(['active']);
    expect(fired).toBe(before + 1);
    // [PCODE-455 | S15 | v0.1.0] watched in both folders: .orqiva, and .plane on a legacy folder
    for (const e of DOC_ENTRIES) {
      expect(WATCHED_FILES as readonly string[]).toContain('.plane/' + e.rel);
      expect(WATCHED_FILES as readonly string[]).toContain('.orqiva/' + e.rel);
    }
    provider.dispose();
  });
});
