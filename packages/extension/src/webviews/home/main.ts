// ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
// ── [PCODE-462 | S15 | v0.1.0] Tasks run in plan order, finish by themselves, and show the same state in VS Code and the portal ──
// ── [PCODE-461 | S15 | v0.1.0] Planning in VS Code shows what Claude writes right now: file and size live, failed tools as steps ──
// ── [PCODE-458 | S15 | v0.1.0] VS Code extension updates itself from GitHub: CI publishes the build, Update button installs it ──
// ── [PCODE-457 | S15 | v0.1.0] VS Code planning as a conversation: Claude asks, the user answers with text and files, then the plan; replan and description change work; Home tab explains itself ──
// ── [PCODE-454 | S15 | v0.1.0] VS Code extension: Home tab shows and changes project, server and account; planning works on the Orqiva server ──
// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-78 | S08 | v0.1.0] Add the Orqiva Home tab: guided setup steps and a visual task board ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the webview: a four-step header, one big obvious next action for the step the user is on,
//          and - once everything is set up - the sprint as a board of cards with buttons. Nothing here
//          needs a command name or any syntax; every button names what it does in plain words.
// ── [PCODE-79 | S08 | v0.1.0] Add the New project wizard: describe the idea, draft, review and publish the plan visually ──
//    Why:  a new project is a form (name), a text box (the idea), and three buttons (plan, check, send);
//          the position comes from the host, so the wizard picks up wherever the files say it is.
import type {
  HomeAction,
  HomeBindingChoice,
  HomeTaskOp,
  HomeToHost,
  HostToHome,
} from '../protocol';
import { el, icon, vscodeApi } from '../vscodeApi';
import type { HomeBinding, HomeCard, HomeColumn, HomeData, HomeSprint, StepId } from './model';
import type { WizardData, WizardSprint, WizardTalk } from './wizard';

const api = vscodeApi<HomeToHost>();
const app = document.getElementById('app') as HTMLDivElement;
app.classList.add('pc-home');

let data: HomeData | null = null;
let busy: string | null = null;
let error: string | null = null;
let sprintCode: string | null = null;
// [PCODE-79 | S08 | v0.1.0] wizard state that only lives while the tab is open
let creating = false;
const form = { name: '', identifier: '', identifierTouched: false };
let descDraft: string | null = null;
let editingDescription = false;
let drafting = false;
// [PCODE-454 | S15 | v0.1.0] a finished step opened again from the header, to see or change it
let viewing: StepId | null = null;
// [PCODE-457 | S15 | v0.1.0] what the user types for Claude, kept while the tab lives (and across reloads)
interface Draft {
  text: string;
  files: string[];
}
const saved = (api.getState() ?? {}) as { answers?: Record<string, Draft> };
const answers: Record<string, Draft> = saved.answers ?? {};
let replanOpen = false;
let noteOpen = false;
const keep = (): void => {
  api.setState({ answers });
};
const draftOf = (id: string): Draft => (answers[id] ??= { text: '', files: [] });

const STEP_ICONS: Record<StepId, string> = {
  computer: 'device-desktop',
  plane: 'plug',
  project: 'folder',
  work: 'rocket',
};

function go(action: HomeAction): void {
  api.postMessage({ type: 'home/go', action });
}

function task(op: HomeTaskOp, ref: string): void {
  error = null;
  api.postMessage({ type: 'home/task', op, ref });
}

function button(
  label: string,
  iconName: string,
  onClick: () => void,
  opts: { primary?: boolean; small?: boolean; busyKey?: string; big?: boolean } = {},
): HTMLButtonElement {
  const loading = opts.busyKey !== undefined && busy === opts.busyKey;
  const cls = ['pc-btn'];
  if (opts.primary) cls.push('pc-btn--primary');
  if (opts.small) cls.push('pc-btn--small');
  if (opts.big) cls.push('pc-btn--big');
  const b = el(
    'button',
    { class: cls.join(' '), type: 'button' },
    icon(loading ? 'loading codicon-modifier-spin' : iconName),
    loading ? 'Working…' : label,
  );
  b.disabled = busy !== null;
  b.addEventListener('click', onClick);
  return b;
}

// ── [PCODE-457 | S15 | v0.1.0] once set up, the setup steps shrink to one quiet line of links ──
const SETUP_DONE: Record<Exclude<StepId, 'work'>, string> = {
  computer: 'This computer is ready',
  plane: 'Signed in',
  project: 'Project linked',
};
function setupLine(d: HomeData): HTMLElement {
  const nav = el(
    'nav',
    { class: 'pc-setup', 'aria-label': 'Setup' },
    el('span', { class: 'pc-setup__label', text: 'Setup' }),
  );
  for (const s of d.steps) {
    if (s.id === 'work') continue;
    const b = el(
      'button',
      {
        class: `pc-setup__item${viewing === s.id ? ' pc-setup__item--open' : ''}`,
        type: 'button',
        title: 'Show and change',
      },
      icon('pass-filled'),
      SETUP_DONE[s.id] + (s.id === 'plane' && d.account ? ' as ' + d.account.email : ''),
    );
    b.addEventListener('click', () => {
      viewing = viewing === s.id ? null : s.id;
      render();
    });
    nav.append(b);
  }
  return nav;
}

// ── [PCODE-78 | S08 | v0.1.0] the step header: done = tick, current = highlighted ──
function stepper(d: HomeData): HTMLElement {
  if (d.current === 'work') return setupLine(d); // [PCODE-457 | S15 | v0.1.0]
  const ol = el('ol', { class: 'pc-stepper', 'aria-label': 'Setup progress' });
  d.steps.forEach((s, n) => {
    // [PCODE-454 | S15 | v0.1.0] a finished step is a button: it shows what was set and how to change it
    const open = viewing === s.id || (viewing === null && s.state === 'current');
    const li = el(
      'li',
      {
        class: `pc-stepper__step pc-stepper__step--${s.state}${open ? ' pc-stepper__step--open' : ''}`,
        ...(s.state === 'current' ? { 'aria-current': 'step' } : {}),
      },
      el('span', { class: 'pc-stepper__dot' }, s.state === 'done' ? icon('check') : String(n + 1)),
      el('span', { class: 'pc-stepper__label' }, icon(STEP_ICONS[s.id]), s.title),
    );
    if (s.state !== 'todo') {
      li.classList.add('pc-stepper__step--link');
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      if (s.state === 'done') li.title = 'Show and change';
      const pick = (): void => {
        viewing = s.state === 'current' || s.id === 'work' ? null : s.id;
        creating = false;
        render();
      };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      });
    }
    ol.append(li);
  });
  return ol;
}

