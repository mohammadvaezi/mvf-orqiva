// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
// ── [PCODE-461 | S15 | v0.1.0] Planning in VS Code shows what Claude writes right now: file and size live, failed tools as steps ──
// ── [PCODE-457 | S15 | v0.1.0] VS Code planning as a conversation: Claude asks, the user answers with text and files, then the plan; replan and description change work; Home tab explains itself ──
//    Why:  the planning conversation runs Claude Code without a terminal: `claude -p` in the project
//          folder, the task on stdin, the system prompt from a file, and the stream of what it does read
//          line by line, so the Home tab shows the steps live and gets Claude's final message as the
//          result. The command line is the same on every shell because nothing is typed into one.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { describeTool } from '../../../cli/src/loop/hooks';
import { commandLine } from '../util/terminal';

export type ClaudeJob = 'interview' | 'plan';

/** Read-only for the questions; reading and writing files for the plan. */
export function headlessArgs(job: ClaudeJob, promptFileRel: string): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages', // [PCODE-461 | S15 | v0.1.0] what it writes, while it writes
    '--append-system-prompt-file',
    promptFileRel,
    ...(job === 'interview'
      ? [
          '--allowedTools',
          'Read,Glob,Grep',
          '--disallowedTools',
          'Write,Edit,MultiEdit,NotebookEdit,Bash',
        ]
      : ['--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Write,Edit,Glob,Grep']),
  ];
}

export interface StreamEvent {
  step?: string;
  /** [PCODE-461 | S15 | v0.1.0] what Claude does this moment, before the step is complete */
  live?: string;
  result?: { text: string; isError: boolean; usage?: RunUsage | undefined };
}

/** [PCODE-466 | S15 | v0.1.0] what a run used: its main model, the tokens and Claude Code's own price */
export interface RunUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

interface ModelLine {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
}

/** The result line's usage: summed over the models, named after the one that cost most. */
export function usageOf(o: {
  total_cost_usd?: number;
  modelUsage?: Record<string, ModelLine>;
}): RunUsage | undefined {
  const models = Object.entries(o.modelUsage ?? {});
  if (!models.length) return undefined;
  const main = models.reduce((a, b) => ((b[1].costUSD ?? 0) > (a[1].costUSD ?? 0) ? b : a));
  const sum = (f: (m: ModelLine) => number | undefined): number =>
    models.reduce((n, [, m]) => n + (f(m) ?? 0), 0);
  return {
    model: main[0],
    tokensIn: sum((m) => m.inputTokens),
    tokensOut: sum((m) => m.outputTokens),
    cacheRead: sum((m) => m.cacheReadInputTokens),
    cacheWrite: sum((m) => m.cacheCreationInputTokens),
    costUsd: o.total_cost_usd ?? sum((m) => m.costUSD),
  };
}

/** Two runs' usage together (the rounds of one planning conversation). */
export function addUsage(a: RunUsage | undefined, b: RunUsage | undefined): RunUsage | undefined {
  if (!a || !b) return a ?? b;
  return {
    model: b.costUsd >= a.costUsd ? b.model : a.model,
    tokensIn: a.tokensIn + b.tokensIn,
    tokensOut: a.tokensOut + b.tokensOut,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    costUsd: a.costUsd + b.costUsd,
  };
}

interface Block {
  type?: string;
  name?: string;
  input?: Record<string, unknown>;
  is_error?: boolean;
  content?: unknown;
}

interface Line {
  type?: string;
  message?: { content?: Block[] };
  result?: unknown;
  is_error?: boolean;
  subtype?: string;
  total_cost_usd?: number;
  modelUsage?: Record<string, ModelLine>;
  event?: {
    type?: string;
    content_block?: { type?: string; name?: string };
    delta?: { type?: string; partial_json?: string; text?: string };
  };
}

const VERBS: Record<string, string> = {
  Write: 'Writing',
  Edit: 'Changing',
  MultiEdit: 'Changing',
  NotebookEdit: 'Changing',
  Read: 'Reading',
  Glob: 'Looking for files',
  Grep: 'Searching',
  Bash: 'Running a command',
};

/** C:\\x\\MarketSpider\\.orqiva\\plan.json -> .orqiva/plan.json when it is inside the folder */
function relative(root: string, file: string): string {
  const f = file.replace(/\\/g, '/');
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  return f.toLowerCase().startsWith(r.toLowerCase()) ? f.slice(r.length) : f;
}

const kb = (n: number): string =>
  n < 1024 ? String(n) + ' bytes' : String(Math.round(n / 1024)) + ' KB';

// ── [PCODE-457 | S15 | v0.1.0] a tool Claude used becomes a step, the last message the result ──
// ── [PCODE-461 | S15 | v0.1.0] ...and the partial messages say what it does right now ──
//    Writing a long file is one tool call that takes minutes; its input arrives in pieces, so the live line
//    names the file as soon as its path has arrived and counts what has been written so far. A tool that
//    failed (a refused write, a missing file) becomes a step of its own, so it is seen, not guessed.
export class StreamReader {
  private tool: { name: string; json: string; file: string | null } | null = null;

  constructor(private readonly root: string) {}

