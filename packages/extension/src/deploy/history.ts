// ── [PCODE-59 | S11 | v0.1.0] Post deployment history to the Release item, including failures ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  a deployment that nobody recorded did not happen. Every attempt - finished, failed or cancelled -
//          becomes one comment on the version's Release item (created when it is missing), written through
//          the engine's `plane note`, and the note carries no token and no query string (criticals #8).
import type { EngineCommands } from '../engine/commands';
import type { PlaneClient } from '../plane/client';
import type { Store } from '../state/store';
import { ensureReleaseItem, releaseTitle } from '../release/releaseItem';
import { redact } from '../util/redact';
import { formatDuration, type DeployResult } from './deployService';
import type { DeployTarget } from './targets';

export const DEPLOY_LEAD = 'Deployed';
export const FAILED_LEAD = 'Deploy failed';
export const CANCELLED_LEAD = 'Deploy cancelled';
/** the lead words the panel filters the Release item's comments by */
export const HISTORY_LEADS = [DEPLOY_LEAD, FAILED_LEAD, CANCELLED_LEAD];

export interface Attempt {
  target: DeployTarget;
  version: string;
  result?: DeployResult;
  error?: string;
  cancelled?: boolean;
  /** YYYY-MM-DD */
  date: string;
}

// ── [PCODE-59 | S11 | v0.1.0] sanitize: a note never carries a token, a query string or more than a line ──
export function sanitize(text: string): string {
  return redact(text)
    .replace(/\?[^\s]*/g, '') // a URL's query string can hold a uuid or a token
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// ── [PCODE-59 | S11 | v0.1.0] noteText: one line per attempt, starting with the word the panel filters by ──
export function noteText(attempt: Attempt): string {
  const where = `${attempt.target.name} (${attempt.target.kind})`;
  if (attempt.cancelled)
    return `${CANCELLED_LEAD} v${attempt.version} to ${where} — ${attempt.date}`;
  if (attempt.error)
    return `${FAILED_LEAD} v${attempt.version} to ${where} — ${sanitize(attempt.error)}, ${attempt.date}`;
  const ms = attempt.result?.ms ?? 0;
  return `${DEPLOY_LEAD} v${attempt.version} to ${where} — ${formatDuration(ms)}, ${attempt.date}`;
}

export function isHistoryLine(text: string): boolean {
  return HISTORY_LEADS.some((lead) => text.trim().startsWith(lead));
}

export interface HistoryDeps {
  client: Pick<PlaneClient, 'getIssues' | 'getComments' | 'webUrl'>;
  engine: Pick<EngineCommands, 'newTask' | 'note'>;
  store: Pick<Store, 'state'>;
  hasApiKey: () => Promise<boolean>;
  /** the changelog section, used when the Release item has to be created */
  section?: string;
  log?: (line: string) => void;
}

// ── [PCODE-59 | S11 | v0.1.0] recordAttempt: find or create the Release item, then post the line ──
export async function recordAttempt(
  attempt: Attempt,
  deps: HistoryDeps,
): Promise<{ posted: boolean; ref: string | null; text: string }> {
  const text = noteText(attempt);
  const out = { posted: false, ref: null as string | null, text };
  try {
    const release = await ensureReleaseItem({
      client: deps.client,
      engine: deps.engine,
      store: deps.store,
      hasApiKey: deps.hasApiKey,
      version: attempt.version,
      section: deps.section ?? '',
      today: attempt.date,
      ...(deps.log ? { log: deps.log } : {}),
    });
    if (!release.ref) {
      deps.log?.(`deployment not recorded: no Release item for v${attempt.version}`);
      return out;
    }
    await deps.engine.note(release.ref, text);
    return { posted: true, ref: release.ref, text };
  } catch (e) {
    // recording is a courtesy; it must never turn a finished deploy into a failed one
    deps.log?.(`deployment note failed: ${e instanceof Error ? e.message : String(e)}`);
    return out;
  }
}

// ── [PCODE-59 | S11 | v0.1.0] loadHistory: the Release item's own comments, newest first ──
export async function loadHistory(version: string, deps: HistoryDeps): Promise<string[]> {
  const link = deps.store.state.link;
  if (!link || !(await deps.hasApiKey())) return [];
  try {
    const issues = await deps.client.getIssues(link.project_id);
    const title = releaseTitle(version).toLowerCase();
    const item = issues.find((i) => i.name.trim().toLowerCase() === title);
    if (!item) return [];
    const comments = await deps.client.getComments(link.project_id, item.id);
    return [...comments]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((c) => c.comment_html.replace(/<[^>]+>/g, '').trim())
      .filter(isHistoryLine);
  } catch (e) {
    deps.log?.(`deployment history unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}
