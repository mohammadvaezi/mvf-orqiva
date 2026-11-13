// ── [PCODE-22 | S04 | v0.1.0] Add action buttons to the task panel: Start, Done, Status, Note, Open in Plane ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the rules behind the panel buttons, kept pure so both the webview and the host tests share them:
//          which action is primary for a state, and the busy gate that ignores a second click.
import type { TaskToHost } from '../protocol';

export type PrimaryAction = 'start' | 'done' | null;

// ── [PCODE-22 | S04 | v0.1.0] primaryAction: Todo/Backlog -> Start; In Progress -> Done; Review/Test/Done -> none ──
export function primaryAction(stateName: string, group: string): PrimaryAction {
  const n = stateName.toLowerCase();
  if (group === 'completed' || group === 'cancelled') return null;
  if (n === 'in progress' || n === 'blocked') return 'done';
  if (n === 'review' || n === 'test') return null;
  if (group === 'unstarted' || group === 'backlog') return 'start';
  return null;
}

/** Labels for the host's progress titles and the notify action word. */
export const ACTION_WORD: Record<'start' | 'done' | 'status' | 'note', string> = {
  start: 'Start',
  done: 'Done',
  status: 'Status',
  note: 'Note',
};

// ── [PCODE-22 | S04 | v0.1.0] ActionGate: one action at a time; a second click while busy is ignored ──
export class ActionGate {
  private running: string | null = null;

  get busy(): boolean {
    return this.running !== null;
  }

  get current(): string | null {
    return this.running;
  }

  /** Returns false (and does nothing) when another action runs. */
  async run<T>(name: string, fn: () => Promise<T>): Promise<{ ran: boolean; result?: T }> {
    if (this.running) return { ran: false };
    this.running = name;
    try {
      return { ran: true, result: await fn() };
    } finally {
      this.running = null;
    }
  }
}

export interface PanelActionRunner {
  start(ref: string): Promise<void>;
  done(ref: string): Promise<void>;
  status(ref: string, state: 'review' | 'test' | 'blocked' | 'todo', note?: string): Promise<void>;
  note(ref: string, text: string): Promise<void>;
}

// ── [PCODE-22 | S04 | v0.1.0] handlePanelAction: host side - map a message to the runner, then reload ──
export async function handlePanelAction(
  m: TaskToHost,
  ref: string,
  runner: PanelActionRunner,
  gate: ActionGate,
  post: (
    msg:
      | { type: 'task/busy'; busy: boolean; action?: string }
      | { type: 'task/error'; message: string },
  ) => Promise<unknown>,
  reload: () => Promise<void>,
): Promise<boolean> {
  const kind =
    m.type === 'task/start'
      ? 'start'
      : m.type === 'task/done'
        ? 'done'
        : m.type === 'task/status'
          ? 'status'
          : m.type === 'task/note'
            ? 'note'
            : null;
  if (!kind) return false;
  const { ran } = await gate.run(kind, async () => {
    await post({ type: 'task/busy', busy: true, action: kind });
    try {
      if (m.type === 'task/start') await runner.start(ref);
      else if (m.type === 'task/done') await runner.done(ref);
      else if (m.type === 'task/status') await runner.status(ref, m.state, m.note);
      else if (m.type === 'task/note') await runner.note(ref, m.text);
    } catch (e) {
      await post({ type: 'task/error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      await post({ type: 'task/busy', busy: false });
    }
    await reload();
  });
  return ran;
}
