// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
//    Why:  time without leaving the editor: the status bar shows the running timer (task and clock) or
//          today's hours, and a click starts the timer on the active task or stops it. It is the same
//          timer as on the web; the IDE session of orq start / orq done records time by itself anyway.
//          The clock counts locally; the server is asked only on start, on an action and on focus.
import * as vscode from 'vscode';
import type { Api } from '../../../cli/src/loop/api';

export interface TimerSource {
  api: Api;
  workspaceId: string;
}

interface WeekJson {
  days: string[];
  perDay: number[];
  total: number;
  timer: { title: string; itemRef: string | null; startedAt: string } | null;
}

export interface TimerView {
  running: { label: string; startedAt: number } | null;
  todayMinutes: number;
  weekMinutes: number;
}

/** h:mm:ss of a running clock. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number): string => String(n).padStart(2, '0');
  return String(Math.floor(s / 3600)) + ':' + two(Math.floor((s % 3600) / 60)) + ':' + two(s % 60);
}

/** Minutes as hours, the way Orqiva writes them: 5,75 h. */
export const hoursText = (m: number): string =>
  (m / 60).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' h';

/** What the status bar shows, from the week as the server answers it. */
export function timerViewOf(week: WeekJson, today: string): TimerView {
  const i = week.days.indexOf(today);
  return {
    running: week.timer
      ? {
          label: (week.timer.itemRef ? week.timer.itemRef + ' ' : '') + week.timer.title,
          startedAt: Date.parse(week.timer.startedAt),
        }
      : null,
    todayMinutes: i >= 0 ? (week.perDay[i] ?? 0) : 0,
    weekMinutes: week.total,
  };
}

export class TimerStatus implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9);
  private view: TimerView | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly source: () => TimerSource | null) {
    this.item.command = 'orqiva.timerToggle';
    this.subs.push(
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused) void this.refresh();
      }),
    );
  }

  get running(): boolean {
    return Boolean(this.view?.running);
  }

  async refresh(): Promise<void> {
    const src = this.source();
    if (!src) {
      this.view = null;
      this.item.hide();
      this.stopTick();
      return;
    }
    try {
      const week = await src.api.call<WeekJson>(
        'GET',
        '/api/workspaces/' + src.workspaceId + '/time/week',
      );
      this.view = timerViewOf(week, new Date().toISOString().slice(0, 10));
    } catch {
      return;
    }
    this.render();
    if (this.view.running) this.startTick();
    else this.stopTick();
  }

  /** Starts the timer on a task, or stops the running one. */
  async toggle(itemId: string | null): Promise<string> {
    const src = this.source();
    if (!src) return 'Time needs the folder linked to Orqiva.';
    const W = '/api/workspaces/' + src.workspaceId;
    if (this.view?.running) {
      const r = await src.api.call<{ minutes: number }>('POST', W + '/time/timer/stop', {});
      await this.refresh();
      return 'Timer stopped: ' + hoursText(r.minutes) + ' booked.';
    }
    if (!itemId) return 'Start a task first; the timer runs on the active task.';
    await src.api.call('POST', W + '/time/timer', { itemId });
    await this.refresh();
    return 'Timer started.';
  }

  private render(): void {
    const v = this.view;
    if (!v) return;
    if (v.running) {
      this.item.text = '$(watch) ' + clockText(Date.now() - v.running.startedAt);
      this.item.tooltip =
        'Timer on ' +
        v.running.label +
        '\nToday ' +
        hoursText(v.todayMinutes) +
        ' · this week ' +
        hoursText(v.weekMinutes) +
        '\nClick to stop';
    } else {
      this.item.text = '$(watch) ' + hoursText(v.todayMinutes);
      this.item.tooltip =
        'Today ' +
        hoursText(v.todayMinutes) +
        ' · this week ' +
        hoursText(v.weekMinutes) +
        '\nClick to start the timer on the active task';
    }
    this.item.show();
  }

  private startTick(): void {
    if (this.tick) return;
    this.tick = setInterval(() => {
      this.render();
    }, 1000);
  }

  private stopTick(): void {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }

  dispose(): void {
    this.stopTick();
    for (const s of this.subs) s.dispose();
    this.item.dispose();
  }
}
