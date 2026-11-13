// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
// ── [PCODE-456 | S15 | v0.1.0] Planning in VS Code shows live in the portal: local AI runs, hook steps, plan documents synced ──
// ── [PCODE-290 | S15 | v0.1.0] T30.4 UI kit in the code: component usage, a lint for non-token values, the agent rule ──
// ── [PCODE-247 | S15 | v0.1.0] T25.2 Agent scopes enforced: files, branches, network, trace redaction ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-103 | S15 | v0.1.0] Build the CLI `orq` and the Claude Code hooks against the new server ──
//    Why:  the loop enforced inside Claude Code, as hooks.py did against Plane: no code edit without an
//          active task, the fingerprint in front of the agent on every prompt, and what happens (files,
//          commits, test runs) reported to the board live. A hook decides from the local cache in
//          milliseconds; the network is only used to report, with a short timeout, and anything that cannot
//          be sent waits in the queue. A hook never fails the session: it always exits 0.
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { agentScopeAllows, isCode } from '@orqiva/shared';
import { flushQueue, sendOrQueue } from './api.js';
import {
  loadActive,
  saveActive,
  statePath,
  writeJson,
  readJson,
  type ActiveTask,
} from './config.js';
import { activeFrom, linked, type LoopDeps, type Linked, type StartOut } from './commands.js';
import { fileHasMarker } from './scan.js';
import { readTranscriptUsage } from './usage.js';

export interface HookInput {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  source?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    notebook_path?: string;
    command?: string;
    // [PCODE-456 | S15 | v0.1.0] what the reading tools looked at, for the live run
    pattern?: string;
    path?: string;
    url?: string;
    query?: string;
  };
  tool_response?: unknown;
  /** [PCODE-466 | S15 | v0.1.0] the session's transcript: the model calls with their tokens */
  transcript_path?: string;
}

export interface HookOutput {
  /** JSON for Claude Code on stdout, or nothing */
  stdout: string;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const PROGRESS_EVERY_MS = 60_000;
const TEST_COMMAND =
  /\b(npm|pnpm|yarn)\s+(run\s+)?(test|check)\b|\bvitest\b|\bjest\b|\bpytest\b|\bgo\s+test\b|\bcargo\s+test\b|\bdotnet\s+test\b|\bmvn\b.*\btest\b|\bgradlew?\b.*\btest\b/;
const GIT_COMMIT = /\bgit\b[^|;&]*\bcommit\b/;

/**
 * [PCODE-247 | S15 | v0.1.0] The branches a shell command writes to: a new branch (checkout -b, switch -c, branch <name>), the
 * branch a push updates, or the current branch for a commit, merge, rebase or a push without a branch.
 */
export function branchTargets(command: string, current: string): string[] {
  const out = new Set<string>();
  for (const part of command.split(/&&|\|\||;|\|/)) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    const g = words.indexOf('git');
    if (g < 0) continue;
    // the subcommand after git's own options (git -C dir commit …)
    let i = g + 1;
    while (i < words.length && (words[i] ?? '').startsWith('-'))
      i += words[i] === '-C' || words[i] === '-c' ? 2 : 1;
    const sub = words[i] ?? '';
    const args = words.slice(i + 1);
    const plain = args.filter((a) => !a.startsWith('-'));
    if (sub === 'checkout' || sub === 'switch') {
      const at = args.findIndex((a) =>
        ['-b', '-B', '-c', '-C', '--create', '--force-create'].includes(a),
      );
      if (at >= 0 && args[at + 1]) out.add(args[at + 1] ?? '');
    } else if (sub === 'branch') {
      if (
        !args.some((a) =>
          ['-d', '-D', '--delete', '-l', '--list', '-a', '-r', '--show-current'].includes(a),
        ) &&
        plain[0]
      )
        out.add(plain[0]);
    } else if (sub === 'push') {
      const refs = plain.slice(1);
      if (!refs.length) out.add(current);
      for (const r of refs)
        out.add(
          (r.split(':').pop() ?? r).replace(/^\+/, '').replace(/^refs\/heads\//, '') || current,
        );
    } else if (['commit', 'merge', 'rebase', 'cherry-pick', 'revert', 'am'].includes(sub))
      out.add(current);
  }
  return [...out].filter(Boolean);
}

const context = (event: string, text: string): HookOutput => ({
  stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }),
});

