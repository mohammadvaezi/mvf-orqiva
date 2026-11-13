// ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
// ── [PCODE-458 | S15 | v0.1.0] VS Code extension updates itself from GitHub: CI publishes the build, Update button installs it ──
// ── [PCODE-457 | S15 | v0.1.0] VS Code planning as a conversation: Claude asks, the user answers with text and files, then the plan; replan and description change work; Home tab explains itself ──
// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-236 | S15 | v0.1.0] T23.3 Messages for clients, in VS Code and in the CLI ──
// ── [PCODE-194 | S15 | v0.1.0] B8.2 VS Code: agents view and runs, findings as problems, code-map lens, test results per criterion ──
// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-19 | S04 | v0.1.0] Add the webview host helper with CSP nonce, theme CSS and a typed message bridge ──
// ── [PCODE-23 | S04 | v0.1.0] Build the New task form creating items via plane new with a description file ──
// ── [PCODE-27 | S05 | v0.1.0] Build the setup panel: environment checks, Plane connection and key storage ──
// ── [PCODE-31 | S06 | v0.1.0] Build the plan panel: description status, Draft, Check and Publish ──
// ── [PCODE-33 | S06 | v0.1.0] Validate plan.json with plane_plan.py check and show errors before Publish ──
// ── [PCODE-46 | S09 | v0.1.0] Build the Version panel with current version, last tag, commits and bump buttons ──
// ── [PCODE-47 | S09 | v0.1.0] Generate the CHANGELOG.md section from Done items since the last tag ──
// ── [PCODE-51 | S10 | v0.1.0] Build the Docker panel with generate, build, run, stop, logs and health ──
// ── [PCODE-54 | S10 | v0.1.0] Add the health check with configurable URL and timeout shown in the panel ──
// ── [PCODE-78 | S08 | v0.1.0] Add the Orqiva Home tab: guided setup steps and a visual task board ──
// ── [PCODE-79 | S08 | v0.1.0] Add the New project wizard: describe the idea, draft, review and publish the plan visually ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  every message between a webview and the host is one of these shapes; the host validates with
//          isWebviewMessage() before dispatching (criticals #12: nothing from a webview is trusted blindly).
import { REACTIONS } from '@orqiva/shared';
import type { HomeData } from './home/model';

// ---- task detail panel ------------------------------------------------------------------
export interface TaskData {
  ref: string;
  title: string;
  state: { name: string; group: string };
  priority: string;
  labels: string[];
  url?: string;
  descriptionHtml: string;
  acceptance: {
    text: string;
    done: boolean;
    /** [PCODE-194 | S15 | v0.1.0] its test cases and their latest results, from the coverage */
    tests?: { cases: number; state: 'uncovered' | 'untested' | 'failing' | 'passing' };
  }[];
  comments: {
    date: string;
    html: string;
    who?: string;
    /** [PCODE-193 | S15 | v0.1.0] written for the client */ forClient?: boolean;
  }[];
  files: { file: string; line: number; kind: string }[];
  offline: boolean;
  isActive: boolean;
  /** [PCODE-193 | S15 | v0.1.0] where it came from: a folder linked with orq link reads Orqiva */
  source?: 'plane' | 'orqiva';
  /** [PCODE-193 | S15 | v0.1.0] the project has a client: a comment can be written for them */
  clientProject?: boolean;
  /** [PCODE-466 | S15 | v0.1.0] who or what did the work, with which model, what it cost, how long */
  work?: TaskWork | null;
}

// [PCODE-466 | S15 | v0.1.0] the task's work record, as the server keeps it
export interface TaskWork {
  /** [PCODE-467 | S15 | v0.1.0] for whom */
  client?: string | null;
  internal?: boolean;
  requests?: { ref: string; title: string }[];
  versions: string[];
  time: {
    minutes: number;
    running: boolean;
    sessions: { by: string; client: string; minutes: number }[];
  };
  ai: {
    runs: {
      agent: string;
      source: string;
      client: string;
      model: string;
      status: string;
      tokensIn: number;
      tokensOut: number;
      cacheRead: number;
      cacheWrite: number;
      costUsd: number;
    }[];
    tokensIn: number;
    tokensOut: number;
    cacheRead: number;
    cacheWrite: number;
    costUsd: number;
    costEur: number;
    models: string[];
  };
}

