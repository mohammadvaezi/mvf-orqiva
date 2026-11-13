// ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-194 | S15 | v0.1.0] B8.2 VS Code: agents view and runs, findings as problems, code-map lens, test results per criterion ──
// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-20 | S04 | v0.1.0] Build the task detail panel with description, acceptance, comments and badges ──
// ── [PCODE-22 | S04 | v0.1.0] Add action buttons to the task panel: Start, Done, Status, Note, Open in Plane ──
// ── [PCODE-140 | S15 | v0.1.0] Write our own secret scanner and code rules: orq scan ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the webview side of the task panel - renders TaskData; every action posts a typed message and the
//          host answers with task/data again. Description and comments arrive already sanitised.
import type { HostToTask, TaskData, TaskToHost } from '../protocol';
import { el, icon, vscodeApi } from '../vscodeApi';
import { primaryAction } from './actions';

const api = vscodeApi<TaskToHost>();
const app = document.getElementById('app') as HTMLDivElement;

// state colours from plane_init.py STATES (dot only, never text)
const STATE_COLOR: Record<string, string> = {
  backlog: '#8b8d98',
  todo: '#3f76ff',
  planned: '#3f76ff',
  'in progress': '#f59e0b',
  review: '#a855f7',
  test: '#06b6d4',
  blocked: '#ef4444',
  done: '#16a34a',
  cancelled: '#6b7280',
};
const PRIORITY_ICON: Record<string, string> = {
  urgent: 'flame',
  high: 'arrow-up',
  low: 'arrow-down',
};

let current: TaskData | null = null;
let busy = false;
let busyAction = '';
let lastError = '';
let openForm: 'status' | 'note' | null = null;

function badge(text: string, iconName?: string, dot?: string): HTMLElement {
  const b = el('span', { class: 'pc-badge' });
  if (dot) b.append(el('span', { class: 'pc-dot', style: `background:${dot}` }));
  if (iconName) b.append(icon(iconName));
  b.append(text);
  return b;
}

function button(
  label: string,
  iconName: string,
  primary: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const loading = busy && busyAction === label.toLowerCase();
  const b = el(
    'button',
    { class: `pc-btn${primary ? ' pc-btn--primary' : ''}`, type: 'button' },
    icon(loading ? 'loading' : iconName),
    loading ? 'Working…' : label,
  );
  b.disabled = busy;
  b.addEventListener('click', () => {
    if (busy) return; // [PCODE-22 | S04 | v0.1.0] a second click while an action runs is ignored
    onClick();
  });
  return b;
}

// ── [PCODE-194 | S15 | v0.1.0] a criterion's tests: passing, failing, not run yet, or none ──
const TEST_WORD = {
  passing: 'tests pass',
  failing: 'a test fails',
  untested: 'not tested yet',
  uncovered: 'no test',
} as const;
function testBadge(t: NonNullable<TaskData['acceptance'][number]['tests']>): HTMLElement {
  return el('span', {
    class: 'pc-test pc-test--' + t.state,
    text: TEST_WORD[t.state] + (t.cases ? ' · ' + String(t.cases) : ''),
    title: String(t.cases) + ' test case' + (t.cases === 1 ? '' : 's'),
  });
}

// ── [PCODE-466 | S15 | v0.1.0] the work record: who or what did it, with which model, the tokens, the price, the time ──
const whole = (n: number): string => n.toLocaleString('en-US');
const tokens = (n: number): string =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? String(Math.round(n / 1000)) + 'k' : whole(n);
const hours = (m: number): string =>
  m < 60 ? `${String(m)} min` : `${String(Math.floor(m / 60))} h ${String(m % 60)} min`;
const money = (usd: number, eur: number): string =>
  `${eur.toFixed(2).replace('.', ',')} € ($${usd.toFixed(usd < 1 ? 3 : 2)})`;

function forWhom(w: NonNullable<TaskData['work']>): string {
  if (w.internal) return 'An internal project (no client)';
  if (!w.client) return 'No client yet: choose it on the Orqiva tab';
  const reqs = w.requests ?? [];
  return reqs.length
    ? w.client + ' · ' + reqs.map((r) => r.ref + ' ' + r.title).join(', ')
    : w.client + ' · not requested by the client';
}

