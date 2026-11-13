// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-19 | S04 | v0.1.0] Add the webview host helper with CSP nonce, theme CSS and a typed message bridge ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  one way to open a panel: strict CSP with a per-load nonce, local resources only, one panel per id
//          (reveal, never duplicate), and inbound messages validated before they reach a handler.
import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { isWebviewMessage, type WebviewToHost } from './protocol';

export interface HtmlOptions {
  title: string;
  nonce: string;
  cspSource: string;
  scriptUri: string;
  styleUris: string[];
  /** Static body markup (no inline handlers, no scripts); the entry script renders the rest. */
  body?: string;
}

// ── [PCODE-19 | S04 | v0.1.0] buildHtml: pure; tested for "one nonce, no inline handlers, no remote URLs" ──
export function buildHtml(o: HtmlOptions): string {
  const csp = [
    "default-src 'none'",
    `style-src ${o.cspSource}`,
    `script-src 'nonce-${o.nonce}'`,
    `font-src ${o.cspSource}`,
    `img-src ${o.cspSource} data:`,
  ].join('; ');
  const links = o.styleUris.map((u) => `<link rel="stylesheet" href="${u}">`).join('\n    ');
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${links}
    <title>${escapeHtml(o.title)}</title>
  </head>
  <body>
    <div id="app">${o.body ?? ''}</div>
    <script nonce="${o.nonce}" src="${o.scriptUri}"></script>
  </body>
</html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

export function newNonce(): string {
  return crypto.randomBytes(16).toString('base64url');
}

export interface PanelHandle<In extends WebviewToHost, Out> {
  panel: vscode.WebviewPanel;
  post(message: Out): Thenable<boolean>;
  /** Handlers receive only validated messages; anything else is logged and dropped. */
  onMessage(handler: (message: In) => void): vscode.Disposable;
  setTitle(title: string): void;
  reload(): void;
}

export interface CreatePanelOptions {
  id: string;
  title: string;
  /** bundle name under dist/webviews/, e.g. 'taskDetail' */
  entry: string;
  body?: string;
  column?: vscode.ViewColumn;
  log?: (line: string) => void;
}

const open = new Map<
  string,
  { panel: vscode.WebviewPanel; handle: PanelHandle<WebviewToHost, unknown> }
>();

// ── [PCODE-19 | S04 | v0.1.0] createPanel: reuse by id (reveal), else create with local roots media/ + dist/webviews/ ──
export function createPanel<In extends WebviewToHost, Out>(
  context: vscode.ExtensionContext,
  o: CreatePanelOptions,
): { handle: PanelHandle<In, Out>; created: boolean } {
  const existing = open.get(o.id);
  if (existing) {
    existing.panel.reveal(undefined, true);
    existing.handle.setTitle(o.title);
    return { handle: existing.handle as unknown as PanelHandle<In, Out>, created: false };
  }
  const roots = [
    vscode.Uri.joinPath(context.extensionUri, 'dist', 'media'),
    vscode.Uri.joinPath(context.extensionUri, 'dist', 'webviews'),
  ];
  const panel = vscode.window.createWebviewPanel(
    `orqiva.${o.id}`,
    o.title,
    o.column ?? vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: roots,
      retainContextWhenHidden: true,
    },
  );
  const render = (): void => {
    const w = panel.webview;
    panel.webview.html = buildHtml({
      title: o.title,
      nonce: newNonce(),
      cspSource: w.cspSource,
      scriptUri: w
        .asWebviewUri(
          vscode.Uri.joinPath(context.extensionUri, 'dist', 'webviews', `${o.entry}.js`),
        )
        .toString(),
      styleUris: [
        w
          .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'media', 'codicon.css'))
          .toString(),
        w
          .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'media', 'webview.css'))
          .toString(),
      ],
      ...(o.body === undefined ? {} : { body: o.body }),
    });
  };
  render();
  const handle: PanelHandle<In, Out> = {
    panel,
    post: (m) => panel.webview.postMessage(m),
    onMessage: (handler) =>
      panel.webview.onDidReceiveMessage((raw: unknown) => {
        if (isWebviewMessage(raw)) handler(raw as In);
        else o.log?.(`dropped invalid webview message: ${JSON.stringify(raw).slice(0, 200)}`);
      }),
    setTitle: (t) => {
      panel.title = t;
    },
    reload: render,
  };
  open.set(o.id, { panel, handle });
  panel.onDidDispose(() => open.delete(o.id));
  context.subscriptions.push(panel);
  return { handle, created: true };
}

export function openPanelIds(): string[] {
  return [...open.keys()];
}
