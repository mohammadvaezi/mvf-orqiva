// ── [PCODE-229 | S15 | v0.1.0] T22.2 Task detail and comments on the phone, with quick state and assignee changes ──
// ── [PCODE-226 | S15 | v0.1.0] T21.3 React Native (Expo) app shell: pairing, live feed, offline cache ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-106 | S15 | v0.1.0] Add the team activity feed panel to VS Code ──
// ── [PCODE-108 | S15 | v0.1.0] Integrate Git hosts: GitHub and Gitea webhooks, commits and PRs on items, live ──
// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
// ── [PCODE-145 | S15 | v0.1.0] Add the review stage and the Reviewer agent ──
// ── [PCODE-144 | S15 | v0.1.0] Export evidence packs with one click ──
// ── [PCODE-139 | S15 | v0.1.0] Add security findings with SARIF import, tasks for findings and the security gate ──
// ── [PCODE-135 | S15 | v0.1.0] Add test cases from acceptance criteria and test runs ──
// ── [PCODE-132 | S15 | v0.1.0] Run deploys through our own runner and stream each step ──
// ── [PCODE-127 | S15 | v0.1.0] Show measured progress on every card from acceptance criteria and subtasks ──
// ── [PCODE-125 | S15 | v0.1.0] Approve proposals with an electronic signature and turn them into a plan ──
// ── [PCODE-124 | S15 | v0.1.0] Generate proposals with an estimate from the interview, with versions ──
// ── [PCODE-123 | S15 | v0.1.0] Add the ideas inbox and the AI owner interview ──
// ── [PCODE-122 | S15 | v0.1.0] Show agents in the web app: agents page, ask from a task, live run view, approvals, card badge ──
//    Why:  an activity event as a sentence ("Ada moved APP-3 Export → Review"), the same in the web app's
//          Activity page and the VS Code feed. Moved here from the extension so both read alike.
import type { ActivityEvent } from './events.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function whenText(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? hm : String(d.getDate()) + ' ' + (MONTHS[d.getMonth()] ?? '') + ' ' + hm;
}

const count = (n: number, what: string): string => String(n) + ' ' + what + (n === 1 ? '' : 's');

