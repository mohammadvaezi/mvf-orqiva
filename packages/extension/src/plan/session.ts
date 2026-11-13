// ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
// ── [PCODE-461 | S15 | v0.1.0] Planning in VS Code shows what Claude writes right now: file and size live, failed tools as steps ──
// ── [PCODE-459 | S15 | v0.1.0] Planning in VS Code locks the project in the portal: banner on every tab, conflicting AI planning refused both ways ──
// ── [PCODE-457 | S15 | v0.1.0] VS Code planning as a conversation: Claude asks, the user answers with text and files, then the plan; replan and description change work; Home tab explains itself ──
//    Why:  the one place that drives the planning conversation for a folder: a round of questions, the
//          answers, a note, the plan written from it, plan it again, stop. It runs Claude headless, keeps
//          the steps for the Home tab, writes the conversation files and keeps the portal's live run in
//          step (opened with the first round, a note per round, ended with the plan). Free of vscode:
//          the Home panel and the commands call it, tests drive it with a fake Claude.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '../util/log';
import { projectDir, projectFile, projectRel, planePath } from '../state/files';
import { buildPrompt } from './draft';
import { ORQIVA_PLAN_PROMPT } from './orqivaPlan';
import { descriptionPath, descriptionStatus } from './planService';
import {
  addUsage,
  headlessArgs,
  runClaude,
  type ClaudeRun,
  type ClaudeRunOptions,
  type RunUsage,
} from './claudeRun';
import {
  addNote,
  hashText,
  INTERVIEW_PROMPT,
  INTERVIEW_TASK,
  interviewState,
  newInterview,
  openQuestions,
  parseReply,
  planTask,
  PREVIOUS_PLAN,
  readInterview,
  recordAnswers,
  recordReply,
  stamp,
  writeInterview,
  type Answer,
  type Interview,
} from './interview';
import { endPlanningRun, PlanningConflict, startPlanningRun, type PortalDeps } from './portal';
import { linkPlanRequests, readBindingFile } from '../server/binding';
import {
  addRunNote,
  finishPlanRun,
  openRunId,
  planTarget,
  type PlanTarget,
} from '../server/planSync';
import type { PlanJson } from '../state/types';

export type Phase = 'idle' | 'asking' | 'writing';

export interface SessionView {
  phase: Phase;
  /** what Claude did in this run, newest last */
  steps: string[];
  startedAt: string | null;
  error: string | null;
  /** [PCODE-461 | S15 | v0.1.0] what Claude does this moment: the file it writes and how far, or thinking */
  live?: string | null;
}

export interface SessionDeps {
  log: Pick<Logger, 'info' | 'warn'>;
  /** the folder and its project; null when no folder is linked */
  folder: () => { root: string; name: string; identifier: string; orqiva: boolean } | null;
  claudeCommand: () => string;
  /** the portal's live run (only for a folder on an Orqiva server); injected for tests */
  portal?: Omit<PortalDeps, 'log'>;
  run?: (o: ClaudeRunOptions) => ClaudeRun;
  now?: () => Date;
}

const INTERVIEW_PROMPT_FILE = ['state', 'interview_prompt.txt'] as const;
const PLAN_PROMPT_FILE = ['state', 'plan_prompt.txt'] as const;
const MAX_STEPS = 12;

