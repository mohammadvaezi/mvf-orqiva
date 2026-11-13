// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-50 | S10 | v0.1.0] Add Docker CLI helpers: version, build, compose up/down/logs, inspect health ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  everything the Docker panel does is one `docker` call with an argv array (no shell), run in the
//          project root, streaming its lines as they arrive and returning an exit code. A missing Docker is
//          an answer with a download link, never an exception - the panel has to render that state.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import type { CancelToken } from '../engine/run';
import { OrqivaError } from '../util/errors';
import { redact } from '../util/redact';

export const DOCKER_URL = 'https://www.docker.com/products/docker-desktop/';
export const DEFAULT_COMPOSE = 'docker-compose.yml';
export const DEFAULT_DOCKERFILE = 'Dockerfile';

export interface DockerResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface DockerOptions {
  cwd: string;
  spawn?: typeof nodeSpawn;
  /** every complete line of stdout and stderr, in arrival order, already redacted */
  onLine?: (line: string) => void;
  cancel?: CancelToken;
  timeoutMs?: number;
}

export const DOCKER_TIMEOUT_MS = 15 * 60 * 1000;

// ── [PCODE-50 | S10 | v0.1.0] runDocker: the one spawn; lines stream, the exit code comes back ──
export function runDocker(args: readonly string[], opts: DockerOptions): Promise<DockerResult> {
  const spawn = opts.spawn ?? nodeSpawn;
  return new Promise<DockerResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn('docker', [...args], { cwd: opts.cwd, windowsHide: true, shell: false });
    } catch (e) {
      reject(new OrqivaError(`Could not start docker: ${String(e)}`, 'config'));
      return;
    }
    let stdout = '';
    let stderr = '';
    let outBuf = '';
    let errBuf = '';
    let settled = false;
    const timer = setTimeout(() => {
      finish(new OrqivaError(`docker ${args.join(' ')} timed out.`, 'engine'));
    }, opts.timeoutMs ?? DOCKER_TIMEOUT_MS);
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
      finish(new OrqivaError(`docker is not available: ${e.message}`, 'config'));
    });
    child.on('close', (code: number | null) => {
      finish(null, code ?? -1);
    });
  });
}

export interface DockerVersion {
  ok: boolean;
  docker: string | null;
  compose: string | null;
  /** what to do when it is missing */
  fix: string | null;
  detail: string;
}

// ── [PCODE-50 | S10 | v0.1.0] version: never throws - "Docker not found" is a state the panel renders ──
export async function version(opts: DockerOptions): Promise<DockerVersion> {
  const missing: DockerVersion = {
    ok: false,
    docker: null,
    compose: null,
    fix: DOCKER_URL,
    detail: 'Docker not found — install Docker Desktop and start it.',
  };
  let docker: DockerResult;
  try {
    docker = await runDocker(['version', '--format', '{{.Server.Version}}'], {
      ...opts,
      timeoutMs: opts.timeoutMs ?? 20_000,
    });
  } catch {
    return missing;
  }
  if (docker.code !== 0) {
    const detail = (docker.stderr || docker.stdout).trim().split('\n')[0] ?? '';
    // the CLI is there but the engine is not running: a different problem, same panel row
    return /daemon|pipe|connect/i.test(detail)
      ? { ...missing, detail: 'Docker is installed but not running — start Docker Desktop.' }
      : missing;
  }
  let compose: string | null = null;
  try {
    const r = await runDocker(['compose', 'version', '--short'], {
      ...opts,
      timeoutMs: opts.timeoutMs ?? 20_000,
    });
    compose = r.code === 0 ? r.stdout.trim() : null;
  } catch {
    compose = null;
  }
  const server = docker.stdout.trim();
  return {
    ok: true,
    docker: server,
    compose,
    fix: null,
    detail: `Docker ${server}${compose ? ` · Compose ${compose}` : ' · no compose plugin'}`,
  };
}

// ── [PCODE-50 | S10 | v0.1.0] imageTag: <project name, lowercased and cleaned>:<version> ──
export function imageTag(projectName: string, version_: string): string {
  const name =
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-._]+|[-._]+$/g, '')
      .slice(0, 60) || 'app';
  return `${name}:${version_ || 'latest'}`;
}