export type TaskToHost =
  | { type: 'task/reload' }
  | { type: 'task/start' }
  | { type: 'task/done' }
  | { type: 'task/status'; state: 'review' | 'test' | 'blocked' | 'todo'; note?: string }
  | { type: 'task/note'; text: string }
  // [PCODE-193 | S15 | v0.1.0] a comment on the task in Orqiva, for the team or written for the client
  | { type: 'task/comment'; text: string; forClient: boolean }
  | { type: 'task/openPlane' }
  | { type: 'task/openFile'; file: string; line: number };

export type HostToTask =
  | { type: 'task/data'; data: TaskData }
  | { type: 'task/busy'; busy: boolean; action?: string }
  | { type: 'task/error'; message: string };

// ---- new task form -----------------------------------------------------------------------
export interface NewTaskOptions {
  sprints: { value: string; label: string }[];
  labels: string[];
  priorities: string[];
}

export interface NewTaskInputMessage {
  title: string;
  sprint: string;
  label: string;
  priority: string;
  description: string;
  acceptance: string[];
}

export type NewTaskToHost =
  | { type: 'new/submit'; input: NewTaskInputMessage }
  | { type: 'new/cancel' }
  | { type: 'new/start'; ref: string }; // [PCODE-23 | S04 | v0.1.0] the "Start it" button

export type HostToNewTask =
  | { type: 'new/options'; options: NewTaskOptions }
  | { type: 'new/busy'; busy: boolean }
  | { type: 'new/created'; ref: string; title: string; sprint: string }
  | { type: 'new/error'; message: string };

// ---- setup panel -------------------------------------------------------------------------
// [PCODE-27 | S05 | v0.1.0] the key goes webview -> host exactly once (setup/connect) and never comes back
export interface SetupCheck {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
  required: boolean;
}

export type SetupToHost =
  | { type: 'setup/refresh' }
  | { type: 'setup/openFix'; fix: string }
  | { type: 'setup/connect'; baseUrl: string; workspace: string; apiKey: string }
  | { type: 'setup/install' }
  | { type: 'setup/forgetKey' };

export type HostToSetup =
  | { type: 'setup/checks'; results: SetupCheck[] }
  | { type: 'setup/connection'; baseUrl: string; workspace: string; hasKey: boolean }
  | { type: 'setup/busy'; busy: boolean; what?: string }
  | { type: 'setup/connected'; projects: string[] }
  | { type: 'setup/installed' }
  | { type: 'setup/error'; message: string };

// ---- plan panel --------------------------------------------------------------------------
// [PCODE-31 | S06 | v0.1.0] the status is computed by PlanService and posted whole; buttons are decided host-side
export interface PlanStatusMessage {
  root: string | null;
  description: 'missing' | 'template' | 'written';
  plan: 'missing' | 'invalid' | 'errors' | 'valid';
  summary: string;
  errors: string[];
  /** [PCODE-33 | S06 | v0.1.0] parallel to errors: 'Sprint 1, item 2' or '' */
  errorLocations: string[];
  checkError: string | null;
  publishedAt: string | null;
  published: string;
  buttons: { openDescription: boolean; draft: boolean; check: boolean; publish: boolean };
}

export type PlanToHost =
  | { type: 'plan/refresh' }
  | { type: 'plan/openDescription' }
  | { type: 'plan/openPlan' }
  | { type: 'plan/draft' }
  | { type: 'plan/check' }
  | { type: 'plan/openError'; index: number } // [PCODE-33 | S06 | v0.1.0]
  | { type: 'plan/publish' };

export type HostToPlan =
  | { type: 'plan/status'; status: PlanStatusMessage }
  | { type: 'plan/busy'; busy: boolean; what?: string }
  | { type: 'plan/info'; message: string }
  | { type: 'plan/error'; message: string };

// ---- version panel -----------------------------------------------------------------------
// [PCODE-46 | S09 | v0.1.0] the panel shows sentences the host already composed, never three raw sources
export interface VersionMessage {
  version: string;
  packageVersion: string | null;
  lastTag: string | null;
  tagLine: string;
  commits: { hash: string; subject: string }[];
  commitsSinceTag: number;
  mismatch: string[];
  dirtyWarning: string;
  changed: string[];
  next: { patch: string; minor: string; major: string };
  canBump: boolean;
  /** [PCODE-47 | S09 | v0.1.0] the section that would be written, or null when Plane cannot be asked */
  changelog: string | null;
  changelogNote: string;
}

