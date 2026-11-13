// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-31 | S06 | v0.1.0] Build the plan panel: description status, Draft, Check and Publish ──
// ── [PCODE-33 | S06 | v0.1.0] Validate plan.json with plane_plan.py check and show errors before Publish ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the webview: three steps (describe, draft, publish) with their status, the check summary and its
//          error list. Buttons are enabled only when the host says their step is possible.
import type { HostToPlan, PlanStatusMessage, PlanToHost } from '../protocol';
import { el, icon, vscodeApi } from '../vscodeApi';

const api = vscodeApi<PlanToHost>();
const app = document.getElementById('app') as HTMLDivElement;

let status: PlanStatusMessage | null = null;
let busy: string | null = null;
let message: { kind: 'error' | 'info'; text: string } | null = null;

function button(
  label: string,
  iconName: string,
  primary: boolean,
  enabled: boolean,
  onClick: () => void,
  busyKey = label.toLowerCase(),
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

function stepIcon(state: 'todo' | 'warn' | 'done'): HTMLSpanElement {
  return icon(
    state === 'done' ? 'pass-filled' : state === 'warn' ? 'warning' : 'circle-large-outline',
  );
}

// ── [PCODE-31 | S06 | v0.1.0] render: header, alert, the three steps ──
function render(): void {
  app.replaceChildren();
  app.append(
    el(
      'div',
      { class: 'pc-header' },
      el('h1', { class: 'pc-title', text: 'Plan the project' }),
      el(
        'div',
        { class: 'pc-actions' },
        button('Refresh', 'refresh', false, status !== null, () => {
          api.postMessage({ type: 'plan/refresh' });
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
  if (!status) {
    app.append(el('p', { class: 'pc-muted', text: 'Reading…' }));
    return;
  }
  const s = status;
  if (!s.root) {
    app.append(
      el('p', { class: 'pc-muted', text: 'Link this folder to an Orqiva project first.' }),
    );
    return;
  }

  // 1. describe
  const descText =
    s.description === 'written'
      ? 'Description written'
      : s.description === 'template'
        ? 'Description is still the template - write what you want built'
        : 'No description yet';
  const step1 = el(
    'section',
    { class: 'pc-section pc-step' },
    el('h2', {}, stepIcon(s.description === 'written' ? 'done' : 'warn'), ' 1. Describe'),
    el('p', { class: 'pc-muted', text: descText }),
    el(
      'div',
      { class: 'pc-row' },
      button(
        'Open description',
        'edit',
        s.description !== 'written',
        s.buttons.openDescription,
        () => {
          api.postMessage({ type: 'plan/openDescription' });
        },
      ),
    ),
  );
  app.append(step1);

  // 2. draft + check
  const planState: 'todo' | 'warn' | 'done' =
    s.plan === 'valid' ? 'done' : s.plan === 'missing' ? 'todo' : 'warn';
  const step2 = el(
    'section',
    { class: 'pc-section pc-step' },
    el('h2', {}, stepIcon(planState), ' 2. Draft with Claude'),
    el('p', { class: s.plan === 'valid' ? '' : 'pc-muted', text: s.summary }),
  );
  if (s.checkError) step2.append(el('p', { class: 'pc-hint pc-hint--error', text: s.checkError }));
  if (s.errors.length) {
    // [PCODE-33 | S06 | v0.1.0] each error names its place; clicking opens plan.json there
    const ul = el('ul', { class: 'pc-list' });
    s.errors.forEach((e, index) => {
      const where = s.errorLocations[index] ?? '';
      const link = el('a', { href: '#', text: e.replace(/^sprint \d+( item \d+)?:\s*/, '') });
      link.addEventListener('click', (ev) => {
        ev.preventDefault();
        api.postMessage({ type: 'plan/openError', index });
      });
      ul.append(
        el(
          'li',
          { class: 'pc-check' },
          icon('error'),
          ' ',
          ...(where ? [el('strong', { text: `${where}: ` })] : []),
          link,
        ),
      );
    });
    step2.append(ul);
  }
  const row2 = el(
    'div',
    { class: 'pc-row' },
    button(
      'Draft plan',
      'sparkle',
      s.plan === 'missing',
      s.buttons.draft,
      () => {
        api.postMessage({ type: 'plan/draft' });
      },
      'draft',
    ),
    button(
      'Check plan',
      'checklist',
      false,
      s.buttons.check,
      () => {
        api.postMessage({ type: 'plan/check' });
      },
      'check',
    ),
  );
  if (s.plan !== 'missing')
    row2.append(
      button('Open plan.json', 'json', false, true, () => {
        api.postMessage({ type: 'plan/openPlan' });
      }),
    );
  step2.append(row2);
  if (!s.buttons.draft && s.description !== 'written')
    step2.append(el('p', { class: 'pc-hint', text: 'Write the description first.' }));
  app.append(step2);

  // 3. publish
  const step3 = el(
    'section',
    { class: 'pc-section pc-step' },
    el('h2', {}, stepIcon(s.publishedAt ? 'done' : 'todo'), ' 3. Publish'),
    el('p', { class: 'pc-muted', text: s.published }),
    el(
      'div',
      { class: 'pc-row' },
      button(
        'Publish plan',
        'cloud-upload',
        s.plan === 'valid' && !s.publishedAt,
        s.buttons.publish,
        () => {
          api.postMessage({ type: 'plan/publish' });
        },
        'publish',
      ),
      el('span', {
        class: 'pc-hint',
        text:
          s.plan === 'valid'
            ? 'Existing items are kept; nothing is deleted.'
            : 'Needs a valid plan.',
      }),
    ),
  );
  app.append(step3);
}

window.addEventListener('message', (ev: MessageEvent<HostToPlan>) => {
  const m = ev.data;
  if (m.type === 'plan/status') {
    status = m.status;
    if (message?.kind === 'error' && busy === null) message = null;
  } else if (m.type === 'plan/busy') busy = m.busy ? (m.what ?? 'busy') : null;
  else if (m.type === 'plan/info') message = { kind: 'info', text: m.message };
  else message = { kind: 'error', text: m.message };
  render();
});

render();
api.postMessage({ type: 'plan/refresh' });
