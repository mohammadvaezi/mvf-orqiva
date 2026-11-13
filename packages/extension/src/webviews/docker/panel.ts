// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-51 | S10 | v0.1.0] Build the Docker panel with generate, build, run, stop, logs and health ──
// ── [PCODE-53 | S10 | v0.1.0] Stream build and container logs into the Orqiva Docker output channel ──
// ── [PCODE-54 | S10 | v0.1.0] Add the health check with configurable URL and timeout shown in the panel ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  host side of the Docker panel. The long runs (build, up, logs) live in a module-level registry,
//          not in the panel, so closing the panel while a build runs does not stop it and reopening
//          re-attaches to the same output. Everything Docker prints goes to the "Orqiva Docker" channel.
import * as vscode from 'vscode';
import {
  build as dockerBuild,
  composeDown,
  composeLogs,
  composeUp,
  DEFAULT_COMPOSE,
} from '../../release/docker';
import { channelLine, LogBuffer } from '../../release/dockerLogs';
import { describeService, readDockerState, type DockerState } from '../../release/dockerState';
import {
  checkHealth,
  healthSummary,
  healthUrlFrom,
  pollHealth,
  readDeployJson,
  DEFAULT_TIMEOUT_SECONDS,
  type HealthReport,
} from '../../release/health';
import type { Services } from '../../services';
import { redact } from '../../util/redact';
import { createPanel, type PanelHandle } from '../host';
import type { DockerMessage, DockerToHost, HostToDocker } from '../protocol';

export const DOCKER_CHANNEL = 'Orqiva Docker';

export interface DockerPanelDeps {
  context: vscode.ExtensionContext;
  services: Services;
  /** [PCODE-52] creates the Plane task and opens Claude Code to write the files */
  onGenerate?: () => Promise<void>;
}

// ── [PCODE-54 | S10 | v0.1.0] healthSettings: the URL a project or the setting chose, and the timeout ──
export function healthSettings(root: string): { url: string; timeoutSeconds: number } {
  const cfg = vscode.workspace.getConfiguration('orqiva');
  return {
    url: healthUrlFrom(cfg.get<string>('docker.healthUrl'), readDeployJson(root)),
    timeoutSeconds: cfg.get<number>('docker.healthTimeoutSeconds', DEFAULT_TIMEOUT_SECONDS),
  };
}

// ── [PCODE-51 | S10 | v0.1.0] the run registry: one build/up/down at a time, outliving the panel ──
interface RunState {
  what: string | null;
  /** [PCODE-53 | S10 | v0.1.0] the last 2000 lines; the channel keeps the rest */
  buffer: LogBuffer;
  logging: boolean;
  cancelLogs: vscode.CancellationTokenSource | null;
  listeners: Set<(what: string | null) => void>;
}

const run: RunState = {
  what: null,
  buffer: new LogBuffer(),
  logging: false,
  cancelLogs: null,
  listeners: new Set(),
};

let channel: vscode.OutputChannel | undefined;
function dockerChannel(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel(DOCKER_CHANNEL);
  return channel;
}

export function disposeDockerChannel(): void {
  channel?.dispose();
  channel = undefined;
}

/** tests only */
export function _resetDockerRun(): void {
  run.what = null;
  run.buffer.clear();
  run.logging = false;
  run.cancelLogs?.dispose();
  run.cancelLogs = null;
  run.listeners.clear();
}

export function isDockerBusy(): string | null {
  return run.what;
}

// ── [PCODE-51 | S10 | v0.1.0] emit: one line to the channel and to every open panel ──
//    [PCODE-53 | S10 | v0.1.0] the buffer cleans it once (ANSI, secrets) and both sinks use that result
export function emitDockerLine(line: string): void {
  const clean = run.buffer.push(line);
  dockerChannel().appendLine(channelLine(clean));
  for (const l of run.listeners) l(run.what);
}

/** what the panel shows: the newest lines plus a note about the ones the ring dropped */
export function panelLines(): string[] {
  const tail = run.buffer.tail(400);
  const hidden = run.buffer.total - tail.length;
  return hidden > 0 ? [`… ${String(hidden)} earlier line(s) — Open output for all`, ...tail] : tail;
}

/** exactOptionalPropertyTypes: `what` is present only when there is one */
function busyMessage(what: string | null): HostToDocker {
  return what === null
    ? { type: 'docker/busy', busy: false }
    : { type: 'docker/busy', busy: true, what };
}

export function toMessage(state: DockerState): DockerMessage {
  return {
    docker: state.version.detail,
    dockerOk: state.version.ok,
    fix: state.version.fix,
    filesNote: state.filesNote,
    hasDockerfile: state.hasDockerfile,
    composeFile: state.composeFile,
    image: state.image,
    services: state.services.map(describeService),
    running: state.running,
    buttons: state.buttons,
  };
}

