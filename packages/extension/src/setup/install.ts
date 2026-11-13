// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-28 | S05 | v0.1.0] Install hooks, plane command and MCP server through install.py with progress ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the engine's install.py does the per-machine work (hooks, plane on PATH, allow rule, MCP server,
//          DPAPI store). We run it from the engine folder with the stored key; the key appears in argv exactly
//          once and is masked in every logged line (criticals #1).
import { runEngine, type CancelToken, type EngineSpec, type RunOptions } from '../engine/run';
import { OrqivaError } from '../util/errors';
import { redact, registerSecret } from '../util/redact';

export interface InstallDeps {
  spec: EngineSpec;
  apiKey: string | undefined;
  baseUrl: string;
  workspace: string;
  onLine: (line: string) => void;
  cancel?: CancelToken;
  /** injected for tests */
  run?: typeof runEngine;
}

export interface InstallResult {
  ok: true;
  summary: string;
}

// ── [PCODE-28 | S05 | v0.1.0] installHooks: `install.py --key … --url … --workspace …` with cwd = engine home ──
export async function installHooks(deps: InstallDeps): Promise<InstallResult> {
  if (!deps.apiKey)
    throw new OrqivaError(
      'Connect the legacy tracker first. Install needs the stored API key.',
      'config',
    );
  if (!deps.spec.home)
    throw new OrqivaError(
      'Engine folder not found. Fix the setting orqiva.engineHome first.',
      'config',
    );
  registerSecret(deps.apiKey);
  const args = ['--key', deps.apiKey, '--url', deps.baseUrl, '--workspace', deps.workspace];
  const opts: RunOptions = {
    cwd: deps.spec.home,
    timeoutMs: 300_000,
    onLine: deps.onLine,
    ...(deps.cancel ? { cancel: deps.cancel } : {}),
  };
  const r = await (deps.run ?? runEngine)(deps.spec, 'install.py', args, opts);
  const lines = r.stdout.split(/\r?\n/).filter((l) => l.trim());
  return {
    ok: true,
    summary: redact(lines.find((l) => /^Done/.test(l)) ?? lines.at(-1) ?? 'Installed.'),
  };
}