function hero(
  title: string,
  text: string,
  iconName: string,
  ...actions: HTMLElement[]
): HTMLElement {
  return el(
    'section',
    { class: 'pc-hero' },
    el('div', { class: 'pc-hero__icon' }, icon(iconName)),
    el('h2', { class: 'pc-hero__title', text: title }),
    el('p', { class: 'pc-hero__text', text: text }),
    el('div', { class: 'pc-hero__actions' }, ...actions),
  );
}

function tile(title: string, text: string, iconName: string, action: HomeAction): HTMLElement {
  const b = el(
    'button',
    { class: 'pc-tile', type: 'button' },
    el('span', { class: 'pc-tile__icon' }, icon(iconName)),
    el('span', { class: 'pc-tile__title', text: title }),
    el('span', { class: 'pc-tile__text', text: text }),
  );
  b.disabled = busy !== null;
  b.addEventListener('click', () => {
    // [PCODE-79 | S08 | v0.1.0] a new project is a form here, not a row of input boxes
    if (action === 'newProject') {
      creating = true;
      render();
    } else go(action);
  });
  return b;
}

// ── [PCODE-79 | S08 | v0.1.0] the identifier rule plane_init.py applies, suggested from the name ──
function suggestIdentifier(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, '').toUpperCase();
  return letters.length >= 2 ? letters.slice(0, 5) : '';
}

// ── [PCODE-79 | S08 | v0.1.0] New project: a name, a short code, one button ──
function newProjectForm(): HTMLElement {
  const name = el('input', { class: 'pc-input', type: 'text', maxlength: '80' });
  name.value = form.name;
  name.placeholder = 'e.g. My shop website';
  const ident = el('input', { class: 'pc-input pc-input--short', type: 'text', maxlength: '5' });
  ident.value = form.identifier;
  const identOk = (): boolean => /^[A-Z]{2,5}$/.test(form.identifier);
  const hint = el('span', {
    class: 'pc-hint',
    text: 'Two to five capital letters. Every task gets it as a prefix: HELLO-1, HELLO-2 …',
  });
  const create = button(
    'Create the project',
    'sparkle',
    () => {
      error = null;
      api.postMessage({
        type: 'home/createProject',
        name: form.name.trim(),
        identifier: form.identifier,
      });
    },
    { primary: true, big: true, busyKey: 'createProject' },
  );
  const sync = (): void => {
    create.disabled = busy !== null || !form.name.trim() || !identOk();
    hint.className = `pc-hint${form.identifier && !identOk() ? ' pc-hint--error' : ''}`;
  };
  name.addEventListener('input', () => {
    form.name = name.value;
    if (!form.identifierTouched) {
      form.identifier = suggestIdentifier(form.name);
      ident.value = form.identifier;
    }
    sync();
  });
  ident.addEventListener('input', () => {
    form.identifierTouched = true;
    form.identifier = ident.value.toUpperCase().replace(/[^A-Z]/g, '');
    ident.value = form.identifier;
    sync();
  });
  sync();
  const back = button('Back', 'arrow-left', () => {
    creating = false;
    render();
  });
  setTimeout(() => {
    name.focus();
  }, 0);
  return el(
    'section',
    { class: 'pc-hero pc-hero--form' },
    el('div', { class: 'pc-hero__icon' }, icon('sparkle')),
    el('h2', { class: 'pc-hero__title', text: 'Start a new project' }),
    el('p', {
      class: 'pc-hero__text',
      text: 'Give it a name. Orqiva creates the project and links this folder to it.',
    }),
    el(
      'div',
      { class: 'pc-form' },
      el(
        'label',
        { class: 'pc-field' },
        el('span', { class: 'pc-field__label', text: 'Project name' }),
        name,
      ),
      el(
        'label',
        { class: 'pc-field' },
        el('span', { class: 'pc-field__label', text: 'Short code' }),
        ident,
        hint,
      ),
    ),
    el('div', { class: 'pc-hero__actions' }, back, create),
  );
}

// ── [PCODE-457 | S15 | v0.1.0] the planning progress: a labelled track, not a row of buttons ──
const STEP_HELP: Record<WizardData['step'], string> = {
  describe: 'Write down what you want to build. Claude reads it next.',
  questions:
    'Claude reads your description and asks what it needs to know. You answer here, in words or with files.',
  draft:
    'Claude writes the architecture and the sprint plan from your description and your answers.',
  review:
    'Claude writes the architecture and the sprint plan from your description and your answers.',
  publish: 'Look the plan over. Publishing puts the sprints and tasks on your board in Orqiva.',
};
function wizardStepper(w: WizardData): HTMLElement {
  const at = w.steps.findIndex((s) => s.state === 'current');
  const ol = el('ol', { class: 'pc-track', 'aria-label': 'Planning progress' });
  w.steps.forEach((s, n) => {
    ol.append(
      el(
        'li',
        {
          class: `pc-track__step pc-track__step--${s.state}`,
          ...(s.state === 'current' ? { 'aria-current': 'step' } : {}),
        },
        el('span', { class: 'pc-track__dot' }, s.state === 'done' ? icon('check') : String(n + 1)),
        el('span', { class: 'pc-track__label', text: s.title }),
      ),
    );
  });
  return el(
    'div',
    { class: 'pc-planhead' },
    el(
      'div',
      { class: 'pc-planhead__top' },
      el('h2', { class: 'pc-planhead__title' }, icon('map'), ' Plan your project'),
      el('span', {
        class: 'pc-muted',
        text: `Step ${String(at + 1)} of ${String(w.steps.length)}`,
      }),
    ),
    ol,
    // [PCODE-457 | S15 | v0.1.0] changing the description is the describe step, wherever the plan is
    el('p', {
      class: 'pc-planhead__help',
      text: STEP_HELP[editingDescription ? 'describe' : w.step],
    }),
  );
}

