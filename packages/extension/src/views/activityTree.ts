// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-106 | S15 | v0.1.0] Add the team activity feed panel to VS Code ──
//    Why:  the team at work, in the sidebar next to the board: one line per event, newest on top, a person,
//          robot or gear icon for who acted, the time beside it, and a click that opens the task. Fed by the
//          board source's live connection; nothing here asks the server for anything.
import * as vscode from 'vscode';
import type { ActorKind } from '@orqiva/shared';
import type { ActivityFeed, FeedEntry } from '../server/feed';

const ACTOR_ICON: Record<ActorKind, string> = {
  user: 'person',
  agent: 'hubot',
  system: 'gear',
  integration: 'plug',
};

const ACTOR_WORD: Record<ActorKind, string> = {
  user: 'Person',
  agent: 'AI agent',
  system: 'Orqiva',
  integration: 'Connected tool',
};

export const OPEN_ACTIVITY_ITEM = 'orqiva.openActivityItem';

export class ActivityTreeProvider implements vscode.TreeDataProvider<FeedEntry>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<FeedEntry | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly sub: { dispose(): void };

  constructor(private readonly feed: ActivityFeed) {
    this.sub = feed.onDidChange(() => {
      this.emitter.fire(undefined);
    });
  }

  getChildren(element?: FeedEntry): FeedEntry[] {
    return element ? [] : this.feed.entries();
  }

  getTreeItem(e: FeedEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(e.text, vscode.TreeItemCollapsibleState.None);
    item.id = 'activity-' + String(e.sequence);
    item.description = e.when;
    item.iconPath = new vscode.ThemeIcon(ACTOR_ICON[e.actorKind]);
    item.tooltip =
      ACTOR_WORD[e.actorKind] + (e.actor ? ': ' + e.actor : '') + '\n' + e.text + '\n' + e.when;
    item.accessibilityInformation = {
      label: ACTOR_WORD[e.actorKind] + ', ' + e.text + ', ' + e.when,
    };
    if (e.itemId)
      item.command = { command: OPEN_ACTIVITY_ITEM, title: 'Open task', arguments: [e.itemId] };
    return item;
  }

  dispose(): void {
    this.sub.dispose();
    this.emitter.dispose();
  }
}
