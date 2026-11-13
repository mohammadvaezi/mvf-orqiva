// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-8 | S02 | v0.1.0] Implement the engine runner: spawn, cwd, env passthrough, output, cancellation ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  every engine call goes through here: argument arrays (never a shell string), cwd = project root,
//          secrets only via env, output streamed to the log through redact(), cancellation kills the child.
//          Guards criticals #4 (no shell) and #1 (no secret in the log).
// ── [PCODE-61 | S12 | v0.1.0] Harden engine spawning for paths with spaces and non-Windows shells ──
//    Why:  two things the engine's own output forces. It prints em dashes and arrows, so the bytes are decoded
//          with a stateful decoder - a character split across two chunks must not become a replacement char -
//          and on Windows it prints CRLF, so what callers parse is normalised to \n.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { OrqivaError } from '../util/errors';
import { redact } from '../util/redact';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CancelToken {
  isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface RunOptions {
  /** Project root; the engine resolves `.plane/` from it. */
  cwd: string;
  /** Extra environment (PLANE_API_KEY, PLANE_BASE_URL, PLANE_WORKSPACE_SLUG); merged over process.env. */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  cancel?: CancelToken;
  /** Receives redacted lines for the output channel (stdout and stderr, in arrival order). */
  onLine?: (line: string) => void;
  /** Injected for tests; defaults to node:child_process.spawn. */
  spawn?: typeof nodeSpawn;
}

export interface EngineSpec {
  /** Python command plus leading args, e.g. ['py', '-3'] or ['C:\\Python\\python.exe']. */
  python: string[];
  /** Engine folder holding the scripts. */
  home: string;
}

export const DEFAULT_TIMEOUT_MS = 60_000;

// ── [PCODE-61 | S12 | v0.1.0] normalizeEol: the engine prints CRLF on Windows; callers parse \n ──
//    A stray \r at the end of a line is invisible in a log and fatal in a comparison, which is how a
//    ref like "PCODE-12\r" gets used as a command argument.
export function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

// ── [PCODE-8 | S02 | v0.1.0] displayCommand: what the log shows before the output - argv joined, secrets masked ──
export function displayCommand(script: string, args: readonly string[]): string {
  const name = script.replace(/^plane_(\w+)\.py$/, 'plane $1').replace(/^plane task/, 'plane');
  return redact([name, ...args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))].join(' '));
}

// ── [PCODE-8 | S02 | v0.1.0] runEngine: spawn <python> <home>/<script> ...args and collect the result ──
export function runEngine(
  spec: EngineSpec,
  script: string,
  args: readonly string[],
  opts: RunOptions,
): Promise<RunResult> {
  const [command, ...leading] = spec.python;
  if (!command)
    return Promise.reject(new OrqivaError('No Python configured for the engine.', 'config'));
  if (!spec.home) return Promise.reject(new OrqivaError('Engine folder not configured.', 'config'));
  const spawn = opts.spawn ?? nodeSpawn;
  const argv = [...leading, path.join(spec.home, script), ...args];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...opts.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  };
  opts.onLine?.(`> ${displayCommand(script, args)}`);

  return new Promise<RunResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, argv, { cwd: opts.cwd, env, windowsHide: true, shell: false });
    } catch (e) {
      reject(new OrqivaError(`Could not start ${command}: ${String(e)}`, 'config'));
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      finish(
        new OrqivaError(
          `Engine timed out after ${Math.round((opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} s: ${displayCommand(script, args)}`,
          'engine',
        ),
      );
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const cancelSub = opts.cancel?.onCancellationRequested(() => {
      finish(new OrqivaError('Cancelled.', 'cancelled'));
    });

    // [PCODE-61 | S12 | v0.1.0] one decoder per stream: a multi-byte character may straddle two chunks
    const outDec = new StringDecoder('utf8');
    const errDec = new StringDecoder('utf8');
    const feed = (buf: string, text: string, isErr: boolean): string => {
      const lines = (buf + text).split(/\r?\n/);
      const rest = lines.pop() ?? '';
      for (const l of lines) opts.onLine?.(redact(isErr ? `! ${l}` : l));
      return rest;
    };
    let outBuf = '';
    let errBuf = '';
    child.stdout?.on('data', (c: Buffer | string) => {
      const text = typeof c === 'string' ? c : outDec.write(c);
      stdout += text;
      outBuf = feed(outBuf, text, false);
    });
    child.stderr?.on('data', (c: Buffer | string) => {
      const text = typeof c === 'string' ? c : errDec.write(c);
      stderr += text;
      errBuf = feed(errBuf, text, true);
    });

    function finish(error: OrqivaError | null, code = -1): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cancelSub?.dispose();
      if (error) {
        if (!child.killed && child.exitCode === null) child.kill();
        reject(error);
        return;
      }
      // [PCODE-61 | S12 | v0.1.0] flush what the decoders still hold, then hand callers \n-only text
      stdout += outDec.end();
      stderr += errDec.end();
      stdout = normalizeEol(stdout);
      stderr = normalizeEol(stderr);
      if (outBuf) opts.onLine?.(redact(outBuf));
      if (errBuf) opts.onLine?.(redact(`! ${errBuf}`));
      if (code !== 0) {
        const first = /^ERROR:\s*(.+)$/m.exec(stdout + '\n' + stderr);
        reject(
          new OrqivaError(
            redact(first?.[1] ?? `Engine exited with code ${code}`),
            'engine',
            redact(stderr || stdout),
          ),
        );
        return;
      }
      resolve({ code, stdout, stderr });
    }

    child.on('error', (e) => {
      finish(new OrqivaError(`Could not run ${command}: ${e.message}`, 'config'));
    });
    child.on('close', (code) => {
      finish(null, code ?? -1);
    });
    if (opts.cancel?.isCancellationRequested) finish(new OrqivaError('Cancelled.', 'cancelled'));
  });
}