// ── [PCODE-79 | S08 | v0.1.0] the plan as cards: one column per sprint ──
function planPreview(sprints: WizardSprint[]): HTMLElement {
  const wrap = el('div', { class: 'pc-plan' });
  for (const s of sprints) {
    const list = el('div', { class: 'pc-column__cards' });
    for (const it of s.items)
      list.append(
        el(
          'article',
          { class: 'pc-card' },
          el(
            'div',
            { class: 'pc-card__meta' },
            priorityDot(it.priority),
            el('span', { text: it.label }),
            el('span', {
              text: `${String(it.acceptance)} check${it.acceptance === 1 ? '' : 's'}`,
            }),
          ),
          el('div', { class: 'pc-card__text', text: it.title }),
        ),
      );
    wrap.append(
      el(
        'section',
        { class: 'pc-column' },
        el(
          'h3',
          { class: 'pc-column__title' },
          s.name,
          el('span', { class: 'pc-column__count', text: String(s.items.length) }),
        ),
        s.goal ? el('p', { class: 'pc-muted pc-plan__goal', text: s.goal }) : '',
        list,
      ),
    );
  }
  return wrap;
}

function redraft(): void {
  drafting = true;
  error = null;
  go('draftPlan');
  render();
}

// ── [PCODE-457 | S15 | v0.1.0] the conversation's buttons ──
function planOp(op: 'next' | 'write' | 'skip' | 'stop'): void {
  error = null;
  api.postMessage({ type: 'home/plan', op });
}

/** Files attached to one answer, each with a button to take it off again. */
function attachRow(id: string): HTMLElement {
  const d = draftOf(id);
  const row = el(
    'div',
    { class: 'pc-attach' },
    button(
      'Attach files',
      'attach',
      () => {
        api.postMessage({ type: 'home/attach', question: id });
      },
      { small: true },
    ),
  );
  for (const f of d.files) {
    const x = el(
      'button',
      { class: 'pc-file__remove', type: 'button', title: 'Remove ' + f },
      icon('close'),
    );
    x.addEventListener('click', () => {
      d.files = d.files.filter((y) => y !== f);
      keep();
      render();
    });
    row.append(el('span', { class: 'pc-file' }, icon('file'), f, x));
  }
  return row;
}

function answerBox(id: string, placeholder: string): HTMLTextAreaElement {
  const area = el('textarea', { class: 'pc-textarea', rows: '3', 'data-focus': id });
  area.placeholder = placeholder;
  area.value = draftOf(id).text;
  area.addEventListener('input', () => {
    draftOf(id).text = area.value;
    keep();
  });
  return area;
}

function understandingBox(text: string, title = 'What Claude understood so far'): HTMLElement {
  return el(
    'div',
    { class: 'pc-understanding' },
    el('div', { class: 'pc-understanding__title' }, icon('lightbulb'), ' ' + title),
    el('p', { text }),
  );
}

function earlier(t: WizardTalk): HTMLElement | string {
  if (!t.answered.length) return '';
  const list = el('dl', { class: 'pc-qa' });
  for (const a of t.answered)
    list.append(
      el('dt', { text: a.question }),
      el('dd', {
        text: a.answer + (a.files.length ? ' (attached: ' + a.files.join(', ') + ')' : ''),
      }),
    );
  return el(
    'details',
    { class: 'pc-earlier' },
    el('summary', { text: `Earlier questions and your answers (${String(t.answered.length)})` }),
    list,
  );
}

// ── [PCODE-457 | S15 | v0.1.0] Claude's questions: one card each, answered in words, with a pick or a file ──
function questionsForm(t: WizardTalk): HTMLElement {
  const wrap = el('section', { class: 'pc-talk' });
  const n = t.open.length;
  wrap.append(
    el('h2', {
      class: 'pc-hero__title',
      text:
        `Claude has ${String(n)} question${n === 1 ? '' : 's'}` +
        (t.rounds > 1 ? ` (round ${String(t.rounds)})` : ''),
    }),
    el('p', {
      class: 'pc-muted',
      text:
        'Answer in your own words, pick a suggestion, or attach a file (a spec, a sketch, an export). ' +
        'Leave a question empty and Claude decides it for you and says so in the plan.',
    }),
  );
  if (t.understanding) wrap.append(understandingBox(t.understanding));
  t.open.forEach((q, i) => {
    const card = el(
      'article',
      { class: 'pc-question' },
      el(
        'div',
        { class: 'pc-question__head' },
        el('span', { class: 'pc-question__num', text: String(i + 1) }),
        el('p', { class: 'pc-question__text', text: q.question }),
      ),
    );
    if (q.why) card.append(el('p', { class: 'pc-question__why', text: q.why }));
    if (q.options?.length) {
      const chips = el('div', { class: 'pc-chips' });
      for (const o of q.options) {
        const c = el('button', {
          class: 'pc-chip',
          type: 'button',
          text: o,
          title: 'Use this answer',
        });
        c.addEventListener('click', () => {
          const d = draftOf(q.id);
          d.text = d.text.trim() ? d.text.trim() + '\n' + o : o;
          keep();
          render();
        });
        chips.append(c);
      }
      card.append(chips);
    }
    card.append(answerBox(q.id, 'Your answer'), attachRow(q.id));
    wrap.append(card);
  });
  wrap.append(
    el(
      'article',
      { class: 'pc-question pc-question--more' },
      el(
        'div',
        { class: 'pc-question__head' },
        el('span', { class: 'pc-question__num' }, icon('add')),
        el('p', {
          class: 'pc-question__text',
          text: 'Anything else Claude should know? (optional)',
        }),
      ),
      answerBox(
        '_more',
        'For example: a system it must connect to, a deadline, an example you like',
      ),
      attachRow('_more'),
    ),
  );
  const send = button(
    'Send my answers',
    'send',
    () => {
      const out: Record<string, Draft> = {};
      for (const id of [...t.open.map((q) => q.id), '_more']) out[id] = draftOf(id);
      api.postMessage({ type: 'home/answers', answers: out });
      for (const k of Object.keys(answers)) Reflect.deleteProperty(answers, k);
      keep();
    },
    { primary: true, big: true },
  );
  const skip = button('Skip the questions and write the plan', 'debug-step-over', () => {
    planOp('skip');
  });
  wrap.append(
    el('div', { class: 'pc-hero__actions pc-hero__actions--end' }, skip, send),
    earlier(t),
  );
  return wrap;
}