  read(line: string): StreamEvent | null {
    let o: Line;
    try {
      const v: unknown = JSON.parse(line);
      if (typeof v !== 'object' || v === null) return null;
      o = v;
    } catch {
      return null;
    }
    if (o.type === 'result')
      return {
        result: {
          text: typeof o.result === 'string' ? o.result : '',
          isError: o.is_error === true || (o.subtype !== undefined && o.subtype !== 'success'),
          ...(usageOf(o) ? { usage: usageOf(o) } : {}), // [PCODE-466 | S15 | v0.1.0]
        },
      };
    if (o.type === 'stream_event') return this.partial(o.event ?? {});
    if (o.type === 'user') {
      const failed = (o.message?.content ?? []).find((b) => b.type === 'tool_result' && b.is_error);
      if (!failed) return null;
      const text =
        typeof failed.content === 'string'
          ? failed.content
          : Array.isArray(failed.content)
            ? (failed.content as { text?: string }[]).map((x) => x.text ?? '').join(' ')
            : '';
      return { step: 'Failed: ' + text.replace(/\s+/g, ' ').trim().slice(0, 240) };
    }
    if (o.type !== 'assistant') return null;
    const tool = (o.message?.content ?? []).find((b) => b.type === 'tool_use');
    if (!tool?.name) return null;
    this.tool = null;
    return {
      step: describeTool(this.root, { tool_name: tool.name, tool_input: tool.input ?? {} }).text,
      live: 'Thinking about the next step',
    };
  }

  private partial(e: NonNullable<Line['event']>): StreamEvent | null {
    if (e.type === 'content_block_start') {
      const b = e.content_block;
      if (b?.type === 'tool_use' && b.name) {
        this.tool = { name: b.name, json: '', file: null };
        return { live: (VERBS[b.name] ?? 'Using ' + b.name) + '…' };
      }
      if (b?.type === 'thinking' || b?.type === 'text') {
        return { live: 'Thinking about the next step' };
      }
      return null;
    }
    if (e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta' && this.tool) {
      const t = this.tool;
      const before = t.json.length;
      t.json += e.delta.partial_json ?? '';
      t.file ??=
        /"(?:file_path|notebook_path)"\s*:\s*"((?:[^"\\]|\\.)*)"/
          .exec(t.json)?.[1]
          ?.replace(/\\\\/g, '\\') ?? null;
      // a new live line every 2 KB is plenty; the session sends it on at most twice a second
      if (Math.floor(before / 2048) === Math.floor(t.json.length / 2048) && before > 0) return null;
      const verb = VERBS[t.name] ?? 'Using ' + t.name;
      return {
        live: t.file
          ? `${verb} ${relative(this.root, t.file)} (${kb(t.json.length)} so far)`
          : `${verb}… (${kb(t.json.length)} so far)`,
      };
    }
    return null;
  }
}

/** One line on its own, without the partial messages around it (tests, simple callers). */
export function parseStreamLine(root: string, line: string): StreamEvent | null {
  return new StreamReader(root).read(line);
}

export interface ClaudeRunOptions {
  command: string;
  args: string[];
  cwd: string;
  /** the task, on stdin */
  input: string;
  onStep?: (text: string) => void;
  /** [PCODE-461 | S15 | v0.1.0] what Claude does this moment */
  onLive?: (text: string) => void;
  spawn?: typeof nodeSpawn;
  platform?: NodeJS.Platform;
}

export interface ClaudeRun {
  done: Promise<RunDone>;
  stop: () => void;
}

export interface RunDone {
  text: string;
  isError: boolean;
  stderr: string;
  code: number | null;
  /** [PCODE-466 | S15 | v0.1.0] */
  usage?: RunUsage | undefined;
}

// ── [PCODE-457 | S15 | v0.1.0] runClaude: one headless run; stop() ends it ──
export function runClaude(o: ClaudeRunOptions): ClaudeRun {
  const spawn = o.spawn ?? nodeSpawn;
  // claude is often claude.cmd on Windows, which only starts through the shell
  const win = (o.platform ?? process.platform) === 'win32';
  let child: ChildProcess | undefined;
  let stopped = false;
  const done = new Promise<RunDone>((resolve) => {
    const got: { result: { text: string; isError: boolean; usage?: RunUsage | undefined } | null } =
      {
        result: null,
      };
    let stderr = '';
    let rest = '';
    try {
      child = win
        ? spawn(commandLine(o.command, o.args, 'cmd'), {
            cwd: o.cwd,
            shell: true,
            windowsHide: true,
          })
        : spawn(o.command, o.args, { cwd: o.cwd, windowsHide: true });
    } catch (e) {
      resolve({ text: '', isError: true, stderr: String(e), code: null });
      return;
    }
    const reader = new StreamReader(o.cwd);
    const line = (l: string): void => {
      const ev = reader.read(l.trim());
      if (ev?.step) o.onStep?.(ev.step);
      if (ev?.live) o.onLive?.(ev.live);
      if (ev?.result) got.result = ev.result;
    };
    child.stdout?.on('data', (c: Buffer) => {
      const parts = (rest + c.toString('utf8')).split('\n');
      rest = parts.pop() ?? '';
      parts.forEach(line);
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr = (stderr + c.toString('utf8')).slice(-4000);
    });
    child.on('error', (e) => {
      stderr += String(e);
    });
    child.on('close', (code) => {
      if (rest.trim()) line(rest);
      const r = got.result;
      resolve({
        text: r?.text ?? '',
        isError: stopped || !r || r.isError,
        stderr: stopped ? 'stopped' : stderr,
        code,
        usage: r?.usage,
      });
    });
    child.stdin?.end(o.input, 'utf8');
  });
  return {
    done,
    stop: () => {
      stopped = true;
      const pid = child?.pid;
      if (!pid) return;
      // the shell's child (claude) must go too on Windows
      if (win)
        spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true }).on(
          'error',
          () => undefined,
        );
      else child?.kill();
    },
  };
}
