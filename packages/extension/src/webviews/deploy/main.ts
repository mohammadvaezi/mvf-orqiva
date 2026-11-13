// ── [PCODE-58 | S11 | v0.1.0] Build the Deploy panel with targets, deploy button, progress and history ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the webview: the targets with their Deploy button, the form that adds one (the fields follow the
//          kind, the token is a password field that is cleared after saving), the version with its warnings,
//          the log of the running deploy and the history of the ones before it.
import type { DeployMessage, DeployToHost, HostToDeploy } from '../protocol';
import { el, icon, vscodeApi } from '../vscodeApi';

const api = vscodeApi<DeployToHost>();
const app = document.getElementById('app') as HTMLDivElement;

let state: DeployMessage | null = null;
let lines: string[] = [];
let message: { kind: 'error' | 'info'; text: string } | null = null;
let problems: { field: string; message: string }[] = [];
let form: { open: boolean; kind: 'coolify' | 'ssh'; values: Record<string, string> } = {
  open: false,
  kind: 'coolify',
  values: {},
};

function button(
  label: string,
  iconName: string,
  primary: boolean,
  enabled: boolean,
  onClick: () => void,
  busyKey = '',
): HTMLButtonElement {
  const loading = Boolean(busyKey) && state?.busy === busyKey;
  const b = el(
    'button',
    { class: `pc-btn${primary ? ' pc-btn--primary' : ''}`, type: 'button' },
    icon(loading ? 'loading' : iconName),
    loading ? 'Working…' : label,
  );
  b.disabled = !enabled;
  b.addEventListener('click', onClick);
  return b;
}

function field(
  name: string,
  label: string,
  type: 'text' | 'password' = 'text',
  placeholder = '',
): HTMLDivElement {
  const input = el('input', { class: 'pc-input', id: `f-${name}`, type, placeholder });
  input.value = form.values[name] ?? '';
  input.addEventListener('input', () => {
    form.values[name] = input.value;
  });
  const problem = problems.find((p) => p.field === name);
  if (problem) input.classList.add('pc-input--error');
  const wrap = el(
    'div',
    { class: 'pc-field' },
    el('label', { for: `f-${name}`, text: label }),
    input,
  );
  if (problem) wrap.append(el('p', { class: 'pc-hint pc-hint--error', text: problem.message }));
  return wrap;
}