const deny = (reason: string): HookOutput => ({
  stdout: JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }),
});

const NOTHING: HookOutput = { stdout: '' };

/** `src/generated/` or `docs/*.ts`: a prefix, or a pattern with * (any characters but /) and ** (anything). */
export function matchesPath(rel: string, pattern: string): boolean {
  if (!pattern.includes('*'))
    return rel === pattern || rel.startsWith(pattern.endsWith('/') ? pattern : pattern + '/');
  const re = pattern
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('.*');
  return new RegExp('^' + re + '$').test(rel);
}

/** The repository-relative path of a file a tool works on, or null when it is outside the repository. */
function repoPath(root: string, input: HookInput): string | null {
  const p = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!p) return null;
  const abs = isAbsolute(p) ? p : resolve(input.cwd ?? root, p);
  const rel = relative(root, abs).replace(/\\/g, '/');
  if (rel.startsWith('../') || rel === '..' || isAbsolute(rel)) return null;
  return rel;
}

export function guarded(rel: string, active: ActiveTask | null): boolean {
  if (!isCode(rel)) return false;
  return !(active?.rules.unguardedPaths ?? []).some((p) => matchesPath(rel, p));
}

const progressPath = (l: Linked): string => l.ws + '/loop/progress';

async function reportPending(l: Linked, a: ActiveTask, now: number): Promise<void> {
  if (a.pending.length === 0) return;
  const files = a.pending.slice(0, 500);
  a.pending = [];
  a.lastProgressAt = now;
  saveActive(l.root, a);
  await sendOrQueue(l.root, l.api, 'POST', progressPath(l), {
    client: l.client,
    kind: 'edit',
    files,
  });
}

// ── [PCODE-456 | S15 | v0.1.0] Planning in VS Code shows live in the portal: local AI runs, hook steps, plan documents synced ──
//    While VS Code has a run of this folder open in the portal (.orqiva/state/run.json), every tool Claude
//    uses, its waiting and its answers become steps of that run, live. Steps are not queued: a step that
//    cannot be sent now is of no use later.
export interface LocalRun {
  runId: string;
}

const READ_TOOLS: Record<string, string> = {
  Read: 'Read',
  Write: 'Wrote',
  Edit: 'Edited',
  MultiEdit: 'Edited',
  NotebookEdit: 'Edited',
};

/** One line for the run page: what the tool did, with the path inside the repository. */
export function describeTool(root: string, input: HookInput): { text: string; path?: string } {
  const tool = input.tool_name ?? 'a tool';
  const t = input.tool_input ?? {};
  const where = repoPath(root, input) ?? t.file_path ?? t.notebook_path;
  const verb = READ_TOOLS[tool];
  if (verb && where) return { text: verb + ' ' + where, path: where };
  if (tool === 'Glob' && t.pattern) return { text: 'Looked for files: ' + t.pattern };
  if (tool === 'Grep' && t.pattern) return { text: 'Searched for ' + JSON.stringify(t.pattern) };
  if (tool === 'Bash' && t.command) return { text: 'Ran: ' + t.command.slice(0, 300) };
  if (tool === 'WebFetch' && t.url) return { text: 'Fetched ' + t.url.slice(0, 300) };
  if (tool === 'WebSearch' && t.query)
    return { text: 'Searched the web for ' + JSON.stringify(t.query) };
  return { text: 'Used ' + tool };
}