export type VersionToHost =
  { type: 'version/refresh' } | { type: 'version/bump'; part: 'patch' | 'minor' | 'major' };

export type HostToVersion =
  | { type: 'version/info'; info: VersionMessage }
  | { type: 'version/busy'; busy: boolean; what?: string }
  | { type: 'version/info-message'; message: string }
  | { type: 'version/error'; message: string };

// ---- docker panel ------------------------------------------------------------------------
// [PCODE-51 | S10 | v0.1.0] the panel renders what the host decided: sentences and an enablement matrix
export interface DockerMessage {
  docker: string;
  dockerOk: boolean;
  fix: string | null;
  filesNote: string;
  hasDockerfile: boolean;
  composeFile: string | null;
  image: string;
  services: string[];
  running: boolean;
  buttons: {
    generate: boolean;
    build: boolean;
    run: boolean;
    stop: boolean;
    logs: boolean;
    health: boolean;
  };
}

export type DockerToHost =
  | { type: 'docker/refresh' }
  | { type: 'docker/generate' }
  | { type: 'docker/build' }
  | { type: 'docker/run' }
  | { type: 'docker/stop' }
  | { type: 'docker/logs'; on: boolean }
  | { type: 'docker/health' }
  | { type: 'docker/openOutput' }
  | { type: 'docker/openFix' };

export type HostToDocker =
  | { type: 'docker/state'; state: DockerMessage }
  // [PCODE-54 | S10 | v0.1.0] one line per service plus one for the URL, with a summary
  | {
      type: 'docker/health';
      lines: { name: string; state: string; text: string }[];
      summary: string;
      healthy: boolean;
      checking: boolean;
    }
  | { type: 'docker/busy'; busy: boolean; what?: string }
  | { type: 'docker/log'; lines: string[]; logging: boolean }
  | { type: 'docker/error'; message: string };

// ---- deploy panel ------------------------------------------------------------------------
// [PCODE-58 | S11 | v0.1.0] a target's fields travel to the form; its token never comes back
export interface DeployMessage {
  targets: {
    name: string;
    kind: 'coolify' | 'ssh';
    summary: string;
    tokenStored: boolean;
    fields: Record<string, unknown>;
  }[];
  version: string;
  warnings: string[];
  history: string[];
  busy: string | null;
  canDeploy: boolean;
}

export type DeployToHost =
  | { type: 'deploy/refresh' }
  | { type: 'deploy/save'; target: Record<string, string> }
  | { type: 'deploy/remove'; name: string }
  | { type: 'deploy/deploy'; name: string };

export type HostToDeploy =
  | { type: 'deploy/state'; state: DeployMessage }
  | { type: 'deploy/log'; lines: string[] }
  | { type: 'deploy/problems'; problems: { field: string; message: string }[] }
  | { type: 'deploy/saved'; name: string }
  | { type: 'deploy/error'; message: string };

// ---- security panel ----------------------------------------------------------------------
// [PCODE-60 | S12 | v0.1.0] the panel mirrors the file; a toggle names the item by its index in it
export interface SecurityMessage {
  sections: {
    title: string;
    items: { index: number; text: string; checked: boolean; hint: string; note: string }[];
  }[];
  progress: string;
  checked: number;
  total: number;
  file: string;
  /** [PCODE-66 | S13 | v0.1.0] the automated checks, and what the last run of each said */
  checks: SecurityCheck[];
  /** the check currently running, if any */
  busy: string | null;
}

export interface SecurityCheck {
  id: 'npm' | 'pip' | 'secrets';
  label: string;
  /** what the last run reported, or '' when it has never run here */
  summary: string;
  /** why it cannot run at all */
  unavailable?: string;
  /** secret scan only: where the findings are, with the values masked */
  findings?: { file: string; line: number; rule: string; excerpt: string }[];
}

export type SecurityToHost =
  | { type: 'security/refresh' }
  | { type: 'security/open' }
  | { type: 'security/toggle'; index: number; checked: boolean }
  | { type: 'security/run'; check: string };

export type HostToSecurity =
  { type: 'security/state'; state: SecurityMessage } | { type: 'security/error'; message: string };