// [PCODE-229 | S15 | v0.1.0] how a changed field reads in a sentence
const FIELD_WORDS: Record<string, string> = {
  stateId: 'state',
  assigneeId: 'assignee',
  sprintId: 'sprint',
  parentId: 'parent',
  labelIds: 'labels',
  dueDate: 'due date',
  startDate: 'start date',
  durationDays: 'duration',
  percentDone: 'progress',
  scheduleMode: 'scheduling',
};
const fieldWord = (f: string): string =>
  FIELD_WORDS[f] ??
  f
    .replace(/Id$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();

/** One event as a sentence. Unknown kinds still read sensibly: "<who> <verb> <what>". */
export function describe(e: ActivityEvent): string {
  const d = e.data;
  const who = d.actor.name ?? (d.actor.kind === 'system' ? 'Orqiva' : 'Someone');
  const what = d.object.label ?? d.object.type;
  const on = d.parent?.type === 'item' ? (d.parent.label ?? 'a task') : what;
  const ch = d.changes ?? {};
  const state = ch['state']?.to;
  if (d.object.type === 'agent_run') return describeRun(e, who);
  // [PCODE-139 | S15 | v0.1.0] security scans and decisions on findings
  if (d.object.type === 'finding') {
    const scan = ch['scan']?.to as
      { tool?: string; found?: number; new?: number; fixed?: number } | undefined;
    if (scan && typeof scan === 'object')
      return (
        who +
        ' ran ' +
        (scan.tool ?? 'a scan') +
        ': ' +
        String(scan.found ?? 0) +
        ' found, ' +
        String(scan.new ?? 0) +
        ' new, ' +
        String(scan.fixed ?? 0) +
        ' fixed'
      );
    const st = ch['status']?.to;
    if (st === 'accepted') return who + ' accepted the risk of ' + what;
    if (st === 'false_positive') return who + ' marked ' + what + ' as a false positive';
    if (st === 'open') return who + ' opened ' + what + ' again';
  }
  // [PCODE-135 | S15 | v0.1.0] test runs: started and ended, with their score
  if (d.object.type === 'test_run') {
    const score = d.progress
      ? ' (' + String(d.progress.done) + ' of ' + String(d.progress.total) + ' passed)'
      : '';
    if (d.verb === 'created') return who + ' started the test run ' + what;
    if (d.verb === 'completed') return 'Test run ' + what + ' passed' + score;
    if (d.verb === 'failed') return 'Test run ' + what + ' failed' + score;
  }
  // [PCODE-132 | S15 | v0.1.0] deploys: asked for, started, ended
  if (d.object.type === 'deploy') {
    const env = d.parent?.label ?? 'an environment';
    if (d.verb === 'created') return who + ' started a deploy to ' + env;
    if (d.verb === 'started') return who + ' is deploying to ' + env;
    if (d.verb === 'completed') return 'The deploy to ' + env + ' succeeded';
    if (d.verb === 'failed') return 'The deploy to ' + env + ' failed';
    if (ch['status']?.to === 'cancelled') return who + ' cancelled the deploy to ' + env;
  }
  // [PCODE-123 | S15 | v0.1.0] ideas: filed, interviewed, decided
  if (d.object.type === 'idea') {
    const idea = '“' + what + '”';
    if (d.verb === 'created') return who + ' filed the idea ' + idea;
    // [PCODE-125 | S15 | v0.1.0] the owner's signature
    if (d.verb === 'approved') return who + ' approved and signed the proposal for ' + idea;
    if (d.verb === 'rejected') return who + ' declined the proposal for ' + idea;
    if (ch['interview']?.to === 'done') return 'The interview on ' + idea + ' is complete';
    // [PCODE-124 | S15 | v0.1.0]
    const version = ch['proposal']?.to;
    if (typeof version === 'number')
      return who + ' wrote version ' + String(version) + ' of the proposal for ' + idea;
    const st = ch['status']?.to;
    if (typeof st === 'string') return who + ' set the idea ' + idea + ' to ' + st;
  }
  // [PCODE-226 | S15 | v0.1.0] people: joining, and their tokens (a phone signing in or out is one)
  if (d.object.type === 'member') {
    const made = ch['token']?.to;
    const gone = ch['token']?.from;
    const phone = (name: string): string | null =>
      name.startsWith('Phone: ') ? name.slice('Phone: '.length) : null;
    if (typeof made === 'string') {
      const p = phone(made);
      return p ? who + ' signed in on ' + p : who + ' made the token “' + made + '”';
    }
    if (typeof gone === 'string') {
      const p = phone(gone);
      return p ? who + ' signed out ' + p : who + ' revoked the token “' + gone + '”';
    }
    if (d.verb === 'created') return what === who ? who + ' joined' : who + ' added ' + what;
  }
  // [PCODE-145 | S15 | v0.1.0] a review decision on a task
  const review = ch['review']?.to;
  if (review === 'approved') return who + ' approved ' + what + ' in review';
  if (review === 'changes_requested') return who + ' requested changes on ' + what;
  switch (d.verb) {
    case 'created':
      return who + ' created ' + what;
    case 'moved':
      return who + ' moved ' + what + (typeof state === 'string' ? ' → ' + state : '');
    case 'started':
      return who + ' started ' + what;
    case 'completed':
      return who + ' finished ' + what + (typeof state === 'string' ? ' → ' + state : '');
    case 'commented':
      return who + ' commented on ' + on;
    case 'assigned':
      return who + ' assigned ' + what;
    case 'progressed': {
      // [PCODE-127 | S15 | v0.1.0] acceptance criteria, with the progress they make
      const crit = ch['criteria']?.to;
      if (typeof crit === 'string') {
        const n = d.progress
          ? ' (' + String(d.progress.done) + ' of ' + String(d.progress.total) + ')'
          : '';
        if (crit === 'done') return who + ' ticked a criterion on ' + what + n;
        if (crit === 'open') return who + ' unticked a criterion on ' + what + n;
        return who + ' changed the acceptance criteria of ' + what + n;
      }
      const files = ch['files']?.to;
      const commit = ch['commit']?.to;
      const tests = ch['tests']?.to;
      // [PCODE-108 | S15 | v0.1.0] a pull request from a Git host: opened, merged or closed
      const pr = ch['pullRequest']?.to as { number?: string; state?: string } | undefined;
      if (pr && typeof pr === 'object') {
        const verb = pr.state === 'merged' ? 'merged' : pr.state === 'closed' ? 'closed' : 'opened';
        return who + ' ' + verb + ' PR #' + (pr.number ?? '?') + ' on ' + what;
      }
      if (Array.isArray(files))
        return who + ' edited ' + count(files.length, 'file') + ' on ' + what;
      if (typeof commit === 'string')
        return who + ' committed ' + commit.slice(0, 7) + ' on ' + what;
      if (typeof tests === 'string') return who + ' ran tests on ' + what + ': ' + tests;
      return who + ' worked on ' + what;
    }
    case 'updated': {
      // [PCODE-144 | S15 | v0.1.0] an evidence pack was exported
      if (ch['evidencePack']) return who + ' exported an evidence pack of ' + what;
      // [PCODE-114 | S15 | v0.1.0] an import into a project
      const imported = ch['imported'];
      if (imported)
        return (
          who +
          ' imported ' +
          what +
          ' from ' +
          String(imported.from === 'plane' ? 'Plane' : imported.from)
        );
      // [PCODE-229 | S15 | v0.1.0] field names as words: "state and assignee", not "state, assigneeId"
      const fields = Object.keys(ch).map(fieldWord);
      const list =
        fields.length > 1
          ? fields.slice(0, -1).join(', ') + ' and ' + (fields[fields.length - 1] ?? '')
          : (fields[0] ?? '');
      return who + ' changed ' + (list ? 'the ' + list + ' of ' : '') + what;
    }
    default:
      return who + ' ' + d.verb + ' ' + what;
  }
}

// [PCODE-122 | S15 | v0.1.0] an agent's run, as the team should read it
function describeRun(e: ActivityEvent, who: string): string {
  const d = e.data;
  const agent = (d.object.label ?? 'An agent').split(' on ')[0] ?? 'An agent';
  const where = d.parent?.label ? ' on ' + d.parent.label : '';
  const status = d.changes?.['status']?.to;
  const decision = d.changes?.['decision']?.to;
  switch (d.verb) {
    case 'created':
      return who + ' asked ' + agent + ' to work' + where;
    case 'started':
      return agent + ' started work' + where;
    case 'completed':
      return agent + ' finished its run' + where;
    case 'failed':
      return agent + ' stopped with an error' + where;
    case 'progressed':
      return agent + ' took a step' + where;
    default:
      if (status === 'waiting') return agent + ' is waiting for approval' + where;
      if (status === 'cancelled') return who + ' cancelled ' + agent + where;
      if (decision === 'approved' || decision === 'declined')
        return who + ' ' + decision + ' an action of ' + agent + where;
      return who + ' changed ' + agent + "'s run" + where;
  }
}

/** [PCODE-122 | S15 | v0.1.0] Whether an event belongs in a feed: an agent's single steps are for its run page only. */
export const inFeed = (e: ActivityEvent): boolean =>
  // [PCODE-132 | S15 | v0.1.0] a deploy's single steps too
  !(
    // [PCODE-135 | S15 | v0.1.0] and a test run's single results
    (e.data.object.type === 'agent_run' ||
      e.data.object.type === 'deploy' ||
      e.data.object.type === 'test_run') &&
    e.data.verb === 'progressed'
  );

/** The item an event is about: the item itself, or the item a comment belongs to. */
export function itemOf(e: ActivityEvent): string | null {
  if (e.data.object.type === 'item') return e.data.object.id;
  if (e.data.parent?.type === 'item') return e.data.parent.id;
  return null;
}
