// ── [PCODE-239 | S15 | v0.1.0] orq reaches a local server over IPv4 when localhost's IPv6 hangs ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-132 | S15 | v0.1.0] Run deploys through our own runner and stream each step ──
//    Why:  `orq runner` on the customer's machine: it asks the server for a queued deploy, runs the plan's
//          steps with the customer's tools, and reports each step as it starts, every couple of seconds
//          while it runs (the output so far), and when it ends. A cancelled run stops at the next report.
//          The shell, the clock and the network are injected, so the whole loop is tested without them.
import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { viaIPv4 } from '../loop/api.js';
import { describeStep, planDeploy, PlanError, type DeployJob, type Step } from './plan.js';

/** Runs one command; streams its output; resolves to the exit code. */
export type Shell = (
  cmd: string,
  args: string[],
  opts: {
    cwd: string;
    env: Record<string, string>;
    stdin?: string;
    onOutput: (chunk: string) => void;
  },
) => Promise<number>;

export interface RunnerDeps {
  server: string;
  token: string;
  /** the repository the runner deploys from */
  cwd: string;
  shell: Shell;
  fetchImpl: typeof fetch;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  /** how often the output of a running step is sent, in ms */
  flushMs?: number;
}

export class RunnerError extends Error {}

const OUTPUT_KEEP = 50_000;

/** Removes every secret's value from text that leaves the machine. */
export function redact(text: string, secrets: Record<string, string>): string {
  let out = text;
  for (const v of Object.values(secrets)) if (v.length >= 4) out = out.split(v).join('••••');
  return out;
}

async function call<T>(deps: RunnerDeps, path: string, body?: unknown): Promise<T> {
  const res = await deps.fetchImpl(viaIPv4(deps.server + path), {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + deps.token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
    } catch {
      // keep the raw text
    }
    throw new RunnerError(path + ': ' + String(res.status) + ' ' + msg);
  }
  return JSON.parse(text) as T;
}

/** Takes one queued deploy and runs it; false when there was none. */
export async function runOnce(deps: RunnerDeps): Promise<boolean> {
  const { run } = await call<{ run: DeployJob | null }>(deps, '/api/runner/claim');
  if (!run) return false;
  deps.log('Deploying ' + run.project + ' to ' + run.environment.name + ' (' + run.id + ')');
  const report = (
    seq: number,
    step: Step,
    status: string,
    output: string,
    exitCode: number | null,
  ) =>
    call<{ cancelled: boolean }>(deps, '/api/runner/deploys/' + run.id + '/steps', {
      seq,
      name: step.name,
      command: describeStep(step),
      status,
      output: redact(output, run.secrets),
      exitCode,
    });
  const finish = (status: 'succeeded' | 'failed', error = '') =>
    call(deps, '/api/runner/deploys/' + run.id + '/finish', {
      status,
      error: redact(error, run.secrets),
    });

  let steps: Step[];
  try {
    steps = planDeploy(run);
  } catch (e) {
    if (!(e instanceof PlanError)) throw e;
    await finish('failed', e.message);
    deps.log('Failed: ' + e.message);
    return true;
  }
  for (const [i, step] of steps.entries()) {
    const seq = i + 1;
    if ((await report(seq, step, 'running', '', null)).cancelled) {
      deps.log('Cancelled before ' + step.name);
      return true;
    }
    let output = '';
    // set from the flush callback; an object so the check below reads it fresh
    const seen = { cancelled: false };
    const flush = setInterval(() => {
      void report(seq, step, 'running', output, null)
        .then((r) => {
          if (r.cancelled) seen.cancelled = true;
        })
        .catch(() => undefined);
    }, deps.flushMs ?? 2000);
    let ok: boolean;
    let code: number | null = null;
    try {
      const r = await execute(deps, step, (chunk) => {
        output = (output + chunk).slice(-OUTPUT_KEEP);
      });
      ok = r.ok;
      code = r.code;
    } finally {
      clearInterval(flush);
    }
    const end = await report(seq, step, ok ? 'ok' : 'failed', output, code);
    if (seen.cancelled || end.cancelled) {
      deps.log('Cancelled after ' + step.name);
      return true;
    }
    if (!ok) {
      const why = step.name + ' failed' + (code === null ? '' : ' (exit ' + String(code) + ')');
      await finish('failed', why);
      deps.log('Failed: ' + why);
      return true;
    }
  }
  await finish('succeeded');
  deps.log('Deployed ' + run.project + ' to ' + run.environment.name);
  return true;
}

