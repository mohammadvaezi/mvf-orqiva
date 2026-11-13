// ── [PCODE-9 | S02 | v0.1.0] Add typed engine commands and output parsers for list, show, active, start, done ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the only place the extension talks to the engine; every method names the subcommand it maps to.
//          The runner is injected so the wrappers are tested against the fake engine and scripted output.
import * as parse from './parse';
import type { RunResult } from './run';
import type { ActiveTask } from '../state/types';

/** `(script, args, timeoutMs?) => output`; bound to a project root + env by the composition root. */
export type EngineRunner = (
  script: string,
  args: string[],
  timeoutMs?: number,
) => Promise<RunResult>;

export interface NewTaskInput {
  title: string;
  sprint?: string;
  label?: string;
  priority?: 'urgent' | 'high' | 'medium' | 'low' | 'none';
  descFile: string;
  accept?: string[];
}

export type TaskState = 'review' | 'test' | 'blocked' | 'planned' | 'todo' | 'progress';

// ── [PCODE-9 | S02 | v0.1.0] EngineCommands: typed wrappers over plane_task.py / plane_plan.py / plane_init.py / install.py ──
export class EngineCommands {
  constructor(private readonly run: EngineRunner) {}

  /** `plane_task.py sync` — carry-over + queue flush; the "fix rule" before development. */
  async sync(): Promise<parse.SyncResult> {
    return parse.parseSync((await this.run('plane_task.py', ['sync'], 120_000)).stdout);
  }

  /** `plane_task.py list --sprint <today|next|all|name>` */
  async list(sprint = 'today'): Promise<parse.ListResult> {
    return parse.parseList((await this.run('plane_task.py', ['list', '--sprint', sprint])).stdout);
  }

  /** `plane_task.py show <REF>` */
  async show(ref: string): Promise<parse.ShowResult> {
    return parse.parseShow((await this.run('plane_task.py', ['show', ref])).stdout);
  }

  /** `plane_task.py new "<title>" --sprint … --label … --priority … --desc-file … [--accept …]` */
  async newTask(input: NewTaskInput): Promise<parse.NewResult> {
    const args = ['new', input.title, '--desc-file', input.descFile];
    if (input.sprint) args.push('--sprint', input.sprint);
    if (input.label) args.push('--label', input.label);
    if (input.priority) args.push('--priority', input.priority);
    for (const a of input.accept ?? []) args.push('--accept', a);
    return parse.parseNew((await this.run('plane_task.py', args)).stdout);
  }

  /** `plane_task.py start <REF>` */
  async start(ref: string): Promise<parse.StartResult> {
    return parse.parseStart((await this.run('plane_task.py', ['start', ref])).stdout);
  }

  /** `plane_task.py status <REF> <state> [--note …]` */
  async status(ref: string, state: TaskState, note?: string): Promise<parse.StatusResult> {
    const args = ['status', ref, state];
    if (note) args.push('--note', note);
    return parse.parseStatus((await this.run('plane_task.py', args)).stdout);
  }

  /** `plane_task.py note <REF> "<text>"` */
  async note(ref: string, text: string): Promise<void> {
    await this.run('plane_task.py', ['note', ref, text]);
  }

  /** `plane_task.py done <REF> [--no-commit] [--force]` */
  async done(
    ref: string,
    opts: { noCommit?: boolean; force?: boolean } = {},
  ): Promise<parse.DoneResult> {
    const args = ['done', ref];
    if (opts.noCommit) args.push('--no-commit');
    if (opts.force) args.push('--force');
    return parse.parseDone((await this.run('plane_task.py', args, 120_000)).stdout);
  }

  /** `plane_task.py version bump <patch|minor|major>` → "Version a -> b (tag vb)" */
  async versionBump(part: 'patch' | 'minor' | 'major'): Promise<{ from: string; to: string }> {
    const out = (await this.run('plane_task.py', ['version', 'bump', part])).stdout;
    const m = /Version (\S+) -> (\S+)/.exec(out);
    return { from: m?.[1] ?? '', to: m?.[2] ?? '' };
  }

  /** `plane_task.py active` → the active task JSON or null */
  async active(): Promise<ActiveTask | null> {
    return parse.parseActive((await this.run('plane_task.py', ['active'])).stdout);
  }

  /** `plane_plan.py check` — exit 1 with error lines is still a parsed result, not a failure */
  async planCheck(): Promise<parse.CheckResult> {
    try {
      return parse.parseCheck((await this.run('plane_plan.py', ['check'])).stdout);
    } catch (e) {
      const detail = (e as { detail?: string }).detail ?? '';
      if (/sprint\(s\)/.test(detail)) return parse.parseCheck(detail);
      throw e;
    }
  }

  /** `plane_plan.py publish --yes` */
  async planPublish(): Promise<string> {
    return (await this.run('plane_plan.py', ['publish', '--yes'], 600_000)).stdout.trim();
  }

  /** `plane_plan.py draft --print-only` — the command line the terminal will run (prompt goes through a file) */
  async planDraftPrompt(): Promise<string> {
    return (await this.run('plane_plan.py', ['draft', '--print-only'])).stdout.trim();
  }

  /** `plane_init.py --list` → [{identifier, name}] */
  async initList(): Promise<{ identifier: string; name: string }[]> {
    return JSON.parse((await this.run('plane_init.py', ['--list'])).stdout) as {
      identifier: string;
      name: string;
    }[];
  }

  /** `plane_init.py --name … [--identifier …]` */
  async initCreate(name: string, identifier?: string): Promise<string> {
    const args = ['--name', name];
    if (identifier) args.push('--identifier', identifier);
    return (await this.run('plane_init.py', args, 120_000)).stdout.trim();
  }

  /** `plane_init.py --project <IDENT>` */
  async initLink(identifier: string): Promise<string> {
    return (await this.run('plane_init.py', ['--project', identifier], 120_000)).stdout.trim();
  }

  /** `install.py [--key … --url … --workspace …]` — hooks, plane command, MCP server, DPAPI store */
  async install(opts: { key?: string; url?: string; workspace?: string } = {}): Promise<string> {
    const args: string[] = [];
    if (opts.key) args.push('--key', opts.key);
    if (opts.url) args.push('--url', opts.url);
    if (opts.workspace) args.push('--workspace', opts.workspace);
    return (await this.run('install.py', args, 300_000)).stdout.trim();
  }
}