function workRecord(w: NonNullable<TaskData['work']>): HTMLElement {
  const sec = el('section', { class: 'pc-section' }, el('h2', { text: 'Work record' }));
  const rows: [string, string][] = [
    // [PCODE-467 | S15 | v0.1.0] for whom, and the request the task serves
    ['For', forWhom(w)],
    [
      'Time',
      hours(w.time.minutes) +
        (w.time.running ? ' (running)' : '') +
        (w.time.sessions.length
          ? ` · ${String(w.time.sessions.length)} session${w.time.sessions.length === 1 ? '' : 's'} by ${[...new Set(w.time.sessions.map((s) => s.by))].join(', ')}`
          : ''),
    ],
    ['Version', w.versions.length ? w.versions.map((v) => 'v' + v).join(', ') : '—'],
  ];
  if (w.ai.runs.length) {
    rows.push(
      [
        'AI',
        [
          ...new Set(
            w.ai.runs.map((r) => (r.source === 'local' ? 'Claude Code in VS Code' : r.agent)),
          ),
        ].join(', '),
      ],
      ['Model', w.ai.models.join(', ')],
      [
        'Tokens',
        `${tokens(w.ai.tokensIn)} in · ${tokens(w.ai.tokensOut)} out · ${tokens(w.ai.cacheRead)} from cache · ${tokens(w.ai.cacheWrite)} to cache`,
      ],
      ['Price', money(w.ai.costUsd, w.ai.costEur)],
    );
  } else rows.push(['AI', 'No AI work recorded yet']);
  const dl = el('dl', { class: 'pc-facts' });
  for (const [k, v] of rows) dl.append(el('dt', { text: k }), el('dd', { text: v }));
  sec.append(dl);
  return sec;
}

// ── [PCODE-20 | S04 | v0.1.0] render: header, badges, description, acceptance, comments, code ──
function render(): void {
  app.replaceChildren();
  if (!current) {
    app.append(el('p', { class: 'pc-muted', text: 'Loading…' }));
    return;
  }
  const d = current;
  const title = el(
    'h1',
    { class: 'pc-title' },
    el('span', { class: 'pc-mono', text: d.ref }),
    d.title,
  );
  const actions = el('div', { class: 'pc-actions', id: 'actions' });
  renderActions(actions, d);
  app.append(el('div', { class: 'pc-header' }, title, actions));

  if (lastError) app.append(el('div', { class: 'pc-alert', role: 'alert', text: lastError }));
  if (d.offline)
    app.append(
      el('div', {
        class: 'pc-alert pc-alert--info',
        text: 'The server is offline; details unavailable. Showing what the last sync knows.',
      }),
    );

  const formHost = el('div', { id: 'form' });
  renderForm(formHost, d);
  app.append(formHost);

  const badges = el('div', { class: 'pc-row pc-section' });
  badges.append(
    badge(d.state.name, undefined, STATE_COLOR[d.state.name.toLowerCase()] ?? '#8b8d98'),
  );
  if (d.priority !== 'none') badges.append(badge(d.priority, PRIORITY_ICON[d.priority]));
  for (const l of d.labels) badges.append(badge(l, 'tag'));
  if (d.isActive) badges.append(badge('active task', 'tasklist'));
  app.append(badges);

  const desc = el('section', { class: 'pc-section' }, el('h2', { text: 'Description' }));
  if (d.descriptionHtml) {
    const body = el('div');
    // [PCODE-140 | S15 | v0.1.0] pe-scan: ignore js/html-injection -- the host sanitises it first (util/sanitize.ts)
    body.innerHTML = d.descriptionHtml; // sanitised by the host (util/sanitize.ts)
    desc.append(body);
  } else
    desc.append(
      el('p', {
        class: 'pc-empty',
        text: d.offline ? 'Description unavailable offline.' : 'No description.',
      }),
    );
  app.append(desc);

  const acc = el('section', { class: 'pc-section' }, el('h2', { text: 'Acceptance' }));
  if (d.acceptance.length) {
    const ul = el('ul', { class: 'pc-list' });
    for (const a of d.acceptance)
      ul.append(
        el(
          'li',
          { class: `pc-check${a.done ? ' pc-check--done' : ''}` },
          icon(a.done ? 'pass-filled' : 'circle-large-outline'),
          a.text,
          a.tests ? testBadge(a.tests) : '', // [PCODE-194 | S15 | v0.1.0]
        ),
      );
    acc.append(ul);
  } else acc.append(el('p', { class: 'pc-empty', text: 'No acceptance checks.' }));
  app.append(acc);
  if (d.work) app.append(workRecord(d.work)); // [PCODE-466 | S15 | v0.1.0]

  const code = el('section', { class: 'pc-section' }, el('h2', { text: 'Code' }));
  if (d.files.length) {
    const ul = el('ul', { class: 'pc-list' });
    for (const f of d.files) {
      const li = el(
        'li',
        { class: 'pc-file', role: 'button', tabindex: '0' },
        el('code', { text: `${f.file}:${f.line}` }),
        ` ${f.kind}`,
      );
      const open = (): void => {
        api.postMessage({ type: 'task/openFile', file: f.file, line: f.line });
      };
      li.addEventListener('click', open);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') open();
      });
      ul.append(li);
    }
    code.append(ul);
  } else
    code.append(
      el('p', {
        class: 'pc-empty',
        text: 'No fingerprinted files yet — add the header from the status bar.',
      }),
    );
  app.append(code);

  const com = el(
    'section',
    { class: 'pc-section' },
    el('h2', { text: `Comments${d.comments.length ? ` (${d.comments.length})` : ''}` }),
  );
  if (d.comments.length) {
    for (const c of d.comments) {
      const body = el('div');
      // [PCODE-140 | S15 | v0.1.0] pe-scan: ignore js/html-injection -- the host sanitises it first (util/sanitize.ts)
      body.innerHTML = c.html; // sanitised by the host
      com.append(
        el(
          'div',
          { class: 'pc-comment' },
          el('time', { text: c.date }),
          c.who ? el('span', { class: 'pc-muted', text: `${c.who} ` }) : '',
          // [PCODE-193 | S15 | v0.1.0] a comment the client reads too
          c.forClient ? el('span', { class: 'pc-badge', text: 'for the client' }) : '',
          body,
        ),
      );
    }
  } else
    com.append(
      el('p', {
        class: 'pc-empty',
        text: d.offline ? 'Comments unavailable offline.' : 'No comments yet.',
      }),
    );
  app.append(com);
}

