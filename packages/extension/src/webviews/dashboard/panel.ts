// ── [PCODE-65 | S13 | v0.1.0] Build the multi-project dashboard panel across the Plane workspace ──
// ── [PCODE-67 | S13 | v0.1.0] Add Open folder from the dashboard and a recent projects list on Welcome ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  host side of the dashboard. Every other view in this extension is about the folder that is
//          open; this one is about the workspace, which is the only way to see that a project has been
//          sitting untouched for three weeks. The rows arrive one at a time (the service reads projects
//          in turn to stay inside the throttle), so each one is pushed to the webview as it lands rather
//          than leaving the panel empty until the slowest project answers.
import * as vscode from 'vscode';
import { ago, sortRows, type ProjectRow } from '../../dashboard/aggregate';
import { Dashboard } from '../../dashboard/dashboardService';
import { knownFolders, type MementoLike } from '../../dashboard/folders';
import type { Services } from '../../services';
import { createPanel, type PanelHandle } from '../host';
import type { DashboardMessage, DashboardToHost, HostToDashboard } from '../protocol';

export interface DashboardPanelDeps {
  context: vscode.ExtensionContext;
  services: Services;
  /** injected by the tests; otherwise the extension's globalState */
  memento?: MementoLike;
  openFolder?: (folder: string, newWindow: boolean) => Thenable<unknown>;
  openExternal?: (url: string) => Thenable<unknown>;
}

export function toMessage(
  rows: readonly ProjectRow[],
  now: Date,
  loading: boolean,
  error?: string,
): DashboardMessage {
  return {
    rows: sortRows(rows).map((r) => ({
      identifier: r.identifier,
      name: r.name,
      open: r.counts.open,
      inProgress: r.counts.inProgress,
      review: r.counts.review,
      done: r.counts.done,
      total: r.counts.total,
      sprint: r.sprint,
      lastActivity: ago(r.lastActivity, now),
      boardUrl: r.boardUrl,
      folder: r.folder ?? null,
      error: r.error ?? null,
    })),
    loading,
    ...(error ? { error } : {}),
  };
}

export async function openDashboardPanel(
  deps: DashboardPanelDeps,
): Promise<PanelHandle<DashboardToHost, HostToDashboard>> {
  const { context, services } = deps;
  const memento: MementoLike = deps.memento ?? context.globalState;
  const { handle, created } = createPanel<DashboardToHost, HostToDashboard>(context, {
    id: 'dashboard',
    title: 'Projects',
    entry: 'dashboard',
    log: (l) => {
      services.log.warn(l);
    },
  });

  // [PCODE-65 | S13 | v0.1.0] one Dashboard per panel: the cache lives as long as the panel does
  const rows: ProjectRow[] = [];
  const dashboard = new Dashboard({
    client: services.client,
    folders: knownFolders(memento),
    log: (l) => {
      services.log.warn(l);
    },
    onRow: (row) => {
      const at = rows.findIndex((r) => r.id === row.id);
      if (at >= 0) rows[at] = row;
      else rows.push(row);
      void handle.post({
        type: 'dashboard/state',
        state: toMessage(rows, new Date(), true),
      });
    },
  });

  const load = async (force: boolean): Promise<void> => {
    rows.length = 0;
    await handle.post({ type: 'dashboard/state', state: toMessage([], new Date(), true) });
    try {
      await dashboard.rows(force);
      await handle.post({ type: 'dashboard/state', state: toMessage(rows, new Date(), false) });
    } catch (e) {
      // the whole workspace failed - no key, no network - so the panel says so instead of showing nothing
      await handle.post({
        type: 'dashboard/state',
        state: toMessage(rows, new Date(), false, e instanceof Error ? e.message : String(e)),
      });
    }
  };

  if (!created) {
    await load(false);
    return handle;
  }

  const openExternal =
    deps.openExternal ?? ((url: string) => vscode.env.openExternal(vscode.Uri.parse(url)));
  // [PCODE-67 | S13 | v0.1.0] this window by default; a modified click keeps the current one open
  const openFolder =
    deps.openFolder ??
    ((folder: string, newWindow: boolean) =>
      vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folder), {
        forceNewWindow: newWindow,
      }));

  handle.onMessage((m) => {
    void (async () => {
      if (m.type === 'dashboard/refresh') {
        await load(m.force);
        return;
      }
      if (m.type === 'dashboard/openBoard') {
        await openExternal(m.url);
        return;
      }
      // dashboard/openFolder (the last kind)
      const folder = knownFolders(memento)[m.identifier];
      if (folder) await openFolder(folder, m.newWindow);
    })().catch((e: unknown) => {
      services.log.error('dashboard panel', e);
    });
  });

  await load(false);
  return handle;
}