async function reportRunStep(l: Linked, event: string, input: HookInput): Promise<void> {
  const run = readJson<LocalRun>(statePath(l.root, 'run.json'));
  if (!run?.runId) return;
  let step: { kind: 'note' | 'tool_result' | 'error'; text: string; tool?: string; path?: string };
  if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
    const d = describeTool(l.root, input);
    step =
      event === 'PostToolUse'
        ? { kind: 'tool_result', ...d, ...(input.tool_name ? { tool: input.tool_name } : {}) }
        : { kind: 'error', text: 'Failed: ' + d.text };
  } else if (event === 'SessionStart') step = { kind: 'note', text: 'Claude Code started' };
  else if (event === 'UserPromptSubmit') step = { kind: 'note', text: 'Got an answer in VS Code' };
  else if (event === 'Stop')
    step = {
      kind: 'note',
      text: 'Claude is waiting: it finished, or it asks something in VS Code',
    };
  else return;
  try {
    await l.api.call('POST', l.ws + '/agent-runs/' + run.runId + '/steps', step, 3000);
  } catch {
    // the run ended or the server is away: the run page simply misses this step
  }
}

// ── [PCODE-466 | S15 | v0.1.0] reportUsage: the tokens of the turn, per model, for the task they were spent on ──
//    The transcript is read every time, so tokens spent without a task are not counted on the next one.
//    A planning conversation (its live run in run.json) reports its own usage when it ends; the turn that
//    finished a task with orq done counts for that task, for a few minutes after.
const JUST_DONE_MS = 15 * 60_000;

async function reportUsage(l: Linked, input: HookInput, active: ActiveTask | null): Promise<void> {
  if (!input.transcript_path || existsSync(statePath(l.root, 'run.json'))) return;
  const usage = readTranscriptUsage(input.transcript_path, statePath(l.root, 'usage.json'));
  const done = readJson<{ at?: string }>(statePath(l.root, 'last-task.json'));
  const justDone = Boolean(done?.at && Date.now() - Date.parse(done.at) < JUST_DONE_MS);
  if (!active && !justDone) return;
  for (const u of usage)
    try {
      await sendOrQueue(l.root, l.api, 'POST', progressPath(l), {
        client: l.client,
        kind: 'usage',
        ...u,
      });
    } catch {
      // no task this client worked on lately: the tokens are nobody's
    }
}