async function execute(
  deps: RunnerDeps,
  step: Step,
  out: (chunk: string) => void,
): Promise<{ ok: boolean; code: number | null }> {
  if (step.kind === 'run') {
    const cwd = step.cwd ? (isAbsolute(step.cwd) ? step.cwd : join(deps.cwd, step.cwd)) : deps.cwd;
    const env = step.env ?? {};
    if (!step.pipe) {
      const code = await deps.shell(step.cmd, step.args, {
        cwd,
        env,
        ...(step.stdin === undefined ? {} : { stdin: step.stdin }),
        onOutput: out,
      });
      return { ok: code === 0, code };
    }
    // first | second: the first command's output is the second one's input, and is not shown
    let piped = '';
    const first = await deps.shell(step.cmd, step.args, {
      cwd,
      env,
      ...(step.stdin === undefined ? {} : { stdin: step.stdin }),
      onOutput: (chunk) => {
        piped += chunk;
      },
    });
    if (first !== 0) {
      out(step.cmd + ' ended with ' + String(first) + '\n');
      return { ok: false, code: first };
    }
    const second = await deps.shell(step.pipe.cmd, step.pipe.args, {
      cwd,
      env,
      stdin: piped,
      onOutput: out,
    });
    return { ok: second === 0, code: second };
  }
  if (step.kind === 'http') {
    try {
      const res = await deps.fetchImpl(step.url, {
        method: step.method,
        headers: step.headers,
        signal: AbortSignal.timeout(30_000),
      });
      out(String(res.status) + ' ' + (await res.text()).slice(0, 500) + '\n');
      return { ok: res.ok, code: res.status };
    } catch (e) {
      out('No answer: ' + (e instanceof Error ? e.message : String(e)) + '\n');
      return { ok: false, code: null };
    }
  }
  // health: ask until it answers 2xx or the time is up
  const until = Date.now() + step.timeoutMs;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await deps.fetchImpl(step.url, { signal: AbortSignal.timeout(5000) });
      out('Attempt ' + String(attempt) + ': ' + String(res.status) + '\n');
      if (res.ok) return { ok: true, code: res.status };
    } catch (e) {
      out(
        'Attempt ' +
          String(attempt) +
          ': no answer (' +
          (e instanceof Error ? e.message : String(e)) +
          ')\n',
      );
    }
    if (Date.now() >= until) return { ok: false, code: null };
    await deps.sleep(3000);
  }
}

/** The real shell: no shell at all, the program is started directly; secrets go in env or stdin. */
export const spawnShell: Shell = (cmd, args, opts) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (d: Buffer) => {
      opts.onOutput(d.toString('utf8'));
    });
    child.stderr.on('data', (d: Buffer) => {
      opts.onOutput(d.toString('utf8'));
    });
    child.on('error', (e) => {
      opts.onOutput('Cannot start ' + cmd + ': ' + e.message + '\n');
      resolve(127);
    });
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
    child.stdin.end(opts.stdin ?? '');
  });

/** Claims and runs deploys until stopped; waits between empty claims. */
export async function runForever(
  deps: RunnerDeps,
  stop: () => boolean,
  idleMs = 5000,
): Promise<void> {
  while (!stop()) {
    try {
      if (!(await runOnce(deps))) await deps.sleep(idleMs);
    } catch (e) {
      deps.log('Runner: ' + (e instanceof Error ? e.message : String(e)));
      await deps.sleep(idleMs * 2);
    }
  }
}