export interface BuildInput {
  tag: string;
  /** Dockerfile path relative to the context */
  file?: string;
  context?: string;
}

export function buildArgs(input: BuildInput): string[] {
  return ['build', '-t', input.tag, '-f', input.file ?? DEFAULT_DOCKERFILE, input.context ?? '.'];
}

export function build(input: BuildInput, opts: DockerOptions): Promise<DockerResult> {
  return runDocker(buildArgs(input), opts);
}

const compose = (file: string, ...rest: string[]): string[] => ['compose', '-f', file, ...rest];

export function composeUp(file: string, opts: DockerOptions): Promise<DockerResult> {
  return runDocker(compose(file, 'up', '-d'), opts);
}

export function composeDown(file: string, opts: DockerOptions): Promise<DockerResult> {
  return runDocker(compose(file, 'down'), opts);
}

/** follows the logs until the token cancels; the promise then rejects with kind 'cancelled' */
export function composeLogs(
  file: string,
  onLine: (line: string) => void,
  opts: DockerOptions,
): Promise<DockerResult> {
  return runDocker(compose(file, 'logs', '-f', '--tail', '200'), { ...opts, onLine });
}

export interface ComposeService {
  name: string;
  service: string;
  state: string;
  health: string | null;
}

// ── [PCODE-50 | S10 | v0.1.0] parseComposePs: compose prints one JSON object per line, or one array ──
export function parseComposePs(stdout: string): ComposeService[] {
  const rows: Record<string, unknown>[] = [];
  const text = stdout.trim();
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) rows.push(...(parsed as Record<string, unknown>[]));
    else if (parsed && typeof parsed === 'object') rows.push(parsed as Record<string, unknown>);
  } catch {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        /* a line that is not JSON is not a container */
      }
    }
  }
  return rows.map((r) => {
    const str = (k: string): string => (typeof r[k] === 'string' ? r[k] : '');
    const health = str('Health');
    return {
      name: str('Name'),
      service: str('Service'),
      state: str('State'),
      health: health || null,
    };
  });
}

export async function composePs(file: string, opts: DockerOptions): Promise<ComposeService[]> {
  const r = await runDocker(compose(file, 'ps', '--format', 'json'), {
    ...opts,
    timeoutMs: opts.timeoutMs ?? 60_000,
  });
  return r.code === 0 ? parseComposePs(r.stdout) : [];
}

/** healthy | starting | unhealthy | none (the container has no healthcheck) | unknown */
export async function inspectHealth(container: string, opts: DockerOptions): Promise<string> {
  try {
    const r = await runDocker(['inspect', '--format', '{{.State.Health.Status}}', container], {
      ...opts,
      timeoutMs: opts.timeoutMs ?? 30_000,
    });
    if (r.code !== 0) return 'unknown';
    const value = r.stdout.trim();
    if (!value || value === '<no value>') return 'none';
    return value;
  } catch {
    return 'unknown';
  }
}

export interface HttpHealth {
  ok: boolean;
  status: number | null;
  ms: number;
  error: string | null;
}

export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<{ status: number }>;

// ── [PCODE-50 | S10 | v0.1.0] httpHealth: a 2xx/3xx inside the timeout is healthy; anything else is not ──
export async function httpHealth(
  url: string,
  timeoutMs = 10_000,
  fetchLike?: FetchLike,
): Promise<HttpHealth> {
  const doFetch: FetchLike = fetchLike ?? ((u, init) => fetch(u, init));
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const started = Date.now();
  try {
    const res = await doFetch(url, { signal: controller.signal });
    return {
      ok: res.status >= 200 && res.status < 400,
      status: res.status,
      ms: Date.now() - started,
      error: null,
    };
  } catch (e) {
    const aborted = controller.signal.aborted;
    return {
      ok: false,
      status: null,
      ms: Date.now() - started,
      error: aborted
        ? `no answer within ${String(Math.round(timeoutMs / 1000))} s`
        : String(e instanceof Error ? e.message : e),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function describeHttpHealth(url: string, h: HttpHealth): string {
  return h.status !== null
    ? `${url}: ${String(h.status)} in ${String(h.ms)} ms`
    : `${url}: ${h.error ?? 'failed'}`;
}