/** A box for something the user wants to add or change, with files. */
function noteBox(
  id: string,
  title: string,
  placeholder: string,
  sendLabel: string,
  onSend: (d: Draft) => void,
  onCancel: () => void,
): HTMLElement {
  return el(
    'article',
    { class: 'pc-question pc-question--more' },
    el('p', { class: 'pc-question__text', text: title }),
    answerBox(id, placeholder),
    attachRow(id),
    el(
      'div',
      { class: 'pc-hero__actions pc-hero__actions--end' },
      button('Cancel', 'close', onCancel),
      button(
        sendLabel,
        'send',
        () => {
          onSend({ ...draftOf(id) });
          Reflect.deleteProperty(answers, id);
          keep();
        },
        { primary: true },
      ),
    ),
  );
}

// ── [PCODE-457 | S15 | v0.1.0] while Claude works: what it does right now, and a way to stop it ──
function working(title: string, text: string, w: WizardData): HTMLElement {
  const r = w.running;
  const since = r?.startedAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(r.startedAt)) / 1000))
    : 0;
  const steps = el('ul', { class: 'pc-steps', 'aria-live': 'polite' });
  for (const st of r?.steps ?? []) steps.append(el('li', {}, icon('circle-small-filled'), st));
  if (!r?.steps.length && !r?.live)
    steps.append(el('li', { class: 'pc-muted', text: 'Starting Claude Code…' }));
  // [PCODE-461 | S15 | v0.1.0] the step in progress: which file, how much is written so far
  if (r?.live)
    steps.append(
      el('li', { class: 'pc-steps__now' }, icon('loading codicon-modifier-spin'), r.live),
    );
  return el(
    'section',
    { class: 'pc-hero' },
    el('div', { class: 'pc-hero__icon' }, icon('loading codicon-modifier-spin')),
    el('h2', { class: 'pc-hero__title', text: title }),
    el('p', { class: 'pc-hero__text', text }),
    el('p', {
      class: 'pc-muted',
      text:
        `Working for ${String(Math.floor(since / 60))}:${String(since % 60).padStart(2, '0')} min. ` +
        'The portal shows it live too, under Agents.',
    }),
    steps,
    el(
      'div',
      { class: 'pc-hero__actions' },
      button('Stop', 'debug-stop', () => {
        planOp('stop');
      }),
    ),
  );
}

function sessionError(w: WizardData): HTMLElement | string {
  const e = w.running?.error;
  if (!e) return '';
  return el('div', {
    class: `pc-alert${e === 'stopped' ? ' pc-alert--info' : ''}`,
    role: 'alert',
    text: e === 'stopped' ? 'Stopped. Start again whenever you are ready.' : e,
  });
}

// ── [PCODE-467 | S15 | v0.1.0] for whom: the client (an existing one or a new one) or internal, and its requests ──
interface BindDraft {
  /** a client's id, 'new', 'internal', or '' (not chosen) */
  pick: string;
  newClient: string;
  requestIds: string[];
  fromDescription: boolean;
}
let bindDraft: BindDraft | null = null;
let bindDraftOf = '';
let bindingOpen = false;

function draftFor(b: HomeBinding): BindDraft {
  // a binding changed elsewhere (saved here, or set in the portal) starts the choice again from it
  const key =
    (b.client?.id ?? '') +
    '|' +
    String(b.internal) +
    '|' +
    b.requests.map((r) => r.id + String(r.inProject)).join(',');
  if (key !== bindDraftOf) {
    bindDraftOf = key;
    bindDraft = null;
  }
  bindDraft ??= {
    pick: b.client?.id ?? (b.internal ? 'internal' : ''),
    newClient: '',
    requestIds: b.requests.filter((r) => r.inProject).map((r) => r.id),
    fromDescription: !b.requests.some((r) => r.inProject),
  };
  return bindDraft;
}

function choiceOf(d: BindDraft): HomeBindingChoice | null {
  if (d.pick === 'internal') return { internal: true, requestIds: [] };
  if (d.pick === 'new')
    return d.newClient.trim()
      ? { newClient: d.newClient.trim(), requestIds: [], fromDescription: d.fromDescription }
      : null;
  return d.pick
    ? { clientId: d.pick, requestIds: d.requestIds, fromDescription: d.fromDescription }
    : null;
}

function bindingBox(b: HomeBinding, onChange: () => void): HTMLElement {
  const d = draftFor(b);
  const box = el(
    'section',
    { class: 'pc-bind' },
    el('h3', { class: 'pc-bind__title' }, icon('organization'), ' For which client?'),
    el('p', {
      class: 'pc-muted',
      text: 'Every task is done for someone: Orqiva links each task to the client request it serves, so you can check later that the work was what the client asked for.',
    }),
  );
  const select = el('select', { class: 'pc-input', 'aria-label': 'Client' });
  const opt = (value: string, text: string): HTMLOptionElement => {
    const o = el('option', { value, text });
    o.selected = d.pick === value;
    return o;
  };
  select.append(opt('', 'Choose the client…'));
  for (const c of b.clients) select.append(opt(c.id, c.name));
  select.append(opt('new', '+ A new client'), opt('internal', 'No client: an internal project'));
  select.addEventListener('change', () => {
    d.pick = select.value;
    // another client: its requests are not known here yet, so the description becomes one
    if (d.pick !== (b.client?.id ?? '')) {
      d.requestIds = [];
      d.fromDescription = true;
    }
    render();
  });
  box.append(select);
  if (d.pick === 'new') {
    const name = el('input', {
      class: 'pc-input',
      type: 'text',
      maxlength: '200',
      'data-focus': 'newClient',
    });
    name.placeholder = 'The client’s name, e.g. Werkstatt Meyer GmbH';
    name.value = d.newClient;
    name.addEventListener('input', () => {
      d.newClient = name.value;
      onChange();
    });
    box.append(name);
  }
  if (d.pick && d.pick !== 'internal') {
    // the client's requests are known for the client the project has; a new choice shows them after saving
    const theirs = b.client?.id === d.pick ? b.requests : [];
    if (theirs.length) {
      box.append(
        el('p', {
          class: 'pc-bind__label',
          text: 'What the client asked for (the plan answers these):',
        }),
      );
      for (const r of theirs) {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = d.requestIds.includes(r.id);
        cb.addEventListener('change', () => {
          d.requestIds = cb.checked
            ? [...d.requestIds, r.id]
            : d.requestIds.filter((x) => x !== r.id);
          onChange();
        });
        box.append(
          el(
            'label',
            { class: 'pc-bind__request' },
            cb,
            el('span', { class: 'pc-mono', text: r.ref }),
            ' ' +
              r.title +
              (r.tasks ? ` · ${String(r.tasks)} task${r.tasks === 1 ? '' : 's'}` : ''),
          ),
        );
      }
    }
    const from = el('input', { type: 'checkbox' });
    from.checked = d.fromDescription;
    from.addEventListener('change', () => {
      d.fromDescription = from.checked;
      onChange();
    });
    box.append(
      el(
        'label',
        { class: 'pc-bind__request' },
        from,
        theirs.length
          ? ' Also make a new client request from this description'
          : ' Make a client request from this description (the client can see and comment on it in their portal)',
      ),
    );
  }
  return box;
}

