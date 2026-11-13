// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-58 | S11 | v0.1.0] Build the Deploy panel with targets, deploy button, progress and history ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  one place decides what a deploy is: a target that was named explicitly (never a default one -
//          criticals #8), the version the repo is at, the adapter that fits the target's kind, and a line
//          for every step. Whether it worked is the adapter's answer, not a guess.
import type { CancelToken } from '../engine/run';
import { OrqivaError } from '../util/errors';
import { deployToCoolify, type HttpLike } from './coolify';
import { deployOverSsh } from './ssh';
import { getToken, type DeployTarget, type SecretBag } from './targets';
import type { spawn as nodeSpawn } from 'node:child_process';

export interface DeployRequest {
  /** the target the user picked; there is no default */
  target: DeployTarget;
  version: string;
  secrets: SecretBag;
  onLine?: (line: string) => void;
  stop?: () => boolean;
  cancel?: CancelToken;
  /** injected for tests */
  http?: HttpLike;
  spawn?: typeof nodeSpawn;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

export interface DeployResult {
  target: string;
  kind: DeployTarget['kind'];
  version: string;
  ms: number;
  detail: string;
}

// ── [PCODE-58 | S11 | v0.1.0] formatDuration: "1m 43s", the way the summary line reads ──
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${String(minutes)}m ${String(seconds % 60)}s` : `${String(seconds)}s`;
}

export function deployedLine(version: string, target: string, ms: number): string {
  return `Deployed v${version} to ${target} in ${formatDuration(ms)}`;
}

export function confirmMessage(version: string, target: DeployTarget): string {
  const kind = target.kind === 'coolify' ? 'Coolify' : 'SSH';
  return `Deploy v${version} to ${target.name} (${kind})? This triggers a deployment on the server.`;
}

const defaultHttp: HttpLike = async (url, init) => {
  const res = await fetch(url, { method: init.method, headers: init.headers });
  return { status: res.status, text: await res.text() };
};

// ── [PCODE-58 | S11 | v0.1.0] runDeploy: the adapter for this target's kind, and nothing else ──
export async function runDeploy(req: DeployRequest): Promise<DeployResult> {
  const now = req.now ?? Date.now;
  const started = now();
  if (req.target.kind === 'coolify') {
    const token = await getToken(req.target.name, req.secrets);
    if (!token)
      throw new OrqivaError(
        `No token stored for ${req.target.name} — add it in the deploy panel (Edit target).`,
        'config',
      );
    const outcome = await deployToCoolify({
      target: req.target,
      token,
      http: req.http ?? defaultHttp,
      ...(req.onLine ? { onLine: req.onLine } : {}),
      ...(req.stop ? { stop: req.stop } : {}),
      ...(req.now ? { now: req.now } : {}),
      ...(req.wait ? { wait: req.wait } : {}),
    });
    return {
      target: req.target.name,
      kind: 'coolify',
      version: req.version,
      ms: outcome.ms,
      detail: outcome.detail,
    };
  }
  const outcome = await deployOverSsh(req.target, {
    ...(req.spawn ? { spawn: req.spawn } : {}),
    ...(req.onLine ? { onLine: req.onLine } : {}),
    ...(req.cancel ? { cancel: req.cancel } : {}),
    ...(req.now ? { now: req.now } : {}),
  });
  return {
    target: req.target.name,
    kind: 'ssh',
    version: req.version,
    ms: outcome.ms || now() - started,
    detail: outcome.ps.split('\n').at(-1)?.trim() ?? 'compose up finished',
  };
}

// ── [PCODE-58 | S11 | v0.1.0] versionWarnings: what makes this version a doubtful thing to ship ──
export function versionWarnings(input: {
  version: string;
  dirty: boolean;
  changed: string[];
  lastTag: string | null;
}): string[] {
  const out: string[] = [];
  if (input.dirty)
    out.push(
      `${String(input.changed.length)} uncommitted change(s) — what you deploy is not what the repo holds.`,
    );
  if (input.lastTag !== `v${input.version}`)
    out.push(
      input.lastTag
        ? `v${input.version} is not tagged yet (the last tag is ${input.lastTag}) — bump the version first.`
        : `v${input.version} is not tagged yet — bump the version first.`,
    );
  return out;
}
