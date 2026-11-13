// ── [PCODE-455 | S15 | v0.1.0] Rename the project folder .plane to .orqiva on Orqiva folders, with a one-time move ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-55 | S11 | v0.1.0] Add deploy target storage in .plane/deploy.json with tokens in SecretStorage ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  a deploy target is project data and belongs in the repo; its token is a credential and belongs in
//          SecretStorage (criticals #1). So the file holds everything *but* the token, the file itself says
//          so at the top, and a target a human hand-edited keeps whatever extra keys it carries.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projectFile } from '../state/files';
import { registerSecret, forgetSecret } from '../util/redact';

/** in the project's folder (.orqiva, or .plane on a legacy folder) */
export const DEPLOY_FILE = ['deploy.json'] as const;
export const TOKEN_PREFIX = 'orqiva.coolify.token.';
export const SCHEMA_NOTE =
  'Deploy targets of this project. Tokens are NOT stored here — they live in the editor’s secret storage.';

export type TargetKind = 'coolify' | 'ssh';

export interface DeployTarget {
  name: string;
  kind: TargetKind;
  /** coolify */
  url?: string;
  appUuid?: string;
  /** ssh */
  host?: string;
  user?: string;
  path?: string;
  /** checked after the deploy; falls back to the docker health url */
  healthUrl?: string;
  /** whatever a human added by hand is kept as it is */
  [extra: string]: unknown;
}

export interface DeployFile {
  $comment?: string;
  targets: DeployTarget[];
  /** the project-wide health url PCODE-54 also reads */
  healthUrl?: string;
  [extra: string]: unknown;
}

export interface TargetsIo {
  existsSync: (p: string) => boolean;
  readFileSync: (p: string, enc: 'utf8') => string;
  writeFileSync: (p: string, data: string, enc: 'utf8') => void;
  mkdirSync: (p: string, o: { recursive: true }) => void;
}

const defaultIo: TargetsIo = {
  existsSync: (p) => fs.existsSync(p),
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  writeFileSync: (p, d, enc) => {
    fs.writeFileSync(p, d, enc);
  },
  mkdirSync: (p, o) => {
    fs.mkdirSync(p, o);
  },
};

export function deployPath(root: string): string {
  return projectFile(root, DEPLOY_FILE);
}

export const TOKEN_KEYS = ['token', 'apiToken', 'apiKey', 'password', 'secret'] as const;

// ── [PCODE-55 | S11 | v0.1.0] stripToken: whatever a caller hands in, no credential reaches the file ──
export function stripToken(target: DeployTarget): { target: DeployTarget; token: string | null } {
  let token: string | null = null;
  const copy: DeployTarget = { name: target.name, kind: target.kind };
  for (const [key, value] of Object.entries(target)) {
    if ((TOKEN_KEYS as readonly string[]).includes(key)) {
      if (typeof value === 'string' && value.trim() && token === null) token = value.trim();
      continue; // a credential-shaped key never reaches the copy, so it can never reach the file
    }
    copy[key] = value;
  }
  return { target: copy, token };
}

// ── [PCODE-55 | S11 | v0.1.0] validateTarget: field-level messages, so the form can point at the input ──
export function validateTarget(
  target: DeployTarget,
  others: readonly DeployTarget[] = [],
): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  const name = target.name.trim();
  if (!name) problems.push({ field: 'name', message: 'A name is needed.' });
  else if (!/^[\w .-]{1,40}$/.test(name))
    problems.push({ field: 'name', message: 'Letters, digits, space, dot, dash or underscore.' });
  else if (others.some((o) => o.name.trim().toLowerCase() === name.toLowerCase()))
    problems.push({ field: 'name', message: `A target named ${name} already exists.` });

  if (target.kind === 'coolify') {
    const url = (target.url ?? '').trim();
    if (!url) problems.push({ field: 'url', message: 'The Coolify address is needed.' });
    else if (!/^https:\/\/[^\s]+$/i.test(url))
      problems.push({ field: 'url', message: 'Use an https address — the token travels with it.' });
    if (!(target.appUuid ?? '').trim())
      problems.push({ field: 'appUuid', message: 'The application uuid is needed.' });
  } else {
    if (!(target.host ?? '').trim())
      problems.push({ field: 'host', message: 'The host is needed.' });
    if (!(target.path ?? '').trim())
      problems.push({ field: 'path', message: 'The folder holding docker-compose.yml is needed.' });
  }
  const health = (target.healthUrl ?? '').trim();
  if (health && !/^https?:\/\//i.test(health))
    problems.push({ field: 'healthUrl', message: 'A health URL starts with http:// or https://.' });
  return problems;
}

