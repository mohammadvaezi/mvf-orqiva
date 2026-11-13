// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-48 | S09 | v0.1.0] Bump version via plane version bump with clean-worktree guard and tag check ──
// ── [PCODE-49 | S09 | v0.1.0] Create or update the Release item in Plane on bump via plane new ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the command behind the panel's three buttons: one modal, one progress notification, and the
//          engine doing the commit and the tag.
import * as vscode from 'vscode';
import { bumpVersion, confirmMessage, type BumpResult } from '../release/bump';
import type { BumpPart } from '../release/version';
import type { Services } from '../services';
import { info, showError } from './notify';

export function resultMessage(r: BumpResult): string {
  const release = r.release?.ref
    ? ` Release item ${r.release.ref}${r.release.created ? ' created' : ''}.`
    : '';
  return `Version ${r.from} → ${r.to} (tag ${r.tag}). CHANGELOG.md${r.packageUpdated ? ' and package.json' : ''} committed by the engine.${release}`;
}

export const OPEN_RELEASE = 'Open release item';

// ── [PCODE-49 | S09 | v0.1.0] announce: the result line, with a way to the Release item in Plane ──
export function announce(r: BumpResult): void {
  const url = r.release?.url;
  if (!url) {
    info(resultMessage(r));
    return;
  }
  void Promise.resolve(vscode.window.showInformationMessage(resultMessage(r), OPEN_RELEASE)).then(
    (pick) => (pick === OPEN_RELEASE ? vscode.env.openExternal(vscode.Uri.parse(url)) : undefined),
    () => undefined,
  );
}

// ── [PCODE-48 | S09 | v0.1.0] runBump: modal confirmation, progress, the engine, then the result line ──
export async function runBump(services: Services, part: BumpPart): Promise<BumpResult | undefined> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Orqiva: bumping the ${part} version`,
    },
    async () =>
      bumpVersion({
        services,
        part,
        confirm: (message) =>
          Promise.resolve(vscode.window.showWarningMessage(message, { modal: true }, 'Bump')).then(
            (pick) => pick === 'Bump',
          ),
      }),
  );
}

export function registerReleaseCommands(
  context: vscode.ExtensionContext,
  services: Services,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.bumpVersion', async (arg?: unknown) => {
      const part: BumpPart = arg === 'minor' || arg === 'major' || arg === 'patch' ? arg : 'patch';
      try {
        const r = await runBump(services, part);
        if (r) announce(r);
      } catch (e) {
        await showError('Bump version', e, services.log);
      }
    }),
  );
}

export { confirmMessage };