/** The Claude Code hook named by event, with the hook's JSON from stdin. */
export async function runHook(
  event: string,
  stdinText: string,
  deps: LoopDeps,
): Promise<HookOutput> {
  let input: HookInput = {};
  try {
    input = (JSON.parse(stdinText || '{}') as HookInput | null) ?? {};
  } catch {
    // not JSON: run with what is known
  }
  const cwd = input.cwd ?? deps.cwd;
  let l: Linked;
  try {
    l = linked({ ...deps, cwd });
  } catch {
    return NOTHING; // not a linked repository, or not signed in: orq stays out of the way
  }
  const now = (deps.now ?? Date.now)();
  const active = loadActive(l.root);
  await reportRunStep(l, event, input); // [PCODE-456 | S15 | v0.1.0]

  try {
    switch (event) {
      case 'SessionStart': {
        await flushQueue(l.root, l.api, 3000);
        // the server is the truth: another tool may have finished or started the task meanwhile
        let a = active;
        try {
          const r = await l.api.call<{ active: Omit<StartOut, 'resumed'> | null }>(
            'GET',
            l.ws + '/loop/active?client=' + encodeURIComponent(l.client),
            undefined,
            3000,
          );
          a = r.active
            ? activeFrom({ ...r.active, resumed: true }, input.session_id ?? '', active)
            : null;
          saveActive(l.root, a);
        } catch {
          // offline: trust the cache
        }
        const head =
          'Orqiva project ' +
          l.link.projectName +
          ' (' +
          l.link.projectKey +
          '). Loop: orq sync → orq start <REF> or orq new "title" --desc-file f.md --start → code with fingerprints → orq done <REF>.';
        return context(
          'SessionStart',
          a
            ? head +
                '\nActive task: ' +
                a.ref +
                ' ' +
                a.title +
                '. Fingerprint: `' +
                a.marker +
                '` in a comment, once per file header and above every block written for it.' +
                // [PCODE-290 | S15 | v0.1.0] the kit rule for UI work
                (a.rules.kit ? '\n' + a.rules.kit : '')
            : head +
                '\nNo active task: code edits are refused until one is started (orq list shows the open ones).',
        );
      }
      case 'UserPromptSubmit':
        return active
          ? context(
              'UserPromptSubmit',
              'Active task ' + active.ref + ' — fingerprint `' + active.marker + '`.',
            )
          : NOTHING;

      case 'PreToolUse': {
        // [PCODE-247 | S15 | v0.1.0] a task assigned to an agent: only the branches in its scope are written to
        const agent = active?.rules.agent;
        const command = input.tool_input?.command;
        if (input.tool_name === 'Bash' && command && agent?.branches.length) {
          const head = await deps.exec('git', ['symbolic-ref', '--short', 'HEAD'], l.root);
          for (const b of branchTargets(command, head.code === 0 ? head.out.trim() : '')) {
            const ok = agentScopeAllows(agent, 'branches', b, agent.name);
            if (!ok.allowed)
              return deny(
                ok.reason +
                  '. ' +
                  (active?.ref ?? '') +
                  ' is assigned to ' +
                  agent.name +
                  '; work on a branch its scope allows.',
              );
          }
          return NOTHING;
        }
        if (!input.tool_name || !EDIT_TOOLS.has(input.tool_name)) return NOTHING;
        // [PCODE-247 | S15 | v0.1.0] and only the files in its scope are changed
        const inRepo = repoPath(l.root, input);
        if (inRepo && agent?.files.length) {
          const ok = agentScopeAllows(agent, 'files', inRepo, agent.name);
          if (!ok.allowed)
            return deny(
              ok.reason + '. ' + (active?.ref ?? '') + ' is assigned to ' + agent.name + '.',
            );
        }
        const rel = inRepo;
        if (!rel || !guarded(rel, active)) return NOTHING;
        if (!active)
          return deny(
            'No active Orqiva task for ' +
              l.link.projectKey +
              ', so code edits are refused. Start one first: `orq list`, then `orq start <REF>` (or `orq new "title" --desc-file f.md --start`).',
          );
        return NOTHING;
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        if (!active) return NOTHING;
        // [PCODE-456 | S15 | v0.1.0] a failed edit changed nothing; only failed commands count (tests)
        if (event === 'PostToolUseFailure' && input.tool_name !== 'Bash') return NOTHING;
        if (input.tool_name && EDIT_TOOLS.has(input.tool_name)) {
          const rel = repoPath(l.root, input);
          if (!rel || !guarded(rel, active)) return NOTHING;
          if (!active.files.includes(rel)) active.files.push(rel);
          if (!active.pending.includes(rel)) active.pending.push(rel);
          saveActive(l.root, active);
          if (now - active.lastProgressAt >= PROGRESS_EVERY_MS) await reportPending(l, active, now);
          if (!fileHasMarker(join(l.root, rel), active.ref))
            return context(
              'PostToolUse',
              rel +
                ' has no fingerprint of ' +
                active.ref +
                ' yet. Add `' +
                active.marker +
                '` in a comment to its header and above the block you wrote.',
            );
          return NOTHING;
        }
        const command = input.tool_input?.command;
        if (input.tool_name === 'Bash' && command) {
          if (GIT_COMMIT.test(command) && event === 'PostToolUse') {
            const head = await deps.exec('git', ['rev-parse', 'HEAD'], l.root);
            const sha = head.out.trim();
            if (head.code === 0 && /^[0-9a-f]{40}$/.test(sha) && sha !== active.lastCommit) {
              active.lastCommit = sha;
              saveActive(l.root, active);
              await sendOrQueue(l.root, l.api, 'POST', progressPath(l), {
                client: l.client,
                kind: 'commit',
                commit: sha,
              });
            }
          } else if (TEST_COMMAND.test(command)) {
            await reportPending(l, active, now);
            await sendOrQueue(l.root, l.api, 'POST', progressPath(l), {
              client: l.client,
              kind: 'tests',
              command: command.slice(0, 300),
              green: event === 'PostToolUse',
            });
          }
        }
        return NOTHING;
      }
      case 'Stop':
      case 'PreCompact':
      case 'SessionEnd': {
        if (active) await reportPending(l, active, now);
        await reportUsage(l, input, active); // [PCODE-466 | S15 | v0.1.0]
        await flushQueue(l.root, l.api, 3000);
        if (event === 'SessionEnd' && active)
          await sendOrQueue(l.root, l.api, 'POST', progressPath(l), {
            client: l.client,
            kind: 'paused',
          });
        return NOTHING;
      }
      default:
        return NOTHING;
    }
  } catch {
    return NOTHING; // a report the server refused never blocks the agent
  }
}

