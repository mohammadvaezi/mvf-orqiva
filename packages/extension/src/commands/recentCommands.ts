// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-67 | S13 | v0.1.0] Add Open folder from the dashboard and a recent projects list on Welcome ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  an unlinked folder is the one place the extension has nothing to show, and it is usually not
//          where the person meant to be. The folders this machine has already opened are known (the
//          dashboard learns them), so the welcome offers them instead of an empty view. A welcome view
//          takes static markdown, so the list itself is a quick pick behind one link.
import * as vscode from 'vscode';
import { knownFolders, pruneFolders, type MementoLike } from '../dashboard/folders';

export const RECENT_CONTEXT = 'orqiva.hasRecentProjects';

export interface RecentItem {
  identifier: string;
  folder: string;
}

export function recentItems(memento: MementoLike, exists?: (p: string) => boolean): RecentItem[] {
  return Object.entries(knownFolders(memento, exists))
    .map(([identifier, folder]) => ({ identifier, folder }))
    .sort((a, b) => a.identifier.localeCompare(b.identifier));
}

export interface RecentDeps {
  memento: MementoLike;
  /** injected for tests */
  pick?: (items: (vscode.QuickPickItem & RecentItem)[]) => Thenable<RecentItem | undefined>;
  open?: (folder: string) => Thenable<unknown>;
  exists?: (p: string) => boolean;
  currentRoot?: () => string | null;
}

// ── [PCODE-67 | S13 | v0.1.0] openRecentProject: pick one, open it in this window ──
//    The folder currently open is left out of the list: offering to reopen where you already are is the
//    kind of choice that makes a menu feel automated rather than written.
export async function openRecentProject(deps: RecentDeps): Promise<RecentItem | undefined> {
  const here = deps.currentRoot?.() ?? null;
  const items = recentItems(deps.memento, deps.exists).filter((i) => i.folder !== here);
  if (!items.length) return undefined;
  const pick =
    deps.pick ??
    ((list: (vscode.QuickPickItem & RecentItem)[]) =>
      vscode.window
        .showQuickPick(list, { placeHolder: 'Open which project?', matchOnDetail: true })
        .then((p) => (p ? { identifier: p.identifier, folder: p.folder } : undefined)));
  const chosen = await pick(items.map((i) => ({ ...i, label: i.identifier, detail: i.folder })));
  if (!chosen) return undefined;
  const open =
    deps.open ??
    ((folder: string) =>
      vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folder), {
        forceNewWindow: false,
      }));
  await open(chosen.folder);
  return chosen;
}

// ── [PCODE-67 | S13 | v0.1.0] the context key the welcome view asks about ──
//    Pruned on the way: a folder that has been deleted or moved must not be offered, and finding that
//    out when the window fails to open is too late.
export async function refreshRecentContext(
  memento: MementoLike,
  setContext: (key: string, value: unknown) => Thenable<unknown> = (k, v) =>
    vscode.commands.executeCommand('setContext', k, v),
  exists?: (p: string) => boolean,
  currentRoot?: () => string | null,
): Promise<number> {
  const live = await pruneFolders(memento, exists);
  const here = currentRoot?.() ?? null;
  const count = Object.values(live).filter((f) => f !== here).length;
  await setContext(RECENT_CONTEXT, count > 0);
  return count;
}

export function registerRecentCommands(
  context: vscode.ExtensionContext,
  currentRoot: () => string | null,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.openRecentProject', () => {
      void openRecentProject({ memento: context.globalState, currentRoot });
    }),
  );
}
