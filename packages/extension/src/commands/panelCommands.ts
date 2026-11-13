// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-20 | S04 | v0.1.0] Build the task detail panel with description, acceptance, comments and badges ──
// ── [PCODE-21 | S04 | v0.1.0] List fingerprinted files in the task panel with click-to-open at line ──
// ── [PCODE-22 | S04 | v0.1.0] Add action buttons to the task panel: Start, Done, Status, Note, Open in Plane ──
//    Why:  orqiva.openTask(ref | tree node | nothing = active task) opens the one task panel.
import * as vscode from 'vscode';
import type { Services } from '../services';
import type { ItemNode } from '../views/sprintsTree';
import { openTaskPanel, type TaskPanelDeps } from '../webviews/taskDetail/panel';
import { info } from './notify';
import {
  ActionGate,
  handlePanelAction,
  type PanelActionRunner,
} from '../webviews/taskDetail/actions';
import { currentTaskRef } from '../webviews/taskDetail/panel';
import { filesForTask } from '../util/fingerprintScan';
import * as path from 'node:path';

export function refFromArg(arg: unknown, services: Services): string | undefined {
  if (typeof arg === 'string') return arg;
  const n = arg as ItemNode | undefined;
  if (n?.kind === 'item') return n.item.ref;
  return services.store.state.active?.task;
}

// ── [PCODE-20 | S04 | v0.1.0] registerPanelCommands ──
export function registerPanelCommands(
  context: vscode.ExtensionContext,
  services: Services,
  extra: Pick<TaskPanelDeps, 'filesFor' | 'onAction'> & { runner?: PanelActionRunner } = {},
): void {
  const gate = new ActionGate(); // [PCODE-22 | S04 | v0.1.0] one action at a time across the panel
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.openTask', (arg?: unknown) => {
      const ref = refFromArg(arg, services);
      if (!ref) {
        info('No active task. Pick one in the Sprints view.');
        return;
      }
      void openTaskPanel(
        {
          context,
          services,
          // [PCODE-21 | S04 | v0.1.0] files from the workspace scan (current even before plane done)
          filesFor: (task) =>
            Promise.resolve(services.root() ? filesForTask(services.root() ?? '', task) : []),
          onAction: async (m, reload) => {
            if (m.type === 'task/openFile') {
              await openAtLine(services.root() ?? '', m.file, m.line);
              return true;
            }
            // [PCODE-22 | S04 | v0.1.0] Start / Done / Status / Note through the shared runner
            if (extra.runner && currentTaskRef()) {
              const handled = await handlePanelAction(
                m,
                currentTaskRef() ?? '',
                extra.runner,
                gate,
                (msg) =>
                  (async () =>
                    (await openTaskPanel({ context, services }, currentTaskRef() ?? '')).post(
                      msg,
                    ))(),
                reload,
              );
              if (handled) return true;
            }
            return extra.onAction ? extra.onAction(m, reload) : false;
          },
          ...(extra.filesFor ? { filesFor: extra.filesFor } : {}),
        },
        ref,
      ).catch((e: unknown) => {
        services.log.error('task panel', e);
      });
    }),
  );
}

// ── [PCODE-21 | S04 | v0.1.0] openAtLine: open the document with the line revealed and selected ──
export async function openAtLine(root: string, file: string, line: number): Promise<void> {
  const uri = vscode.Uri.file(path.join(root, file));
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: true });
  const l = Math.max(0, Math.min(line - 1, doc.lineCount - 1));
  const range = doc.lineAt(l).range;
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}
