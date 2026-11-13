// ── [PCODE-20 | S04 | v0.1.0] Build the task detail panel with description, acceptance, comments and badges ──
//    Why:  the one place a webview script touches the VS Code bridge; typed per panel.
export interface VsCodeApi<Out> {
  postMessage(message: Out): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi<Out>(): VsCodeApi<Out>;

let api: VsCodeApi<unknown> | undefined;

export function vscodeApi<Out>(): VsCodeApi<Out> {
  api ??= acquireVsCodeApi<unknown>();
  return api;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

export function icon(name: string): HTMLSpanElement {
  return el('span', { class: `codicon codicon-${name}`, 'aria-hidden': 'true' });
}
