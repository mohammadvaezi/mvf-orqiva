// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-52 | S10 | v0.1.0] Generate Dockerfile and compose through a Plane task run by Claude Code ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the command behind the panel's "Generate with Claude" button and the palette entry: work out the
//          image tag, run the flow, and say which task now owns the two files.
import * as vscode from 'vscode';
import { imageTag } from '../release/docker';
import { generateDockerFiles } from '../release/dockerGenerate';
import type { Services } from '../services';
import { info, showError } from './notify';

// ── [PCODE-52 | S10 | v0.1.0] runDockerGenerate: image tag from the link, then the loop does the rest ──
export async function runDockerGenerate(services: Services): Promise<void> {
  const link = services.store.state.link;
  if (!link) {
    info('Link this folder to an Orqiva project first.');
    return;
  }
  try {
    const r = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Orqiva: creating the Docker task',
      },
      () => generateDockerFiles({ services, image: imageTag(link.name, link.version) }),
    );
    info(`${r.ref} is active — Claude Code is writing Dockerfile and docker-compose.yml.`);
  } catch (e) {
    await showError('Generate Docker files', e, services.log);
  }
}
