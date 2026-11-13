// ── [PCODE-23 | S04 | v0.1.0] Build the New task form creating items via plane new with a description file ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the form: title, sprint, label, priority, description, acceptance lines. Create stays disabled until
//          valid (no asterisks - design-system.md); the reason sits under the field.
import type {
  HostToNewTask,
  NewTaskInputMessage,
  NewTaskOptions,
  NewTaskToHost,
} from '../protocol';
import { el, icon, vscodeApi } from '../vscodeApi';
import { DESCRIPTION_MIN, parseAcceptanceLines, TITLE_MAX, validate } from './validate';

const api = vscodeApi<NewTaskToHost>();
const app = document.getElementById('app') as HTMLDivElement;

let options: NewTaskOptions = {
  sprints: [
    { value: 'today', label: 'Today' },
    { value: 'next', label: 'Next sprint' },
  ],
  labels: ['feature', 'bug', 'chore', 'test', 'hotfix'],
  priorities: ['urgent', 'high', 'medium', 'low', 'none'],
};
let busy = false;
let error = '';
let created: { ref: string; title: string; sprint: string } | null = null;
const draft: NewTaskInputMessage = {
  title: '',
  sprint: 'today',
  label: 'feature',
  priority: 'medium',
  description: '',
  acceptance: [],
};

function field(
  labelText: string,
  id: string,
  control: HTMLElement,
  hint?: string,
  isError = false,
): HTMLElement {
  const wrap = el('div', {}, control);
  if (hint)
    wrap.append(el('p', { class: `pc-hint${isError ? ' pc-hint--error' : ''}`, text: hint }));
  return el('div', { class: 'pc-field' }, el('label', { for: id, text: labelText }), wrap);
}

function select(
  id: string,
  values: { value: string; label: string }[],
  current: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const s = el('select', { class: 'pc-select', id });
  for (const v of values) {
    const o = el('option', { value: v.value, text: v.label });
    if (v.value === current) o.selected = true;
    s.append(o);
  }
  s.addEventListener('change', () => {
    onChange(s.value);
  });
  return s;
}

// ── [PCODE-23 | S04 | v0.1.0] render: the whole form; re-rendered on every input so Create follows validity ──
function render(): void {
  app.replaceChildren();
  const errors = validate(draft);
  const valid = Object.keys(errors).length === 0;

  const createBtn = el(
    'button',
    { class: 'pc-btn pc-btn--primary', type: 'submit' },
    icon(busy ? 'loading' : 'add'),
    busy ? 'Creating…' : 'Create',
  );
  createBtn.disabled = !valid || busy;
  app.append(
    el(
      'div',
      { class: 'pc-header' },
      el('h1', { class: 'pc-title', text: 'New task' }),
      el('div', { class: 'pc-actions' }, createBtn),
    ),
  );

  if (error) app.append(el('div', { class: 'pc-alert', role: 'alert', text: error }));
  if (created) {
    const startBtn = el(
      'button',
      { class: 'pc-btn pc-btn--primary', type: 'button' },
      icon('play'),
      'Start it',
    );
    startBtn.addEventListener('click', () => {
      api.postMessage({ type: 'new/start', ref: created?.ref ?? '' });
    });
    app.append(
      el(
        'div',
        { class: 'pc-alert pc-alert--info' },
        `Created ${created.ref} ${created.title} in ${created.sprint}. `,
        startBtn,
      ),
    );
  }

  const form = el('form', { id: 'new-task' });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!valid || busy) return;
    api.postMessage({
      type: 'new/submit',
      input: { ...draft, title: draft.title.trim(), description: draft.description.trim() },
    });
  });

  const title = el('input', {
    class: `pc-input${errors.title && draft.title ? ' pc-input--error' : ''}`,
    id: 'title',
    type: 'text',
    placeholder: 'Verb + object, e.g. Add the login form',
    maxlength: String(TITLE_MAX + 20),
  });
  title.value = draft.title;
  title.addEventListener('input', () => {
    draft.title = title.value;
    rerenderKeepingFocus('title');
  });
  form.append(
    field(
      'Title',
      'title',
      title,
      draft.title ? errors.title : `${draft.title.length}/${TITLE_MAX}`,
      Boolean(draft.title && errors.title),
    ),
  );

  form.append(
    field(
      'Sprint',
      'sprint',
      select('sprint', options.sprints, draft.sprint, (v) => {
        draft.sprint = v;
      }),
    ),
  );
  form.append(
    field(
      'Label',
      'label',
      select(
        'label',
        options.labels.map((l) => ({ value: l, label: l })),
        draft.label,
        (v) => {
          draft.label = v;
        },
      ),
    ),
  );
  form.append(
    field(
      'Priority',
      'priority',
      select(
        'priority',
        options.priorities.map((p) => ({ value: p, label: p })),
        draft.priority,
        (v) => {
          draft.priority = v;
        },
      ),
    ),
  );

  const desc = el('textarea', {
    class: `pc-textarea${errors.description && draft.description ? ' pc-textarea--error' : ''}`,
    id: 'description',
    placeholder:
      'What is being built and why. How will you verify it? Reference the architecture where useful.',
  });
  desc.value = draft.description;
  desc.addEventListener('input', () => {
    draft.description = desc.value;
    rerenderKeepingFocus('description');
  });
  form.append(
    field(
      'Description',
      'description',
      desc,
      draft.description
        ? errors.description
        : `At least ${DESCRIPTION_MIN} characters: what, why, how to verify.`,
      Boolean(draft.description && errors.description),
    ),
  );

  const acc = el('textarea', {
    class: 'pc-textarea',
    id: 'acceptance',
    placeholder: 'One check per line, e.g.\nGET /hello returns 200\nthe name appears in the header',
  });
  acc.value = draft.acceptance.join('\n');
  acc.addEventListener('input', () => {
    draft.acceptance = parseAcceptanceLines(acc.value);
    rerenderKeepingFocus('acceptance', acc.value);
  });
  form.append(
    field(
      'Acceptance',
      'acceptance',
      acc,
      draft.acceptance.length ? `${draft.acceptance.length} check(s)` : errors.acceptance,
      false,
    ),
  );

  app.append(form);
  if (!busy) document.getElementById(focusId)?.focus();
}

let focusId = 'title';
let rawAcceptance = '';
function rerenderKeepingFocus(id: string, raw?: string): void {
  focusId = id;
  if (raw !== undefined) rawAcceptance = raw;
  const active = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  const pos = active?.selectionStart ?? null;
  render();
  const again = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (again && id === 'acceptance') again.value = rawAcceptance;
  if (again && pos !== null) again.setSelectionRange(pos, pos);
}

window.addEventListener('message', (ev: MessageEvent<HostToNewTask>) => {
  const m = ev.data;
  if (m.type === 'new/options') options = m.options;
  else if (m.type === 'new/busy') busy = m.busy;
  else if (m.type === 'new/created') {
    created = { ref: m.ref, title: m.title, sprint: m.sprint };
    error = '';
    busy = false;
    draft.title = '';
    draft.description = '';
    draft.acceptance = [];
    rawAcceptance = '';
    focusId = 'title';
  } else {
    error = m.message;
    busy = false;
  }
  render();
});

render();
