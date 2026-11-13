// ── [PCODE-194 | S15 | v0.1.0] B8.2 VS Code: agents view and runs, findings as problems, code-map lens, test results per criterion ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Why:  the loop buttons on Orqiva. A folder linked with `orq link` runs sync, start, status, note,
//          new and done through the orq loop itself, in-process (no Python, no Plane): the same client key,
//          the same .orqiva/state/active.json, so a task started in VS Code is the one the terminal and
//          the Claude Code hooks see. A Plane-linked folder keeps the engine until Plane retires (T06).
//          Results come back in the shapes the commands already show.
import { homedir, hostname } from 'node:os';
import { resolve } from 'node:path';
import { spawnExec } from '../../../cli/src/install/exec';
import { loadActive, loadLink } from '../../../cli/src/loop/config';
import { linked, runLoop, type LoopDeps } from '../../../cli/src/loop/commands';
import { runTests } from '../../../cli/src/tests/command'; // [PCODE-194 | S15 | v0.1.0]
import {
  EngineCommands,
  type EngineRunner,
  type NewTaskInput,
  type TaskState,
} from '../engine/commands';
import type * as parse from '../engine/parse';
import { activeFromPe } from '../state/files';
import type { ActiveTask } from '../state/types';
import { OrqivaError } from '../util/errors';

export interface LoopCommandsOptions {
  /** the project root, if the workspace has one */
  root: () => string | null;
  deps?: Partial<LoopDeps>;
}

export class LoopCommands extends EngineCommands {
  constructor(
    run: EngineRunner,
    private readonly opts: LoopCommandsOptions,
  ) {
    super(run);
  }

  /** The orq root when the workspace's project is on Orqiva, else null (the engine handles it). */
  private serverRoot(): string | null {
    const root = this.opts.root();
    return root && loadLink(root) ? root : null;
  }

  private deps(root: string): LoopDeps {
    return {
      cwd: root,
      home: homedir(),
      hostname: hostname(),
      exec: spawnExec,
      env: process.env,
      ...this.opts.deps,
    };
  }

  private async pe(root: string, argv: string[]): Promise<string> {
    const r = await runLoop(argv, this.deps(root));
    if (!r) throw new OrqivaError('Unknown orq command: ' + argv.join(' '));
    if (r.code !== 0) throw new OrqivaError(r.out.split('\n')[0] ?? 'orq failed', 'engine', r.out);
    return r.out;
  }

  private activeRef(root: string): { ref: string; title: string } | null {
    const a = loadActive(root);
    return a ? { ref: a.ref, title: a.title } : null;
  }

  override async sync(): Promise<parse.SyncResult> {
    const root = this.serverRoot();
    if (!root) return super.sync();
    await this.pe(root, ['sync']);
    return { carried: 0, promoted: 0, active: this.activeRef(root) };
  }

  override async list(sprint = 'today'): Promise<parse.ListResult> {
    const root = this.serverRoot();
    if (!root) return super.list(sprint);
    const l = linked(this.deps(root));
    const rows = await l.api.call<
      { ref: string; title: string; state: string; sprint: string | null }[]
    >('GET', l.ws + '/loop/open?project=' + l.link.projectKey);
    const sprints: parse.ListSprint[] = [];
    for (const r of rows) {
      const name = r.sprint ?? 'Backlog';
      let s = sprints.find((x) => x.name === name);
      if (!s) sprints.push((s = { name, date: '', items: [] }));
      s.items.push({ ref: r.ref, state: r.state, priority: 'none', title: r.title });
    }
    return { sprints, active: this.activeRef(root) };
  }

