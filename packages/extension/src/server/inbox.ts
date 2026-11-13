// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
//    Why:  what waits for me, in VS Code as on the web: approvals an agent asks for, mentions, gates to
//          sign, incidents. The same inbox the web shows (one list on the server), so an entry done here
//          is gone there within a second. An agent's approval is answered here too, without a browser.
import * as vscode from 'vscode';
import type { Api } from '../../../cli/src/loop/api';

export interface InboxEntry {
  id: string;
  kind: string;
  projectKey: string | null;
  objectType: string;
  objectId: string;
  title: string;
  detail: string;
  priority: string;
  state: string;
  createdAt: string;
  readAt: string | null;
  url: string | null;
}

export interface InboxSource {
  api: Api;
  workspaceId: string;
  server: string;
}

const KIND_ICON: Record<string, string> = {
  approval: 'shield',
  signoff: 'verified',
  incident: 'flame',
  mention: 'mention',
};

/** Whether an entry is an agent asking before it acts, which VS Code can answer. */
export const isAgentApproval = (e: InboxEntry): boolean =>
  e.kind === 'approval' && e.objectType === 'agent_run';

/** "3 min", "2 h", "4 days" since a time. */
export function ageText(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 60) return String(m) + ' min';
  const h = Math.round(m / 60);
  return h < 48 ? String(h) + ' h' : String(Math.round(h / 24)) + ' days';
}

/** The open inbox, read again when something changes; one request at a time. */
export class InboxModel implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private list: InboxEntry[] = [];
  private loading: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly source: () => InboxSource | null) {}

  entries(): InboxEntry[] {
    return this.list;
  }

  /** Reads the inbox again after a short pause (events come in bursts). */
  refreshSoon(ms = 400): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, ms);
  }

  refresh(): Promise<void> {
    if (this.loading) return this.loading;
    const src = this.source();
    if (!src) {
      this.list = [];
      this.emitter.fire();
      return Promise.resolve();
    }
    this.loading = src.api
      .call<{ items: InboxEntry[] }>(
        'GET',
        '/api/workspaces/' + src.workspaceId + '/inbox?state=open',
      )
      .then((r) => {
        this.list = r.items;
        this.emitter.fire();
      })
      .catch(() => undefined)
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  /** Marks an entry done or snoozes it for an hour. */
  async act(entry: InboxEntry, action: 'done' | 'snooze' | 'read'): Promise<void> {
    const src = this.source();
    if (!src) return;
    await src.api.call('PATCH', '/api/workspaces/' + src.workspaceId + '/inbox/' + entry.id, {
      action,
      ...(action === 'snooze' ? { until: new Date(Date.now() + 3_600_000).toISOString() } : {}),
    });
    await this.refresh();
  }

  /** Answers an agent's approval; the run goes on (or stops), and the entry is done. */
  async decide(entry: InboxEntry, approve: boolean, note?: string): Promise<void> {
    const src = this.source();
    if (!src || !isAgentApproval(entry)) return;
    await src.api.call(
      'POST',
      '/api/workspaces/' + src.workspaceId + '/agent-runs/' + entry.objectId + '/decision',
      { approve, ...(note ? { note } : {}) },
    );
    await this.act(entry, 'done').catch(() => undefined);
  }

  /** The web address of an entry. */
  urlOf(entry: InboxEntry): string | null {
    const src = this.source();
    if (!src || !entry.url) return null;
    return entry.url.startsWith('http') ? entry.url : src.server.replace(/\/$/, '') + entry.url;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.emitter.dispose();
  }
}

export class InboxTreeProvider implements vscode.TreeDataProvider<InboxEntry>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<InboxEntry | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly sub: vscode.Disposable;

  constructor(private readonly model: InboxModel) {
    this.sub = model.onDidChange(() => {
      this.emitter.fire(undefined);
    });
  }

  getChildren(element?: InboxEntry): InboxEntry[] {
    return element ? [] : this.model.entries();
  }

  getTreeItem(e: InboxEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(e.title, vscode.TreeItemCollapsibleState.None);
    item.id = 'inbox-' + e.id;
    item.description = (e.projectKey ? e.projectKey + ' · ' : '') + ageText(e.createdAt);
    item.iconPath = new vscode.ThemeIcon(
      KIND_ICON[e.kind] ?? 'bell',
      e.priority === 'urgent' ? new vscode.ThemeColor('errorForeground') : undefined,
    );
    item.tooltip = e.title + (e.detail ? '\n' + e.detail : '');
    item.contextValue = isAgentApproval(e) ? 'inbox-approval' : 'inbox-entry';
    item.command = { command: 'orqiva.inbox.open', title: 'Open', arguments: [e] };
    item.accessibilityInformation = {
      label: e.kind + ': ' + e.title + ', ' + ageText(e.createdAt) + ' ago',
    };
    return item;
  }

  dispose(): void {
    this.sub.dispose();
    this.emitter.dispose();
  }
}