// ── [PCODE-22 | S04 | v0.1.0] actions: primary per state, Status, Note, Open in Plane, Reload ──
function renderActions(host: HTMLElement, d: TaskData): void {
  host.replaceChildren();
  const primary = primaryAction(d.state.name, d.state.group);
  if (primary === 'start')
    host.append(
      button('Start', 'play', true, () => {
        api.postMessage({ type: 'task/start' });
      }),
    );
  if (primary === 'done')
    host.append(
      button('Done', 'check', true, () => {
        api.postMessage({ type: 'task/done' });
      }),
    );
  if (d.state.group !== 'completed' && d.state.group !== 'cancelled') {
    host.append(
      button('Status', 'symbol-enum', false, () => {
        openForm = openForm === 'status' ? null : 'status';
        render();
      }),
    );
    host.append(
      button(d.source === 'orqiva' ? 'Comment' : 'Note', 'comment', false, () => {
        openForm = openForm === 'note' ? null : 'note';
        render();
      }),
    );
  }
  if (d.url)
    host.append(
      button(
        d.source === 'orqiva' ? 'Open in Orqiva' : 'Open in the web app',
        'link-external',
        false,
        () => {
          api.postMessage({ type: 'task/openPlane' });
        },
      ),
    );
  const reload = el(
    'button',
    { class: 'pc-btn', type: 'button', title: 'Reload' },
    icon(busy ? 'loading' : 'refresh'),
  );
  reload.disabled = busy;
  reload.addEventListener('click', () => {
    api.postMessage({ type: 'task/reload' });
  });
  host.append(reload);
}