export class PlanningSession {
  private view: SessionView = { phase: 'idle', steps: [], startedAt: null, error: null };
  private current: ClaudeRun | null = null;
  private live: PlanTarget | null = null;
  /** [PCODE-466 | S15 | v0.1.0] the tokens of the conversation so far, for its run in the portal */
  private usage: RunUsage | undefined;
  private readonly listeners = new Set<() => void>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: SessionDeps) {}

  get state(): SessionView {
    return this.view;
  }

  onDidChange(fn: () => void): { dispose: () => void } {
    this.listeners.add(fn);
    return { dispose: () => this.listeners.delete(fn) };
  }

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  private changed(soon = false): void {
    // the steps come fast: the Home tab is redrawn at most twice a second for them
    if (soon) {
      this.timer ??= setTimeout(() => {
        this.timer = null;
        this.listeners.forEach((f) => {
          f();
        });
      }, 500);
      return;
    }
    this.listeners.forEach((f) => {
      f();
    });
  }

  private set(v: Partial<SessionView>): void {
    this.view = { ...this.view, ...v };
    this.changed();
  }

  private folder(): {
    root: string;
    name: string;
    identifier: string;
    orqiva: boolean;
    description: string;
  } {
    const f = this.deps.folder();
    if (!f) throw new Error('Link this folder to an Orqiva project first.');
    const file = descriptionPath(f.root);
    const description = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (descriptionStatus(description || null) !== 'written')
      throw new Error('Write the description first.');
    // [PCODE-467 | S15 | v0.1.0] planned for someone: the client, or internal on purpose
    if (f.orqiva && !readBindingFile(f.root))
      throw new Error(
        'Choose the client this project is for (or mark it as internal) above the description, then save.',
      );
    return { ...f, description };
  }

  private portal(): PortalDeps | null {
    return this.deps.folder()?.orqiva ? { log: this.deps.log, ...this.deps.portal } : null;
  }

  /** The next thing to do: a round when Claude has to read, the plan when the conversation is clear. */
  async next(): Promise<void> {
    if (this.view.phase !== 'idle') return;
    const f = this.folder();
    const iv = readInterview(f.root);
    const state = interviewState(iv, hashText(f.description));
    if (state === 'asking') return;
    if (state === 'clear') await this.writePlan();
    else await this.ask();
  }

  // ── [PCODE-457 | S15 | v0.1.0] the portal's run: opened with the first round, a note for every turn ──
  private async note(text: string): Promise<void> {
    const p = this.portal();
    const f = this.deps.folder();
    if (!p || !f) return;
    try {
      if (!this.live || !openRunId(f.root)) this.live = await startPlanningRun(f.root, p);
      const id = openRunId(f.root);
      if (this.live && id) await addRunNote(this.live, id, text, p.fetchImpl);
    } catch (e) {
      // [PCODE-459 | S15 | v0.1.0] planned elsewhere right now: the round does not start
      if (e instanceof PlanningConflict) throw e;
      this.deps.log.warn('the planning run could not be updated in Orqiva: ' + String(e));
    }
  }

  private writePrompt(
    root: string,
    name: string,
    identifier: string,
    file: readonly string[],
    template: string,
  ): string {
    const built = buildPrompt({ name, identifier, template, today: this.now() });
    const abs = projectFile(root, file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, built.prompt, 'utf8');
    return projectRel(root, file);
  }

  private async claude(
    job: 'interview' | 'plan',
    root: string,
    promptRel: string,
    task: string,
  ): Promise<{ text: string; isError: boolean; stderr: string }> {
    const run = (this.deps.run ?? runClaude)({
      command: this.deps.claudeCommand(),
      args: headlessArgs(job, promptRel),
      cwd: root,
      input: task,
      onStep: (s) => {
        this.view = { ...this.view, steps: [...this.view.steps, s].slice(-MAX_STEPS) };
        this.changed(true);
      },
      // [PCODE-461 | S15 | v0.1.0]
      onLive: (l) => {
        this.view = { ...this.view, live: l };
        this.changed(true);
      },
    });
    this.current = run;
    try {
      const out = await run.done;
      this.usage = addUsage(this.usage, out.usage); // [PCODE-466 | S15 | v0.1.0]
      return out;
    } finally {
      this.current = null;
    }
  }

  private guard(): void {
    if (this.view.phase !== 'idle') throw new Error('Claude is still working on the plan.');
  }

  // ── [PCODE-457 | S15 | v0.1.0] ask: one round - Claude reads everything and asks, or says it is clear ──
  async ask(): Promise<void> {
    this.guard();
    const f = this.folder();
    const hash = hashText(f.description);
    let iv = readInterview(f.root) ?? newInterview(hash);
    if (openQuestions(iv)) return; // the questions on screen still wait for answers
    this.set({
      phase: 'asking',
      steps: [],
      startedAt: this.now().toISOString(),
      error: null,
      live: null,
    });
    try {
      writeInterview(f.root, iv, this.now()); // conversation.md is there before Claude reads it
      await this.note(
        iv.entries.length ? 'Claude reads the answers' : 'Claude reads the description',
      );
      const promptRel = this.writePrompt(
        f.root,
        f.name,
        f.identifier,
        INTERVIEW_PROMPT_FILE,
        INTERVIEW_PROMPT,
      );
      const out = await this.claude('interview', f.root, promptRel, INTERVIEW_TASK);
      if (this.view.error === 'stopped') return;
      const reply = out.isError ? null : parseReply(out.text);
      if (!reply) throw new Error(failure(out, 'Claude did not answer with its questions'));
      iv = recordReply(iv, reply, hash, this.now());
      writeInterview(f.root, iv, this.now());
      await this.note(
        reply.status === 'clear'
          ? 'Claude has what it needs: ' + reply.understanding.slice(0, 300)
          : 'Claude asks ' + String(reply.questions.length) + ' question(s) in VS Code',
      );
      this.set({ phase: 'idle', error: null, live: null });
    } catch (e) {
      this.set({ phase: 'idle', error: e instanceof Error ? e.message : String(e), live: null });
    }
  }

  /** The user's answers (and anything they added under "_more"), then the next round. */
  async answer(answers: Record<string, Answer>): Promise<void> {
    this.guard();
    const f = this.folder();
    const iv = readInterview(f.root);
    if (!iv || !openQuestions(iv)) throw new Error('There are no questions to answer.');
    writeInterview(f.root, recordAnswers(iv, answers, this.now()), this.now());
    await this.note('The user answered in VS Code');
    await this.ask();
  }

  /** Something the user wants Claude to know, then a round. */
  async addNote(text: string, files: string[] = []): Promise<void> {
    this.guard();
    const f = this.folder();
    const iv = closeOpen(
      readInterview(f.root) ?? newInterview(hashText(f.description)),
      this.now(),
    );
    if (text.trim() || files.length)
      writeInterview(f.root, addNote(iv, text, files, this.now()), this.now());
    await this.ask();
  }

  /** The description was saved: when it changed after a conversation or a plan, Claude reads it again. */
  async descriptionChanged(before: string | null): Promise<void> {
    const f = this.deps.folder();
    if (!f || this.view.phase !== 'idle') return;
    const file = descriptionPath(f.root);
    const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (descriptionStatus(now || null) !== 'written') return;
    const iv = readInterview(f.root);
    const hadPlan = fs.existsSync(planePath(f.root, 'plan'));
    if (before !== null && hashText(before) === hashText(now)) {
      // saved unchanged: only a project with nothing yet starts its first round
      if (!iv && !hadPlan) await this.ask();
      return;
    }
    if (iv || hadPlan)
      writeInterview(
        f.root,
        addNote(
          closeOpen(iv ?? newInterview(hashText(before ?? '')), this.now()),
          'The user changed the description.',
          [],
          this.now(),
        ),
        this.now(),
      );
    await this.ask();
  }

  // ── [PCODE-457 | S15 | v0.1.0] writePlan: the plan from the description and the whole conversation ──
  async writePlan(): Promise<void> {
    this.guard();
    const f = this.folder();
    const iv: Interview = readInterview(f.root) ?? newInterview(hashText(f.description));
    if (interviewState(iv, hashText(f.description)) === 'asking')
      throw new Error("Answer Claude's questions first, or skip them.");
    this.set({
      phase: 'writing',
      steps: [],
      startedAt: this.now().toISOString(),
      error: null,
      live: null,
    });
    try {
      writeInterview(f.root, iv, this.now());
      await this.note('Claude writes the plan');
      const promptRel = this.writePrompt(
        f.root,
        f.name,
        f.identifier,
        PLAN_PROMPT_FILE,
        ORQIVA_PLAN_PROMPT,
      );
      const dir = projectDir(f.root);
      const previous = fs.existsSync(projectFile(f.root, PREVIOUS_PLAN));
      const planFile = planePath(f.root, 'plan');
      const before = fs.existsSync(planFile) ? fs.statSync(planFile).mtimeMs : 0;
      const out = await this.claude('plan', f.root, promptRel, planTask(dir, previous));
      if (this.view.error === 'stopped') return;
      const written = fs.existsSync(planFile) && fs.statSync(planFile).mtimeMs !== before;
      if (written) writeInterview(f.root, { ...iv, planOf: stamp(iv) }, this.now());
      await this.endRun();
      if (!written) throw new Error(failure(out, 'Claude finished without writing the plan'));
      this.set({ phase: 'idle', error: null, live: null });
    } catch (e) {
      this.set({ phase: 'idle', error: e instanceof Error ? e.message : String(e), live: null });
    }
  }

  /** Plan it again: the old plan is set aside, the wish is noted, and Claude reads everything again. */
  async replan(wish: string): Promise<void> {
    this.guard();
    const f = this.folder();
    const plan = planePath(f.root, 'plan');
    if (fs.existsSync(plan)) {
      const prev = projectFile(f.root, PREVIOUS_PLAN);
      fs.mkdirSync(path.dirname(prev), { recursive: true });
      fs.renameSync(plan, prev);
    }
    const iv = readInterview(f.root) ?? newInterview(hashText(f.description));
    writeInterview(
      f.root,
      addNote(
        iv,
        wish.trim() ? 'Plan it again. What should change: ' + wish.trim() : 'Plan it again.',
        [],
        this.now(),
      ),
      this.now(),
    );
    await this.ask();
  }

  /** Skip the remaining questions: Claude decides what is open, then writes the plan. */
  async skipQuestions(): Promise<void> {
    this.guard();
    const f = this.folder();
    const iv = closeOpen(
      readInterview(f.root) ?? newInterview(hashText(f.description)),
      this.now(),
    );
    writeInterview(
      f.root,
      {
        ...iv,
        descriptionHash: hashText(f.description),
        entries: [
          ...iv.entries,
          {
            kind: 'clear',
            at: this.now().toISOString(),
            understanding:
              'The user skipped the remaining questions: Claude decides what is open and notes it in architecture.md.',
          },
        ],
      },
      this.now(),
    );
    await this.writePlan();
  }

  // ── [PCODE-467 | S15 | v0.1.0] mapTasks: a plan published before its client was known, mapped to the requests ──
  //    Claude reads the plan and the client's requests and says which tasks serve which request (read-only);
  //    plan.json keeps it, and the published tasks are linked on the server.
  async mapTasks(): Promise<{ mapped: number; unrequested: number }> {
    this.guard();
    const f = this.folder();
    const planFile = planePath(f.root, 'plan');
    const binding = readBindingFile(f.root);
    if (!fs.existsSync(planFile) || !binding?.requests.length) return { mapped: 0, unrequested: 0 };
    this.set({ phase: 'asking', steps: [], startedAt: this.now().toISOString(), error: null });
    try {
      const promptRel = this.writePrompt(f.root, f.name, f.identifier, MAP_PROMPT_FILE, MAP_PROMPT);
      const out = await this.claude('interview', f.root, promptRel, MAP_TASK);
      const reply = parseMapping(out.text);
      if (!reply)
        throw new Error('Claude did not answer with the mapping: ' + out.text.slice(0, 200));
      const known = new Set(binding.requests.map((r) => r.ref.toUpperCase()));
      const plan = JSON.parse(fs.readFileSync(planFile, 'utf8')) as PlanJson;
      let mapped = 0;
      let unrequested = 0;
      for (const it of plan.sprints.flatMap((s) => s.items)) {
        const refs = (reply[it.title] ?? []).filter((r) => known.has(r.toUpperCase()));
        (it as { requests?: string[] }).requests = refs;
        if (refs.length) mapped++;
        else unrequested++;
      }
      fs.writeFileSync(planFile, JSON.stringify(plan, null, 2) + '\n', 'utf8');
      const t = planTarget(f.root, this.deps.portal?.home?.() ?? os.homedir());
      if (t) await linkPlanRequests(t, plan, this.deps.portal?.fetchImpl);
      this.set({ phase: 'idle', error: null, live: null });
      return { mapped, unrequested };
    } catch (e) {
      this.set({ phase: 'idle', error: e instanceof Error ? e.message : String(e), live: null });
      throw e;
    }
  }

  stop(): void {
    if (this.view.phase === 'idle') return;
    this.current?.stop();
    this.set({ phase: 'idle', error: 'stopped', live: null });
    void this.endRun('cancelled');
  }

  private async endRun(how: 'plan' | 'cancelled' = 'plan'): Promise<void> {
    const p = this.portal();
    const f = this.deps.folder();
    if (!p || !f) return;
    try {
      this.live ??= await startPlanningRun(f.root, p);
      if (!this.live) return;
      const id = openRunId(f.root);
      if (how === 'cancelled') {
        if (id)
          await finishPlanRun(
            this.live,
            id,
            {
              status: 'cancelled',
              summary: 'Stopped in VS Code',
              ...(this.usage ? { usage: this.usage } : {}),
            },
            p.fetchImpl,
          );
      } else await endPlanningRun(this.live, p, this.usage);
      this.usage = undefined;
    } catch (e) {
      this.deps.log.warn('the planning run could not be ended in Orqiva: ' + String(e));
    }
    this.live = null;
  }
}

