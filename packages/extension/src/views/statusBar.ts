// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-15 | S03 | v0.1.0] Add the status bar item showing active task, fingerprint and queue length ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the one-glance answer to "what is Claude working on and is Plane up to date", per
//          design-system.md "Status bar": `$(tasklist) PCODE-12 · S03 · v0.1.0`, `$(cloud-upload) 3`, `$(circle-slash) No task`.
import * as vscode from 'vscode';
import type { Store } from '../state/store';
import { markerText } from '../util/fingerprint';

export interface StatusText {
  text: string;
  tooltip: string;
  warning: boolean;
}

// ── [PCODE-15 | S03 | v0.1.0] statusText: pure rendering from the store state (unit-tested) ──
export function statusText(state: Store['state']): StatusText {
  const a = state.active;
  let text = a ? `$(tasklist) ${a.task} · ${a.sprint} · v${a.version}` : '$(circle-slash) No task';
  const tip: string[] = a
    ? [
        markerText(a.task, a.sprint, a.version, a.title),
        `Started ${a.started_at.replace('T', ' ')} on ${a.host}`,
        `${a.files.length} file(s) touched`,
      ]
    : ['No active task. Start one from the Sprints view or let Claude pick the next.'];
  let warning = false;
  if (state.queueLength > 0) {
    text += `  $(cloud-upload) ${state.queueLength}`;
    tip.push(`${state.queueLength} update(s) waiting to be sent`);
    warning = true;
  }
  if (state.root && state.link && !state.online && state.lastError) {
    text += '  $(cloud-offline)';
    tip.push(`Offline: ${state.lastError}`);
    warning = true;
  }
  return { text, tooltip: tip.join('\n'), warning };
}

// ── [PCODE-15 | S03 | v0.1.0] StatusBar: one item, left, priority 100; updates on store changes ──
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly sub: { dispose(): void };

  constructor(private readonly store: Store) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.name = 'Orqiva';
    this.item.command = 'orqiva.openTask';
    this.sub = store.onDidChange((keys) => {
      if (keys.some((k) => k === 'active' || k === 'queueLength' || k === 'online' || k === 'link'))
        this.update();
    });
    this.update();
  }

  update(): void {
    if (!this.store.state.link) {
      this.item.hide();
      return;
    }
    const s = statusText(this.store.state);
    this.item.text = s.text;
    this.item.tooltip = s.tooltip;
    this.item.backgroundColor = s.warning
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
    this.item.show();
  }

  get current(): {
    text: string;
    tooltip: string | vscode.MarkdownString | undefined;
    visible: boolean;
  } {
    return {
      text: this.item.text,
      tooltip: this.item.tooltip,
      visible: (this.item as { visible?: boolean }).visible ?? true,
    };
  }

  dispose(): void {
    this.sub.dispose();
    this.item.dispose();
  }
}
