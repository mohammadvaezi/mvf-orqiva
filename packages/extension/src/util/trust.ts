// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-73 | S03 | v0.1.0] Support VS Code workspace trust: limited mode until the folder is trusted ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/1a212ca9-413a-4bd7-a3dd-d943258eace1/
//    Why:  in Restricted Mode nothing may run code in the folder (criticals #4). The read-only parts of the
//          extension keep working; every spawn passes this gate first.
import * as vscode from 'vscode';
import { OrqivaError } from './errors';

export const TRUST_MESSAGE =
  'Trust this folder to run the engine. Orqiva runs its loop commands and Claude Code inside the workspace; VS Code keeps it in Restricted Mode until you trust it (Manage Workspace Trust).';

export function isTrusted(ws: { isTrusted: boolean } = vscode.workspace): boolean {
  return ws.isTrusted;
}

// ── [PCODE-73 | S03 | v0.1.0] requireTrust: the one check every spawn and terminal goes through ──
export function requireTrust(ws: { isTrusted: boolean } = vscode.workspace): void {
  if (!ws.isTrusted) throw new OrqivaError(TRUST_MESSAGE, 'config');
}
