// ── [PCODE-60 | S12 | v0.1.0] Add the security checklist template and a panel with persistent checkboxes ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the webview: the sections as they stand in the file, native checkboxes that save the moment they
//          change, the progress line, and a way into the file itself for anything the panel cannot express.
import type { HostToSecurity, SecurityMessage, SecurityToHost } from '../protocol';
import { el, icon, vscodeApi } from '../vscodeApi';

const api = vscodeApi<SecurityToHost>();
const app = document.getElementById('app') as HTMLDivElement;

let state: SecurityMessage | null = null;
let message: string | null = null;

// ── [PCODE-60 | S12 | v0.1.0] render: progress, then a section per heading ──
function render(): void {
  app.replaceChildren();
  const refresh = el('button', { class: 'pc-btn', type: 'button' }, icon('refresh'), 'Refresh');
  refresh.addEventListener('click', () => {
    api.postMessage({ type: 'security/refresh' });
  });
  const open = el(
    'button',
    { class: 'pc-btn', type: 'button' },
    icon('go-to-file'),
    'Open the file',
  );
  open.addEventListener('click', () => {
    api.postMessage({ type: 'security/open' });
  });
  app.append(
    el(
      'div',
      { class: 'pc-header' },
      el('h1', { class: 'pc-title', text: 'Security checklist' }),
      el('div', { class: 'pc-actions' }, refresh, open),
    ),
  );
  if (message) app.append(el('div', { class: 'pc-alert', role: 'alert', text: message }));
  if (!state) {
    app.append(el('p', { class: 'pc-muted', text: 'Reading…' }));
    return;
  }
  const s = state;
  app.append(
    el(
      'section',
      { class: 'pc-section' },
      el('p', {}, icon(s.checked === s.total ? 'pass-filled' : 'checklist'), ` ${s.progress}`),
      el('p', { class: 'pc-hint pc-mono', text: s.file }),
    ),
  );

  // ── [PCODE-66 | S13 | v0.1.0] Checks: what a machine can answer, and what it found ──
  const checks = el(
    'section',
    { class: 'pc-section' },
    el('h2', { text: 'Checks' }),
    el('p', {
      class: 'pc-hint',
      text: 'A run writes a dated line under its item. Nothing is ticked for you.',
    }),
  );
  for (const check of s.checks) {
    const row = el('div', { class: 'pc-check-row' });
    const button = el(
      'button',
      { class: 'pc-btn pc-btn--small', type: 'button' },
      s.busy === check.id ? icon('loading~spin') : icon('play'),
      check.label,
    );
    if (s.busy) button.setAttribute('disabled', 'true');
    button.addEventListener('click', () => {
      api.postMessage({ type: 'security/run', check: check.id });
    });
    row.append(button);
    if (check.unavailable) row.append(el('span', { class: 'pc-muted', text: check.unavailable }));
    else if (check.summary) row.append(el('span', { text: check.summary }));
    else row.append(el('span', { class: 'pc-muted', text: 'not run yet' }));
    checks.append(row);
    for (const f of check.findings ?? []) {
      checks.append(
        el(
          'p',
          { class: 'pc-hint pc-mono' },
          `${f.file}:${String(f.line)} — ${f.rule}: `,
          el('span', { text: f.excerpt }),
        ),
      );
    }
  }
  app.append(checks);
  for (const section of s.sections) {
    if (!section.items.length) continue;
    const box = el('section', { class: 'pc-section' }, el('h2', { text: section.title }));
    const ul = el('ul', { class: 'pc-list pc-list--plain' });
    for (const item of section.items) {
      const input = el('input', { type: 'checkbox', id: `i-${String(item.index)}` });
      input.checked = item.checked;
      input.addEventListener('change', () => {
        api.postMessage({ type: 'security/toggle', index: item.index, checked: input.checked });
      });
      const li = el(
        'li',
        { class: 'pc-check' },
        input,
        el('label', { for: `i-${String(item.index)}`, text: ` ${item.text}` }),
      );
      if (item.hint) li.append(el('p', { class: 'pc-hint', text: item.hint }));
      // [PCODE-66 | S13 | v0.1.0] what the last automated run wrote under this item
      if (item.note) li.append(el('p', { class: 'pc-hint pc-mono', text: item.note }));
      ul.append(li);
    }
    box.append(ul);
    app.append(box);
  }
}

window.addEventListener('message', (ev: MessageEvent<HostToSecurity>) => {
  const m = ev.data;
  if (m.type === 'security/state') {
    state = m.state;
    message = null;
  } else message = m.message;
  render();
});

render();
api.postMessage({ type: 'security/refresh' });
