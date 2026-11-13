// ── [PCODE-23 | S04 | v0.1.0] Build the New task form creating items via plane new with a description file ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  host side: options from the store, submit -> description file -> plane new -> file removed (also
//          on failure) -> "Created X" with Start it -> refresh. Nothing here talks to Plane except the engine.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { EngineCommands } from '../../engine/commands';
import type { Services } from '../../services';
import { projectFile } from '../../state/files';
import { showError } from '../../commands/notify';
import { createPanel } from '../host';
import type {
  HostToNewTask,
  NewTaskInputMessage,
  NewTaskOptions,
  NewTaskToHost,
} from '../protocol';
import { descriptionFile, isValid, LABELS, PRIORITIES } from './validate';

export function newTaskOptions(services: Services): NewTaskOptions {
  const sprints = [
    { value: 'today', label: 'Today' },
    { value: 'next', label: 'Next sprint' },
  ];
  for (const s of services.store.state.sprints)
    if (!s.isToday) sprints.push({ value: s.name, label: s.name });
  return { sprints, labels: [...LABELS], priorities: [...PRIORITIES] };
}

// ── [PCODE-23 | S04 | v0.1.0] submitNewTask: pure enough to test - writes the file, calls the engine, cleans up ──
export async function submitNewTask(
  engine: Pick<EngineCommands, 'newTask'>,
  root: string,
  input: NewTaskInputMessage,
  now: () => number = Date.now,
): Promise<{ ref: string; title: string; sprint: string }> {
  if (!isValid(input)) throw new Error('The form is not complete.');
  const dir = projectFile(root, ['state']); // [PCODE-455 | S15 | v0.1.0]
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `desc-${now()}.md`);
  fs.writeFileSync(file, descriptionFile(input), 'utf8');
  try {
    const r = await engine.newTask({
      title: input.title.trim(),
      sprint: input.sprint,
      label: input.label,
      priority: input.priority as 'urgent' | 'high' | 'medium' | 'low' | 'none',
      descFile: file,
    });
    return { ref: r.ref, title: r.title, sprint: r.sprint };
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  }
}

export interface NewTaskPanelDeps {
  context: vscode.ExtensionContext;
  services: Services;
  refresh: () => Promise<void>;
  startTask: (ref: string) => Promise<void>;
}

// ── [PCODE-23 | S04 | v0.1.0] openNewTaskPanel: one panel, options pushed on open ──
export function openNewTaskPanel(deps: NewTaskPanelDeps): void {
  const { context, services } = deps;
  const { handle, created } = createPanel<NewTaskToHost, HostToNewTask>(context, {
    id: 'newTask',
    title: 'New task',
    entry: 'newTask',
    log: (l) => {
      services.log.warn(l);
    },
  });
  const pushOptions = (): Thenable<boolean> =>
    handle.post({ type: 'new/options', options: newTaskOptions(services) });
  if (!created) {
    void pushOptions();
    return;
  }
  void pushOptions();
  handle.onMessage((m) => {
    void (async () => {
      if (m.type === 'new/cancel') {
        handle.panel.dispose();
        return;
      }
      if (m.type === 'new/start') {
        await deps.startTask(m.ref);
        return;
      }
      // m.type === 'new/submit'
      {
        const root = services.root();
        if (!root) return;
        await handle.post({ type: 'new/busy', busy: true });
        try {
          const r = await submitNewTask(services.engine, root, m.input);
          await handle.post({ type: 'new/created', ref: r.ref, title: r.title, sprint: r.sprint });
          const pick = await vscode.window.showInformationMessage(
            `Created ${r.ref} ${r.title} in ${r.sprint}.`,
            'Start it',
          );
          if (pick === 'Start it') await deps.startTask(r.ref);
        } catch (e) {
          await handle.post({
            type: 'new/error',
            message: e instanceof Error ? e.message : String(e),
          });
          await showError('New task', e, services.log);
        }
        await deps.refresh();
      }
    })();
  });
}
