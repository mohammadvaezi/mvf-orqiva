// ── [PCODE-463 | S15 | v0.1.0] Finishing a task never dead-ends on missing fingerprints: Claude marks the code, or finish without marks ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-14 | S03 | v0.1.0] Add Sync, Start, Done, Status and Note commands wired to the engine ──
// ── [PCODE-22 | S04 | v0.1.0] Add action buttons to the task panel: Start, Done, Status, Note, Open in Plane ──
// ── [PCODE-23 | S04 | v0.1.0] Build the New task form creating items via plane new with a description file ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the loop buttons. Every one spawns the engine (never the client), shows the engine's first line,
//          maps errors through notify.ts and refreshes the store afterwards.
import * as vscode from 'vscode';
import type { TaskState } from '../engine/commands';
import type { Services } from '../services';
import type { Item } from '../state/board';
import type { ItemNode, TreeNode } from '../views/sprintsTree';
import { info, showError } from './notify';
import type { DoneResult } from '../engine/parse';
import { defaultInstalledOrq } from '../plan/portal';
import { orqCommand } from '../server/planSync';
import { markPrompt, startDevelopment } from './devCommands';

// ── [PCODE-463 | S15 | v0.1.0] finishTask: Done, and when the code has no fingerprint, a way on ──
//    orq done looks for the task's fingerprint to know which code is its; Claude does not always write it.
//    Instead of a dead end the user picks: Claude marks the code and finishes, or it is finished without
//    marks (orq done --force), which moves it to Review all the same.
export const NO_FINGERPRINT = /No fingerprint of [A-Z][A-Z0-9]*-\d+ in the code/;

export async function finishTask(
  services: Services,
  ref: string,
  run: <T>(title: string, fn: () => Promise<T>) => Promise<T>,
  /** the dialog; injected for tests */
  ask: (message: string, detail: string, ...items: string[]) => Thenable<string | undefined> = (
    message,
    detail,
    ...items
  ) => vscode.window.showWarningMessage(message, { modal: true, detail }, ...items),
): Promise<DoneResult | null> {
  try {
    return await run(`Orqiva: Done ${ref}`, () => services.engine.done(ref));
  } catch (e) {
    if (!NO_FINGERPRINT.test(e instanceof Error ? e.message : String(e))) throw e;
  }
  const mark = 'Let Claude mark it';
  const force = 'Finish without marks';
  const pick = await ask(
    `${ref} has no fingerprint in the code yet.`,
    'Fingerprints are short comments that say which code belongs to which task; Orqiva uses them for the code map, the docs and the review. ' +
      'Claude can add them to the files it wrote and then finish the task, or you finish it without them: either way it moves to Review.',
    mark,
    force,
  );
  if (pick === force)
    return run(`Orqiva: Done ${ref}`, () => services.engine.done(ref, { force: true }));
  if (pick !== mark) return null;
  const a = services.store.state.active;
  const marker =
    a?.task === ref ? `[${a.task} | ${a.sprint} | v${a.version}] ${a.title}` : undefined;
  const root = services.root();
  await startDevelopment({
    services,
    prompt: {
      text: markPrompt(
        ref,
        a?.task === ref ? a.title : ref,
        root ? orqCommand(root, defaultInstalledOrq()) : 'orq',
        marker,
      ),
      // a terminal of its own: the one Claude built in may still be open
      terminal: `Claude Code · ${ref} · marks`,
    },
  });
  return null;
}

export interface TaskCommandDeps {
  services: Services;
  /** Re-read files and, when available, the board from Plane (set by the board source, PCODE-105). */
  refresh: () => Promise<void>;
  /** [PCODE-23 | S04 | v0.1.0] opens the New task panel; set by the extension */
  openNewTask?: () => void;
}

