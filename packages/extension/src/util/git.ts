// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-45 | S09 | v0.1.0] Add git helpers: status, last tag, log since tag, tag list, dirty check ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the release work needs a few facts from git and nothing more: is this a repo, is it clean, what
//          was the last tag, what landed since it. Each one is a single `git` call with an argv array (no
//          shell), the spawn is injected so the tests never touch a real repository, and a failure carries
//          git's own stderr instead of an exit code.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { OrqivaError } from './errors';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GitSpawn = typeof nodeSpawn;

export interface GitOptions {
  cwd: string;
  spawn?: GitSpawn;
  timeoutMs?: number;
}

export const GIT_TIMEOUT_MS = 20_000;

// ── [PCODE-45 | S09 | v0.1.0] runGit: one call, argv array, never a shell; a crash is a config error ──
export function runGit(args: readonly string[], opts: GitOptions): Promise<GitResult> {
  const spawn = opts.spawn ?? nodeSpawn;
  return new Promise<GitResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn('git', [...args], { cwd: opts.cwd, windowsHide: true, shell: false });
    } catch (e) {
      reject(new OrqivaError(`Could not start git: ${String(e)}`, 'config'));
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      finish(new OrqivaError(`git ${args.join(' ')} timed out.`, 'engine'));
    }, opts.timeoutMs ?? GIT_TIMEOUT_MS);
    function finish(error: OrqivaError | null, code = -1): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        if (!child.killed && child.exitCode === null) child.kill();
        reject(error);
        return;
      }
      resolve({ code, stdout, stderr });
    }
    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString()));
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString()));
    child.on('error', (e: Error) => {
      finish(new OrqivaError(`git is not available: ${e.message}`, 'config'));
    });
    child.on('close', (code: number | null) => {
      finish(null, code ?? -1);
    });
  });
}

/** stdout of a call that must succeed; git's stderr becomes the message */
async function out(args: readonly string[], opts: GitOptions): Promise<string> {
  const r = await runGit(args, opts);
  if (r.code !== 0)
    throw new OrqivaError(
      `git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim().split('\n')[0] ?? `exit ${String(r.code)}`}`,
      'engine',
      r.stderr,
    );
  return r.stdout;
}

export interface Commit {
  hash: string;
  subject: string;
  /** the task the commit message starts with, e.g. PCODE-12 */
  ref: string | null;
}

// ── [PCODE-45 | S09 | v0.1.0] refFromSubject: "PCODE-12 Title" -> PCODE-12; the changelog cross-checks with it ──
export function refFromSubject(subject: string): string | null {
  return /^([A-Z]{2,5}-\d+)\s/.exec(subject.trim())?.[1] ?? null;
}

export function parseLog(stdout: string): Commit[] {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const hash = tab < 0 ? line : line.slice(0, tab);
      const subject = tab < 0 ? '' : line.slice(tab + 1);
      return { hash, subject, ref: refFromSubject(subject) };
    });
}

export function parseStatus(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.slice(3).trim());
}

// ── [PCODE-45 | S09 | v0.1.0] the facts the release work asks for ──
export async function isRepo(opts: GitOptions): Promise<boolean> {
  try {
    const r = await runGit(['rev-parse', '--is-inside-work-tree'], opts);
    return r.code === 0 && r.stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/** the files git reports as changed (staged or not); empty means a clean worktree */
export async function changedFiles(opts: GitOptions): Promise<string[]> {
  return parseStatus(await out(['status', '--porcelain'], opts));
}

export async function isDirty(opts: GitOptions): Promise<boolean> {
  return (await changedFiles(opts)).length > 0;
}

/** the most recent tag reachable from HEAD, or null when the repo has none */
export async function lastTag(opts: GitOptions): Promise<string | null> {
  const r = await runGit(['describe', '--tags', '--abbrev=0'], opts);
  const tag = r.stdout.trim();
  return r.code === 0 && tag ? tag : null;
}

export async function tags(opts: GitOptions): Promise<string[]> {
  const r = await runGit(['tag', '--list', '--sort=-creatordate'], opts);
  if (r.code !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** commits after `tag` (or the whole history when there is no tag), newest first */
export async function logSince(tag: string | null, opts: GitOptions): Promise<Commit[]> {
  const range = tag ? [`${tag}..HEAD`] : ['HEAD'];
  const r = await runGit(['log', ...range, '--pretty=format:%h%x09%s'], opts);
  if (r.code !== 0) return []; // a repo without commits has no HEAD; that is not an error here
  return parseLog(r.stdout);
}

export async function tagDate(tag: string, opts: GitOptions): Promise<string | null> {
  const r = await runGit(['log', '-1', '--format=%cI', tag], opts);
  const date = r.stdout.trim();
  return r.code === 0 && date ? date : null;
}

export async function currentBranch(opts: GitOptions): Promise<string> {
  const r = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], opts);
  return r.code === 0 ? r.stdout.trim() : '';
}

export async function headShort(opts: GitOptions): Promise<string> {
  const r = await runGit(['rev-parse', '--short', 'HEAD'], opts);
  return r.code === 0 ? r.stdout.trim() : '';
}

export async function stage(files: readonly string[], opts: GitOptions): Promise<void> {
  if (!files.length) return;
  await out(['add', '--', ...files], opts);
}
