// ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
// ── [PCODE-462 | S15 | v0.1.0] Tasks run in plan order, finish by themselves, and show the same state in VS Code and the portal ──
// ── [PCODE-454 | S15 | v0.1.0] VS Code extension: Home tab shows and changes project, server and account; planning works on the Orqiva server ──
// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-78 | S08 | v0.1.0] Add the Orqiva Home tab: guided setup steps and a visual task board ──
// ── [PCODE-79 | S08 | v0.1.0] Add the New project wizard: describe the idea, draft, review and publish the plan visually ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  what the Home tab shows, computed from facts the extension already has: which of the four
//          steps (computer, Plane, project, work) is done, which one is next, and the board of the
//          current sprint as columns of cards. Pure, so it is tested without VS Code; the webview only
//          draws it and the host only feeds it.
import type { Item, Sprint } from '../../state/board';
import type { WizardData } from './wizard';

export type StepId = 'computer' | 'plane' | 'project' | 'work';
export type StepState = 'done' | 'current' | 'todo';
export type ColumnId = 'todo' | 'working' | 'review' | 'done';

export interface HomeInputs {
  folderOpen: boolean;
  trusted: boolean;
  engineFound: boolean;
  connected: boolean;
  link: { identifier: string; name: string; server?: string; projectId?: string } | null;
  /** [PCODE-454 | S15 | v0.1.0] the Orqiva sign-in of this computer, shown and changed from the steps */
  account?: { server: string; email: string } | null;
  sprints: Sprint[];
  activeRef: string | null;
  online: boolean;
  hasRecent: boolean;
  /** [PCODE-79 | S08 | v0.1.0] the plan wizard, when the linked project has no plan published yet */
  wizard?: WizardData | null;
  /** [PCODE-467 | S15 | v0.1.0] for whom the project is; null on a folder that is not on an Orqiva server */
  binding?: HomeBinding | null;
}

// [PCODE-467 | S15 | v0.1.0] the project's client (or internal), its requests, and the clients to choose from
export interface HomeBinding {
  /** a client is set, or the project is internal on purpose */
  ok: boolean;
  client: { id: string; name: string } | null;
  internal: boolean;
  requests: { id: string; ref: string; title: string; inProject: boolean; tasks: number }[];
  clients: { id: string; name: string }[];
  /** the server could not be asked */
  error?: string;
}

export interface HomeStep {
  id: StepId;
  title: string;
  state: StepState;
}

export interface HomeCard {
  ref: string;
  title: string;
  priority: string;
  state: string;
  blocked: boolean;
  active: boolean;
  url?: string;
  /** [PCODE-462 | S15 | v0.1.0] it waits for these tasks; no Start or Build until they are finished */
  waits?: string[];
}

export interface HomeColumn {
  id: ColumnId;
  title: string;
  cards: HomeCard[];
}

export interface HomeSprint {
  code: string;
  name: string;
  isToday: boolean;
  columns: HomeColumn[];
  open: number;
}

export interface HomeData {
  steps: HomeStep[];
  current: StepId;
  folderOpen: boolean;
  trusted: boolean;
  hasRecent: boolean;
  online: boolean;
  project: HomeProject | null;
  account: { server: string; email: string } | null;
  sprints: HomeSprint[];
  activeRef: string | null;
  wizard: WizardData | null;
  binding: HomeBinding | null; // [PCODE-467 | S15 | v0.1.0]
}

// [PCODE-454 | S15 | v0.1.0] the linked project, with where it lives when it is on an Orqiva server
export interface HomeProject {
  identifier: string;
  name: string;
  server?: string;
  url?: string;
}

const STEP_TITLES: Record<StepId, string> = {
  computer: 'This computer',
  plane: 'Sign in to Orqiva', // [PCODE-453 | S15 | v0.1.0]
  project: 'Your project',
  work: 'Work',
};

const COLUMN_TITLES: Record<ColumnId, string> = {
  todo: 'To do',
  working: 'Working on it',
  review: 'Check it',
  done: 'Done',
};

// ── [PCODE-78 | S08 | v0.1.0] columnOf: Plane's state groups, with Review/Test split from the work ──
export function columnOf(item: Item): ColumnId {
  const g = item.state.group;
  if (g === 'completed' || item.done) return 'done';
  if (g === 'backlog' || g === 'unstarted') return 'todo';
  const n = item.state.name.toLowerCase();
  if (n === 'review' || n === 'test') return 'review';
  return 'working';
}

function card(item: Item, activeRef: string | null): HomeCard {
  return {
    ref: item.ref,
    title: item.title,
    priority: item.priority,
    state: item.state.name,
    blocked: item.state.name.toLowerCase() === 'blocked',
    active: item.ref === activeRef,
    ...(item.url ? { url: item.url } : {}),
    ...(item.waitsFor?.length ? { waits: item.waitsFor } : {}),
  };
}

// ── [PCODE-78 | S08 | v0.1.0] homeModel: the first step not done is the current one ──
export function homeModel(i: HomeInputs): HomeData {
  const done: Record<StepId, boolean> = {
    computer: i.engineFound,
    plane: i.connected,
    project: i.folderOpen && i.link !== null,
    work: false,
  };
  const order: StepId[] = ['computer', 'plane', 'project', 'work'];
  const current = order.find((s) => !done[s]) ?? 'work';
  const steps = order.map<HomeStep>((id) => ({
    id,
    title: STEP_TITLES[id],
    state: done[id] ? 'done' : id === current ? 'current' : 'todo',
  }));
  const sprints = i.sprints.map<HomeSprint>((s) => {
    const columns = (Object.keys(COLUMN_TITLES) as ColumnId[]).map<HomeColumn>((id) => ({
      id,
      title: COLUMN_TITLES[id],
      cards: s.items
        .filter((it) => it.state.group !== 'cancelled' && columnOf(it) === id)
        .map((it) => card(it, i.activeRef)),
    }));
    return {
      code: s.code,
      name: s.name,
      isToday: s.isToday,
      columns,
      open: s.items.filter((it) => !it.done && it.state.group !== 'cancelled').length,
    };
  });
  return {
    steps,
    current,
    folderOpen: i.folderOpen,
    trusted: i.trusted,
    hasRecent: i.hasRecent,
    online: i.online,
    project: i.link ? homeProject(i.link) : null,
    account: i.account ?? null,
    sprints,
    activeRef: i.activeRef,
    // [PCODE-79 | S08 | v0.1.0] an existing board wins: the wizard is for a project with nothing in it
    wizard: current === 'work' && i.sprints.length === 0 ? (i.wizard ?? null) : null,
    binding: i.binding ?? null,
  };
}

// ── [PCODE-454 | S15 | v0.1.0] homeProject: key and name, and on Orqiva the server and the project's page ──
export function homeProject(link: NonNullable<HomeInputs['link']>): HomeProject {
  const p: HomeProject = { identifier: link.identifier, name: link.name };
  if (link.server) {
    p.server = link.server.replace(/\/+$/, '');
    if (link.projectId) p.url = p.server + '/projects/' + link.projectId;
  }
  return p;
}
