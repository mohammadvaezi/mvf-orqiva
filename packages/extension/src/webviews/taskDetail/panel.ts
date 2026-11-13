// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
// ── [PCODE-20 | S04 | v0.1.0] Build the task detail panel with description, acceptance, comments and badges ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the host side: one panel (reused), data from the client when connected, from the board when not;
//          messages are validated by the host helper before they land here.
import * as vscode from 'vscode';
import type { Services } from '../../services';
import { createPanel, type PanelHandle } from '../host';
import type { HostToTask, TaskData, TaskToHost } from '../protocol';
import { taskDataFromPlane, taskDataOffline } from './data';
import { commentOnServer, taskDataFromServer, type ServerTaskSource } from './serverData';
import type { ServerConnection } from '../../server/connection';

// [PCODE-193 | S15 | v0.1.0]
const sourceOf = (c: ServerConnection): ServerTaskSource => ({
  api: c.api,
  workspaceId: c.link.workspaceId,
  projectId: c.link.projectId,
  server: c.link.server,
});

export interface TaskPanelDeps {
  context: vscode.ExtensionContext;
  services: Services;
  /** fingerprinted files for a task (PCODE-21 fills this in; empty until then) */
  filesFor?: (ref: string) => Promise<TaskData['files']>;
  /** extra message handling (PCODE-22 actions); return true when handled */
  onAction?: (message: TaskToHost, reload: () => Promise<void>) => Promise<boolean>;
}

let currentRef: string | null = null;

// ── [PCODE-20 | S04 | v0.1.0] loadTaskData: client when possible, else the board item + offline flag ──
export async function loadTaskData(
  services: Services,
  ref: string,
  files: TaskData['files'],
): Promise<TaskData> {
  const { store, client, secrets } = services;
  const link = store.state.link;
  const active = store.state.active?.task ?? null;
  const item = store.state.sprints.flatMap((s) => s.items).find((i) => i.ref === ref);
  const boardUrl = link ? client.webUrl(link.project_id) : undefined;
  // [PCODE-193 | S15 | v0.1.0] a folder linked with orq link: the task as Orqiva has it
  const server = services.server?.() ?? null;
  if (server && item?.id) {
    try {
      return await taskDataFromServer(sourceOf(server), { ...item, id: item.id }, files, active);
    } catch (e) {
      services.log.warn(
        `task panel: Orqiva unreachable for ${ref}, showing the board: ${e instanceof Error ? e.message : String(e)}`,
      );
      return taskDataOffline(item, files, active, server.link.server);
    }
  }
  if (link && !link.server && (await secrets.hasApiKey())) {
    try {
      const issue = await client.getIssue(link.project_id, ref);
      const [comments, states, labels] = await Promise.all([
        client.getComments(link.project_id, issue.id),
        client.getStates(link.project_id),
        client.getLabels(link.project_id),
      ]);
      return taskDataFromPlane(
        issue,
        comments,
        states,
        labels,
        link.identifier,
        client.webUrl(link.project_id, issue.id),
        files,
        active,
      );
    } catch (e) {
      services.log.warn(
        `task panel: falling back to the board for ${ref}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  if (item) return taskDataOffline(item, files, active, boardUrl);
  return {
    ref,
    title: ref,
    state: { name: '?', group: 'backlog' },
    priority: 'none',
    labels: [],
    ...(boardUrl ? { url: boardUrl } : {}),
    descriptionHtml: '',
    acceptance: [],
    comments: [],
    files,
    offline: true,
    isActive: active === ref,
  };
}

// ── [PCODE-20 | S04 | v0.1.0] openTaskPanel: reveal the one panel, retarget it to `ref`, load ──
export async function openTaskPanel(
  deps: TaskPanelDeps,
  ref: string,
): Promise<PanelHandle<TaskToHost, HostToTask>> {
  const { context, services } = deps;
  const title =
    `${ref} ${services.store.state.sprints.flatMap((s) => s.items).find((i) => i.ref === ref)?.title ?? ''}`.trim();
  const { handle, created } = createPanel<TaskToHost, HostToTask>(context, {
    id: 'taskDetail',
    title,
    entry: 'taskDetail',
    log: (l) => {
      services.log.warn(l);
    },
  });
  currentRef = ref;
  const reload = async (): Promise<void> => {
    const target = currentRef;
    if (!target) return;
    const files = deps.filesFor ? await deps.filesFor(target) : [];
    const data = await loadTaskData(services, target, files);
    handle.setTitle(`${data.ref} ${data.title}`.trim());
    await handle.post({ type: 'task/data', data });
  };
  if (created) {
    // [PCODE-39 | S07 | v0.1.0] active.json / fingerprints.md / board changed -> the open panel reloads
    const sub = services.store.onDidChange((keys) => {
      if (keys.includes('active') || keys.includes('fingerprints') || keys.includes('sprints'))
        void reload().catch((e: unknown) => {
          services.log.error('task panel reload', e);
        });
    });
    handle.panel.onDidDispose(() => {
      sub.dispose();
    });
    handle.onMessage((m) => {
      void (async () => {
        if (m.type === 'task/reload') return reload();
        // [PCODE-193 | S15 | v0.1.0] a comment from VS Code, on the task in Orqiva
        if (m.type === 'task/comment') {
          const server = services.server?.() ?? null;
          const item = services.store.state.sprints
            .flatMap((x) => x.items)
            .find((i) => i.ref === currentRef);
          if (!server || !item?.id) {
            await handle.post({
              type: 'task/error',
              message: 'Comments need the folder linked to Orqiva.',
            });
            return;
          }
          try {
            await commentOnServer(sourceOf(server), item.id, m.text, m.forClient);
            await reload();
          } catch (e) {
            await handle.post({
              type: 'task/error',
              message: 'The comment was not saved: ' + (e instanceof Error ? e.message : String(e)),
            });
          }
          return;
        }
        if (m.type === 'task/openPlane') {
          // [PCODE-193 | S15 | v0.1.0] a linked folder opens the task in Orqiva
          const server = services.server?.() ?? null;
          const onServer = server
            ? services.store.state.sprints.flatMap((x) => x.items).find((i) => i.ref === currentRef)
            : undefined;
          if (server && onServer?.id) {
            await vscode.env.openExternal(
              vscode.Uri.parse(server.link.server.replace(/\/$/, '') + '/items/' + onServer.id),
            );
            return;
          }
          const link = services.store.state.link;
          const url = link ? services.client.webUrl(link.project_id) : undefined;
          const active = services.store.state.active;
          const target =
            active?.task === currentRef
              ? active.url
              : (services.store.state.sprints
                  .flatMap((s) => s.items)
                  .find((i) => i.ref === currentRef)?.url ?? url);
          if (target) await vscode.env.openExternal(vscode.Uri.parse(target));
          return;
        }
        if (deps.onAction && (await deps.onAction(m, reload))) return;
      })();
    });
  } else {
    await reload();
  }
  return handle;
}

export function currentTaskRef(): string | null {
  return currentRef;
}