export const RUN_TOOLS = 'Edit|Write|MultiEdit|NotebookEdit|Bash|Read|Glob|Grep|WebFetch|WebSearch';

const HOOK_EVENTS: { event: string; matcher?: string; timeout: number }[] = [
  { event: 'SessionStart', timeout: 10 },
  { event: 'UserPromptSubmit', timeout: 5 },
  // [PCODE-247 | S15 | v0.1.0] Bash too: a task assigned to an agent keeps to the agent's branches
  { event: 'PreToolUse', matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash', timeout: 5 },
  // [PCODE-456 | S15 | v0.1.0] the reading tools too: a run open in the portal shows what Claude looks at
  { event: 'PostToolUse', matcher: RUN_TOOLS, timeout: 10 },
  { event: 'PostToolUseFailure', matcher: RUN_TOOLS, timeout: 10 },
  { event: 'PreCompact', timeout: 10 },
  { event: 'Stop', timeout: 10 },
  { event: 'SessionEnd', timeout: 10 },
];

interface HookEntry {
  matcher?: string;
  hooks: { type: string; command: string; timeout?: number }[];
}
type Settings = Record<string, unknown> & { hooks?: Record<string, HookEntry[]> };

/** Writes the hooks into .claude/settings.json, keeping every other setting and every other hook. */
export function installHooks(root: string, peMain: string, node = 'node'): string {
  const path = join(root, '.claude', 'settings.json');
  const settings: Settings = (existsSync(path) ? readJson<Settings>(path) : null) ?? {};
  const hooks = settings.hooks ?? {};
  // a orq hook from an earlier install (maybe from another path) is replaced, never doubled
  const ours = (c: string, event: string): boolean =>
    c.endsWith(' hook ' + event) &&
    // [PCODE-456 | S15 | v0.1.0] and the single-file orq.mjs the setup program installs
    (c.includes('main.js"') ||
      c.includes('orq.mjs"') ||
      c.startsWith('pe ') ||
      c.startsWith('orq '));
  for (const h of HOOK_EVENTS) {
    const command = node + ' "' + peMain + '" hook ' + h.event;
    const kept = (hooks[h.event] ?? [])
      .map((e) => ({ ...e, hooks: e.hooks.filter((x) => !ours(x.command, h.event)) }))
      .filter((e) => e.hooks.length > 0);
    hooks[h.event] = [
      ...kept,
      {
        ...(h.matcher ? { matcher: h.matcher } : {}),
        hooks: [{ type: 'command', command, timeout: h.timeout }],
      },
    ];
  }
  settings.hooks = hooks;
  writeJson(path, settings);
  return path;
}

export function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((done) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d: string) => (text += d));
    process.stdin.on('end', () => {
      done(text);
    });
    process.stdin.on('error', () => {
      done(text);
    });
  });
}