/** Questions still open are left to Claude ("you decide") when the user moves on without answering. */
function closeOpen(iv: Interview, now: Date): Interview {
  return openQuestions(iv) ? recordAnswers(iv, {}, now) : iv;
}

/** One line on why a run gave nothing usable: Claude's own words when it said something. */
function failure(out: { text: string; isError: boolean; stderr: string }, what: string): string {
  const said = (out.text || out.stderr).trim().split('\n').filter(Boolean).slice(-2).join(' ');
  if (/not (found|recognized)|ENOENT|nicht als Name/i.test(out.stderr))
    return 'Claude Code was not found. Check "This computer" on the Home tab, or the setting orqiva.claudeCommand.';
  return said ? what + ': ' + said.slice(0, 400) : what + '.';
}

// ── [PCODE-467 | S15 | v0.1.0] the mapping of published tasks to the client's requests ──
const MAP_PROMPT_FILE = ['state', 'map_prompt.txt'] as const;
const MAP_TASK =
  'Map the tasks to the client requests as instructed, and reply with the JSON object.';
export const MAP_PROMPT = `You map the tasks of the project **{name}** (Orqiva key \`{identifier}\`) to the requests of its client.
Read \`.orqiva/plan.json\` (the sprints and their tasks) and \`.orqiva/description/requests.md\` (the client's requests,
each under its ref, for example F-1). For every task, name the refs of the requests it serves: the work the client
asked for, or that is needed so the request can be delivered. Foundation work no request needs gets [].

Reply with ONLY one JSON object and nothing else, with every task title of plan.json exactly as written there:
{{"tasks": {{"<task title>": ["F-1"], "<task title>": []}}}}

Do not write, change or delete any file.
`;

/** Claude's mapping: task title to the refs; null when the reply is no such object. */
export function parseMapping(text: string): Record<string, string[]> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as { tasks?: unknown };
    if (typeof v.tasks !== 'object' || v.tasks === null) return null;
    const out: Record<string, string[]> = {};
    for (const [title, refs] of Object.entries(v.tasks as Record<string, unknown>))
      out[title] = Array.isArray(refs)
        ? refs.filter((r): r is string => typeof r === 'string')
        : [];
    return out;
  } catch {
    return null;
  }
}
