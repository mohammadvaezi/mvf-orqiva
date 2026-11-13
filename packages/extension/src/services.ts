// ── [PCODE-455 | S15 | v0.1.0] Rename the project folder .plane to .orqiva on Orqiva folders, with a one-time move ──
// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-11 | S02 | v0.1.0] Add the state store with a .plane file watcher and change events ──
// ── [PCODE-73 | S03 | v0.1.0] Support VS Code workspace trust: limited mode until the folder is trusted ──
// ── [PCODE-30 | S06 | v0.1.0] Add New project and Link project commands calling plane_init.py ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the composition root - one object built once in activate() holding log, secrets, engine, store
//          and client; views and commands take it, nothing constructs services on its own.
import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { EngineCommands, type EngineRunner } from './engine/commands';
import type { ServerConnection } from './server/connection';
import { LoopCommands } from './server/loopCommands';
import { locateCached, type EngineLocation, type Probe } from './engine/locate';
import { runEngine, type RunResult } from './engine/run';
import { PlaneClient } from './plane/client';
import { PlaneSecrets, type PlaneConnection } from './plane/secrets';
import { findProject } from './state/project';
import { moveToOrqiva } from './state/moveFolder';
import { Store } from './state/store';
import { type WatchBackend, nodeBackend } from './state/watcher';
import { getLogger, type Logger } from './util/log';
import { requireTrust } from './util/trust';

export interface Services extends vscode.Disposable {
  log: Logger;
  secrets: PlaneSecrets;
  store: Store;
  client: PlaneClient;
  engine: EngineCommands;
  /** Resolved lazily; problems are surfaced by the setup view (Sprint 05). */
  location(refresh?: boolean): Promise<EngineLocation>;
  connection(): PlaneConnection;
  root(): string | null;
  /** [PCODE-30 | S06 | v0.1.0] an engine runner with cwd = `cwd` - for folders that are not a project yet */
  runAt(cwd: string): EngineRunner;
  /** [PCODE-30 | S06 | v0.1.0] point the store (and its watcher) at a folder that just became a project */
  relocate(root: string): void;
  /** [PCODE-105 | S15 | v0.1.0] set by the board source: read the board now (Orqiva or Plane). */
  refreshBoard?: () => Promise<void>;
  /** [PCODE-193 | S15 | v0.1.0] set by the board source: the live Orqiva connection of a linked folder, else null */
  server?: () => ServerConnection | null;
}

// ── [PCODE-11 | S02 | v0.1.0] connectionFromSettings: base URL + workspace, the key stays in SecretStorage ──
export function connectionFromSettings(): PlaneConnection {
  const cfg = vscode.workspace.getConfiguration('orqiva');
  return {
    baseUrl: cfg.get<string>('plane.baseUrl', 'https://plan.broszio.com'),
    workspace: cfg.get<string>('plane.workspace', 'prodsystem'),
  };
}

// ── [PCODE-11 | S02 | v0.1.0] probe: spawn `<cmd> --version` for the locator (argv array, no shell) ──
const probe: Probe = (command, args) =>
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

// ── [PCODE-11 | S02 | v0.1.0] vscodeBackend: FileSystemWatcher on .plane/** relative to the root ──
export const vscodeBackend: WatchBackend = (root, onChange) => {
  const w = vscode.workspace.createFileSystemWatcher(
    // [PCODE-105 | S15 | v0.1.0] .orqiva/ too: the orq link and the active task of the orq loop
    new vscode.RelativePattern(vscode.Uri.file(root), '{.plane,.orqiva}/**'),
  );
  const rel = (u: vscode.Uri): void => {
    onChange(vscode.workspace.asRelativePath(u, false).replace(/\\/g, '/'));
  };
  const subs = [w.onDidChange(rel), w.onDidCreate(rel), w.onDidDelete(rel)];
  return {
    dispose: () => {
      subs.forEach((s) => {
        s.dispose();
      });
      w.dispose();
    },
  };
};