// ---- dashboard panel -------------------------------------------------------------------
// [PCODE-65 | S13 | v0.1.0] one flat row per project; the host has already done the arithmetic
export interface DashboardRow {
  identifier: string;
  name: string;
  open: number;
  inProgress: number;
  review: number;
  done: number;
  total: number;
  sprint: string | null;
  lastActivity: string;
  boardUrl: string;
  folder: string | null;
  error: string | null;
}

export interface DashboardMessage {
  rows: DashboardRow[];
  loading: boolean;
  error?: string;
}

export type DashboardToHost =
  | { type: 'dashboard/refresh'; force: boolean }
  | { type: 'dashboard/openBoard'; url: string }
  | { type: 'dashboard/openFolder'; identifier: string; newWindow: boolean };

export type HostToDashboard = { type: 'dashboard/state'; state: DashboardMessage };

// ---- home tab ------------------------------------------------------------------------------
// [PCODE-78 | S08 | v0.1.0] the Home tab asks for actions by name; the host maps each to one command
export const HOME_ACTIONS = [
  'openSetup',
  'openFolder',
  'newProject',
  'linkProject',
  'openRecent',
  'newTask',
  'sync',
  'planProject',
  'openDashboard',
  'trust',
  'draftPlan', // [PCODE-79 | S08 | v0.1.0]
  'publishPlan',
  'signIn', // [PCODE-453 | S15 | v0.1.0]
  'openProjectOnline', // [PCODE-454 | S15 | v0.1.0]
  'checkForUpdates', // [PCODE-458 | S15 | v0.1.0]
] as const;
export type HomeAction = (typeof HOME_ACTIONS)[number];
export const HOME_TASK_OPS = ['start', 'build', 'done', 'open', 'plane'] as const;
export type HomeTaskOp = (typeof HOME_TASK_OPS)[number];

export type HomeToHost =
  | { type: 'home/ready' }
  | { type: 'home/go'; action: HomeAction }
  | { type: 'home/task'; op: HomeTaskOp; ref: string }
  // [PCODE-79 | S08 | v0.1.0] the wizard's two forms
  | { type: 'home/createProject'; name: string; identifier: string }
  | { type: 'home/saveDescription'; text: string; binding?: HomeBindingChoice } // [PCODE-467 | S15 | v0.1.0]
  | { type: 'home/binding'; binding: HomeBindingChoice }
  // [PCODE-457 | S15 | v0.1.0] the planning conversation: the next turn, answers, notes, plan again, files
  | { type: 'home/plan'; op: HomePlanOp }
  | { type: 'home/answers'; answers: Record<string, { text: string; files: string[] }> }
  | { type: 'home/note'; text: string; files: string[] }
  | { type: 'home/replan'; wish: string }
  | { type: 'home/attach'; question: string };

// [PCODE-467 | S15 | v0.1.0] the client for the project: an existing one, a new one, or internal; and its requests
export interface HomeBindingChoice {
  clientId?: string;
  newClient?: string;
  internal?: boolean;
  requestIds: string[];
  fromDescription?: boolean;
}

export const HOME_PLAN_OPS = ['next', 'write', 'skip', 'stop'] as const;
export type HomePlanOp = (typeof HOME_PLAN_OPS)[number];

export type HostToHome =
  | { type: 'home/data'; data: HomeData }
  | { type: 'home/busy'; busy: boolean; what?: string }
  | { type: 'home/error'; message: string }
  | { type: 'home/attached'; question: string; files: string[] }; // [PCODE-457 | S15 | v0.1.0]

// ---- [PCODE-236 | S15 | v0.1.0] a conversation of Orqiva's messages ---------------------------------
export interface ChatMessageView {
  id: string;
  authorId: string | null;
  author: string;
  mine: boolean;
  /** ISO time */
  at: string;
  body: string;
  deleted: boolean;
  edited: boolean;
  replyCount: number;
  reactions: { emoji: string; count: number; mine: boolean }[];
  files: string[];
  itemId: string | null;
}

export interface ChatData {
  channelId: string;
  title: string;
  topic: string;
  messages: ChatMessageView[];
  more: boolean;
  thread: { root: ChatMessageView; replies: ChatMessageView[] } | null;
  /** handles of people who can be mentioned, and mine (to mark mentions of me) */
  handles: string[];
  me: string;
  error: string | null;
}

