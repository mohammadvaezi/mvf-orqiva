// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-13 | S03 | v0.1.0] Add the Orqiva activity bar container and the Sprints tree view ──
// ── [PCODE-20 | S04 | v0.1.0] Build the task detail panel with description, acceptance, comments and badges ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the board in the sidebar - sprints (today first, expanded) and their items with state codicons
//          and priority prefixes exactly as design-system.md "Components" specifies.
import * as vscode from 'vscode';
import type { Item, Sprint } from '../state/board';
import type { Store } from '../state/store';

export type SprintNode = { kind: 'sprint'; sprint: Sprint };
export type ItemNode = { kind: 'item'; item: Item; sprint: Sprint };
export type EmptyNode = { kind: 'empty'; message: string };
export type TreeNode = SprintNode | ItemNode | EmptyNode;

export const EMPTY_COPY = 'No sprint today. Run Sync to carry over open items, or create a task.';

// ── [PCODE-13 | S03 | v0.1.0] state codicon + ThemeColor per design-system.md ──
const STATE_ICONS: Record<string, [string, string | undefined]> = {
  backlog: ['circle-outline', 'charts.gray'],
  todo: ['circle-large-outline', 'charts.blue'],
  planned: ['circle-large-outline', 'charts.blue'],
  'in progress': ['play-circle', 'charts.orange'],
  review: ['eye', 'charts.purple'],
  test: ['beaker', 'charts.blue'],
  blocked: ['error', 'charts.red'],
  done: ['pass-filled', 'charts.green'],
  cancelled: ['circle-slash', 'charts.gray'],
};
// [PCODE-20 | S04 | v0.1.0] TreeItem.description renders no codicons, so the priority is a word (medium = nothing)
const PRIORITY_TEXT: Record<string, string> = { urgent: 'urgent', high: 'high', low: 'low' };

export function stateIcon(stateName: string): vscode.ThemeIcon {
  const [id, color] = STATE_ICONS[stateName.toLowerCase()] ?? ['circle-outline', undefined];
  return new vscode.ThemeIcon(id, color ? new vscode.ThemeColor(color) : undefined);
}

// ── [PCODE-13 | S03 | v0.1.0] SprintsTreeProvider: reads store.state.sprints, refreshes on 'sprints' ──
export class SprintsTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly sub: { dispose(): void };

  constructor(private readonly store: Store) {
    this.sub = store.onDidChange((keys) => {
      if (keys.includes('sprints') || keys.includes('active') || keys.includes('online'))
        this.emitter.fire(undefined);
    });
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      const sprints = this.store.state.sprints;
      if (!sprints.length) return [{ kind: 'empty', message: EMPTY_COPY }];
      return sprints.map((s) => ({ kind: 'sprint', sprint: s }));
    }
    if (node.kind === 'sprint')
      return node.sprint.items.map((item) => ({ kind: 'item', item, sprint: node.sprint }));
    return [];
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === 'empty') {
      const t = new vscode.TreeItem(node.message, vscode.TreeItemCollapsibleState.None);
      t.iconPath = new vscode.ThemeIcon('info');
      t.contextValue = 'empty';
      return t;
    }
    if (node.kind === 'sprint') {
      const s = node.sprint;
      const done = s.items.filter((i) => i.done).length;
      const t = new vscode.TreeItem(
        s.name,
        s.isToday
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
      );
      t.description = `${s.date} · ${done}/${s.items.length} done`;
      t.tooltip = s.goal || s.name;
      t.iconPath = new vscode.ThemeIcon(
        s.isToday
          ? 'calendar'
          : s.date > new Date().toISOString().slice(0, 10)
            ? 'arrow-right'
            : 'history',
      );
      t.contextValue = s.isToday ? 'sprint-today' : 'sprint';
      return t;
    }
    const i = node.item;
    const t = new vscode.TreeItem(`${i.ref} ${i.title}`, vscode.TreeItemCollapsibleState.None);
    t.iconPath = stateIcon(i.state.name);
    t.description = [PRIORITY_TEXT[i.priority], ...i.labels].filter(Boolean).join(' · ');
    t.tooltip = new vscode.MarkdownString(
      `**${i.ref}** ${i.title}\n\n${i.state.name} · ${i.priority}${i.labels.length ? ` · ${i.labels.join(', ')}` : ''}`,
    );
    t.contextValue = `item-${i.state.group}${this.store.state.active?.task === i.ref ? '-active' : ''}`;
    t.command = { command: 'orqiva.openTask', title: 'Open task', arguments: [i.ref] }; // [PCODE-20 | S04 | v0.1.0]
    return t;
  }

  dispose(): void {
    this.sub.dispose();
    this.emitter.dispose();
  }
}
