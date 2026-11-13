// ── [PCODE-196 | S15 | v0.1.0] B8.4 VS Code: ideation interview, and presence per file and block (workspace switch, off by default) ──
//    Why:  who works on the same code right now. VS Code reports where you are (the project, your active
//          task, viewing or editing) and, where the workspace shares files, which file is open; the server
//          drops the file otherwise. Back come the people present: the status bar names who else has this
//          file open, and the fingerprint lens of a block names who is on that block's task in this file.
//          Nothing here is stored; it is the live picture of the last 45 seconds.
import type { PresenceEntry } from '@orqiva/shared';
import * as vscode from 'vscode';

/** The others (not me) who have this repo file open. */
export function othersInFile(
  people: readonly PresenceEntry[],
  me: string | null,
  file: string | null,
): PresenceEntry[] {
  if (!file) return [];
  return people.filter((p) => p.userId !== me && p.file === file);
}

/** The names of the others on a task in this file: who is on that block. */
export function onBlock(
  people: readonly PresenceEntry[],
  me: string | null,
  file: string | null,
  itemId: string | null,
): string[] {
  if (!itemId) return [];
  return othersInFile(people, me, file)
    .filter((p) => p.itemId === itemId)
    .map((p) => p.name);
}

/** "Ada (editing), Bob". */
export const namesText = (people: readonly PresenceEntry[]): string =>
  people.map((p) => p.name + (p.state === 'editing' ? ' (editing)' : '')).join(', ');

export class PresenceModel implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private list: PresenceEntry[] = [];
  me: string | null = null;

  people(): PresenceEntry[] {
    return this.list;
  }

  set(people: PresenceEntry[]): void {
    this.list = people;
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

export class PresenceStatus implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 8);
  private readonly sub: vscode.Disposable;

  constructor(
    private readonly model: PresenceModel,
    /** the repo path of the active editor's file */
    private readonly file: () => string | null,
  ) {
    this.sub = model.onDidChange(() => {
      this.render();
    });
  }

  render(): void {
    const here = othersInFile(this.model.people(), this.model.me, this.file());
    if (!here.length) {
      this.item.hide();
      return;
    }
    this.item.text = '$(person) ' + String(here.length);
    this.item.tooltip = 'Also in this file: ' + namesText(here);
    this.item.accessibilityInformation = { label: 'Also in this file: ' + namesText(here) };
    this.item.show();
  }

  dispose(): void {
    this.sub.dispose();
    this.item.dispose();
  }
}