// ── [PCODE-58 | S11 | v0.1.0] render: targets, form, version, deploy log, history ──
function render(): void {
  app.replaceChildren();
  app.append(
    el(
      'div',
      { class: 'pc-header' },
      el('h1', { class: 'pc-title', text: 'Deploy' }),
      el(
        'div',
        { class: 'pc-actions' },
        button('Refresh', 'refresh', false, true, () => {
          api.postMessage({ type: 'deploy/refresh' });
        }),
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
  if (!state) {
    app.append(el('p', { class: 'pc-muted', text: 'Reading…' }));
    return;
  }
  const s = state;

  const version = el(
    'section',
    { class: 'pc-section' },
    el('h2', { text: 'Version' }),
    el(
      'div',
      { class: 'pc-version' },
      el('span', { class: 'pc-version__number', text: `v${s.version}` }),
    ),
  );
  for (const w of s.warnings)
    version.append(el('div', { class: 'pc-alert', role: 'alert', text: w }));
  app.append(version);

  const targets = el('section', { class: 'pc-section' }, el('h2', { text: 'Targets' }));
  if (s.targets.length) {
    for (const t of s.targets) {
      const row = el(
        'div',
        { class: 'pc-row' },
        el(
          'span',
          {},
          `${t.summary}${t.kind === 'coolify' ? (t.tokenStored ? ' · token stored' : ' · no token') : ''}`,
        ),
        button(
          `Deploy to ${t.name}`,
          'rocket',
          true,
          s.canDeploy && (t.kind !== 'coolify' || t.tokenStored),
          () => {
            api.postMessage({ type: 'deploy/deploy', name: t.name });
          },
          `deploy to ${t.name}`,
        ),
        button('Edit', 'edit', false, s.busy === null, () => {
          form = {
            open: true,
            kind: t.kind,
            values: Object.fromEntries(
              Object.entries(t.fields).map(([k, v]) => [k, typeof v === 'string' ? v : '']),
            ),
          };
          problems = [];
          render();
        }),
        button('Remove', 'trash', false, s.busy === null, () => {
          api.postMessage({ type: 'deploy/remove', name: t.name });
        }),
      );
      targets.append(row);
    }
  } else {
    targets.append(el('p', { class: 'pc-muted', text: 'No target yet — add the first one.' }));
  }
  targets.append(
    el(
      'div',
      { class: 'pc-row' },
      button(form.open ? 'Close form' : 'Add target', 'add', false, s.busy === null, () => {
        form = { open: !form.open, kind: form.kind, values: form.open ? {} : form.values };
        problems = [];
        render();
      }),
    ),
  );
  app.append(targets);

  if (form.open) {
    const add = el('section', { class: 'pc-section' }, el('h2', { text: 'Target' }));
    const kind = el('select', { class: 'pc-select', id: 'f-kind' });
    for (const option of ['coolify', 'ssh'] as const) {
      const o = el('option', { value: option, text: option === 'coolify' ? 'Coolify' : 'SSH' });
      if (form.kind === option) o.selected = true;
      kind.append(o);
    }
    kind.addEventListener('change', () => {
      form.kind = kind.value === 'ssh' ? 'ssh' : 'coolify';
      render();
    });
    add.append(
      el('div', { class: 'pc-field' }, el('label', { for: 'f-kind', text: 'Kind' }), kind),
    );
    add.append(field('name', 'Name'));
    if (form.kind === 'coolify') {
      add.append(field('url', 'Coolify address', 'text', 'https://coolify.example.com'));
      add.append(field('appUuid', 'Application uuid'));
      add.append(
        field('token', 'API token', 'password', 'stored in the editor, never in the file'),
      );
    } else {
      add.append(field('host', 'Host'));
      add.append(field('user', 'User'));
      add.append(field('path', 'Folder with docker-compose.yml', 'text', '/srv/app'));
    }
    add.append(field('healthUrl', 'Health URL (optional)', 'text', 'https://example.com/health'));
    add.append(
      el(
        'div',
        { class: 'pc-row' },
        button('Save target', 'save', true, s.busy === null, () => {
          api.postMessage({
            type: 'deploy/save',
            target: { ...form.values, kind: form.kind, name: form.values['name'] ?? '' },
          });
        }),
      ),
    );
    app.append(add);
  }

  const log = el('section', { class: 'pc-section' }, el('h2', { text: 'Deployment' }));
  log.append(el('pre', { class: 'pc-log pc-log--tall', text: lines.join('\n') || 'Nothing yet.' }));
  app.append(log);

  const history = el('section', { class: 'pc-section' }, el('h2', { text: 'History' }));
  if (s.history.length) {
    const ul = el('ul', { class: 'pc-list' });
    for (const line of s.history)
      ul.append(
        el(
          'li',
          { class: 'pc-check' },
          icon(/failed|cancelled/i.test(line) ? 'error' : 'pass-filled'),
          ` ${line}`,
        ),
      );
    history.append(ul);
  } else {
    history.append(
      el('p', { class: 'pc-muted', text: 'No deployment recorded for this version yet.' }),
    );
  }
  app.append(history);
}

window.addEventListener('message', (ev: MessageEvent<HostToDeploy>) => {
  const m = ev.data;
  if (m.type === 'deploy/state') {
    state = m.state;
    if (!m.state.busy) message = null;
  } else if (m.type === 'deploy/log') lines = m.lines;
  else if (m.type === 'deploy/problems') problems = m.problems;
  else if (m.type === 'deploy/saved') {
    problems = [];
    form = { open: false, kind: form.kind, values: {} }; // the token field goes with it
    message = { kind: 'info', text: `${m.name} saved.` };
  } else message = { kind: 'error', text: m.message };
  render();
});

render();
api.postMessage({ type: 'deploy/refresh' });