// ── [PCODE-11 | S02 | v0.1.0] createServices: files first (no network), engine bound to the root + env ──
export function createServices(
  context: vscode.ExtensionContext,
  opts: { watchBackend?: WatchBackend } = {},
): Services {
  const log = getLogger();
  const secrets = new PlaneSecrets(context.secrets, connectionFromSettings);
  const store = new Store((m) => {
    log.warn(m);
  });

  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const found = findProject(folders);
  const backend = opts.watchBackend ?? (process.env['ORQIVA_TEST'] ? nodeBackend : vscodeBackend);
  // [PCODE-455 | S15 | v0.1.0] an Orqiva folder's files move from .plane to .orqiva once, when trusted
  const move = (root: string): void => {
    if (!vscode.workspace.isTrusted) return;
    const r = moveToOrqiva(root);
    if (r?.moved.length)
      log.info(
        'moved the project files to .orqiva: ' +
          r.moved.map((m) => m.from + ' -> ' + m.to).join(', '),
      );
    if (r?.stayed.length)
      log.warn('could not move yet: ' + r.stayed.map((x) => '.plane/' + x).join(', '));
  };
  if (found) move(found.root);
  store.load(found?.root ?? null);
  if (found) store.watch(backend);
  // [PCODE-30 | S06 | v0.1.0] relocate: New/Link project made a folder a project - re-read and re-watch it
  const relocate = (root: string): void => {
    move(root);
    store.load(root);
    store.watch(backend);
  };
  // [PCODE-455 | S15 | v0.1.0] trusted later: the move waits until then
  context.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      if (store.state.root) relocate(store.state.root);
    }),
  );

  const location = (refresh = false): Promise<EngineLocation> => {
    const cfg = vscode.workspace.getConfiguration('orqiva');
    return locateCached(
      {
        settings: {
          engineHome: cfg.get<string>('engineHome') ?? '',
          pythonPath: cfg.get<string>('pythonPath') ?? '',
        },
        env: process.env,
        platform: process.platform,
        probe,
      },
      refresh,
    ).then((loc) => {
      if (refresh || !loc.problems.length)
        log.info(
          `engine: ${loc.home || '(none)'} · python: ${loc.python.join(' ') || '(none)'} ${loc.versions.python ?? ''}`,
        );
      for (const p of loc.problems) log.warn(p);
      return loc;
    });
  };

  // [PCODE-30 | S06 | v0.1.0] runAt: the runner bound to an explicit cwd; `run` is runAt(project root)
  const runAt =
    (cwd: string): EngineRunner =>
    async (script: string, args: string[], timeoutMs?: number): Promise<RunResult> => {
      requireTrust(); // [PCODE-73 | S03 | v0.1.0] no spawn in Restricted Mode
      const loc = await location();
      const opt = {
        cwd,
        env: await secrets.envForEngine(),
        onLine: (l: string) => {
          log.info(l);
        },
      };
      return runEngine(
        { python: loc.python, home: loc.home },
        script,
        args,
        timeoutMs === undefined ? opt : { ...opt, timeoutMs },
      );
    };
  const run: EngineRunner = (script, args, timeoutMs) => {
    const root = store.state.root;
    if (!root) return Promise.reject(new Error('No linked project in this workspace.'));
    return runAt(root)(script, args, timeoutMs);
  };

  const client = new PlaneClient({
    baseUrl: connectionFromSettings().baseUrl,
    workspace: connectionFromSettings().workspace,
    apiKey: () => secrets.getApiKey(),
    log: (l) => {
      log.info(l);
    },
  });

  return {
    log,
    secrets,
    store,
    client,
    // [PCODE-105 | S15 | v0.1.0] a folder linked with orq runs the loop on Orqiva, others on the engine
    engine: new LoopCommands(run, { root: () => store.state.root }),
    location,
    connection: connectionFromSettings,
    root: () => store.state.root,
    runAt,
    relocate,
    dispose: () => {
      store.dispose();
    },
  };
}