function emptyFile(): DeployFile {
  return { $comment: SCHEMA_NOTE, targets: [] };
}

// ── [PCODE-55 | S11 | v0.1.0] readDeployFile: tolerant - a broken file is an empty one, not a crash ──
export function readDeployFile(root: string, io: TargetsIo = defaultIo): DeployFile {
  const file = deployPath(root);
  if (!io.existsSync(file)) return emptyFile();
  try {
    const parsed = JSON.parse(io.readFileSync(file, 'utf8')) as Partial<DeployFile>;
    const targets = Array.isArray(parsed.targets) ? parsed.targets : [];
    return {
      ...parsed,
      $comment: SCHEMA_NOTE,
      targets: targets.filter((t: unknown): t is DeployTarget => {
        const row = t as { name?: unknown } | null;
        return typeof row === 'object' && row !== null && typeof row.name === 'string';
      }),
    };
  } catch {
    return emptyFile();
  }
}

export function writeDeployFile(root: string, file: DeployFile, io: TargetsIo = defaultIo): void {
  const dir = path.dirname(deployPath(root));
  if (!io.existsSync(dir)) io.mkdirSync(dir, { recursive: true });
  const ordered: DeployFile = { $comment: SCHEMA_NOTE, ...file, targets: file.targets };
  io.writeFileSync(deployPath(root), `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
}

export function readTargets(root: string, io: TargetsIo = defaultIo): DeployTarget[] {
  return readDeployFile(root, io).targets;
}

export function tokenKey(name: string): string {
  return `${TOKEN_PREFIX}${name.trim().toLowerCase()}`;
}

/** the slice of SecretStorage this module needs */
export interface SecretBag {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

// ── [PCODE-55 | S11 | v0.1.0] saveTarget: the file gets the target, SecretStorage gets the token ──
export async function saveTarget(
  root: string,
  raw: DeployTarget,
  secrets: SecretBag,
  io: TargetsIo = defaultIo,
): Promise<{ target: DeployTarget; tokenStored: boolean }> {
  const { target, token } = stripToken(raw);
  target.name = target.name.trim();
  const file = readDeployFile(root, io);
  const index = file.targets.findIndex(
    (t) => t.name.trim().toLowerCase() === target.name.toLowerCase(),
  );
  const others = file.targets.filter((_t, i) => i !== index);
  const problems = validateTarget(target, others);
  if (problems.length) throw new Error(problems.map((p) => `${p.field}: ${p.message}`).join(' '));
  // an edited target keeps the keys the file already carried
  const merged: DeployTarget = index >= 0 ? { ...file.targets[index], ...target } : target;
  if (index >= 0) file.targets[index] = merged;
  else file.targets.push(merged);
  writeDeployFile(root, file, io);
  if (token) {
    registerSecret(token);
    await secrets.store(tokenKey(target.name), token);
  }
  return { target: merged, tokenStored: Boolean(token) };
}

export async function removeTarget(
  root: string,
  name: string,
  secrets: SecretBag,
  io: TargetsIo = defaultIo,
): Promise<boolean> {
  const file = readDeployFile(root, io);
  const before = file.targets.length;
  file.targets = file.targets.filter(
    (t) => t.name.trim().toLowerCase() !== name.trim().toLowerCase(),
  );
  if (file.targets.length === before) return false;
  writeDeployFile(root, file, io);
  const old = await secrets.get(tokenKey(name));
  await secrets.delete(tokenKey(name));
  forgetSecret(old);
  return true;
}

/** the token of a target; every value handed out is registered with redact() first */
export async function getToken(name: string, secrets: SecretBag): Promise<string | undefined> {
  const token = await secrets.get(tokenKey(name));
  registerSecret(token);
  return token;
}

export async function hasToken(name: string, secrets: SecretBag): Promise<boolean> {
  return Boolean(await secrets.get(tokenKey(name)));
}

export function describeTarget(target: DeployTarget): string {
  return target.kind === 'coolify'
    ? `${target.name} · Coolify · ${target.url ?? ''}`
    : `${target.name} · SSH · ${target.user ? `${target.user}@` : ''}${target.host ?? ''}:${target.path ?? ''}`;
}
