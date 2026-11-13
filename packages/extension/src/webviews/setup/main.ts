// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-27 | S05 | v0.1.0] Build the setup panel: environment checks, Plane connection and key storage ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the webview: checks with fix links, then Connect (address, workspace, key as a password field that is
//          cleared after sending), then Install (PCODE-28) and Forget key (PCODE-29).
import type { HostToSetup, SetupToHost } from '../protocol';
import { el, icon, vscodeApi } from '../vscodeApi';

const api = vscodeApi<SetupToHost>();
const app = document.getElementById('app') as HTMLDivElement;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
  required: boolean;
}

let checks: Check[] | null = null;
let conn = { baseUrl: 'https://plan.broszio.com', workspace: 'prodsystem', hasKey: false };
let busy: string | null = null;
let message: { kind: 'error' | 'info'; text: string } | null = null;
let hooksInstalled = false;
const draft = { baseUrl: '', workspace: '', apiKey: '' };
let draftTouched = false;

function button(
  label: string,
  iconName: string,
  primary: boolean,
  onClick: () => void,
  disabled = false,
): HTMLButtonElement {
  const loading = busy === label.toLowerCase();
  const b = el(
    'button',
    { class: `pc-btn${primary ? ' pc-btn--primary' : ''}`, type: 'button' },
    icon(loading ? 'loading' : iconName),
    loading ? 'Working…' : label,
  );
  b.disabled = disabled || busy !== null;
  b.addEventListener('click', onClick);
  return b;
}

