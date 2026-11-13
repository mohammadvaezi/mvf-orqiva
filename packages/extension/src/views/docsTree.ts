// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-35 | S07 | v0.1.0] Add the Docs tree view listing .plane documents with open and preview actions ──
// ── [PCODE-42 | S08 | v0.1.0] Add the Generate code documentation command with progress and Docs tree entries ──
// ── [PCODE-46 | S09 | v0.1.0] Build the Version panel with current version, last tag, commits and bump buttons ──
// ── [PCODE-51 | S10 | v0.1.0] Build the Docker panel with generate, build, run, stop, logs and health ──
// ── [PCODE-58 | S11 | v0.1.0] Build the Deploy panel with targets, deploy button, progress and history ──
// ── [PCODE-60 | S12 | v0.1.0] Add the security checklist template and a panel with persistent checkboxes ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the project's own documents (rules, criticals, architecture, design system, security, description,
//          sprints, fingerprint index, plan) in one view. A click previews markdown, the inline pencil opens the
//          source; a file that does not exist yet is dimmed and says who writes it. Generated docs (Sprint 08)
//          hang under one folder node.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { readChecklist, shortProgress } from '../security/checklist';
import { projectFile, projectRel } from '../state/files';
import type { Store } from '../state/store';

export interface DocEntry {
  key: string;
  label: string;
  /** posix-relative to the project root */
  rel: string;
  icon: string;
  /** shown for a missing file */
  missingHint: string;
}

// ── [PCODE-35 | S07 | v0.1.0] the fixed list, in the order the view shows it ──
export const DOC_ENTRIES: readonly DocEntry[] = [
  {
    key: 'rules',
    label: 'Rules',
    rel: 'rules.md',
    icon: 'book',
    missingHint: 'Written by the project scaffold',
  },
  {
    key: 'criticals',
    label: 'Criticals',
    rel: 'criticals.md',
    icon: 'book',
    missingHint: 'Written by the planning run',
  },
  {
    key: 'architecture',
    label: 'Architecture',
    rel: 'architecture.md',
    icon: 'book',
    missingHint: 'Written by the planning run',
  },
  {
    key: 'designSystem',
    label: 'Design system',
    rel: 'design-system.md',
    icon: 'book',
    missingHint: 'Written by the planning run',
  },
  {
    key: 'security',
    label: 'Security checklist',
    rel: 'security.md',
    icon: 'shield',
    // [PCODE-60 | S12 | v0.1.0] not the planning run: the panel writes it from the template on first open
    missingHint: 'Created from the template when you open the panel',
  },
  {
    key: 'description',
    label: 'Description',
    rel: 'description/description.md',
    icon: 'book',
    missingHint: 'Written by you - Plan the project',
  },
  {
    key: 'sprints',
    label: 'Sprints',
    rel: 'sprints.md',
    icon: 'book',
    missingHint: 'Written when the board syncs',
  },
  {
    key: 'fingerprints',
    label: 'Fingerprint index',
    rel: 'fingerprints.md',
    icon: 'fingerprint',
    missingHint: 'Written when a task is done',
  },
  {
    key: 'plan',
    label: 'Plan',
    rel: 'plan.json',
    icon: 'json',
    missingHint: 'Written by the planning run',
  },
];

export const GENERATED_DIR = 'docs/generated';

