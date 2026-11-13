// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-57 | S11 | v0.1.0] Implement the SSH adapter running docker compose pull and up on the host ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the simplest deploy there is: ssh in, pull, up, show what runs. No password ever - BatchMode makes
//          ssh fail loudly instead of asking, and the failure is turned into the sentence that says what to
//          add to the agent or ~/.ssh/config. The remote path is quoted, so a folder with a space works.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import type { CancelToken } from '../engine/run';
import { OrqivaError } from '../util/errors';
import { redact } from '../util/redact';
import type { DeployTarget } from './targets';

export const CONNECT_TIMEOUT_SECONDS = 10;
export const SSH_TIMEOUT_MS = 15 * 60 * 1000;

export interface SshResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface SshOptions {
  spawn?: typeof nodeSpawn;
  onLine?: (line: string) => void;
  cancel?: CancelToken;
  timeoutMs?: number;
}

/** 'deploy@host' or just 'host' when the target names no user */
export function destination(target: DeployTarget): string {
  const user = (target.user ?? '').trim();
  const host = (target.host ?? '').trim();
  return user ? `${user}@${host}` : host;
}

// ── [PCODE-57 | S11 | v0.1.0] quote: the path travels through the remote shell, so it is single-quoted ──
export function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function sshArgs(target: DeployTarget, remoteCommand: string): string[] {
  return [
    '-o',
    'BatchMode=yes', // never ask for a password: fail instead
    '-o',
    `ConnectTimeout=${String(CONNECT_TIMEOUT_SECONDS)}`,
    destination(target),
    remoteCommand,
  ];
}

export function checkCommand(target: DeployTarget): string {
  return `test -f ${quote(`${(target.path ?? '').replace(/\/+$/, '')}/docker-compose.yml`)}`;
}

export function deployCommand(target: DeployTarget): string {
  const dir = quote((target.path ?? '').replace(/\/+$/, ''));
  return `cd ${dir} && docker compose pull && docker compose up -d && docker compose ps`;
}

// ── [PCODE-57 | S11 | v0.1.0] explainSsh: what ssh printed becomes what the user has to do ──
export function explainSsh(target: DeployTarget, code: number, stderr: string): string {
  const text = stderr.trim();
  const host = (target.host ?? '').trim();
  if (/permission denied|publickey/i.test(text))
    return `Permission denied by ${host} — add your key to the agent or to ~/.ssh/config for ${host}.`;
  if (/host key verification failed/i.test(text))
    return `The host key of ${host} is not known yet — connect once in a terminal to accept it.`;
  if (/could not resolve|name or service not known|nodename nor servname/i.test(text))
    return `${host} cannot be resolved — check the host name of this target.`;
  if (/connection refused/i.test(text)) return `${host} refused the connection on port 22.`;
  if (/connection timed out|operation timed out/i.test(text))
    return `${host} did not answer within ${String(CONNECT_TIMEOUT_SECONDS)} s.`;
  if (/batch mode|password/i.test(text))
    return `${host} asked for a password — Orqiva only deploys with a key (add it to your agent).`;
  const first = text.split('\n')[0] ?? '';
  return `ssh exited with ${String(code)}${first ? ` — ${first}` : ''}.`;
}

// ── [PCODE-57 | S11 | v0.1.0] runSsh: one ssh call, lines streamed, exit code returned ──
export function runSsh(
  target: DeployTarget,
  remoteCommand: string,
  opts: SshOptions = {},
): Promise<SshResult> {
  const spawn = opts.spawn ?? nodeSpawn;
  const args = sshArgs(target, remoteCommand);
  return new Promise<SshResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn('ssh', args, { windowsHide: true, shell: false });
    } catch (e) {
      reject(new OrqivaError(`Could not start ssh: ${String(e)}`, 'config'));
      return;
    }
    let stdout = '';
    let stderr = '';
    let outBuf = '';
    let errBuf = '';
    let settled = false;
    const timer = setTimeout(() => {
      finish(new OrqivaError('The ssh command timed out.', 'engine'));
    }, opts.timeoutMs ?? SSH_TIMEOUT_MS);
    const cancelSub = opts.cancel?.onCancellationRequested(() => {
      finish(new OrqivaError('Cancelled.', 'cancelled'));
    });
    const feed = (buf: string, chunk: Buffer): string => {
      const text = buf + chunk.toString();
      const lines = text.split(/\r?\n/);
      const rest = lines.pop() ?? '';
      for (const l of lines) opts.onLine?.(redact(l));
      return rest;
    };
    function finish(error: OrqivaError | null, code = -1): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cancelSub?.dispose();
      if (error) {
        if (!child.killed && child.exitCode === null) child.kill();
        reject(error);
        return;
      }
      if (outBuf) opts.onLine?.(redact(outBuf));
      if (errBuf) opts.onLine?.(redact(errBuf));
      resolve({ code, stdout, stderr });
    }
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString();
      outBuf = feed(outBuf, c);
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
      errBuf = feed(errBuf, c);
    });
    child.on('error', (e: Error) => {
      finish(new OrqivaError(`ssh is not available: ${e.message}`, 'config'));
    });
    child.on('close', (code: number | null) => {
      finish(null, code ?? -1);
    });
  });
}

export interface SshDeployResult {
  ms: number;
  /** the `docker compose ps` output of the host */
  ps: string;
}

// ── [PCODE-57 | S11 | v0.1.0] deployOverSsh: check the folder first, then pull, up and ps ──
export async function deployOverSsh(
  target: DeployTarget,
  opts: SshOptions & { now?: () => number } = {},
): Promise<SshDeployResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  opts.onLine?.(`> ssh ${destination(target)} ${checkCommand(target)}`);
  const check = await runSsh(target, checkCommand(target), opts);
  if (check.code !== 0) {
    // a failing `test -f` is either a missing file or a connection problem; both are named
    const message = check.stderr.trim()
      ? explainSsh(target, check.code, check.stderr)
      : `${(target.path ?? '').replace(/\/+$/, '')}/docker-compose.yml does not exist on ${(target.host ?? '').trim()} — check the folder of this target.`;
    throw new OrqivaError(message, 'user');
  }
  opts.onLine?.(`> ssh ${destination(target)} ${deployCommand(target)}`);
  const run = await runSsh(target, deployCommand(target), opts);
  if (run.code !== 0) throw new OrqivaError(explainSsh(target, run.code, run.stderr), 'engine');
  return { ms: now() - started, ps: run.stdout.trim() };
}