// ── [PCODE-27 | S05 | v0.1.0] render: checks, connect, install, forget ──
function render(): void {
  app.replaceChildren();
  app.append(
    el(
      'div',
      { class: 'pc-header' },
      el('h1', { class: 'pc-title', text: 'Orqiva setup' }),
      el(
        'div',
        { class: 'pc-actions' },
        button('Check again', 'refresh', false, () => {
          api.postMessage({ type: 'setup/refresh' });
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

  // 1. checks
  const sec1 = el('section', { class: 'pc-section' }, el('h2', { text: '1. This computer' }));
  if (!checks)
    sec1.append(
      el('p', { class: 'pc-muted', text: busy === 'checks' ? 'Checking…' : 'Not checked yet.' }),
    );
  else {
    const ul = el('ul', { class: 'pc-list' });
    for (const c of checks) {
      const li = el(
        'li',
        { class: 'pc-check' },
        icon(c.ok ? 'pass-filled' : c.required ? 'error' : 'warning'),
        el('strong', { text: c.name }),
        el('span', { class: 'pc-muted', text: ` ${c.detail}` }),
      );
      if (!c.ok && c.fix) {
        const fix = el('a', { href: '#', text: /^https?:/.test(c.fix) ? 'Download' : 'Fix' });
        fix.addEventListener('click', (e) => {
          e.preventDefault();
          api.postMessage({ type: 'setup/openFix', fix: c.fix ?? '' });
        });
        li.append(' ', fix);
      }
      ul.append(li);
    }
    sec1.append(ul);
    hooksInstalled = checks.find((c) => c.name === 'Claude Code hooks')?.ok ?? false;
  }
  app.append(sec1);

  // 2. connect
  const sec2 = el(
    'section',
    { class: 'pc-section' },
    el('h2', { text: '2. Legacy tracker (only for folders not yet on Orqiva)' }),
  );
  const url = el('input', {
    class: 'pc-input',
    id: 'baseUrl',
    type: 'url',
    placeholder: 'https://plan.example.com',
  });
  url.value = draftTouched ? draft.baseUrl : conn.baseUrl;
  url.addEventListener('input', () => {
    draft.baseUrl = url.value;
    draftTouched = true;
  });
  const ws = el('input', {
    class: 'pc-input',
    id: 'workspace',
    type: 'text',
    placeholder: 'workspace slug',
  });
  ws.value = draftTouched ? draft.workspace : conn.workspace;
  ws.addEventListener('input', () => {
    draft.workspace = ws.value;
    draftTouched = true;
  });
  const key = el('input', {
    class: 'pc-input',
    id: 'apiKey',
    type: 'password',
    placeholder: conn.hasKey ? 'stored securely — paste a new key to replace it' : 'plane_api_…',
    autocomplete: 'off',
  });
  key.addEventListener('input', () => {
    draft.apiKey = key.value;
  });
  const keyLink = el('a', { href: '#', text: 'Where do I get a key?' });
  keyLink.addEventListener('click', (e) => {
    e.preventDefault();
    api.postMessage({
      type: 'setup/openFix',
      fix: `${(draftTouched ? draft.baseUrl : conn.baseUrl).replace(/\/+$/, '')}/profile/api-tokens/`,
    });
  });
  sec2.append(
    el('div', { class: 'pc-field' }, el('label', { for: 'baseUrl', text: 'Tracker address' }), url),
  );
  sec2.append(
    el('div', { class: 'pc-field' }, el('label', { for: 'workspace', text: 'Workspace' }), ws),
  );
  sec2.append(
    el(
      'div',
      { class: 'pc-field' },
      el('label', { for: 'apiKey', text: 'API key' }),
      el(
        'div',
        {},
        key,
        el(
          'p',
          { class: 'pc-hint' },
          conn.hasKey ? 'Key stored securely on this computer. ' : '',
          keyLink,
        ),
      ),
    ),
  );
  const connect = button('Connect', 'plug', true, () => {
    api.postMessage({
      type: 'setup/connect',
      baseUrl: url.value,
      workspace: ws.value,
      apiKey: key.value,
    });
    key.value = '';
    draft.apiKey = '';
  });
  const forget = button(
    'Forget key',
    'trash',
    false,
    () => {
      api.postMessage({ type: 'setup/forgetKey' });
    },
    !conn.hasKey,
  );
  forget.classList.add('pc-btn--danger');
  sec2.append(el('div', { class: 'pc-row' }, connect, forget));
  app.append(sec2);

  // 3. install
  const sec3 = el(
    'section',
    { class: 'pc-section' },
    el('h2', { text: '3. Claude Code hooks and the plane command' }),
  );
  sec3.append(
    el('p', {
      class: 'pc-muted',
      text: hooksInstalled
        ? 'Installed. Claude Code sessions in linked folders get the Orqiva brief, the hooks and the orq command.'
        : 'Installs the session hooks, the plane command, the allow rule and the MCP server through the engine (install.py).',
    }),
  );
  const engineOk = checks?.find((c) => c.name === 'Engine folder')?.ok ?? false;
  sec3.append(
    el(
      'div',
      { class: 'pc-row' },
      button(
        hooksInstalled ? 'Reinstall' : 'Install',
        'cloud-download',
        !hooksInstalled,
        () => {
          api.postMessage({ type: 'setup/install' });
        },
        !conn.hasKey || !engineOk,
      ),
      el('span', {
        class: 'pc-hint',
        text: !conn.hasKey
          ? 'Connect the tracker first.'
          : !engineOk
            ? 'Engine folder not found — see the checks.'
            : '',
      }),
    ),
  );
  app.append(sec3);
}

window.addEventListener('message', (ev: MessageEvent<HostToSetup>) => {
  const m = ev.data;
  if (m.type === 'setup/checks') checks = m.results;
  else if (m.type === 'setup/connection') {
    conn = { baseUrl: m.baseUrl, workspace: m.workspace, hasKey: m.hasKey };
    draftTouched = false;
  } else if (m.type === 'setup/busy') busy = m.busy ? (m.what ?? 'busy') : null;
  else if (m.type === 'setup/connected')
    message = {
      kind: 'info',
      text: `Connected: ${m.projects.length} project(s)${m.projects.length ? ` (${m.projects.slice(0, 8).join(', ')}${m.projects.length > 8 ? ', …' : ''})` : ''}.`,
    };
  else if (m.type === 'setup/installed')
    message = {
      kind: 'info',
      text: 'Hooks, plane command and MCP server installed. Restart open Claude Code terminals.',
    };
  else message = { kind: 'error', text: m.message };
  render();
});

render();
api.postMessage({ type: 'setup/refresh' });
