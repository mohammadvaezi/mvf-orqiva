// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-27 | S05 | v0.1.0] Build the setup panel: environment checks, Plane connection and key storage ──
// ── [PCODE-28 | S05 | v0.1.0] Install hooks, plane command and MCP server through install.py with progress ──
// ── [PCODE-29 | S05 | v0.1.0] Add Forget key with confirmation and an e2e secrets test ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  host side of Setup: checks with fixes, then Connect. The key travels webview -> host once and is
//          never posted back; the panel only learns "a key is stored".
import * as vscode from 'vscode';
import {
  applyFix,
  checkEnvironment,
  forgetKey,
  installWithProgress,
} from '../../commands/setupCommands';
import { PlaneClient } from '../../plane/client';
import type { Services } from '../../services';
import { connectPlane } from '../../setup/connect';
import { redact } from '../../util/redact';
import { createPanel, type PanelHandle } from '../host';
import type { HostToSetup, SetupToHost } from '../protocol';

export interface SetupPanelDeps {
  context: vscode.ExtensionContext;
  services: Services;
  /** after a successful connect: refresh welcome keys, reconnect the board … */
  onConnected?: () => Promise<void>;
}

// ── [PCODE-27 | S05 | v0.1.0] connectionState: what the webview may know - never the key itself ──
export async function connectionState(
  services: Services,
): Promise<Extract<HostToSetup, { type: 'setup/connection' }>> {
  const conn = services.connection();
  return {
    type: 'setup/connection',
    baseUrl: conn.baseUrl,
    workspace: conn.workspace,
    hasKey: await services.secrets.hasApiKey(),
  };
}

export async function openSetupPanel(
  deps: SetupPanelDeps,
): Promise<PanelHandle<SetupToHost, HostToSetup>> {
  const { context, services } = deps;
  const { handle, created } = createPanel<SetupToHost, HostToSetup>(context, {
    id: 'setup',
    title: 'Orqiva setup',
    entry: 'setup',
    log: (l) => {
      services.log.warn(l);
    },
  });
  const pushAll = async (): Promise<void> => {
    await handle.post(await connectionState(services));
    await handle.post({ type: 'setup/busy', busy: true, what: 'checks' });
    const results = await checkEnvironment(services);
    await handle.post({ type: 'setup/checks', results });
    await handle.post({ type: 'setup/busy', busy: false });
  };
  if (!created) {
    await pushAll();
    return handle;
  }
  handle.onMessage((m) => {
    void (async () => {
      if (m.type === 'setup/refresh') return pushAll();
      if (m.type === 'setup/openFix') return applyFix(m.fix);
      if (m.type === 'setup/connect') {
        await handle.post({ type: 'setup/busy', busy: true, what: 'connect' });
        try {
          const r = await connectPlane(
            {
              writeSetting: (k, v) =>
                Promise.resolve(
                  vscode.workspace
                    .getConfiguration('orqiva')
                    .update(k, v, vscode.ConfigurationTarget.Global),
                ),
              storeKey: (k) => services.secrets.setApiKey(k),
              testClient: (c) =>
                new PlaneClient({
                  baseUrl: c.baseUrl,
                  workspace: c.workspace,
                  apiKey: () => Promise.resolve(c.apiKey),
                }),
            },
            m,
          );
          // [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names
          services.log.info(`connected to the legacy tracker: ${r.projects.length} project(s)`);
          await handle.post({ type: 'setup/connected', projects: r.projects });
          await handle.post(await connectionState(services));
          await deps.onConnected?.();
        } catch (e) {
          await handle.post({
            type: 'setup/error',
            message: redact(e instanceof Error ? e.message : String(e)),
          });
        } finally {
          await handle.post({ type: 'setup/busy', busy: false });
        }
        return;
      }
      if (m.type === 'setup/install') {
        // [PCODE-28 | S05 | v0.1.0] install through the engine, then re-run the checks so the panel shows the result
        await handle.post({ type: 'setup/busy', busy: true, what: 'install' });
        try {
          await installWithProgress(services);
          await handle.post({ type: 'setup/installed' });
          await handle.post({ type: 'setup/checks', results: await checkEnvironment(services) });
          await deps.onConnected?.();
        } catch (e) {
          await handle.post({
            type: 'setup/error',
            message: redact(e instanceof Error ? e.message : String(e)),
          });
        } finally {
          await handle.post({ type: 'setup/busy', busy: false });
        }
        return;
      }
      // [PCODE-29 | S05 | v0.1.0] setup/forgetKey (the last message kind): confirmation lives in the
      // command; the panel only learns the new hasKey afterwards
      if (await forgetKey(services)) {
        await handle.post(await connectionState(services));
        await deps.onConnected?.();
      }
    })();
  });
  await pushAll();
  return handle;
}