// ── [PCODE-22 | S04 | v0.1.0] inline forms: Status (select + optional note) and Note (textarea, Ctrl+Enter submits) ──
function renderForm(host: HTMLElement, d: TaskData): void {
  host.replaceChildren();
  if (!openForm || d.state.group === 'completed') return;
  const box = el('section', { class: 'pc-section' });
  if (openForm === 'status') {
    box.append(el('h2', { text: 'Change status' }));
    const select = el('select', { class: 'pc-select', id: 'state' });
    for (const [v, l] of [
      ['review', 'Review'],
      ['test', 'Test'],
      ['blocked', 'Blocked'],
      ['todo', 'Todo'],
    ] as const)
      select.append(el('option', { value: v, text: l }));
    const note = el('textarea', {
      class: 'pc-textarea',
      id: 'status-note',
      placeholder: 'Why, or what is next (optional)',
    });
    const submit = (): void => {
      const state = select.value as 'review' | 'test' | 'blocked' | 'todo';
      const text = note.value.trim();
      api.postMessage(
        text ? { type: 'task/status', state, note: text } : { type: 'task/status', state },
      );
      openForm = null;
    };
    note.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
    });
    box.append(
      el('div', { class: 'pc-field' }, el('label', { for: 'state', text: 'New status' }), select),
    );
    box.append(
      el('div', { class: 'pc-field' }, el('label', { for: 'status-note', text: 'Note' }), note),
    );
    box.append(
      el(
        'div',
        { class: 'pc-row' },
        button('Change status', 'check', true, submit),
        button('Cancel', 'close', false, () => {
          openForm = null;
          render();
        }),
      ),
    );
  } else if (d.source === 'orqiva') {
    // [PCODE-193 | S15 | v0.1.0] a comment on the task in Orqiva, for the team or written for the client
    box.append(el('h2', { text: 'Add a comment' }));
    const text = el('textarea', {
      class: 'pc-textarea',
      id: 'comment-text',
      placeholder: 'Shown on the web at once — Ctrl+Enter sends',
    });
    const forClient = el('input', { type: 'checkbox', id: 'comment-client' });
    const hint = el('p', { class: 'pc-hint pc-hint--error', text: '' });
    const submit = (): void => {
      const t = text.value.trim();
      if (!t) {
        hint.textContent = 'Write the comment first.';
        return;
      }
      api.postMessage({ type: 'task/comment', text: t, forClient: forClient.checked });
      openForm = null;
    };
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
    });
    box.append(
      el(
        'div',
        { class: 'pc-field' },
        el('label', { for: 'comment-text', text: 'Comment' }),
        el('div', {}, text, hint),
      ),
    );
    if (d.clientProject)
      box.append(
        el(
          'div',
          { class: 'pc-field' },
          el('label', { for: 'comment-client', text: 'Written for the client' }),
          forClient,
        ),
      );
    box.append(
      el(
        'div',
        { class: 'pc-row' },
        button('Add comment', 'comment', true, submit),
        button('Cancel', 'close', false, () => {
          openForm = null;
          render();
        }),
      ),
    );
  } else {
    box.append(el('h2', { text: 'Add a note' }));
    const text = el('textarea', {
      class: 'pc-textarea',
      id: 'note-text',
      placeholder: 'Decision, blocker or progress — Ctrl+Enter sends',
    });
    const hint = el('p', { class: 'pc-hint pc-hint--error', text: '' });
    const submit = (): void => {
      const t = text.value.trim();
      if (!t) {
        hint.textContent = 'Write the note first.';
        return;
      }
      api.postMessage({ type: 'task/note', text: t });
      openForm = null;
    };
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
    });
    box.append(
      el(
        'div',
        { class: 'pc-field' },
        el('label', { for: 'note-text', text: 'Note' }),
        el('div', {}, text, hint),
      ),
    );
    box.append(
      el(
        'div',
        { class: 'pc-row' },
        button('Add note', 'comment', true, submit),
        button('Cancel', 'close', false, () => {
          openForm = null;
          render();
        }),
      ),
    );
  }
  host.append(box);
  box.querySelector<HTMLElement>('select, textarea')?.focus();
}

window.addEventListener('message', (ev: MessageEvent<HostToTask>) => {
  const m = ev.data;
  if (m.type === 'task/data') {
    current = m.data;
    lastError = '';
    busy = false;
    busyAction = '';
    render();
  } else if (m.type === 'task/busy') {
    busy = m.busy;
    busyAction = m.action ?? '';
    if (current) renderActions(document.getElementById('actions') as HTMLElement, current);
  } else {
    lastError = m.message;
    busy = false;
    busyAction = '';
    render();
  }
});

render();
api.postMessage({ type: 'task/reload' });