  override async show(ref: string): Promise<parse.ShowResult> {
    const root = this.serverRoot();
    if (!root) return super.show(ref);
    const l = linked(this.deps(root));
    const t = await l.api.call<{
      task: { id: string; ref: string; title: string; state: string; description: string };
    }>('GET', l.ws + '/loop/tasks/' + encodeURIComponent(ref));
    const [comments, code] = await Promise.all([
      l.api.call<{ body: string; createdAt: string }[]>(
        'GET',
        l.ws + '/items/' + t.task.id + '/comments',
      ),
      l.api.call<{ path: string; line: number; kind: string }[]>(
        'GET',
        l.ws + '/items/' + t.task.id + '/fingerprints',
      ),
    ]);
    return {
      ref: t.task.ref,
      title: t.task.title,
      state: t.task.state,
      priority: 'none',
      url: l.link.server.replace(/\/$/, '') + '/items/' + t.task.id,
      description: t.task.description,
      acceptance: [...t.task.description.matchAll(/^\s*- \[( |x)\] (.+)$/gim)].map((m) => ({
        text: m[2] ?? '',
        done: m[1]?.toLowerCase() === 'x',
      })),
      comments: comments.map((c) => ({ date: c.createdAt.slice(0, 10), text: c.body })),
      files: code.map((f) => ({ file: f.path, line: f.line, kind: f.kind })),
    };
  }

  override async newTask(input: NewTaskInput): Promise<parse.NewResult> {
    const root = this.serverRoot();
    if (!root) return super.newTask(input);
    const argv = ['new', input.title, '--desc-file', resolve(root, input.descFile)];
    const out = await this.pe(root, argv);
    const ref = /Created (\S+)/.exec(out)?.[1] ?? '';
    const link = loadLink(root);
    return { ref, title: input.title, sprint: '', url: link ? link.server : '' };
  }

  override async start(ref: string): Promise<parse.StartResult> {
    const root = this.serverRoot();
    if (!root) return super.start(ref);
    const out = await this.pe(root, ['start', ref]);
    const a = loadActive(root);
    return {
      ref: a?.ref ?? ref,
      title: a?.title ?? '',
      from: out.startsWith('Resumed') ? 'In Progress' : '',
      to: 'In Progress',
      fingerprint: a?.marker ?? '',
    };
  }

  override async status(ref: string, state: TaskState, note?: string): Promise<parse.StatusResult> {
    const root = this.serverRoot();
    if (!root) return super.status(ref, state, note);
    // the engine's "planned" is the server's backlog
    const argv = ['status', ref, state === 'planned' ? 'backlog' : state];
    if (note) argv.push('--note', note);
    const out = await this.pe(root, argv);
    return { ref: ref.toUpperCase(), state: /→ ([^(]+)/.exec(out)?.[1]?.trim() ?? state };
  }

  override async note(ref: string, text: string): Promise<void> {
    const root = this.serverRoot();
    if (!root) return super.note(ref, text);
    await this.pe(root, ['note', ref, text]);
  }

  override async done(
    ref: string,
    opts: { noCommit?: boolean; force?: boolean } = {},
  ): Promise<parse.DoneResult> {
    const root = this.serverRoot();
    if (!root) return super.done(ref, opts);
    const argv = ['done', ref];
    if (opts.noCommit) argv.push('--no-commit');
    if (opts.force) argv.push('--force');
    const out = await this.pe(root, argv);
    const m = /^(\S+) → (.+?): (\d+) file\(s\) fingerprinted(?:, commit ([0-9a-f]+))?/.exec(out);
    return {
      ref: m?.[1] ?? ref,
      state: m?.[2] ?? '',
      files: Number(m?.[3] ?? 0),
      commit: m?.[4] ?? null,
    };
  }

  override async active(): Promise<ActiveTask | null> {
    const root = this.serverRoot();
    if (!root) return super.active();
    const a = loadActive(root);
    const link = loadLink(root);
    return a && link ? activeFromPe(a, link.server) : null;
  }

  // ── [PCODE-194 | S15 | v0.1.0] run a test command and report each result to Orqiva, as orq test run ──
  async runTests(
    command: string,
    print: (line: string) => void,
  ): Promise<{ code: number; summary: string }> {
    const root = this.serverRoot();
    if (!root)
      throw new OrqivaError('Test results go to Orqiva: link the folder with orq link first.');
    const r = await runTests(['test', 'run', '--', command], { ...this.deps(root), print });
    return { code: r.code, summary: r.out.split('\n')[0] ?? '' };
  }
}
