// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
// ── [PCODE-194 | S15 | v0.1.0] B8.2 VS Code: agents view and runs, findings as problems, code-map lens, test results per criterion ──
// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
//    Why:  for a folder linked with orq link, the task panel shows the task as Orqiva has it: the board's
//          state, priority and labels, and from the server the description, the acceptance criteria as
//          ticked on the web, and the comments (who, when, and whether they were written for the client).
//          A comment written here appears on the web within a second, and the other way round.
import type { Api } from '../../../../cli/src/loop/api';
import type { Item } from '../../state/board';
import { markdownToHtml } from '../../util/markdown';
import { sanitizeHtml } from '../../util/sanitize';
import type { TaskData, TaskWork } from '../protocol';

interface ItemJson {
  id: string;
  description: string;
}
interface CommentJson {
  id: string;
  authorName: string | null;
  body: string;
  createdAt: string;
  visibility: string;
}
interface CriterionJson {
  id: string;
  text: string;
  done: boolean;
}
// [PCODE-194 | S15 | v0.1.0] the tests behind each criterion
interface CoverageJson {
  items: {
    itemId: string;
    requirements: { criterionId: string | null; cases: number; state: string }[];
  }[];
}
type TestState = NonNullable<TaskData['acceptance'][number]['tests']>['state'];
const STATES: readonly string[] = ['uncovered', 'untested', 'failing', 'passing'];

/** Each criterion with its tests' state, matched by the criterion's id. */
export function acceptanceWithTests(
  criteria: readonly CriterionJson[],
  coverage: CoverageJson | null,
  itemId: string,
): TaskData['acceptance'] {
  const reqs = coverage?.items.find((i) => i.itemId === itemId)?.requirements ?? [];
  return criteria.map((c) => {
    const r = reqs.find((x) => x.criterionId === c.id);
    return {
      text: c.text,
      done: c.done,
      ...(r && STATES.includes(r.state)
        ? { tests: { cases: r.cases, state: r.state as TestState } }
        : {}),
    };
  });
}

interface ClientJson {
  projects: { id: string }[];
}

export interface ServerTaskSource {
  api: Api;
  workspaceId: string;
  projectId: string;
  server: string;
}

/** The task panel's data from Orqiva. */
export async function taskDataFromServer(
  src: ServerTaskSource,
  item: Item & { id: string },
  files: TaskData['files'],
  activeRef: string | null,
): Promise<TaskData> {
  const ws = '/api/workspaces/' + src.workspaceId;
  const [full, comments, criteria, clients, coverage, work] = await Promise.all([
    src.api.call<ItemJson>('GET', ws + '/items/' + item.id),
    src.api.call<CommentJson[]>('GET', ws + '/items/' + item.id + '/comments'),
    src.api.call<CriterionJson[]>('GET', ws + '/items/' + item.id + '/criteria').catch(() => []),
    src.api.call<ClientJson[]>('GET', ws + '/clients').catch(() => []),
    src.api
      .call<CoverageJson>('GET', ws + '/projects/' + src.projectId + '/coverage')
      .catch(() => null), // [PCODE-194 | S15 | v0.1.0]
    // [PCODE-466 | S15 | v0.1.0] the work record; an older server has none
    src.api.call<TaskWork>('GET', ws + '/items/' + item.id + '/work').catch(() => null),
  ]);
  return {
    ref: item.ref,
    title: item.title,
    state: { name: item.state.name, group: item.state.group },
    priority: item.priority,
    labels: item.labels,
    url: src.server.replace(/\/$/, '') + '/items/' + item.id,
    descriptionHtml: sanitizeHtml(markdownToHtml(full.description)),
    acceptance: acceptanceWithTests(criteria, coverage, item.id), // [PCODE-194 | S15 | v0.1.0]
    comments: [...comments]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => ({
        date: c.createdAt.slice(0, 10),
        html: sanitizeHtml(markdownToHtml(c.body)),
        ...(c.authorName ? { who: c.authorName } : {}),
        ...(c.visibility === 'client' ? { forClient: true } : {}),
      })),
    files,
    offline: false,
    isActive: activeRef === item.ref,
    source: 'orqiva',
    clientProject: clients.some((c) => c.projects.some((p) => p.id === src.projectId)),
    work,
  };
}

/** Writes a comment on the task in Orqiva. */
export async function commentOnServer(
  src: ServerTaskSource,
  itemId: string,
  text: string,
  forClient: boolean,
): Promise<void> {
  await src.api.call(
    'POST',
    '/api/workspaces/' + src.workspaceId + '/items/' + itemId + '/comments',
    {
      body: text,
      ...(forClient ? { visibility: 'client' } : {}),
    },
  );
}
