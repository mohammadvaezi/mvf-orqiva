// ── [PCODE-195 | S15 | v0.1.0] B8.3 CLI parity: inbox, approvals, comments, time, agents and ideas from the terminal, offline queue ──
// ── [PCODE-194 | S15 | v0.1.0] B8.2 VS Code: agents view and runs, findings as problems, code-map lens, test results per criterion ──
//    Why:  the project's agents at work, in VS Code as on the web: each run (who, on which task, its
//          state) with the steps it took, worded the way the web's trace words them. A run is asked for on
//          the active task, stopped, and all agents are paused or resumed (admin) without a browser. The
//          list is read again when the live stream reports a run changing; open runs keep their steps fresh.
import { stepLabel } from '@orqiva/shared';
import * as vscode from 'vscode';
import type { Api } from '../../../cli/src/loop/api';

export interface AgentsSource {
  api: Api;
  workspaceId: string;
  projectId: string;
  server: string;
}

export interface RunJson {
  id: string;
  agentId: string;
  agentName: string;
  itemId: string | null;
  itemRef: string | null;
  instruction: string;
  status: string;
  error: string;
  summary: string;
  costMicros: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
export interface StepJson {
  seq: number;
  kind: string;
  content: Record<string, unknown>;
  at: string;
}
export interface AgentJson {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

const ACTIVE = ['queued', 'running', 'waiting'];
export const isActiveRun = (r: Pick<RunJson, 'status'>): boolean => ACTIVE.includes(r.status);

const RUN_ICON: Record<string, [string, string?]> = {
  queued: ['clock'],
  running: ['sync~spin'],
  waiting: ['shield', 'editorWarning.foreground'],
  succeeded: ['pass', 'testing.iconPassed'],
  failed: ['error', 'errorForeground'],
  cancelled: ['circle-slash'],
};

// [PCODE-195 | S15 | v0.1.0] the wording lives in shared, so the web and orq agent watch say the same
export { stepLabel };

/** A run's line: agent, task, and what it is doing or did. */
export function runLabel(r: RunJson): { label: string; description: string } {
  return {
    label: r.agentName + (r.itemRef ? ' · ' + r.itemRef : ''),
    description:
      r.status === 'waiting'
        ? 'waits for your approval'
        : r.status === 'failed' && r.error
          ? 'failed: ' + r.error.slice(0, 60)
          : r.summary
            ? r.status + ': ' + r.summary.slice(0, 60)
            : r.status,
  };
}

/** The runs list: active ones first, then the latest finished, at most 30. */
export function orderRuns(runs: readonly RunJson[]): RunJson[] {
  const active = runs.filter(isActiveRun);
  const done = runs.filter((r) => !isActiveRun(r));
  return [...active, ...done].slice(0, 30);
}

export class AgentsModel implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<RunJson | undefined>();
  readonly onDidChange = this.emitter.event;
  private list: RunJson[] = [];
  private readonly steps = new Map<string, StepJson[]>();
  private loading: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly source: () => AgentsSource | null) {}

  runs(): RunJson[] {
    return this.list;
  }

  /** The steps of a run, read once and again while the run goes on. */
  async stepsOf(run: RunJson): Promise<StepJson[]> {
    const known = this.steps.get(run.id);
    if (known && !isActiveRun(run)) return known;
    const src = this.source();
    if (!src) return [];
    try {
      const r = await src.api.call<{ run: RunJson; steps: StepJson[] }>(
        'GET',
        '/api/workspaces/' + src.workspaceId + '/agent-runs/' + run.id,
      );
      this.steps.set(run.id, r.steps);
      return r.steps;
    } catch {
      return known ?? [];
    }
  }

