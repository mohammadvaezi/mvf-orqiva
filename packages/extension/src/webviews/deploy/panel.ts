// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-58 | S11 | v0.1.0] Build the Deploy panel with targets, deploy button, progress and history ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  host side of the Deploy panel: the targets of this project, the version the repo is at with its
//          warnings, one Deploy per explicitly chosen target behind a modal, and the lines the adapter
//          produces. The token entered in the form goes straight to SecretStorage and is never echoed back.
import * as vscode from 'vscode';
import {
  confirmMessage,
  deployedLine,
  runDeploy,
  versionWarnings,
  type DeployResult,
} from '../../deploy/deployService';
import {
  describeTarget,
  hasToken,
  readTargets,
  removeTarget,
  saveTarget,
  validateTarget,
  type DeployTarget,
  type SecretBag,
} from '../../deploy/targets';
import { readVersionInfo } from '../../release/version';
import type { Services } from '../../services';
import { redact } from '../../util/redact';
import { createPanel, type PanelHandle } from '../host';
import type { DeployMessage, DeployToHost, HostToDeploy } from '../protocol';

export interface DeployPanelDeps {
  context: vscode.ExtensionContext;
  services: Services;
  /** [PCODE-59] records the attempt on the Release item */
  onAttempt?: (outcome: {
    result?: DeployResult;
    target: DeployTarget;
    version: string;
    error?: string;
    cancelled?: boolean;
  }) => Promise<void>;
  /** [PCODE-59] the lines the Release item already carries */
  loadHistory?: (version: string) => Promise<string[]>;
}

export async function buildMessage(
  services: Services,
  secrets: SecretBag,
  history: string[],
  busy: string | null,
): Promise<DeployMessage> {
  const root = services.root();
  const link = services.store.state.link;
  if (!root || !link)
    return {
      targets: [],
      version: '',
      warnings: ['Link this folder to an Orqiva project first.'],
      history,
      busy,
      canDeploy: false,
    };
  const info = await readVersionInfo({ root, version: link.version });
  const targets = readTargets(root);
  const rows = await Promise.all(
    targets.map(async (t) => ({
      name: t.name,
      kind: t.kind,
      summary: describeTarget(t),
      hasToken: t.kind === 'coolify' ? await hasToken(t.name, secrets) : true,
      target: t,
    })),
  );
  return {
    targets: rows.map((r) => ({
      name: r.name,
      kind: r.kind,
      summary: r.summary,
      tokenStored: r.hasToken,
      fields: r.target,
    })),
    version: link.version,
    warnings: versionWarnings({
      version: link.version,
      dirty: info.dirty,
      changed: info.changed,
      lastTag: info.lastTag,
    }),
    history,
    busy,
    canDeploy: busy === null && rows.length > 0,
  };
}

export async function openDeployPanel(
  deps: DeployPanelDeps,
): Promise<PanelHandle<DeployToHost, HostToDeploy>> {
  const { context, services } = deps;
  const secrets = context.secrets;
  const { handle, created } = createPanel<DeployToHost, HostToDeploy>(context, {
    id: 'deploy',
    title: 'Deploy',
    entry: 'deploy',
    log: (l) => {
      services.log.warn(l);
    },
  });
  let busy: string | null = null;
  let lines: string[] = [];
  let history: string[] = [];

  const push = async (): Promise<void> => {
    await handle.post({
      type: 'deploy/state',
      state: await buildMessage(services, secrets, history, busy),
    });
    await handle.post({ type: 'deploy/log', lines });
  };
  const say = (line: string): void => {
    lines = [...lines, redact(line)].slice(-400);
    services.log.info(`deploy: ${redact(line)}`);
    void handle.post({ type: 'deploy/log', lines }).then(undefined, () => undefined);
  };

  if (!created) {
    await push();
    return handle;
  }

  const refreshHistory = async (): Promise<void> => {
    const link = services.store.state.link;
    if (!deps.loadHistory || !link) return;
    try {
      history = await deps.loadHistory(link.version);
    } catch {
      history = [];
    }
  };

  handle.onMessage((m) => {
    void (async () => {
      const root = services.root();
      if (!root) {
        await push();
        return;
      }
      switch (m.type) {
        case 'deploy/refresh':
          await refreshHistory();
          await push();
          return;
        case 'deploy/save': {
          const target = m.target as DeployTarget;
          const problems = validateTarget(
            target,
            readTargets(root).filter(
              (t) => t.name.toLowerCase() !== target.name.trim().toLowerCase(),
            ),
          );
          if (problems.length) {
            await handle.post({ type: 'deploy/problems', problems });
            return;
          }
          try {
            await saveTarget(root, target, secrets);
            await handle.post({ type: 'deploy/saved', name: target.name.trim() });
            await push();
            return;
          } catch (e) {
            await handle.post({
              type: 'deploy/error',
              message: redact(e instanceof Error ? e.message : String(e)),
            });
            return;
          }
        }
        case 'deploy/remove':
          await removeTarget(root, m.name, secrets);
          await push();
          return;
        case 'deploy/deploy': {
          if (busy) {
            await handle.post({ type: 'deploy/error', message: `${busy} is still running.` });
            return;
          }
          // [PCODE-58 | S11 | v0.1.0] only the target that was named: no default, no "all"
          const target = readTargets(root).find((t) => t.name === m.name);
          const link = services.store.state.link;
          if (!target || !link) {
            await handle.post({ type: 'deploy/error', message: `No target named ${m.name}.` });
            return;
          }
          const pick = await vscode.window.showWarningMessage(
            confirmMessage(link.version, target),
            { modal: true },
            'Deploy',
          );
          if (pick !== 'Deploy') {
            await deps.onAttempt?.({ target, version: link.version, cancelled: true });
            await refreshHistory();
            await push();
            return;
          }
          busy = `deploy to ${target.name}`;
          lines = [];
          await push();
          let result: DeployResult | undefined;
          let error: string | undefined;
          try {
            result = await runDeploy({
              target,
              version: link.version,
              secrets,
              onLine: say,
            });
            say(deployedLine(link.version, target.name, result.ms));
          } catch (e) {
            error = redact(e instanceof Error ? e.message : String(e));
            say(`! ${error}`);
            await handle.post({ type: 'deploy/error', message: error });
          } finally {
            // [PCODE-59 | S11 | v0.1.0] the attempt is recorded whatever happened
            await deps.onAttempt?.({
              ...(result ? { result } : {}),
              target,
              version: link.version,
              ...(error ? { error } : {}),
            });
            busy = null;
            await refreshHistory();
            await push();
          }
          return;
        }
      }
    })().catch((e: unknown) => {
      services.log.error('deploy panel', e);
    });
  });

  await refreshHistory();
  await push();
  return handle;
}
