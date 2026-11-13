// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-7 | S02 | v0.1.0] Implement the engine locator for Python and PLANE_CLAUDE_HOME with diagnostics ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the extension never reimplements the engine, so finding it - and a real Python 3, not the Microsoft
//          Store stub that answers to `python` - is the first thing every command depends on. Pure module: the
//          probe (spawn) and the config/env are injected, so the resolution rules are unit-tested.
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface EngineLocation {
  /** Folder holding plane_task.py etc.; '' when not found. */
  home: string;
  /** Python executable (path or bare command) plus leading args, e.g. ['py', '-3']. */
  python: string[];
  versions: { python?: string; engine?: string };
  /** Human-readable problems; empty means usable. Each names the setting that fixes it. */
  problems: string[];
}

export interface ProbeResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
export type Probe = (command: string, args: string[]) => Promise<ProbeResult>;

export interface LocateOptions {
  settings: { engineHome?: string; pythonPath?: string };
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  probe: Probe;
  exists?: (p: string) => boolean;
}

const ENGINE_FILES = ['plane_task.py', 'plane_plan.py', 'plane_init.py', 'plane_common.py'];
const PYTHON_OK = /Python 3\.(\d+)/;

// ── [PCODE-7 | S02 | v0.1.0] pythonCandidates: setting first, then the platform's usual launchers ──
export function pythonCandidates(
  settings: LocateOptions['settings'],
  platform: NodeJS.Platform,
): string[][] {
  const out: string[][] = [];
  if (settings.pythonPath?.trim()) out.push([settings.pythonPath.trim()]);
  if (platform === 'win32') out.push(['py', '-3']);
  out.push(['python3'], ['python']);
  return out;
}

// ── [PCODE-7 | S02 | v0.1.0] resolveHome: setting > PLANE_CLAUDE_HOME env; must hold the engine scripts ──
export function resolveHome(
  settings: LocateOptions['settings'],
  env: NodeJS.ProcessEnv,
  exists: (p: string) => boolean,
): { home: string; problem?: string } {
  const fromSetting = settings.engineHome?.trim();
  const fromEnv = env['PLANE_CLAUDE_HOME']?.trim();
  const candidate = fromSetting || fromEnv || '';
  if (!candidate) {
    return {
      home: '',
      problem:
        'Engine folder not found: set "orqiva.engineHome" to the plane\\claude folder (or run its install.py, which sets PLANE_CLAUDE_HOME).',
    };
  }
  const missing = ENGINE_FILES.filter((f) => !exists(path.join(candidate, f)));
  if (missing.length) {
    const source = fromSetting
      ? 'setting "orqiva.engineHome"'
      : 'environment variable PLANE_CLAUDE_HOME';
    return {
      home: '',
      problem: `Engine folder ${candidate} (from ${source}) is missing ${missing.join(', ')}.`,
    };
  }
  return { home: candidate };
}

// ── [PCODE-7 | S02 | v0.1.0] locate: the only entry point; verifies each Python really answers "Python 3" ──
export async function locate(opts: LocateOptions): Promise<EngineLocation> {
  const exists = opts.exists ?? ((p: string): boolean => fs.existsSync(p));
  const result: EngineLocation = { home: '', python: [], versions: {}, problems: [] };
  const home = resolveHome(opts.settings, opts.env, exists);
  result.home = home.home;
  if (home.problem) result.problems.push(home.problem);

  const tried: string[] = [];
  for (const candidate of pythonCandidates(opts.settings, opts.platform)) {
    const [cmd, ...args] = candidate;
    if (!cmd) continue;
    let probe: ProbeResult;
    try {
      probe = await opts.probe(cmd, [...args, '--version']);
    } catch {
      tried.push(candidate.join(' '));
      continue;
    }
    const text = `${probe.stdout}\n${probe.stderr}`;
    const match = PYTHON_OK.exec(text);
    // the Store stub exits 9009 and prints nothing useful; anything without "Python 3.x" is skipped
    if (probe.code === 0 && match && Number(match[1]) >= 9) {
      result.python = candidate;
      result.versions.python = match[0];
      break;
    }
    tried.push(candidate.join(' '));
  }
  if (!result.python.length) {
    result.problems.push(
      `No working Python 3.9+ found (tried: ${tried.join(', ') || 'nothing'}). Install Python 3 or set "orqiva.pythonPath".`,
    );
  }
  return result;
}

// ── [PCODE-7 | S02 | v0.1.0] cache per session; a settings change or an explicit refresh clears it ──
let cached: Promise<EngineLocation> | undefined;

export function locateCached(opts: LocateOptions, refresh = false): Promise<EngineLocation> {
  if (refresh || !cached) cached = locate(opts);
  return cached;
}

export function clearLocateCache(): void {
  cached = undefined;
}