const STATUS_PICKS: { label: string; state: TaskState; description: string }[] = [
  { label: 'Review', state: 'review', description: 'Hand over for a human look' },
  { label: 'Test', state: 'test', description: 'Tests are green, needs verification' },
  { label: 'Blocked', state: 'blocked', description: 'Cannot continue - say why in the note' },
  { label: 'Todo', state: 'todo', description: 'Park it again' },
];

function refOf(node: TreeNode | Item | string | undefined, services: Services): string | undefined {
  if (typeof node === 'string') return node;
  if (node && 'kind' in node) return node.kind === 'item' ? node.item.ref : undefined;
  if (node && 'ref' in node) return node.ref;
  return services.store.state.active?.task;
}

// ── [PCODE-14 | S03 | v0.1.0] pickRef: when nothing was clicked and no task is active, offer today's items ──
async function pickRef(services: Services, placeHolder: string): Promise<string | undefined> {
  const items = services.store.state.sprints.flatMap((s) => s.items.filter((i) => !i.done));
  if (!items.length) return undefined;
  const pick = await vscode.window.showQuickPick(
    items.map((i) => ({ label: i.ref, description: i.title, detail: i.state.name })),
    { placeHolder },
  );
  return pick?.label;
}

async function withProgress<T>(title: string, fn: () => Promise<T>): Promise<T> {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, fn);
}

// ── [PCODE-14 | S03 | v0.1.0] the commands ──
export function createTaskCommands(
  deps: TaskCommandDeps,
): Record<string, (...args: unknown[]) => Promise<void>> {
  const { services, refresh } = deps;
  const { engine, log, store } = services;

  const sync = async (): Promise<void> => {
    try {
      const r = await withProgress('Orqiva: Sync', () => engine.sync());
      info(
        `Synced. ${r.carried} carried over, ${r.promoted} moved to Todo.${r.active ? ` Active: ${r.active.ref}.` : ''}`,
      );
    } catch (e) {
      await showError('Sync', e, log);
    }
    await refresh();
  };

  const startTask = async (node?: unknown): Promise<void> => {
    const ref =
      refOf(node as TreeNode | undefined, services) ??
      (await pickRef(services, 'Start which task?'));
    if (!ref) return;
    try {
      const r = await withProgress(`Orqiva: Start ${ref}`, () => engine.start(ref));
      info(`${r.ref} started (${r.from} → ${r.to}). Fingerprint: ${r.fingerprint}`);
    } catch (e) {
      await showError('Start', e, log);
    }
    await refresh();
  };

  const doneTask = async (node?: unknown): Promise<void> => {
    const ref =
      refOf(node as TreeNode | undefined, services) ??
      (await pickRef(services, 'Finish which task?'));
    if (!ref) return;
    try {
      const r = await finishTask(services, ref, withProgress); // [PCODE-463 | S15 | v0.1.0]
      if (r)
        info(`${r.ref} → ${r.state}. ${r.files} file(s)${r.commit ? `, commit ${r.commit}` : ''}.`);
    } catch (e) {
      await showError('Done', e, log);
    }
    await refresh();
  };

  const setStatus = async (node?: unknown): Promise<void> => {
    const ref =
      refOf(node as TreeNode | undefined, services) ??
      (await pickRef(services, 'Change the status of which task?'));
    if (!ref) return;
    const pick = await vscode.window.showQuickPick(STATUS_PICKS, {
      placeHolder: `${ref}: new status`,
    });
    if (!pick) return;
    const note = await vscode.window.showInputBox({
      prompt: `${ref} → ${pick.label}: note (optional)`,
      placeHolder: 'Why, or what is next',
    });
    if (note === undefined) return;
    try {
      const r = await withProgress(`Orqiva: ${ref} → ${pick.label}`, () =>
        engine.status(ref, pick.state, note || undefined),
      );
      info(`${r.ref} → ${r.state}.`);
    } catch (e) {
      await showError('Status', e, log);
    }
    await refresh();
  };

  const addNote = async (node?: unknown): Promise<void> => {
    const ref =
      refOf(node as TreeNode | undefined, services) ??
      (await pickRef(services, 'Add a note to which task?'));
    if (!ref) return;
    const text = await vscode.window.showInputBox({
      prompt: `Note on ${ref}`,
      placeHolder: 'Decision, blocker or progress',
    });
    if (!text?.trim()) return;
    try {
      await withProgress(`Orqiva: Note on ${ref}`, () => engine.note(ref, text.trim()));
      info(`Noted on ${ref}.`);
    } catch (e) {
      await showError('Note', e, log);
    }
  };

  const openInPlane = async (node?: unknown): Promise<void> => {
    const n = node as ItemNode | undefined;
    const url = n?.kind === 'item' ? n.item.url : store.state.active?.url;
    const fallback = store.state.link
      ? services.client.webUrl(store.state.link.project_id)
      : undefined;
    const target = url ?? fallback;
    if (!target) return;
    await vscode.env.openExternal(vscode.Uri.parse(target));
  };

  // [PCODE-23 | S04 | v0.1.0] New task opens the form panel (deps.openNewTask) - no more input boxes
  const newTask = async (): Promise<void> => {
    if (deps.openNewTask) deps.openNewTask();
    else info('The New task form is not available in this context.');
    await Promise.resolve();
  };

  return {
    'orqiva.sync': sync,
    'orqiva.startTask': startTask,
    'orqiva.doneTask': doneTask,
    'orqiva.setStatus': setStatus,
    'orqiva.addNote': addNote,
    'orqiva.openInPlane': openInPlane,
    'orqiva.newTask': newTask,
  };
}

