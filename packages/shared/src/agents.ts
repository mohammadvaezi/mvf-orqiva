// ── [PCODE-334 | S15 | v0.1.0] T33.4c MCP servers per agent: registry, our own MCP client, tools in runs under the agent's rules ──
// ── [PCODE-333 | S15 | v0.1.0] T33.4b Sandbox per run with repo tools, pull requests by a bot Git identity ──
// ── [PCODE-247 | S15 | v0.1.0] T25.2 Agent scopes enforced: files, branches, network, trace redaction ──
// ── [PCODE-205 | S15 | v0.1.0] T17.3 Release agent with release tools, approved release notes, changelogs per release, project and train ──
// ── [PCODE-198 | S15 | v0.1.0] T16.2 Documenter agent: document tools with knowledge scopes, agent-written drafts, Ask the Documenter ──
// ── [PCODE-180 | S15 | v0.1.0] B5.1 Agents live: settings, versioned prompts, action rules, autonomy, pause all, budgets in euro, traces, costs, quality ──
//    Why:  the rules every agent runs under, shared by the runtime, the web app and the extension: which
//          class of action a tool belongs to, what the agent's autonomy and its rules decide for it (run,
//          ask a person, refuse), money in euro from the provider's US dollars, the month-end forecast and
//          the one-sentence summary of a run.

export const ACTION_CLASSES = [
  'comment',
  'write',
  'move',
  'shell',
  'push',
  'merge',
  'deploy',
  'spend',
  'external',
] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];
export type ActionRule = 'never' | 'ask' | 'allowed';
export const AUTONOMY_LEVELS = ['suggest', 'approve', 'scoped', 'autonomous'] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

export const ACTION_TEXT: Record<ActionClass, string> = {
  comment: 'Comment on tasks',
  write: 'Create and change tasks',
  move: 'Move tasks between states',
  shell: 'Run shell commands',
  push: 'Push to a branch',
  merge: 'Merge a pull request',
  deploy: 'Deploy',
  spend: 'Spend money (paid APIs)',
  external: 'Call other services',
};

/** The class of action of each tool; reading is always allowed. */
export const TOOL_CLASS: Record<string, ActionClass | 'read'> = {
  list_items: 'read',
  get_item: 'read',
  add_comment: 'comment',
  create_item: 'write',
  update_item: 'write',
  move_item: 'move',
  // [PCODE-198 | S15 | v0.1.0] documents: reading is reading, a page is a write
  list_docs: 'read',
  read_doc: 'read',
  write_doc: 'write',
  // [PCODE-205 | S15 | v0.1.0] releases
  list_releases: 'read',
  read_release: 'read',
  write_release_notes: 'write',
  // [PCODE-247 | S15 | v0.1.0] reading a web page; the network scope decides which hosts
  fetch_url: 'read',
  // [PCODE-333 | S15 | v0.1.0] the run's sandbox: reading is reading, a file is a write, a pull request a push
  read_repo_file: 'read',
  write_file: 'write',
  open_pull_request: 'push',
};

/** What an agent may do when no rule is set: what agents could do before rules existed. */
export const DEFAULT_RULES: Record<ActionClass, ActionRule> = {
  comment: 'allowed',
  write: 'allowed',
  move: 'ask',
  shell: 'never',
  push: 'never',
  merge: 'never',
  deploy: 'never',
  spend: 'never',
  external: 'never',
};

/**
 * Whether a tool call runs, waits for a person or is refused. "Suggests only" refuses every action;
 * "acts, asks first" asks for every action; within scope and autonomous follow the rules, and a rule of
 * "ask" or "never" always holds.
 */
export function toolDecision(
  tool: string,
  autonomy: Autonomy,
  rules: Partial<Record<ActionClass, ActionRule>>,
): 'run' | 'ask' | 'refuse' {
  return classDecision(TOOL_CLASS[tool] ?? 'external', autonomy, rules);
}

/** [PCODE-334 | S15 | v0.1.0] The same decision for a class of action, as an MCP server's tools have. */
export function classDecision(
  cls: ActionClass | 'read',
  autonomy: Autonomy,
  rules: Partial<Record<ActionClass, ActionRule>>,
): 'run' | 'ask' | 'refuse' {
  if (cls === 'read') return 'run';
  const rule = rules[cls] ?? DEFAULT_RULES[cls];
  if (rule === 'never' || autonomy === 'suggest') return 'refuse';
  if (rule === 'ask' || autonomy === 'approve') return 'ask';
  return 'run';
}

/** Millionths of a US dollar in euro cents at a rate (1 USD = rate EUR). */
export const usdMicrosToCents = (micros: number, usdEur: number): number =>
  Math.round((micros / 10_000) * usdEur);

/** Euro cents spent by this day of the month, carried on at the same pace to the month's end. */
export function monthForecast(spentCents: number, day: number, daysInMonth: number): number {
  if (day <= 0) return spentCents;
  return Math.round((spentCents / day) * daysInMonth);
}

/** The first sentence of a text, at most 200 characters: the run's one-line summary. */
export function firstSentence(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  const s = m?.[1] ?? t;
  return s.length > 200 ? s.slice(0, 199).trimEnd() + '…' : s;
}