// [PCODE-42 | S08 | v0.1.0] the generated folder follows orqiva.docs.outputFolder
export function generatedFolder(): string {
  const raw = vscode.workspace
    .getConfiguration('orqiva')
    .get<string>('docs.outputFolder', GENERATED_DIR);
  const clean = (raw || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return !clean ||
    clean.startsWith('/') ||
    /^[a-zA-Z]:/.test(clean) ||
    clean.split('/').includes('..')
    ? GENERATED_DIR
    : clean;
}

export type DocNode =
  | { kind: 'doc'; entry: DocEntry; file: string; shown: string; exists: boolean }
  | { kind: 'generated'; dir: string; folder: string; exists: boolean }
  | { kind: 'generatedFile'; file: string; name: string }
  | { kind: 'release'; version: string } // [PCODE-46 | S09 | v0.1.0]
  | { kind: 'docker' } // [PCODE-51 | S10 | v0.1.0]
  | { kind: 'deploy' } // [PCODE-58 | S11 | v0.1.0]
  | { kind: 'empty'; message: string };

export interface DocsIo {
  existsSync: (p: string) => boolean;
  readdirSync: (p: string) => string[];
}

const defaultIo: DocsIo = {
  existsSync: (p) => fs.existsSync(p),
  readdirSync: (p) => fs.readdirSync(p),
};

// ── [PCODE-35 | S07 | v0.1.0] docNodes: pure; the root's entries with their existence ──
export function docNodes(
  root: string | null,
  io: DocsIo = defaultIo,
  folderName?: string,
): DocNode[] {
  if (!root)
    return [
      { kind: 'empty', message: 'Link this folder to an Orqiva project to see its documents.' },
    ];
  const nodes: DocNode[] = DOC_ENTRIES.map((entry) => {
    // [PCODE-455 | S15 | v0.1.0] rel is inside the project's folder: .orqiva, or .plane on a legacy folder
    const file = projectFile(root, entry.rel.split('/'), io);
    return {
      kind: 'doc',
      entry,
      file,
      shown: projectRel(root, entry.rel.split('/'), io),
      exists: io.existsSync(file),
    };
  });
  const folder = folderName ?? GENERATED_DIR;
  const dir = path.join(root, ...folder.split('/'));
  nodes.push({ kind: 'generated', dir, folder, exists: io.existsSync(dir) });
  return nodes;
}

export function generatedNodes(dir: string, io: DocsIo = defaultIo): DocNode[] {
  if (!io.existsSync(dir))
    return [{ kind: 'empty', message: 'Generate code documentation to fill this folder.' }];
  // [PCODE-42 | S08 | v0.1.0] README first, then the sprints/ and tasks/ folders the generator writes
  const entries = io.readdirSync(dir).sort();
  const files = entries.filter((f) => /\.(md|html)$/i.test(f));
  const folders = entries.filter((f) => io.existsSync(path.join(dir, f, '.')) && !/\./.test(f));
  const nodes: DocNode[] = [
    ...files.map((name) => ({ kind: 'generatedFile' as const, file: path.join(dir, name), name })),
    ...folders.map((name) => ({
      kind: 'generated' as const,
      dir: path.join(dir, name),
      folder: name,
      exists: true,
    })),
  ];
  return nodes.length ? nodes : [{ kind: 'empty', message: 'Nothing generated yet.' }];
}

export function openCommand(file: string): vscode.Command {
  const uri = vscode.Uri.file(file);
  return /\.md$/i.test(file)
    ? { command: 'markdown.showPreview', title: 'Preview', arguments: [uri] }
    : { command: 'vscode.open', title: 'Open', arguments: [uri] };
}

// ── [PCODE-35 | S07 | v0.1.0] DocsTreeProvider: refreshes on store 'docs'/'fingerprints'/'plan'/'sprints'/'link' ──
export class DocsTreeProvider implements vscode.TreeDataProvider<DocNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<DocNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly sub: { dispose(): void };

  constructor(
    private readonly store: Store,
    private readonly io: DocsIo = defaultIo,
  ) {
    this.sub = store.onDidChange((keys) => {
      if (
        keys.includes('docs') ||
        keys.includes('fingerprints') ||
        keys.includes('plan') ||
        keys.includes('sprints') ||
        keys.includes('link')
      )
        this.emitter.fire(undefined);
    });
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getChildren(node?: DocNode): DocNode[] {
    if (!node)
      return [
        ...docNodes(this.store.state.root, this.io, generatedFolder()),
        // [PCODE-46 | S09 | v0.1.0] the release entry: version now, deployment later
        ...(this.store.state.link
          ? [
              { kind: 'release' as const, version: this.store.state.link.version },
              { kind: 'docker' as const },
              { kind: 'deploy' as const },
            ]
          : []),
      ];
    if (node.kind === 'generated') return generatedNodes(node.dir, this.io);
    return [];
  }

  getTreeItem(node: DocNode): vscode.TreeItem {
    if (node.kind === 'empty') {
      const t = new vscode.TreeItem(node.message, vscode.TreeItemCollapsibleState.None);
      t.iconPath = new vscode.ThemeIcon('info');
      t.contextValue = 'empty';
      return t;
    }
    if (node.kind === 'generated') {
      const t = new vscode.TreeItem('Generated docs', vscode.TreeItemCollapsibleState.Collapsed);
      t.iconPath = new vscode.ThemeIcon('folder-library');
      t.description = node.exists ? node.folder : 'not generated yet';
      t.tooltip = `${node.folder} - written by Generate code documentation`;
      t.contextValue = 'generated';
      return t;
    }
    if (node.kind === 'release') {
      const t = new vscode.TreeItem('Release', vscode.TreeItemCollapsibleState.None);
      t.iconPath = new vscode.ThemeIcon('tag');
      t.description = `v${node.version}`;
      t.tooltip = 'Version, changelog and release';
      t.contextValue = 'release';
      t.command = { command: 'orqiva.openVersionPanel', title: 'Open the version panel' };
      return t;
    }
    if (node.kind === 'docker') {
      const t = new vscode.TreeItem('Docker', vscode.TreeItemCollapsibleState.None);
      t.iconPath = new vscode.ThemeIcon('server-environment');
      t.tooltip = 'Build, run and watch the project in containers';
      t.contextValue = 'docker';
      t.command = { command: 'orqiva.openDockerPanel', title: 'Open the Docker panel' };
      return t;
    }
    if (node.kind === 'deploy') {
      const t = new vscode.TreeItem('Deploy', vscode.TreeItemCollapsibleState.None);
      t.iconPath = new vscode.ThemeIcon('rocket');
      t.tooltip = 'Deploy this version to a target';
      t.contextValue = 'deploy';
      t.command = { command: 'orqiva.openDeployPanel', title: 'Open the deploy panel' };
      return t;
    }
    if (node.kind === 'generatedFile') {
      const t = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
      t.iconPath = new vscode.ThemeIcon('file');
      t.resourceUri = vscode.Uri.file(node.file);
      t.command = openCommand(node.file);
      t.contextValue = 'doc';
      return t;
    }
    const t = new vscode.TreeItem(node.entry.label, vscode.TreeItemCollapsibleState.None);
    // [PCODE-60 | S12 | v0.1.0] the security checklist opens its panel and shows how much is ticked
    if (node.entry.key === 'security') {
      const list = this.store.state.root ? readChecklist(this.store.state.root) : null;
      t.iconPath = new vscode.ThemeIcon('shield');
      t.description = list ? shortProgress(list) : 'not started';
      t.tooltip = 'Security checklist of this project';
      t.contextValue = 'security';
      t.command = { command: 'orqiva.openSecurityPanel', title: 'Open the security checklist' };
      return t;
    }
    t.iconPath = new vscode.ThemeIcon(
      node.entry.icon,
      node.exists ? undefined : new vscode.ThemeColor('disabledForeground'),
    );
    t.description = node.exists ? node.shown : 'missing';
    t.tooltip = node.exists ? node.shown : node.entry.missingHint;
    t.contextValue = node.exists ? 'doc' : 'doc-missing';
    if (node.exists) {
      t.resourceUri = vscode.Uri.file(node.file);
      t.command = openCommand(node.file);
    }
    return t;
  }

  dispose(): void {
    this.sub.dispose();
    this.emitter.dispose();
  }
}

// ── [PCODE-35 | S07 | v0.1.0] registerDocsView: the view, Refresh and the inline "open source" pencil ──
export function registerDocsView(context: vscode.ExtensionContext, store: Store): DocsTreeProvider {
  const provider = new DocsTreeProvider(store);
  context.subscriptions.push(
    provider,
    vscode.window.createTreeView('orqiva.docs', { treeDataProvider: provider }),
    vscode.commands.registerCommand('orqiva.docsRefresh', () => {
      provider.refresh();
    }),
    vscode.commands.registerCommand('orqiva.openDocSource', (node?: DocNode) => {
      const file =
        node?.kind === 'doc' ? node.file : node?.kind === 'generatedFile' ? node.file : undefined;
      if (file) void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
    }),
  );
  return provider;
}
