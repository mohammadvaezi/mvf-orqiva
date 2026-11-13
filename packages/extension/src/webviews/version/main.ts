// ── [PCODE-46 | S09 | v0.1.0] Build the Version panel with current version, last tag, commits and bump buttons ──
// ── [PCODE-47 | S09 | v0.1.0] Generate the CHANGELOG.md section from Done items since the last tag ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the webview: the version large, what git says about it, the warnings that block a bump, the three
//          bump buttons and the commits that would go into the release.
import type { HostToVersion, VersionMessage, VersionToHost } from '../protocol';
import { el, icon, vscodeApi } from '../vscodeApi';

const api = vscodeApi<VersionToHost>();
const app = document.getElementById('app') as HTMLDivElement;

let info: VersionMessage | null = null;
let busy: string | null = null;
let message: { kind: 'error' | 'info'; text: string } | null = null;

function button(
  label: string,
  iconName: string,
  primary: boolean,
  enabled: boolean,
  onClick: () => void,
  busyKey: string,
): HTMLButtonElement {
  const loading = busy === busyKey;
  const b = el(
    'button',
    { class: `pc-btn${primary ? ' pc-btn--primary' : ''}`, type: 'button' },
    icon(loading ? 'loading' : iconName),
    loading ? 'Working…' : label,
  );
  b.disabled = !enabled || busy !== null;
  b.addEventListener('click', onClick);
  return b;
}

// ── [PCODE-46 | S09 | v0.1.0] render: version, git, warnings, bump, commits ──
function render(): void {
  app.replaceChildren();
  app.append(
    el(
      'div',
      { class: 'pc-header' },
      el('h1', { class: 'pc-title', text: 'Version and release' }),
      el(
        'div',
        { class: 'pc-actions' },
        button(
          'Refresh',
          'refresh',
          false,
          true,
          () => {
            api.postMessage({ type: 'version/refresh' });
          },
          'refresh',
        ),
      ),
    ),
  );
  if (message)
    app.append(
      el('div', {
        class: `pc-alert${message.kind === 'info' ? ' pc-alert--info' : ''}`,
        role: message.kind === 'error' ? 'alert' : 'status',
        text: message.text,
      }),
    );
  if (!info) {
    app.append(el('p', { class: 'pc-muted', text: 'Reading…' }));
    return;
  }
  const v = info;

  const current = el(
    'section',
    { class: 'pc-section' },
    el(
      'div',
      { class: 'pc-version' },
      el('span', { class: 'pc-version__number', text: `v${v.version}` }),
    ),
    el('p', { class: 'pc-muted', text: v.tagLine }),
  );
  if (v.packageVersion && v.packageVersion === v.version)
    current.append(
      el('p', { class: 'pc-hint', text: `package.json agrees (${v.packageVersion})` }),
    );
  app.append(current);

  for (const line of v.mismatch)
    app.append(
      el('div', { class: 'pc-alert', role: 'alert', text: `Versions disagree: ${line}.` }),
    );
  if (v.dirtyWarning) {
    const warn = el('div', { class: 'pc-alert', role: 'alert', text: v.dirtyWarning });
    if (v.changed.length)
      warn.append(el('p', { class: 'pc-hint pc-mono', text: v.changed.join(', ') }));
    app.append(warn);
  }

  const bump = el('section', { class: 'pc-section' }, el('h2', { text: 'Bump' }));
  const row = el('div', { class: 'pc-row' });
  for (const part of ['patch', 'minor', 'major'] as const)
    row.append(
      button(
        `${part} → ${v.next[part]}`,
        'tag',
        part === 'patch',
        v.canBump,
        () => {
          api.postMessage({ type: 'version/bump', part });
        },
        part,
      ),
    );
  bump.append(row);
  bump.append(
    el('p', {
      class: 'pc-hint',
      text: v.canBump
        ? 'Writes CHANGELOG.md and package.json, then the engine commits and tags.'
        : v.changelogNote || 'Fix the warnings above first.',
    }),
  );
  app.append(bump);

  // [PCODE-47 | S09 | v0.1.0] what the bump would write into CHANGELOG.md
  const changelog = el('section', { class: 'pc-section' }, el('h2', { text: 'Changelog preview' }));
  if (v.changelog) changelog.append(el('pre', { class: 'pc-log', text: v.changelog }));
  else changelog.append(el('p', { class: 'pc-muted', text: v.changelogNote }));
  app.append(changelog);

  const history = el(
    'section',
    { class: 'pc-section' },
    el('h2', { text: `Commits since ${v.lastTag ?? 'the first commit'}` }),
  );
  if (v.commits.length) {
    const ul = el('ul', { class: 'pc-list' });
    for (const c of v.commits)
      ul.append(
        el(
          'li',
          { class: 'pc-check' },
          el('code', { class: 'pc-mono', text: c.hash }),
          ` ${c.subject}`,
        ),
      );
    history.append(ul);
    if (v.commitsSinceTag > v.commits.length)
      history.append(
        el('p', {
          class: 'pc-hint',
          text: `… and ${String(v.commitsSinceTag - v.commits.length)} more`,
        }),
      );
  } else {
    history.append(el('p', { class: 'pc-muted', text: 'Nothing new since the last tag.' }));
  }
  app.append(history);
}

window.addEventListener('message', (ev: MessageEvent<HostToVersion>) => {
  const m = ev.data;
  if (m.type === 'version/info') {
    info = m.info;
    if (busy === null) message = null;
  } else if (m.type === 'version/busy') busy = m.busy ? (m.what ?? 'busy') : null;
  else if (m.type === 'version/info-message') message = { kind: 'info', text: m.message };
  else message = { kind: 'error', text: m.message };
  render();
});

render();
api.postMessage({ type: 'version/refresh' });
