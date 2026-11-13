// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-15 | S03 | v0.1.0] Add the status bar item showing active task, fingerprint and queue length ──
// ── [PCODE-20 | S04 | v0.1.0] Build the task detail panel with description, acceptance, comments and badges ──
//    Why:  "Copy fingerprint" puts the header for the active file's language on the clipboard; "Open task"
//          (status bar click) opens the task in Plane until the task panel arrives in Sprint 04.
import * as vscode from 'vscode';
import type { Services } from '../services';
import { headerBlock } from '../util/fingerprint';
import { info } from './notify';

// ── [PCODE-15 | S03 | v0.1.0] copyFingerprint: header block for the active editor's file type ──
export async function copyFingerprint(services: Services, filePath?: string): Promise<void> {
  const a = services.store.state.active;
  if (!a) {
    info('No active task. Start one first; the fingerprint belongs to a task.');
    return;
  }
  const file = filePath ?? vscode.window.activeTextEditor?.document.fileName ?? 'file.txt';
  const block = headerBlock(file, a.task, a.sprint, a.version, a.title, a.url);
  await vscode.env.clipboard.writeText(block);
  info(`Fingerprint for ${a.task} copied (${file.split(/[\\/]/).pop() ?? file}).`);
}

export function registerFingerprintCommands(
  context: vscode.ExtensionContext,
  services: Services,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.copyFingerprint', () => {
      void copyFingerprint(services);
    }),
  );
}
