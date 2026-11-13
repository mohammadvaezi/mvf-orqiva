// ── [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox ──
//    Why:  beside every page: keeps what the page hook passes on, notes the person's actions (where they
//          clicked and typed, never what), and hands all of it with the page and the device to the
//          background when a bug is filed.
import { ext } from './ext.js';
import {
  Ring,
  describeTarget,
  deviceOf,
  pathOf,
  type ActionEntry,
  type Collected,
  type ConsoleEntry,
  type NetworkEntry,
} from './lib/collect.js';

const logs = new Ring<ConsoleEntry>(100);
const requests = new Ring<NetworkEntry>(100);
const actions = new Ring<ActionEntry>(30);
const now = (): string => new Date().toISOString();

window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window) return;
  const d = e.data as { source?: string; kind?: string; entry?: unknown } | null;
  if (d?.source !== 'orqiva-capture') return;
  if (d.kind === 'console') logs.push(d.entry as ConsoleEntry);
  if (d.kind === 'network') requests.push(d.entry as NetworkEntry);
});

const targetOf = (t: EventTarget | null): string =>
  t instanceof Element ? describeTarget(t) : 'the page';

document.addEventListener(
  'click',
  (e) => {
    // the closest thing a person would call a button or a link
    const el =
      e.target instanceof Element
        ? (e.target.closest('a,button,[role],input,label,select') ?? e.target)
        : null;
    actions.push({ kind: 'click', target: targetOf(el), at: now() });
  },
  true,
);
document.addEventListener(
  'change',
  (e) => {
    const el = e.target;
    const what =
      el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')
        ? ' (' + (el.checked ? 'checked' : 'unchecked') + ')'
        : '';
    actions.push({ kind: 'input', target: targetOf(el) + what, at: now() });
  },
  true,
);
document.addEventListener(
  'submit',
  (e) => {
    actions.push({ kind: 'submit', target: targetOf(e.target), at: now() });
  },
  true,
);
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab')
      actions.push({ kind: 'key', target: e.key + ' in ' + targetOf(e.target), at: now() });
  },
  true,
);
const navigated = (): void => {
  actions.push({ kind: 'navigate', target: pathOf(location.href), at: now() });
};
navigated();
window.addEventListener('popstate', navigated);
window.addEventListener('hashchange', navigated);

ext.runtime.onMessage.addListener((message, _sender, reply) => {
  if ((message as { type?: string } | null)?.type !== 'collect') return undefined;
  const collected: Collected = {
    page: { url: location.href, title: document.title },
    device: deviceOf(window),
    console: logs.list(),
    network: requests.list(),
    actions: actions.list(),
  };
  reply(collected);
  return true;
});