export type ChatToHost =
  | { type: 'chat/ready' }
  | { type: 'chat/send'; text: string; parentId?: string }
  | { type: 'chat/thread'; messageId: string }
  | { type: 'chat/closeThread' }
  | { type: 'chat/older' }
  | { type: 'chat/react'; messageId: string; emoji: string; on: boolean }
  | { type: 'chat/openRef'; ref: string }
  | { type: 'chat/openWeb' };

export type HostToChat = { type: 'chat/data'; data: ChatData };

export type WebviewToHost =
  | ChatToHost // [PCODE-236 | S15 | v0.1.0]
  | HomeToHost
  | TaskToHost
  | NewTaskToHost
  | SetupToHost
  | PlanToHost
  | VersionToHost
  | DockerToHost
  | DeployToHost
  | SecurityToHost
  | DashboardToHost;

// ── [PCODE-19 | S04 | v0.1.0] validators: one per inbound type; unknown types and wrong payloads are rejected ──
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown): v is string => typeof v === 'string';
const strArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);
// [PCODE-457 | S15 | v0.1.0] a file in .orqiva/description/attachments/, never a path out of it
const fileNamesOk = (v: unknown): boolean =>
  strArr(v) && v.length <= 50 && v.every((f) => /^[\w.-]{1,120}$/.test(f) && !f.startsWith('..'));
// [PCODE-467 | S15 | v0.1.0] one way only: a client, a new client's name, or internal
const bindingOk = (v: unknown): boolean => {
  if (!isObj(v)) return false;
  const ways = [
    v['clientId'] !== undefined,
    v['newClient'] !== undefined,
    v['internal'] === true,
  ].filter(Boolean).length;
  return (
    ways === 1 &&
    (v['clientId'] === undefined || (str(v['clientId']) && UUID_RE.test(v['clientId']))) &&
    (v['newClient'] === undefined ||
      (str(v['newClient']) && v['newClient'].trim().length > 0 && v['newClient'].length <= 200)) &&
    strArr(v['requestIds']) &&
    v['requestIds'].length <= 50 &&
    v['requestIds'].every((x) => UUID_RE.test(x)) &&
    (v['fromDescription'] === undefined || typeof v['fromDescription'] === 'boolean')
  );
};
const answersOk = (v: unknown): boolean => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const all = Object.entries(v as Record<string, unknown>);
  return (
    all.length <= 20 &&
    all.every(
      ([k, a]) =>
        /^(r\d+q\d+|_more)$/.test(k) &&
        typeof a === 'object' &&
        a !== null &&
        str((a as { text?: unknown }).text) &&
        (a as { text: string }).text.length <= 20000 &&
        fileNamesOk((a as { files?: unknown }).files),
    )
  );
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOk = (v: unknown): boolean => str(v) && UUID_RE.test(v);

