// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
// ── [PCODE-459 | S15 | v0.1.0] Planning in VS Code locks the project in the portal: banner on every tab, conflicting AI planning refused both ways ──
// ── [PCODE-457 | S15 | v0.1.0] VS Code planning as a conversation: Claude asks, the user answers with text and files, then the plan; replan and description change work; Home tab explains itself ──
// ── [PCODE-456 | S15 | v0.1.0] Planning in VS Code shows live in the portal: local AI runs, hook steps, plan documents synced ──
//    Why:  the planning steps done in VS Code show in the Orqiva portal: the Claude Code planning run as a
//          live run of the Planner agent, and the description and plan documents in the project's
//          Documents. All of it is best effort: the portal being away never stops the planning; it is
//          written to the log and tried again at the next step.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '../util/log';
import { ApiError } from '../../../cli/src/loop/api';
import { planePath } from '../state/files';
import { checkPlan } from './orqivaPlan';
import type { RunUsage } from './claudeRun';
import { isoDay } from './planService';
import {
  addRunNote,
  finishPlanRun,
  openPlanRun,
  openRunId,
  planTarget,
  refreshHooks,
  syncLine,
  syncPlanDocs,
  type PlanTarget,
} from '../server/planSync';

export interface PortalDeps {
  log: Pick<Logger, 'info' | 'warn'>;
  home?: () => string;
  /** where the setup program puts orq on Windows */
  installedOrq?: string | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const home = (d: PortalDeps): string => (d.home ?? os.homedir)();

export function defaultInstalledOrq(): string | null {
  const base = process.env['LOCALAPPDATA'];
  return base ? path.join(base, 'Orqiva', 'bin', 'orq.mjs') : null;
}

/** [PCODE-459 | S15 | v0.1.0] the project is being planned elsewhere; the message says who and where */
export class PlanningConflict extends Error {}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The documents to the portal; the line for a notification, '' when nothing changed or it failed. */
export async function syncDocs(root: string, d: PortalDeps): Promise<string> {
  const t = planTarget(root, home(d));
  if (!t) return '';
  try {
    const line = syncLine(await syncPlanDocs(t, d.fetchImpl));
    if (line) d.log.info(line);
    return line;
  } catch (e) {
    d.log.warn('the plan documents could not reach Orqiva: ' + message(e));
    return '';
  }
}

/** Opens the planning run in the portal and gets the hooks ready; null when the folder is not on Orqiva. */
export async function startPlanningRun(root: string, d: PortalDeps): Promise<PlanTarget | null> {
  const t = planTarget(root, home(d));
  if (!t) return null;
  try {
    const hooks = refreshHooks(
      t.root,
      d.installedOrq === undefined ? defaultInstalledOrq() : d.installedOrq,
    );
    if (hooks === 'no-orq')
      d.log.warn(
        'orq is not installed on this computer: the portal shows the run without its steps',
      );
    else if (hooks !== 'current') d.log.info('Claude Code hooks ' + hooks + ' for the live run');
  } catch (e) {
    d.log.warn('the Claude Code hooks could not be updated: ' + message(e));
  }
  await syncDocs(root, d);
  try {
    const old = openRunId(t.root);
    if (old)
      await finishPlanRun(t, old, { status: 'cancelled', summary: 'Planning started again' });
  } catch {
    /* it ended already */
  }
  try {
    const id = await openPlanRun(
      t,
      {
        instruction:
          // [PCODE-457 | S15 | v0.1.0] the run covers the questions too
          'Plan the project in VS Code with Claude Code: read the description, ask the user what is unclear, then write the architecture, design system, criticals and rules, and the sprint plan.',
        client: os.hostname() + ':' + t.root,
      },
      d.fetchImpl,
    );
    await addRunNote(t, id, 'Claude Code is starting in VS Code on ' + os.hostname(), d.fetchImpl);
    d.log.info('planning run ' + id + ' is live in Orqiva');
  } catch (e) {
    // [PCODE-459 | S15 | v0.1.0] someone else plans the project (another computer, or the portal): stop here
    if (e instanceof ApiError && e.status === 409) throw new PlanningConflict(e.message);
    d.log.warn('the planning run could not be shown in Orqiva: ' + message(e));
  }
  return t;
}

/** Ends the planning run with what Claude left behind, then sends the documents. */
export async function endPlanningRun(
  t: PlanTarget,
  d: PortalDeps,
  usage?: RunUsage, // [PCODE-466 | S15 | v0.1.0] the tokens and the price of the conversation
): Promise<string> {
  const id = openRunId(t.root);
  if (id) {
    let text: string | null = null;
    try {
      text = fs.readFileSync(planePath(t.root, 'plan'), 'utf8');
    } catch {
      /* no plan written */
    }
    const today = isoDay((d.now ?? (() => new Date()))());
    const check = text === null ? null : checkPlan(text, null, today);
    const result =
      check === null
        ? ({
            status: 'failed',
            summary: 'No plan was written',
            error: 'The planning terminal was closed before Claude wrote plan.json',
          } as const)
        : check.errors.length
          ? ({
              status: 'failed',
              summary: 'The plan has ' + String(check.errors.length) + ' error(s)',
              error: check.errors.slice(0, 10).join('\n'),
            } as const)
          : ({
              status: 'succeeded',
              summary:
                'Plan written: ' +
                String(check.sprints) +
                ' sprints, ' +
                String(check.items) +
                ' tasks, ' +
                check.from +
                ' to ' +
                check.to,
            } as const);
    try {
      await finishPlanRun(t, id, usage ? { ...result, usage } : result, d.fetchImpl);
      d.log.info('planning run ' + id + ' ended: ' + result.summary);
    } catch (e) {
      d.log.warn('the planning run could not be ended in Orqiva: ' + message(e));
    }
  }
  return syncDocs(t.root, d);
}