/** A project planned before its client was known: the notice, or the form to choose it. */
function bindingNotice(b: HomeBinding): HTMLElement | string {
  if (b.ok || b.error) return '';
  if (!bindingOpen)
    return el(
      'div',
      { class: 'pc-alert', role: 'status' },
      el('strong', { text: 'This project is not linked to a client yet. ' }),
      'Every task should trace back to what a client asked for. ',
      button(
        'Choose the client',
        'organization',
        () => {
          bindingOpen = true;
          render();
        },
        { small: true },
      ),
    );
  const save = button(
    'Save, and let Claude map the tasks to the requests',
    'check',
    () => {
      const choice = choiceOf(draftFor(b));
      if (!choice) return;
      bindingOpen = false;
      bindDraft = null;
      api.postMessage({ type: 'home/binding', binding: choice });
    },
    { primary: true, busyKey: 'binding' },
  );
  const sync = (): void => {
    save.disabled = busy !== null || !choiceOf(draftFor(b));
  };
  sync();
  return el(
    'div',
    { class: 'pc-question' },
    bindingBox(b, sync),
    el(
      'div',
      { class: 'pc-hero__actions pc-hero__actions--end' },
      button('Cancel', 'close', () => {
        bindingOpen = false;
        bindDraft = null;
        render();
      }),
      save,
    ),
  );
}

// ── [PCODE-79 | S08 | v0.1.0] one screen per wizard step ──
function wizardScreen(w: WizardData): HTMLElement {
  const wrap = el('section', { class: 'pc-boardwrap' }, wizardStepper(w));
  const t = w.talk;
  const step = editingDescription ? 'describe' : w.step;
  const changeDescription = (): HTMLButtonElement =>
    button('Change the description', 'edit', () => {
      editingDescription = true;
      replanOpen = false;
      noteOpen = false;
      render();
    });
  if (step === 'describe') {
    const area = el('textarea', {
      class: 'pc-textarea pc-textarea--big',
      rows: '12',
      'data-focus': 'description',
    });
    area.value = descDraft ?? w.descriptionText;
    area.placeholder =
      'What do you want to build? Who will use it? What must it do, what would be nice? ' +
      'Anything about looks, hosting or deadlines?\n\nPlain words are perfect - Claude reads this and asks you about anything unclear.';
    const save = button(
      t ? 'Save - Claude reads it next' : 'Save and continue',
      'arrow-right',
      () => {
        error = null;
        editingDescription = false;
        descDraft = null;
        // [PCODE-467 | S15 | v0.1.0] with the client the project is for
        const choice = b ? choiceOf(draftFor(b)) : null;
        api.postMessage({
          type: 'home/saveDescription',
          text: area.value,
          ...(choice ? { binding: choice } : {}),
        });
        bindDraft = null;
      },
      { primary: true, big: true, busyKey: 'saveDescription' },
    );
    // [PCODE-467 | S15 | v0.1.0] on an Orqiva server, nothing is planned before it is clear for whom
    const b = data?.binding && !data.binding.error ? data.binding : null;
    const sync = (): void => {
      descDraft = area.value;
      save.disabled =
        busy !== null || !area.value.trim() || (b !== null && !b.ok && !choiceOf(draftFor(b)));
    };
    area.addEventListener('input', sync);
    sync();
    const actions = el('div', { class: 'pc-hero__actions pc-hero__actions--end' });
    // [PCODE-457 | S15 | v0.1.0] a change can be dropped; a saved change makes Claude read it again
    if (editingDescription)
      actions.append(
        button('Back without saving', 'arrow-left', () => {
          editingDescription = false;
          descDraft = null;
          render();
        }),
      );
    actions.append(save);
    wrap.append(
      el('h2', {
        class: 'pc-hero__title',
        text: editingDescription ? 'Change the description' : 'Describe your idea',
      }),
      el('p', {
        class: 'pc-muted',
        text:
          editingDescription && t && (w.plan !== 'missing' || t.rounds > 0)
            ? 'When you save a change, Claude reads it again, may ask a few more questions, and then writes the plan again.'
            : 'Write it like you would explain it to a friend. You can attach documents when Claude asks its questions.',
      }),
      b ? bindingBox(b, sync) : '',
      area,
      actions,
    );
    return wrap;
  }
  wrap.append(sessionError(w));
  // [PCODE-457 | S15 | v0.1.0] the conversation, on a folder on Orqiva
  if (t && step === 'questions') {
    if (w.running?.phase === 'asking')
      wrap.append(
        working(
          t.rounds ? 'Claude reads your answers…' : 'Claude reads your description…',
          'It looks for what is still unclear and turns it into a few questions for you. Usually about a minute.',
          w,
        ),
      );
    else if (t.state === 'asking') wrap.append(questionsForm(t));
    else
      wrap.append(
        hero(
          t.rounds ? 'Claude needs to read again' : 'First, Claude asks you a few questions',
          t.rounds
            ? 'Something changed since Claude last read the project. Let it read again; it may ask more questions.'
            : 'Claude reads your description and asks what it needs to know: who uses it, what is a must, ' +
                'which systems it connects to, where it runs. You answer here, in words or with files. ' +
                'When nothing is unclear any more, Claude writes the plan.',
          'comment-discussion',
          button(
            t.rounds ? 'Let Claude read again' : 'Start',
            'play',
            () => {
              planOp('next');
            },
            { primary: true, big: true },
          ),
          changeDescription(),
        ),
        earlier(t),
      );
    return wrap;
  }
  if (t && step === 'draft') {
    if (w.running?.phase === 'writing') {
      wrap.append(
        working(
          'Claude is writing the plan…',
          'It writes the architecture, design system, rules and the sprint plan. This takes a few minutes; ' +
            'you can keep working, this page moves on by itself.',
          w,
        ),
      );
      return wrap;
    }
    wrap.append(
      noteOpen
        ? noteBox(
            '_note',
            'What should Claude know or change?',
            'For example: the shop also needs a B2B price list',
            'Send to Claude',
            (d) => {
              noteOpen = false;
              api.postMessage({ type: 'home/note', text: d.text, files: d.files });
            },
            () => {
              noteOpen = false;
              render();
            },
          )
        : hero(
            'Claude has what it needs',
            t.outdatedPlan
              ? 'The conversation changed since the last plan, so Claude writes the plan again from all of it.'
              : 'No more questions. Read below what Claude understood; if it is right, let it write the plan.',
            'pass',
            button(
              'Write the plan',
              'sparkle',
              () => {
                planOp('write');
              },
              { primary: true, big: true },
            ),
            button('Add something first', 'comment', () => {
              noteOpen = true;
              render();
            }),
            changeDescription(),
          ),
    );
    if (t.understanding) wrap.append(understandingBox(t.understanding, 'What Claude will plan'));
    wrap.append(earlier(t));
    if (t.outdatedPlan && w.sprints.length)
      wrap.append(
        el('h3', { class: 'pc-sprint-title', text: 'The plan from before' }),
        planPreview(w.sprints),
      );
    return wrap;
  }
  if (step === 'draft') {
    wrap.append(
      drafting
        ? hero(
            'Claude is planning…',
            'Claude reads your description and writes the plan in the terminal below. If it asks you ' +
              'something, answer there. This page moves on by itself as soon as the plan is ready.',
            'loading codicon-modifier-spin',
            changeDescription(),
          )
        : hero(
            'Let Claude plan it',
            'Claude splits your idea into small tasks, grouped into one-day sprints, each with what ' +
              '"done" means. Nothing is published yet - you check the plan first.',
            'sparkle',
            button('Plan it with Claude', 'sparkle', redraft, { primary: true, big: true }),
            changeDescription(),
          ),
    );
    return wrap;
  }
  drafting = false;
  if (step === 'review') {
    const list = el('ul', { class: 'pc-list' });
    for (const e of w.errors) list.append(el('li', { class: 'pc-hint--error', text: e }));
    if (w.checkError) list.append(el('li', { class: 'pc-hint--error', text: w.checkError }));
    wrap.append(
      hero(
        'The plan needs a fix',
        w.plan === 'invalid'
          ? 'The plan file could not be read. Let Claude write it again.'
          : 'A few things in the plan are not right yet. Claude can fix them by planning again.',
        'warning',
        button(
          'Let Claude fix it',
          'sparkle',
          t
            ? () => {
                planOp('write');
              }
            : redraft,
          { primary: true, big: true },
        ),
        button('Show the details', 'map', () => {
          go('planProject');
        }),
      ),
      list,
      planPreview(w.sprints),
    );
    return wrap;
  }
  wrap.append(
    hero(
      'Your plan is ready',
      `${String(w.totals.sprints)} sprint${w.totals.sprints === 1 ? '' : 's'} with ${String(w.totals.items)} tasks. ` +
        'Look it over below. When it looks right, publish it - then the tasks show up on your board. ' +
        'Not right? Plan it again and tell Claude what to change.',
      'pass',
      button(
        'Publish the plan',
        'cloud-upload',
        () => {
          go('publishPlan');
        },
        { primary: true, big: true },
      ),
      button(
        'Plan it again',
        'refresh',
        t
          ? () => {
              replanOpen = true;
              render();
            }
          : redraft,
      ),
      changeDescription(),
    ),
  );
  // [PCODE-457 | S15 | v0.1.0] plan it again: say what should change; Claude may ask, then plans anew
  if (replanOpen)
    wrap.append(
      noteBox(
        '_replan',
        'What should be different in the new plan? (optional)',
        'For example: fewer sprints, start with the import, leave out the mobile app',
        'Plan it again',
        (d) => {
          replanOpen = false;
          api.postMessage({ type: 'home/replan', wish: d.text });
        },
        () => {
          replanOpen = false;
          render();
        },
      ),
    );
  if (t?.understanding) wrap.append(understandingBox(t.understanding, 'What Claude planned'));
  wrap.append(planPreview(w.sprints));
  return wrap;
}