export function registerTaskCommands(
  context: vscode.ExtensionContext,
  deps: TaskCommandDeps,
): Record<string, (...args: unknown[]) => Promise<void>> {
  const cmds = createTaskCommands(deps);
  for (const [id, fn] of Object.entries(cmds)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, (...args: unknown[]) => {
        void fn(...args);
      }),
    );
  }
  return cmds;
}

// ── [PCODE-22 | S04 | v0.1.0] panelRunner: the panel's buttons run exactly the tree's commands ──
//    (they show their own notifications; the panel also gets the error inline through handlePanelAction)
export function panelRunner(deps: TaskCommandDeps): {
  start(ref: string): Promise<void>;
  done(ref: string): Promise<void>;
  status(ref: string, state: 'review' | 'test' | 'blocked' | 'todo', note?: string): Promise<void>;
  note(ref: string, text: string): Promise<void>;
} {
  const { engine, log } = deps.services;
  const wrap = async <T>(
    action: string,
    fn: () => Promise<T>,
    ok: (r: T) => string,
  ): Promise<void> => {
    try {
      const r = await withProgress(`Orqiva: ${action}`, fn);
      info(ok(r));
    } catch (e) {
      await showError(action, e, log);
      throw e;
    } finally {
      await deps.refresh();
    }
  };
  return {
    start: (ref) =>
      wrap(
        `Start ${ref}`,
        () => engine.start(ref),
        (r) => `${r.ref} started (${r.from} → ${r.to}). Fingerprint: ${r.fingerprint}`,
      ),
    // [PCODE-463 | S15 | v0.1.0] Finished on a card: with the way on when the code has no fingerprint
    done: async (ref) => {
      try {
        const r = await finishTask(deps.services, ref, withProgress);
        if (r)
          info(
            `${r.ref} → ${r.state}. ${r.files} file(s)${r.commit ? `, commit ${r.commit}` : ''}.`,
          );
      } catch (e) {
        await showError(`Done ${ref}`, e, log);
        throw e;
      } finally {
        await deps.refresh();
      }
    },
    status: (ref, state, note) =>
      wrap(
        `Status ${ref}`,
        () => engine.status(ref, state, note),
        (r) => `${r.ref} → ${r.state}.`,
      ),
    note: (ref, text) =>
      wrap(
        `Note ${ref}`,
        () => engine.note(ref, text),
        () => `Noted on ${ref}.`,
      ),
  };
}
