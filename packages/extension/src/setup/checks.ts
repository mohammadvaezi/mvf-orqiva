// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-26 | S05 | v0.1.0] Add environment checks for Python, Node, Claude Code, git and the engine folder ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the same checks ui.ps1 Update-Status made, as data: a missing tool is a result with a fix, never
//          an exception. Pure - the probe, the file reader and the settings path are injected.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { locate, type LocateOptions, type Probe } from '../engine/locate';

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  /** a command id (orqiva.*) or a URL the user can open */
  fix?: string;
  required: boolean;
}

export interface CheckOptions {
  probe: Probe;
  settings: LocateOptions['settings'];
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  exists?: (p: string) => boolean;
  readFile?: (p: string) => string;
  claudeSettingsPath?: string;
}

const ENGINE_FILES = ['plane_task.py', 'hooks.py', 'install.py'];

async function version(
  probe: Probe,
  cmd: string,
  args: string[],
  pattern: RegExp,
): Promise<string | null> {
  try {
    const r = await probe(cmd, args);
    const m = pattern.exec(`${r.stdout}\n${r.stderr}`);
    return r.code === 0 && m ? m[0] : null;
  } catch {
    return null;
  }
}

// ── [PCODE-26 | S05 | v0.1.0] runChecks: Python, engine, Node, Claude Code, git, docker (optional), hooks ──
export async function runChecks(o: CheckOptions): Promise<CheckResult[]> {
  const exists = o.exists ?? ((p: string): boolean => fs.existsSync(p));
  const readFile = o.readFile ?? ((p: string): string => fs.readFileSync(p, 'utf8'));
  const out: CheckResult[] = [];

  const loc = await locate({
    settings: o.settings,
    env: o.env,
    platform: o.platform,
    probe: o.probe,
    exists,
  });
  out.push({
    name: 'Python 3',
    ok: loc.python.length > 0,
    detail: loc.python.length
      ? `${loc.versions.python ?? 'Python 3'} (${loc.python.join(' ')})`
      : (loc.problems.find((p) => p.includes('Python')) ?? 'not found'),
    ...(loc.python.length ? {} : { fix: 'https://www.python.org/downloads/' }),
    required: true,
  });
  const missing = loc.home
    ? ENGINE_FILES.filter((f) => !exists(path.join(loc.home, f)))
    : ENGINE_FILES;
  out.push({
    name: 'Engine folder',
    ok: Boolean(loc.home) && missing.length === 0,
    detail: loc.home
      ? missing.length
        ? `${loc.home} is missing ${missing.join(', ')}`
        : loc.home
      : (loc.problems.find((p) => p.includes('Engine')) ?? 'not configured'),
    ...(loc.home && !missing.length
      ? {}
      : { fix: 'workbench.action.openSettings?orqiva.engineHome' }),
    required: true,
  });

  const node = await version(o.probe, 'node', ['--version'], /v\d+\.\d+\.\d+/);
  out.push({
    name: 'Node.js',
    ok: node !== null,
    detail: node ?? 'not found',
    ...(node ? {} : { fix: 'https://nodejs.org/' }),
    required: true,
  });

  const claude = await version(
    o.probe,
    o.platform === 'win32' ? 'claude.cmd' : 'claude',
    ['--version'],
    /\d+\.\d+\.\d+/,
  );
  out.push({
    name: 'Claude Code',
    ok: claude !== null,
    detail: claude ?? 'not found',
    ...(claude ? {} : { fix: 'https://docs.claude.com/en/docs/claude-code/setup' }),
    required: true,
  });

  const git = await version(o.probe, 'git', ['--version'], /\d+\.\d+\.\d+/);
  out.push({
    name: 'git',
    ok: git !== null,
    detail: git ?? 'not found',
    ...(git ? {} : { fix: 'https://git-scm.com/downloads' }),
    required: true,
  });

  const docker = await version(o.probe, 'docker', ['--version'], /\d+\.\d+\.\d+/);
  out.push({
    name: 'Docker',
    ok: docker !== null,
    detail: docker ?? 'not found (needed for the Docker panel only)',
    ...(docker ? {} : { fix: 'https://www.docker.com/products/docker-desktop/' }),
    required: false,
  });

  out.push(
    hooksCheck(
      o.claudeSettingsPath ?? path.join(os.homedir(), '.claude', 'settings.json'),
      exists,
      readFile,
    ),
  );
  return out;
}

// ── [PCODE-26 | S05 | v0.1.0] hooksCheck: ~/.claude/settings.json must carry hooks.py and Bash(plane *) ──
export function hooksCheck(
  settingsPath: string,
  exists: (p: string) => boolean,
  readFile: (p: string) => string,
): CheckResult {
  if (!exists(settingsPath))
    return {
      name: 'Claude Code hooks',
      ok: false,
      detail: `${settingsPath} not found`,
      fix: 'orqiva.installHooks',
      required: true,
    };
  let text = '';
  try {
    text = readFile(settingsPath);
  } catch {
    return {
      name: 'Claude Code hooks',
      ok: false,
      detail: `${settingsPath} unreadable`,
      fix: 'orqiva.installHooks',
      required: true,
    };
  }
  const hasHooks = text.includes('hooks.py');
  const hasPlane = text.includes('Bash(plane *)');
  const ok = hasHooks && hasPlane;
  return {
    name: 'Claude Code hooks',
    ok,
    detail: ok
      ? 'installed (hooks + plane command allowed)'
      : !hasHooks
        ? 'hooks not installed'
        : 'plane command not allow-listed',
    ...(ok ? {} : { fix: 'orqiva.installHooks' }),
    required: true,
  };
}

export function allRequiredOk(results: CheckResult[]): boolean {
  return results.filter((r) => r.required).every((r) => r.ok);
}