// ── [PCODE-454 | S15 | v0.1.0] a finished step: what it set up, and the buttons that change it ──
function facts(rows: [string, string][]): HTMLElement {
  const dl = el('dl', { class: 'pc-facts' });
  for (const [k, v] of rows) dl.append(el('dt', { text: k }), el('dd', { text: v }));
  return dl;
}

function backButton(): HTMLButtonElement {
  return button('Back to my project', 'arrow-left', () => {
    viewing = null;
    render();
  });
}

function stepDetails(d: HomeData, id: StepId): HTMLElement {
  const wrap = el('section', { class: 'pc-hero pc-hero--details' });
  const head = (iconName: string, title: string, text: string): void => {
    wrap.append(
      el('div', { class: 'pc-hero__icon' }, icon(iconName)),
      el('h2', { class: 'pc-hero__title', text: title }),
      el('p', { class: 'pc-hero__text', text }),
    );
  };
  const actions = el('div', { class: 'pc-hero__actions' });
  if (id === 'computer') {
    head(
      'device-desktop',
      'This computer is ready',
      'The helpers Orqiva needs were found. Check again after you installed or updated something.',
    );
    actions.append(
      button('Check this computer again', 'checklist', () => {
        go('openSetup');
      }),
    );
  } else if (id === 'plane') {
    head(
      'plug',
      'Signed in to Orqiva',
      'This computer uses this sign-in for your Orqiva projects. Sign in again to use another account or another Orqiva server.',
    );
    wrap.append(
      facts(
        d.account
          ? [
              ['Server', d.account.server],
              ['Account', d.account.email],
            ]
          : [['Sign-in', 'The legacy tracker key']],
      ),
    );
    actions.append(
      button(
        'Sign in to another server or account',
        'plug',
        () => {
          go('signIn');
        },
        { primary: true },
      ),
    );
  } else {
    const p = d.project;
    head(
      'folder',
      'Linked project',
      'This folder is linked to the project below, and its tasks show on your board. Picked the wrong one? Link the folder to another project.',
    );
    if (p) {
      const rows: [string, string][] = [
        ['Project', p.name],
        ['Key', p.identifier],
      ];
      if (p.server) rows.push(['Server', p.server]);
      wrap.append(facts(rows));
      if (p.server && d.account && d.account.server !== p.server)
        wrap.append(
          el('div', {
            class: 'pc-alert pc-alert--info',
            role: 'status',
            text:
              'You are signed in to ' +
              d.account.server +
              ', but this project is on ' +
              p.server +
              '. Link the folder to a project on ' +
              d.account.server +
              ', or sign in to ' +
              p.server +
              ' again.',
          }),
        );
    }
    actions.append(
      button(
        'Link to another project',
        'link',
        () => {
          go('linkProject');
        },
        { primary: true },
      ),
      button('Start a new project', 'sparkle', () => {
        go('newProject');
      }),
    );
    if (p?.url)
      actions.append(
        button('Open in Orqiva', 'link-external', () => {
          go('openProjectOnline');
        }),
      );
  }
  actions.append(backButton());
  wrap.append(actions);
  return wrap;
}