const VALIDATORS: Record<string, (m: Record<string, unknown>) => boolean> = {
  // [PCODE-236 | S15 | v0.1.0] a conversation: texts of sane size, ids that look like ids, known reactions
  'chat/ready': () => true,
  'chat/send': (m) =>
    str(m['text']) &&
    m['text'].trim().length > 0 &&
    m['text'].length <= 20_000 &&
    (m['parentId'] === undefined || uuidOk(m['parentId'])),
  'chat/thread': (m) => uuidOk(m['messageId']),
  'chat/closeThread': () => true,
  'chat/older': () => true,
  'chat/react': (m) =>
    uuidOk(m['messageId']) &&
    (REACTIONS as readonly string[]).includes(String(m['emoji'])) &&
    typeof m['on'] === 'boolean',
  'chat/openRef': (m) => str(m['ref']) && /^[A-Z][A-Z0-9]{1,9}-\d{1,6}$/.test(m['ref']),
  'chat/openWeb': () => true,
  // [PCODE-78 | S08 | v0.1.0] only known actions, only refs that look like a task reference
  'home/ready': () => true,
  // [PCODE-79 | S08 | v0.1.0] the identifier rule plane_init.py applies; a description of sane size
  'home/createProject': (m) =>
    str(m['name']) &&
    m['name'].trim().length > 0 &&
    m['name'].length <= 80 &&
    str(m['identifier']) &&
    /^[A-Z]{2,5}$/.test(m['identifier']),
  'home/saveDescription': (m) =>
    str(m['text']) &&
    m['text'].trim().length > 0 &&
    m['text'].length <= 20000 &&
    (m['binding'] === undefined || bindingOk(m['binding'])),
  'home/binding': (m) => bindingOk(m['binding']),
  'home/go': (m) => (HOME_ACTIONS as readonly string[]).includes(String(m['action'])),
  // [PCODE-457 | S15 | v0.1.0] answers of sane size; attachments only by their plain file name
  'home/plan': (m) => (HOME_PLAN_OPS as readonly string[]).includes(String(m['op'])),
  'home/answers': (m) => answersOk(m['answers']),
  'home/note': (m) => str(m['text']) && m['text'].length <= 20000 && fileNamesOk(m['files']),
  'home/replan': (m) => str(m['wish']) && m['wish'].length <= 20000,
  'home/attach': (m) => str(m['question']) && /^(r\d+q\d+|_more|_note)$/.test(m['question']),
  'home/task': (m) =>
    (HOME_TASK_OPS as readonly string[]).includes(String(m['op'])) &&
    str(m['ref']) &&
    /^[A-Z][A-Z0-9]{1,9}-\d+$/.test(m['ref']),
  'task/reload': () => true,
  'task/start': () => true,
  'task/done': () => true,
  'task/status': (m) =>
    ['review', 'test', 'blocked', 'todo'].includes(String(m['state'])) &&
    (m['note'] === undefined || str(m['note'])),
  'task/note': (m) => str(m['text']) && m['text'].trim().length > 0,
  'task/openPlane': () => true,
  'task/openFile': (m) => str(m['file']) && typeof m['line'] === 'number' && m['line'] >= 1,
  'new/cancel': () => true,
  'new/start': (m) => str(m['ref']) && /^[A-Z]{2,5}-\d+$/.test(m['ref']),
  'setup/refresh': () => true,
  'setup/openFix': (m) => str(m['fix']) && m['fix'].length > 0,
  'setup/connect': (m) => str(m['baseUrl']) && str(m['workspace']) && str(m['apiKey']),
  'setup/install': () => true,
  'setup/forgetKey': () => true,
  'plan/refresh': () => true,
  'plan/openDescription': () => true,
  'plan/openPlan': () => true,
  'plan/draft': () => true,
  'plan/check': () => true,
  'plan/openError': (m) =>
    typeof m['index'] === 'number' && Number.isInteger(m['index']) && m['index'] >= 0,
  'plan/publish': () => true,
  'version/refresh': () => true,
  'version/bump': (m) => ['patch', 'minor', 'major'].includes(String(m['part'])),
  'docker/refresh': () => true,
  'docker/generate': () => true,
  'docker/build': () => true,
  'docker/run': () => true,
  'docker/stop': () => true,
  'docker/logs': (m) => typeof m['on'] === 'boolean',
  'docker/health': () => true,
  'docker/openOutput': () => true,
  'docker/openFix': () => true,
  'deploy/refresh': () => true,
  'deploy/save': (m) => isObj(m['target']) && str(m['target']['kind']),
  'deploy/remove': (m) => str(m['name']) && m['name'].length > 0,
  'deploy/deploy': (m) => str(m['name']) && m['name'].length > 0,
  // [PCODE-65 | S13 | v0.1.0] the board url is opened externally, so it must be one we produced
  'dashboard/refresh': (m) => typeof m['force'] === 'boolean',
  'dashboard/openBoard': (m) => str(m['url']) && /^https?:\/\//.test(m['url']),
  'dashboard/openFolder': (m) =>
    str(m['identifier']) && m['identifier'].length > 0 && typeof m['newWindow'] === 'boolean',
  'security/refresh': () => true,
  'security/open': () => true,
  'security/toggle': (m) =>
    typeof m['index'] === 'number' &&
    Number.isInteger(m['index']) &&
    m['index'] >= 0 &&
    typeof m['checked'] === 'boolean',
  'security/run': (m) => str(m['check']) && ['npm', 'pip', 'secrets'].includes(m['check']),
  'new/submit': (m) => {
    const i = m['input'];
    return (
      isObj(i) &&
      str(i['title']) &&
      str(i['sprint']) &&
      str(i['label']) &&
      str(i['priority']) &&
      str(i['description']) &&
      strArr(i['acceptance'])
    );
  },
};

export function isWebviewMessage(v: unknown): v is WebviewToHost {
  if (!isObj(v) || !str(v['type'])) return false;
  const check = VALIDATORS[v['type']];
  return check !== undefined && check(v);
}
