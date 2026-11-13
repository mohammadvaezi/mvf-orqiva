// ── [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox ──
//    Why:  the toolbar button's page: which project, a title and a note, what goes with the bug, a screen
//          recording to attach, and the answer with the bug's reference and a link to it.
import type { FileAnswer, FileRequest } from './background.js';
import { ext } from './ext.js';
import { makeClient, type Settings } from './lib/client.js';

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the element's kind
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error('missing #' + id);
  return el as T;
};
const say = (text: string, link?: string): void => {
  const out = $('status');
  out.textContent = text;
  if (link) {
    const a = document.createElement('a');
    a.href = link;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = ' Open it';
    out.append(a);
  }
};

async function start(): Promise<void> {
  const stored = await ext.storage.local.get(['settings', 'lastProjectId', 'recording']);
  const settings = stored['settings'] as Settings | undefined;
  if (!settings?.token) {
    $('setup').hidden = false;
    $('form').hidden = true;
    return;
  }
  const select = $<HTMLSelectElement>('project');
  try {
    const projects = await makeClient(settings).projects();
    for (const p of projects) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.key + ' · ' + p.name;
      select.append(o);
    }
    const last = stored['lastProjectId'];
    if (typeof last === 'string' && projects.some((p) => p.id === last)) select.value = last;
  } catch (e) {
    say(e instanceof Error ? e.message : 'The projects could not be read');
  }
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  $<HTMLInputElement>('title').value = tab?.title ? 'Bug on ' + tab.title.slice(0, 80) : '';
  if (stored['recording']) $('recording').textContent = 'A recording goes with this bug.';
  $('record').addEventListener('click', () => {
    void ext.storage.local.set({ recordFor: select.value });
    void ext.tabs.create({ url: ext.runtime.getURL('record.html') });
  });
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const send = $<HTMLButtonElement>('send');
    send.disabled = true;
    say('Capturing…');
    const req: FileRequest = {
      type: 'file',
      projectId: select.value,
      title: $<HTMLInputElement>('title').value,
      note: $<HTMLTextAreaElement>('note').value,
      screenshot: $<HTMLInputElement>('with-screenshot').checked,
      ...(tab?.id === undefined ? {} : { tabId: tab.id }),
      include: {
        console: $<HTMLInputElement>('with-console').checked,
        network: $<HTMLInputElement>('with-network').checked,
        actions: $<HTMLInputElement>('with-actions').checked,
      },
    };
    void (ext.runtime.sendMessage(req) as Promise<FileAnswer>).then((a) => {
      send.disabled = false;
      if (a.ok) say('Filed as ' + a.ref + '.', a.url);
      else say(a.error);
    });
  });
}

$('options').addEventListener('click', () => {
  void ext.runtime.openOptionsPage();
});
void start();