// ── [PCODE-78 | S08 | v0.1.0] one screen per step, each with one obvious button ──
function stepScreen(d: HomeData): HTMLElement {
  if (viewing && viewing !== d.current) return stepDetails(d, viewing); // [PCODE-454 | S15 | v0.1.0]
  if (d.current === 'computer')
    return hero(
      'Get this computer ready',
      'Orqiva needs a few helpers on this computer, such as Node.js, Git and Claude Code. ' +
        'We check what is there and show you what is missing, with a button for each.',
      'device-desktop',
      button(
        'Check this computer',
        'checklist',
        () => {
          go('openSetup');
        },
        {
          primary: true,
          big: true,
        },
      ),
    );
  // [PCODE-453 | S15 | v0.1.0] the step is signing in to the Orqiva server
  if (d.current === 'plane')
    return hero(
      'Sign in to Orqiva',
      'Orqiva is where your tasks live. Sign in with the address of your Orqiva server, your e-mail and ' +
        'your password. Your password is not stored; this computer keeps a personal token.',
      'plug',
      button(
        'Sign in',
        'plug',
        () => {
          go('signIn');
        },
        { primary: true, big: true },
      ),
    );
  if (d.current === 'project') {
    if (!d.folderOpen) {
      const actions = [
        button(
          'Choose a folder…',
          'folder-opened',
          () => {
            go('openFolder');
          },
          {
            primary: true,
            big: true,
          },
        ),
      ];
      if (d.hasRecent)
        actions.push(
          button(
            'Open a recent project',
            'history',
            () => {
              go('openRecent');
            },
            { big: true },
          ),
        );
      return hero(
        'Pick your project folder',
        'Every project lives in a folder on this computer. Choose an empty folder for something new, ' +
          'or the folder of a project you already have.',
        'folder',
        ...actions,
      );
    }
    if (creating) return newProjectForm();
    const s = el(
      'section',
      { class: 'pc-hero' },
      el('div', { class: 'pc-hero__icon' }, icon('folder')),
      el('h2', { class: 'pc-hero__title', text: 'Is this a new project?' }),
      el('p', {
        class: 'pc-hero__text',
        text: 'Connect this folder to a project in Orqiva. Pick one:',
      }),
      el(
        'div',
        { class: 'pc-tiles' },
        tile(
          'Start a new project',
          'Creates the project in Orqiva and links this folder to it.',
          'sparkle',
          'newProject',
        ),
        tile(
          'Use an existing project',
          'This folder belongs to a project that is already in Orqiva, for example one made in the web app.',
          'link',
          'linkProject',
        ),
      ),
    );
    return s;
  }
  creating = false;
  return d.wizard ? wizardScreen(d.wizard) : board(d); // [PCODE-79 | S08 | v0.1.0]
}

function priorityDot(p: string): HTMLElement {
  return el('span', { class: `pc-prio pc-prio--${p}`, title: `Priority: ${p}` });
}

// ── [PCODE-78 | S08 | v0.1.0] a card: what it is, and the buttons that fit where it is ──
function cardEl(c: HomeCard, col: HomeColumn['id']): HTMLElement {
  const title = el('button', { class: 'pc-card__title', type: 'button', text: c.title });
  title.addEventListener('click', () => {
    task('open', c.ref);
  });
  const actions = el('div', { class: 'pc-card__actions' });
  // [PCODE-462 | S15 | v0.1.0] a task in plan order waits for the ones before it
  if (col === 'todo' && c.waits?.length) {
    actions.append(
      el('span', {
        class: 'pc-card__waits',
        text: 'Waits for ' + c.waits.join(', '),
        title: 'It starts when ' + c.waits.join(', ') + ' is finished (in Review or Done).',
      }),
    );
  } else if (col === 'todo') {
    actions.append(
      button(
        'Build with Claude',
        'sparkle',
        () => {
          task('build', c.ref);
        },
        {
          primary: true,
          small: true,
          busyKey: `build:${c.ref}`,
        },
      ),
      button(
        'Start',
        'play',
        () => {
          task('start', c.ref);
        },
        {
          small: true,
          busyKey: `start:${c.ref}`,
        },
      ),
    );
  } else if (col === 'working') {
    actions.append(
      button(
        c.active ? 'Continue with Claude' : 'Build with Claude',
        'sparkle',
        () => {
          task('build', c.ref);
        },
        {
          primary: !c.active,
          small: true,
          busyKey: `build:${c.ref}`,
        },
      ),
    );
    if (c.active)
      actions.append(
        button(
          'Finished',
          'pass',
          () => {
            task('done', c.ref);
          },
          {
            primary: true,
            small: true,
            busyKey: `done:${c.ref}`,
          },
        ),
      );
  }
  if (c.url)
    actions.append(
      button(
        'Open online',
        'link-external',
        () => {
          task('plane', c.ref);
        },
        { small: true },
      ),
    );
  return el(
    'article',
    {
      class: `pc-card${c.active ? ' pc-card--active' : ''}${c.blocked ? ' pc-card--blocked' : ''}`,
    },
    el(
      'div',
      { class: 'pc-card__meta' },
      priorityDot(c.priority),
      el('span', { class: 'pc-card__ref', text: c.ref }),
      c.active ? el('span', { class: 'pc-badge', text: 'You are on this' }) : '',
      c.blocked ? el('span', { class: 'pc-badge pc-badge--warn', text: 'Blocked' }) : '',
    ),
    title,
    actions,
  );
}

