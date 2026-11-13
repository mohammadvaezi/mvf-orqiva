// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-26 | S05 | v0.1.0] Add environment checks for Python, Node, Claude Code, git and the engine folder ──
// ── [PCODE-28 | S05 | v0.1.0] Install hooks, plane command and MCP server through install.py with progress ──
// ── [PCODE-29 | S05 | v0.1.0] Add Forget key with confirmation and an e2e secrets test ──
//    Why:  orqiva.checkEnvironment shows the results as a quick pick (fix on select) and logs them.
import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import type { Probe } from '../engine/locate';
import type { Services } from '../services';
import { runChecks, type CheckResult } from '../setup/checks';
import { installHooks } from '../setup/install';
import { info, showError } from './notify';

// ── [PCODE-26 | S05 | v0.1.0] nodeProbe: `<cmd> --version` with an argv array; ENOENT becomes a rejection ──
export const nodeProbe: Probe = (command, args) =>
  new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, shell: false });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });

export async function checkEnvironment(services: Services): Promise<CheckResult[]> {
  const cfg = vscode.workspace.getConfiguration('orqiva');
  const results = await runChecks({
    probe: nodeProbe,
    settings: {
      engineHome: cfg.get<string>('engineHome') ?? '',
      pythonPath: cfg.get<string>('pythonPath') ?? '',
    },
    env: process.env,
    platform: process.platform,
  });
  for (const r of results)
    services.log.info(`check ${r.ok ? 'ok ' : 'MISSING'} ${r.name}: ${r.detail}`);
  return results;
}

export async function applyFix(fix: string): Promise<void> {
  if (/^https?:\/\//.test(fix)) {
    await vscode.env.openExternal(vscode.Uri.parse(fix));
    return;
  }
  const [command, arg] = fix.split('?');
  await vscode.commands.executeCommand(command ?? fix, arg);
}

// ── [PCODE-28 | S05 | v0.1.0] installWithProgress: the panel and the command share it; output streams to the log ──
export async function installWithProgress(services: Services): Promise<string> {
  const loc = await services.location();
  const conn = services.connection();
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Orqiva: installing hooks and the plane command',
      cancellable: true,
    },
    async (_progress, token) => {
      const r = await installHooks({
        spec: { python: loc.python, home: loc.home },
        apiKey: await services.secrets.getApiKey(),
        baseUrl: conn.baseUrl,
        workspace: conn.workspace,
        onLine: (l) => {
          services.log.info(l);
        },
        cancel: token,
      });
      await services.location(true);
      return r.summary;
    },
  );
}

export const FORGET_PROMPT =
  'Remove the stored legacy tracker key from this computer? Projects and hooks are kept.';

// ── [PCODE-29 | S05 | v0.1.0] forgetKey: confirm (unless the caller decided), delete, go offline ──
export async function forgetKey(
  services: Services,
  decided?: boolean,
  ask: () => Thenable<string | undefined> = () =>
    vscode.window.showWarningMessage(FORGET_PROMPT, { modal: true }, 'Remove'),
): Promise<boolean> {
  const yes = decided ?? (await ask()) === 'Remove';
  if (!yes) return false;
  await services.secrets.deleteApiKey();
  services.store.setOnline(false, 'No API key stored');
  services.log.info('legacy tracker key removed from this computer');
  info('Legacy tracker key removed. Connect again to see the live board.');
  return true;
}

export function registerSetupCommands(context: vscode.ExtensionContext, services: Services): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.forgetKey', (arg?: unknown) => {
      const decided =
        typeof arg === 'object' && arg !== null && 'confirm' in arg
          ? Boolean((arg as { confirm?: unknown }).confirm)
          : undefined;
      return forgetKey(services, decided);
    }),
    vscode.commands.registerCommand('orqiva.installHooks', async () => {
      try {
        await installWithProgress(services);
        info('Hooks, plane command and MCP server installed. Restart open Claude Code terminals.');
      } catch (e) {
        await showError('Install', e, services.log);
      }
    }),
    vscode.commands.registerCommand('orqiva.checkEnvironment', async () => {
      const results = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Orqiva: checking this computer',
        },
        () => checkEnvironment(services),
      );
      const items: (vscode.QuickPickItem & { fix?: string })[] = results.map((r) => ({
        label: `$(${r.ok ? 'pass' : r.required ? 'error' : 'warning'}) ${r.name}`,
        description: r.detail,
        ...(r.ok || !r.fix ? {} : { detail: `Fix: ${r.fix}`, fix: r.fix }),
      }));
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Environment checks - select a failed item to open its fix',
      });
      if (pick?.fix) await applyFix(pick.fix);
    }),
  );
}
