// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-65 | S13 | v0.1.0] Build the multi-project dashboard panel across the Plane workspace ──
// ── [PCODE-67 | S13 | v0.1.0] Add Open folder from the dashboard and a recent projects list on Welcome ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the table: one row per project, the three counts that say what is happening, today's sprint if
//          there is one, and how long ago anything moved. Open board always; Open folder only when this
//          machine has seen the project's folder - an offer that opens nothing is worse than no offer.
import type { DashboardMessage, DashboardToHost, HostToDashboard } from '../protocol';
import { el, icon, vscodeApi } from '../vscodeApi';

const api = vscodeApi<DashboardToHost>();
const app = document.getElementById('app') as HTMLDivElement;

let state: DashboardMessage | null = null;

function cell(text: string | number, cls?: string): HTMLElement {
  return el('td', { ...(cls ? { class: cls } : {}), text: String(text) });
}

// ── [PCODE-65 | S13 | v0.1.0] render ──
function render(): void {
  app.replaceChildren();
  const refresh = el('button', { class: 'pc-btn', type: 'button' }, icon('refresh'), 'Refresh');
  refresh.addEventListener('click', () => {
    api.postMessage({ type: 'dashboard/refresh', force: true });
  });
  app.append(
    el(
      'div',
      { class: 'pc-header' },
      el('h1', { class: 'pc-title', text: 'Projects' }),
      el('div', { class: 'pc-actions' }, refresh),
    ),
  );

  if (state?.error) app.append(el('div', { class: 'pc-alert', role: 'alert', text: state.error }));
  if (!state || (state.loading && !state.rows.length)) {
    app.append(el('p', { class: 'pc-muted', text: 'Reading the workspace…' }));
    return;
  }
  if (!state.rows.length) {
    app.append(el('p', { class: 'pc-muted', text: 'No projects in this workspace.' }));
    return;
  }

  const head = el(
    'tr',
    {},
    el('th', { text: 'Project' }),
    el('th', { class: 'pc-num', text: 'Open' }),
    el('th', { class: 'pc-num', text: 'In progress' }),
    el('th', { class: 'pc-num', text: 'Review' }),
    el('th', { class: 'pc-num', text: 'Done' }),
    el('th', { text: 'Today' }),
    el('th', { text: 'Last activity' }),
    el('th', { text: '' }),
  );
  const body = el('tbody');
  for (const row of state.rows) {
    const name = el(
      'td',
      {},
      el('strong', { text: row.identifier }),
      el('span', { class: 'pc-muted', text: ` ${row.name}` }),
    );
    if (row.error) name.append(el('p', { class: 'pc-hint', text: row.error }));

    const board = el('button', { class: 'pc-btn pc-btn--small', type: 'button' }, 'Open board');
    board.addEventListener('click', () => {
      api.postMessage({ type: 'dashboard/openBoard', url: row.boardUrl });
    });
    const actions = el('td', { class: 'pc-actions' }, board);
    if (row.folder) {
      const open = el('button', { class: 'pc-btn pc-btn--small', type: 'button' }, 'Open folder');
      // [PCODE-67 | S13 | v0.1.0] the modifier the rest of the editor uses for "somewhere else"
      open.title = `${row.folder}
Ctrl/Cmd-click to open in a new window`;
      open.addEventListener('click', (ev: MouseEvent) => {
        api.postMessage({
          type: 'dashboard/openFolder',
          identifier: row.identifier,
          newWindow: ev.ctrlKey || ev.metaKey,
        });
      });
      actions.append(open);
    }
    body.append(
      el(
        'tr',
        {},
        name,
        cell(row.open, 'pc-num'),
        cell(row.inProgress, 'pc-num'),
        cell(row.review, 'pc-num'),
        cell(row.done, 'pc-num'),
        el('td', { class: row.sprint ? '' : 'pc-muted', text: row.sprint ?? '—' }),
        cell(row.lastActivity || '—'),
        actions,
      ),
    );
  }
  app.append(el('table', { class: 'pc-table' }, el('thead', {}, head), body));
  if (state.loading)
    app.append(el('p', { class: 'pc-muted', text: 'Reading the remaining projects…' }));
}

window.addEventListener('message', (ev: MessageEvent<HostToDashboard>) => {
  state = ev.data.state;
  render();
});

render();
api.postMessage({ type: 'dashboard/refresh', force: false });
