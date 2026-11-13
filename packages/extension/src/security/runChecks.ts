// ── [PCODE-66 | S13 | v0.1.0] Add npm audit and secret scan runners wired to the security checklist ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the seam between the runners (pure, in audits.ts) and the checklist file. Each check knows the
//          wording of the item it reports under, so the dated line lands in the right place even after the
//          checklist has been edited, and nothing is ever ticked by a machine.
import { spawn } from 'node:child_process';
import {
  noteLine,
  runNpmAudit,
  runPipAudit,
  scanWorkspaceForSecrets,
  secretScanSummary,
  type AuditOutcome,
  type CommandRunner,
  type Finding,
} from './audits';
import { writeNote } from './checklist';

export type CheckId = 'npm' | 'pip' | 'secrets';

export interface CheckDefinition {
  id: CheckId;
  label: string;
  /** the checklist item this check reports under */
  item: RegExp;
}

// ── [PCODE-66 | S13 | v0.1.0] the three checks and the items they answer ──
export const CHECKS: readonly CheckDefinition[] = [
  { id: 'npm', label: 'npm audit', item: /npm audit|pip-audit|unfixed high/i },
  { id: 'pip', label: 'pip-audit', item: /npm audit|pip-audit|unfixed high/i },
  { id: 'secrets', label: 'Secret scan', item: /No credential is committed/i },
];

export interface CheckResult {
  id: CheckId;
  label: string;
  summary: string;
  unavailable?: string;
  findings?: Finding[];
}

/** `npm audit --json` and friends, as an argv array, never through a shell (criticals #4). */
export const nodeRunner: CommandRunner = (cmd, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${cmd} timed out`));
    }, 120_000);
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    child.on('error', (e: Error) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });

export interface RunCheckDeps {
  root: string;
  run?: CommandRunner;
  python?: readonly string[];
  today?: () => Date;
  /** false in tests that only want the result */
  write?: boolean;
}

export function isoDay(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── [PCODE-66 | S13 | v0.1.0] runCheck: run it, then write the dated line under its item ──
export async function runCheck(id: CheckId, deps: RunCheckDeps): Promise<CheckResult> {
  const def = CHECKS.find((c) => c.id === id);
  if (!def) return { id, label: id, summary: '', unavailable: 'unknown check' };
  const run = deps.run ?? nodeRunner;
  let outcome: AuditOutcome;
  let findings: Finding[] | undefined;

  if (id === 'secrets') {
    const scan = scanWorkspaceForSecrets(deps.root);
    findings = scan.findings;
    outcome = { summary: secretScanSummary(scan) };
  } else if (id === 'npm') {
    outcome = await runNpmAudit(deps.root, run);
  } else {
    outcome = await runPipAudit(deps.root, run, deps.python ?? ['python3']);
  }

  const result: CheckResult = {
    id,
    label: def.label,
    summary: outcome.summary,
    ...(outcome.unavailable ? { unavailable: outcome.unavailable } : {}),
    ...(findings ? { findings } : {}),
  };
  // a check that could not run writes nothing: an absent line is honest, "unavailable" is not a result
  if (deps.write !== false && outcome.summary) {
    const day = isoDay((deps.today ?? (() => new Date()))());
    writeNote(deps.root, def.item, noteLine(`${def.label} — ${outcome.summary}`, day));
  }
  return result;
}
