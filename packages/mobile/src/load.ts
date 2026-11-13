// ── [PCODE-231 | S15 | v0.1.0] T22.4 A day on the phone: exit test, docs and sprint close ──
// ── [PCODE-229 | S15 | v0.1.0] T22.2 Task detail and comments on the phone, with quick state and assignee changes ──
// ── [PCODE-228 | S15 | v0.1.0] T22.1 Live map on the phone: projects, health, heat, sprint progress, cards in progress, alerts ──
//    Why:  what the project (sprint) and task screens read, without React Native, so the exact calls the
//          app makes are tested in Node: a project with its running sprint, tasks, people and capacity; a
//          task with its criteria, comments and history. Moved out of the screens for the T22 exit test.
import type { ActivityEvent } from '@orqiva/shared';
import { call, type Session } from './client';
import type { Capacity, Item, Member, ProjectDetail, Sprint } from './types';

export interface ProjectView {
  project: ProjectDetail;
  sprint: Sprint | null;
  next: Sprint | null;
  items: Item[];
  members: Member[];
  capacity: Capacity | null;
}

export async function loadProject(
  s: Session,
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectView> {
  const W = '/api/workspaces/' + s.workspace.id;
  const [project, sprints, members] = await Promise.all([
    call<ProjectDetail>(s, 'GET', W + '/projects/' + projectId, undefined, fetchImpl),
    call<Sprint[]>(s, 'GET', W + '/projects/' + projectId + '/sprints', undefined, fetchImpl),
    call<Member[]>(s, 'GET', W + '/members', undefined, fetchImpl).catch(() => [] as Member[]),
  ]);
  const sprint = sprints.find((x) => x.status === 'active') ?? null;
  const next = sprints.find((x) => x.status === 'planned') ?? null;
  const [items, capacity] = sprint
    ? await Promise.all([
        call<Item[]>(
          s,
          'GET',
          W + '/projects/' + projectId + '/items?sprintId=' + sprint.id,
          undefined,
          fetchImpl,
        ),
        call<Capacity>(
          s,
          'GET',
          W + '/sprints/' + sprint.id + '/capacity',
          undefined,
          fetchImpl,
        ).catch(() => null),
      ])
    : [[] as Item[], null];
  return { project, sprint, next, items, members, capacity };
}

export interface Comment {
  id: string;
  authorId: string | null;
  authorName: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  visibility: string;
}

export interface Criterion {
  id: string;
  text: string;
  done: boolean;
}

export interface TaskView {
  item: Item;
  project: ProjectDetail;
  members: Member[];
  criteria: Criterion[];
  comments: Comment[];
  history: ActivityEvent[];
}

export async function loadTask(
  s: Session,
  itemId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TaskView> {
  const W = '/api/workspaces/' + s.workspace.id;
  const item = await call<Item>(s, 'GET', W + '/items/' + itemId, undefined, fetchImpl);
  const [project, members, criteria, comments, history] = await Promise.all([
    call<ProjectDetail>(s, 'GET', W + '/projects/' + item.projectId, undefined, fetchImpl),
    call<Member[]>(s, 'GET', W + '/members', undefined, fetchImpl).catch(() => [] as Member[]),
    call<Criterion[]>(s, 'GET', W + '/items/' + itemId + '/criteria', undefined, fetchImpl).catch(
      () => [] as Criterion[],
    ),
    call<Comment[]>(s, 'GET', W + '/items/' + itemId + '/comments', undefined, fetchImpl),
    call<ActivityEvent[]>(
      s,
      'GET',
      W + '/items/' + itemId + '/history',
      undefined,
      fetchImpl,
    ).catch(() => [] as ActivityEvent[]),
  ]);
  return { item, project, members, criteria, comments, history };
}
