// ── [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox ──
//    Why:  where the extension files to: the person's Orqiva server and a personal API token (Settings →
//          API tokens), checked before they are kept. The token stays in the browser's extension storage.
import { ext } from './ext.js';
import { makeClient, serverUrl, type Settings } from './lib/client.js';

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the element's kind
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error('missing #' + id);
  return el as T;
};

async function start(): Promise<void> {
  const stored = (await ext.storage.local.get(['settings']))['settings'] as Settings | undefined;
  if (stored) {
    $<HTMLInputElement>('server').value = stored.server;
    $('status').textContent = 'Connected to ' + stored.server + '.';
  }
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    void save();
  });
}

async function save(): Promise<void> {
  const out = $('status');
  const server = serverUrl($<HTMLInputElement>('server').value);
  const token = $<HTMLInputElement>('token').value.trim();
  if (!server) {
    out.textContent = 'The address must be https (or http on this computer).';
    return;
  }
  if (!token) {
    out.textContent = 'Paste a personal API token from Settings → API tokens.';
    return;
  }
  out.textContent = 'Checking…';
  try {
    const me = await makeClient({ server, token, workspaceId: '' }).me();
    const ws = me.workspaces[0];
    if (!ws) {
      out.textContent = 'The token belongs to no workspace.';
      return;
    }
    await ext.storage.local.set({
      settings: { server, token, workspaceId: ws.id } satisfies Settings,
    });
    $<HTMLInputElement>('token').value = '';
    out.textContent = 'Connected as ' + me.name + ' to ' + ws.name + '.';
  } catch (e) {
    out.textContent = e instanceof Error ? e.message : 'That did not work';
  }
}

void start();