  refreshSoon(ms = 400): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, ms);
  }

  refresh(): Promise<void> {
    if (this.loading) return this.loading;
    const src = this.source();
    if (!src) {
      this.list = [];
      this.emitter.fire(undefined);
      return Promise.resolve();
    }
    this.loading = src.api
      .call<RunJson[]>(
        'GET',
        '/api/workspaces/' + src.workspaceId + '/agent-runs?projectId=' + src.projectId,
      )
      .then((runs) => {
        this.list = orderRuns(runs);
        this.emitter.fire(undefined);
      })
      .catch(() => undefined)
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  async agents(): Promise<AgentJson[]> {
    const src = this.source();
    if (!src) return [];
    const all = await src.api.call<AgentJson[]>(
      'GET',
      '/api/workspaces/' + src.workspaceId + '/agents',
    );
    return all.filter((a) => a.enabled);
  }

  /** Asks an agent to work on a task (or on the project when there is none). */
  async ask(agentId: string, instruction: string, itemId: string | null): Promise<RunJson> {
    const src = this.need();
    const run = await src.api.call<RunJson>(
      'POST',
      '/api/workspaces/' + src.workspaceId + '/projects/' + src.projectId + '/agent-runs',
      { agentId, instruction, ...(itemId ? { itemId } : {}) },
    );
    await this.refresh();
    return run;
  }

  async cancel(run: RunJson): Promise<void> {
    const src = this.need();
    await src.api.call(
      'POST',
      '/api/workspaces/' + src.workspaceId + '/agent-runs/' + run.id + '/cancel',
      {},
    );
    await this.refresh();
  }

  /** Pauses every agent of the workspace, or resumes them (admin). */
  async pauseAll(paused: boolean): Promise<void> {
    const src = this.need();
    await src.api.call('PUT', '/api/workspaces/' + src.workspaceId + '/agents/pause', { paused });
  }

  urlOf(run: RunJson): string | null {
    const src = this.source();
    return src ? src.server.replace(/\/$/, '') + '/runs/' + run.id : null;
  }

  private need(): AgentsSource {
    const src = this.source();
    if (!src) throw new Error('Agents need the folder linked to Orqiva (orq link).');
    return src;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.emitter.dispose();
  }
}

export type AgentNode = { run: RunJson } | { run: RunJson; step: StepJson };

export class AgentsTreeProvider implements vscode.TreeDataProvider<AgentNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<AgentNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly sub: vscode.Disposable;

  constructor(private readonly model: AgentsModel) {
    this.sub = model.onDidChange(() => {
      this.emitter.fire(undefined);
    });
  }

  async getChildren(element?: AgentNode): Promise<AgentNode[]> {
    if (!element) return this.model.runs().map((run) => ({ run }));
    if ('step' in element) return [];
    return (await this.model.stepsOf(element.run)).map((step) => ({ run: element.run, step }));
  }

  getTreeItem(n: AgentNode): vscode.TreeItem {
    if ('step' in n) {
      const label = stepLabel(n.step);
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      item.id = 'step-' + n.run.id + '-' + String(n.step.seq);
      item.description = n.step.at.slice(11, 19);
      item.tooltip = label;
      item.iconPath = new vscode.ThemeIcon(
        n.step.kind === 'model'
          ? 'sparkle'
          : n.step.kind === 'tool_result'
            ? 'tools'
            : n.step.kind === 'error'
              ? 'error'
              : n.step.kind === 'approval' || n.step.kind === 'decision'
                ? 'person'
                : 'note',
      );
      return item;
    }
    const r = n.run;
    const { label, description } = runLabel(r);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = 'run-' + r.id;
    item.description = description;
    item.tooltip = label + '\n' + r.instruction + '\n' + description;
    const [icon, color] = RUN_ICON[r.status] ?? ['robot'];
    item.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
    item.contextValue = isActiveRun(r) ? 'agent-run-active' : 'agent-run';
    item.accessibilityInformation = { label: label + ', ' + description };
    return item;
  }

  dispose(): void {
    this.sub.dispose();
    this.emitter.dispose();
  }
}