export async function openDockerPanel(
  deps: DockerPanelDeps,
): Promise<PanelHandle<DockerToHost, HostToDocker>> {
  const { context, services } = deps;
  const { handle, created } = createPanel<DockerToHost, HostToDocker>(context, {
    id: 'docker',
    title: 'Docker',
    entry: 'docker',
    log: (l) => {
      services.log.warn(l);
    },
  });

  const push = async (): Promise<void> => {
    const root = services.root();
    const link = services.store.state.link;
    if (!root || !link) {
      await handle.post({
        type: 'docker/error',
        message: 'Link this folder to an Orqiva project first.',
      });
      return;
    }
    const state = await readDockerState({
      root,
      projectName: link.name,
      version: link.version,
      ...(run.what ? { busy: true } : {}),
    });
    await handle.post({ type: 'docker/state', state: toMessage(state) });
    await handle.post(busyMessage(run.what));
  };

  if (!created) {
    await push();
    await handle.post({ type: 'docker/log', lines: panelLines(), logging: run.logging });
    return handle;
  }

  // [PCODE-51 | S10 | v0.1.0] a reopened panel re-attaches to the running command's output
  const listener = (what: string | null): void => {
    void handle.post({ type: 'docker/log', lines: panelLines(), logging: run.logging }).then(
      () => handle.post(busyMessage(what)),
      () => undefined,
    );
  };
  run.listeners.add(listener);
  handle.panel.onDidDispose(() => {
    run.listeners.delete(listener);
  });

  // [PCODE-54 | S10 | v0.1.0] the health check, and the poll that follows a Run
  const postHealth = async (report: HealthReport, checking: boolean): Promise<void> => {
    await handle.post({
      type: 'docker/health',
      lines: report.lines.map((l) => ({ name: l.name, state: l.state, text: l.text })),
      summary: healthSummary(report),
      healthy: report.healthy,
      checking,
    });
  };
  let polling = false;
  const runHealth = async (poll: boolean): Promise<void> => {
    const root = services.root();
    const link = services.store.state.link;
    if (!root || !link) return;
    const state = await readDockerState({ root, projectName: link.name, version: link.version });
    const settings = healthSettings(root);
    const input = {
      composeFile: state.composeFile,
      url: settings.url,
      timeoutSeconds: settings.timeoutSeconds,
      docker: { cwd: root },
    };
    if (!poll) {
      await postHealth(await checkHealth(input), false);
      return;
    }
    if (polling) return;
    polling = true;
    let disposed = false;
    const sub = handle.panel.onDidDispose(() => {
      disposed = true;
    });
    try {
      await pollHealth({
        ...input,
        stop: () => disposed,
        onReport: (report) => {
          void postHealth(report, !report.healthy).catch(() => undefined);
        },
      });
    } finally {
      polling = false;
      sub.dispose();
    }
  };

  const withRun = async (what: string, fn: () => Promise<void>): Promise<void> => {
    if (run.what) {
      await handle.post({ type: 'docker/error', message: `${run.what} is still running.` });
      return;
    }
    run.what = what;
    await handle.post({ type: 'docker/busy', busy: true, what });
    try {
      await fn();
    } catch (e) {
      const message = redact(e instanceof Error ? e.message : String(e));
      emitDockerLine(`! ${message}`);
      await handle.post({ type: 'docker/error', message });
    } finally {
      run.what = null;
      await handle.post({ type: 'docker/busy', busy: false });
      await push();
    }
  };

  handle.onMessage((m) => {
    void (async () => {
      const root = services.root();
      const link = services.store.state.link;
      if (!root || !link) return push();
      const state = await readDockerState({ root, projectName: link.name, version: link.version });
      const file = state.composeFile ?? DEFAULT_COMPOSE;
      const opts = { cwd: root, onLine: emitDockerLine };
      switch (m.type) {
        case 'docker/refresh':
          return push();
        case 'docker/openOutput':
          dockerChannel().show(true);
          return;
        case 'docker/openFix':
          if (state.version.fix) await vscode.env.openExternal(vscode.Uri.parse(state.version.fix));
          return;
        case 'docker/generate':
          return withRun('generate', async () => {
            if (!deps.onGenerate) throw new Error('Generating the files is not available.');
            await deps.onGenerate();
          });
        case 'docker/build':
          return withRun('build', async () => {
            const dockerfile = state.dockerfile ?? 'Dockerfile';
            emitDockerLine(`> docker build -t ${state.image} -f ${dockerfile} .`);
            const r = await dockerBuild({ tag: state.image, file: dockerfile }, opts);
            if (r.code !== 0)
              throw new Error(`Build failed (exit ${String(r.code)}). See the Docker output.`);
            emitDockerLine(`Built ${state.image}`);
          });
        case 'docker/run':
          return withRun('run', async () => {
            emitDockerLine(`> docker compose -f ${file} up -d`);
            const r = await composeUp(file, opts);
            if (r.code !== 0)
              throw new Error(`Compose up failed (exit ${String(r.code)}). See the Docker output.`);
            void runHealth(true).catch(() => undefined); // keep checking while the stack comes up
          });
        case 'docker/stop':
          return withRun('stop', async () => {
            emitDockerLine(`> docker compose -f ${file} down`);
            const r = await composeDown(file, opts);
            if (r.code !== 0) throw new Error(`Compose down failed (exit ${String(r.code)}).`);
          });
        case 'docker/health':
          await runHealth(false);
          return;
        case 'docker/logs': {
          // [PCODE-51 | S10 | v0.1.0] the stream lives beside the runs: it may follow a build
          if (!m.on) {
            run.cancelLogs?.cancel();
            run.cancelLogs?.dispose();
            run.cancelLogs = null;
            run.logging = false;
            await handle.post({ type: 'docker/log', lines: panelLines(), logging: false });
            return;
          }
          if (run.logging) return;
          run.logging = true;
          const source = new vscode.CancellationTokenSource();
          run.cancelLogs = source;
          emitDockerLine(`> docker compose -f ${file} logs -f`);
          void composeLogs(file, emitDockerLine, { ...opts, cancel: source.token })
            .catch(() => undefined)
            .finally(() => {
              run.logging = false;
              run.cancelLogs = null;
            });
          await handle.post({ type: 'docker/log', lines: panelLines(), logging: true });
          return;
        }
      }
    })().catch((e: unknown) => {
      services.log.error('docker panel', e);
    });
  });

  await push();
  await handle.post({ type: 'docker/log', lines: panelLines(), logging: run.logging });
  return handle;
}