function sprintPicker(sprints: HomeSprint[], current: HomeSprint): HTMLElement {
  const nav = el('div', { class: 'pc-chips', role: 'tablist', 'aria-label': 'Sprints' });
  for (const s of sprints) {
    const b = el(
      'button',
      {
        class: `pc-chip${s.code === current.code ? ' pc-chip--on' : ''}`,
        type: 'button',
        role: 'tab',
        'aria-selected': String(s.code === current.code),
      },
      s.isToday ? icon('calendar') : '',
      `${s.isToday ? 'Today' : s.code}${s.open ? ` · ${s.open}` : ''}`,
    );
    b.title = s.name;
    b.addEventListener('click', () => {
      sprintCode = s.code;
      render();
    });
    nav.append(b);
  }
  return nav;
}

// ── [PCODE-78 | S08 | v0.1.0] the board: today's sprint unless another one was picked ──
function board(d: HomeData): HTMLElement {
  const wrap = el('section', { class: 'pc-boardwrap' });
  const toolbar = el(
    'div',
    { class: 'pc-toolbar' },
    button(
      'New task',
      'add',
      () => {
        go('newTask');
      },
      { primary: true },
    ),
    button('Plan the project', 'map', () => {
      go('planProject');
    }),
    button('Get latest', 'sync', () => {
      go('sync');
    }),
    button('All projects', 'dashboard', () => {
      go('openDashboard');
    }),
  );
  wrap.append(toolbar);
  if (d.binding) wrap.append(bindingNotice(d.binding)); // [PCODE-467 | S15 | v0.1.0]
  if (!d.trusted)
    wrap.append(
      el(
        'div',
        { class: 'pc-alert pc-alert--info', role: 'status' },
        'This folder is not trusted yet, so Orqiva can only look, not act. ',
        button(
          'Trust this folder',
          'shield',
          () => {
            go('trust');
          },
          { small: true },
        ),
      ),
    );
  if (d.sprints.length === 0) {
    wrap.append(
      hero(
        'No tasks yet',
        'Describe what you want to build and let Claude plan it into small tasks - or add a first task yourself.',
        'lightbulb',
        button(
          'Plan the project with Claude',
          'sparkle',
          () => {
            go('planProject');
          },
          {
            primary: true,
            big: true,
          },
        ),
        button(
          'Add a task',
          'add',
          () => {
            go('newTask');
          },
          { big: true },
        ),
      ),
    );
    return wrap;
  }
  const current =
    d.sprints.find((s) => s.code === sprintCode) ??
    d.sprints.find((s) => s.isToday) ??
    d.sprints[0];
  if (!current) return wrap;
  wrap.append(
    sprintPicker(d.sprints, current),
    el('h2', { class: 'pc-sprint-title', text: current.name }),
  );
  const cols = el('div', { class: 'pc-board' });
  for (const c of current.columns) {
    const list = el('div', { class: 'pc-column__cards' });
    if (c.cards.length === 0)
      list.append(el('p', { class: 'pc-muted pc-column__empty', text: 'Nothing here' }));
    for (const card of c.cards) list.append(cardEl(card, c.id));
    cols.append(
      el(
        'section',
        { class: `pc-column pc-column--${c.id}`, 'aria-label': c.title },
        el(
          'h3',
          { class: 'pc-column__title' },
          c.title,
          el('span', { class: 'pc-column__count', text: String(c.cards.length) }),
        ),
        list,
      ),
    );
  }
  wrap.append(cols);
  return wrap;
}

let tick: ReturnType<typeof setTimeout> | null = null;
function render(): void {
  // [PCODE-457 | S15 | v0.1.0] a redraw keeps the box the user is typing in, and the cursor in it
  const focused =
    document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null;
  const focusKey = focused?.getAttribute('data-focus') ?? null;
  const sel = focused ? [focused.selectionStart, focused.selectionEnd] : [0, 0];
  app.replaceChildren();
  const header = el(
    'header',
    { class: 'pc-header pc-home__header' },
    el('h1', { class: 'pc-title' }, icon('rocket'), ' Orqiva'),
  );
  // [PCODE-454 | S15 | v0.1.0] the project and its server; a click shows the link and how to change it
  if (data?.project) {
    const p = data.project;
    const chip = el(
      'button',
      { class: 'pc-home__project', type: 'button', title: 'Show and change the linked project' },
      icon('project'),
      `${p.name} (${p.identifier})`,
      p.server
        ? el('span', { class: 'pc-muted', text: ' · ' + p.server.replace(/^https?:\/\//, '') })
        : '',
    );
    chip.addEventListener('click', () => {
      viewing = 'project';
      render();
    });
    header.append(chip);
  }
  // [PCODE-458 | S15 | v0.1.0] the newest build from GitHub, one click away
  const upd = el(
    'button',
    {
      class: 'pc-home__update',
      type: 'button',
      title: 'Look for a newer Orqiva on GitHub and install it',
    },
    icon('cloud-download'),
    ' Update',
  );
  upd.addEventListener('click', () => {
    go('checkForUpdates');
  });
  header.append(upd);
  if (data && !data.online && data.project)
    header.append(
      el('span', { class: 'pc-badge', text: 'Offline - showing the last saved board' }),
    );
  app.append(header);
  if (!data) {
    app.append(el('p', { class: 'pc-muted', text: 'Loading…' }));
    return;
  }
  app.append(stepper(data));
  if (error) app.append(el('div', { class: 'pc-alert', role: 'alert', text: error }));
  app.append(stepScreen(data));
  if (focusKey) {
    const again = app.querySelector<HTMLTextAreaElement>(`[data-focus="${focusKey}"]`);
    again?.focus();
    again?.setSelectionRange(sel[0] ?? 0, sel[1] ?? 0);
  }
  // [PCODE-457 | S15 | v0.1.0] while Claude works, the clock on the page moves
  if (tick) clearTimeout(tick);
  const running = data.wizard?.running;
  tick = running && running.phase !== 'idle' ? setTimeout(render, 1000) : null;
}

window.addEventListener('message', (ev: MessageEvent<HostToHome>) => {
  const m = ev.data;
  if (m.type === 'home/data') data = m.data;
  else if (m.type === 'home/busy') busy = m.busy ? (m.what ?? 'busy') : null;
  else if (m.type === 'home/attached') {
    // [PCODE-457 | S15 | v0.1.0] the picked files, copied next to the description
    const d = draftOf(m.question);
    d.files = [...d.files, ...m.files.filter((f) => !d.files.includes(f))];
    keep();
  } else error = m.message;
  render();
});

render();
api.postMessage({ type: 'home/ready' });
