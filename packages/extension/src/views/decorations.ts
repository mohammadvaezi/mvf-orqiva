// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-37 | S07 | v0.1.0] Add editor decorations for fingerprint lines with hover details ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  marker lines are metadata, not code: they render at 0.8 opacity with a gutter icon, and hovering
//          one shows task, title, sprint, version, state and an "Open task" link. Ranges come from the same
//          scanner as the lenses; updates are debounced so typing in a large file stays responsive.
import * as vscode from 'vscode';
import type { CacheEntry, IssueCache } from '../plane/issueCache';
import { Debounce } from '../plan/planCheck';
import { scanText, type Marker } from '../util/fingerprint';
import { shouldScan } from '../util/fingerprintScan';
import { SETTING } from './codelens';

export interface DecorationSpec {
  /** 0-based line */
  line: number;
  marker: Marker;
  hover: string;
}

// ── [PCODE-37 | S07 | v0.1.0] hoverMarkdown: task · title · sprint · version · state + Open task command link ──
export function hoverMarkdown(m: Marker, entry: CacheEntry): string {
  const title = entry.kind === 'known' ? entry.info.title : m.title;
  const state =
    entry.kind === 'known'
      ? entry.info.state.name
      : entry.kind === 'missing'
        ? 'not found in Orqiva'
        : entry.kind === 'offline'
          ? 'offline'
          : '…';
  const args = encodeURIComponent(JSON.stringify([m.task]));
  const planeLink =
    entry.kind === 'known' && entry.info.url ? ` · [Open in Orqiva](${entry.info.url})` : '';
  return [
    `**${m.task}** ${title}`,
    '',
    `Sprint ${m.sprint.replace(/^S/, '')} · v${m.version} · ${state} · ${m.kind}`,
    '',
    `[Open task](command:orqiva.openTask?${args})${planeLink}`,
  ].join('\n');
}

/** pure: the decorations a document text produces */
export function decorationsFor(text: string, cache: Pick<IssueCache, 'get'>): DecorationSpec[] {
  return scanText(text).map((m) => ({
    line: m.line - 1,
    marker: m,
    hover: hoverMarkdown(m, cache.get(m.task)),
  }));
}

/** the subset of the editor API the decorator touches; injected for tests */
export interface EditorLike {
  document: { fileName: string; getText(): string; uri: { toString(): string } };
  setDecorations(type: vscode.TextEditorDecorationType, options: vscode.DecorationOptions[]): void;
}

export interface EditorHost {
  visibleTextEditors: readonly EditorLike[];
  onDidChangeActiveTextEditor(l: () => void): { dispose(): void };
  onDidChangeVisibleTextEditors(l: () => void): { dispose(): void };
  onDidChangeTextDocument(l: (e: { document: { uri: { toString(): string } } }) => void): {
    dispose(): void;
  };
}

// ── [PCODE-37 | S07 | v0.1.0] FingerprintDecorator: applies to visible editors, debounced on edits ──
export class FingerprintDecorator implements vscode.Disposable {
  private readonly subs: { dispose(): void }[] = [];
  private readonly pending: Debounce;
  applied = 0;

  constructor(
    private readonly cache: IssueCache,
    private readonly type: vscode.TextEditorDecorationType,
    private readonly host: EditorHost,
    private readonly enabled: () => boolean = () =>
      vscode.workspace.getConfiguration('orqiva').get<boolean>(SETTING, true),
    debounceMs = 300,
  ) {
    this.pending = new Debounce(debounceMs, () => {
      this.refreshAll();
    });
    this.subs.push(
      host.onDidChangeActiveTextEditor(() => {
        this.refreshAll();
      }),
      host.onDidChangeVisibleTextEditors(() => {
        this.refreshAll();
      }),
      host.onDidChangeTextDocument((e) => {
        if (
          host.visibleTextEditors.some(
            (ed) => ed.document.uri.toString() === e.document.uri.toString(),
          )
        )
          this.pending.schedule();
      }),
      cache.onDidChange(() => {
        this.refreshAll();
      }),
    );
    this.refreshAll();
  }

  refreshAll(): void {
    for (const editor of this.host.visibleTextEditors) this.refresh(editor);
  }

  refresh(editor: EditorLike): void {
    if (!this.enabled() || !shouldScan(editor.document.fileName)) {
      editor.setDecorations(this.type, []);
      return;
    }
    const options = decorationsFor(editor.document.getText(), this.cache).map((d) => {
      const md = new vscode.MarkdownString(d.hover);
      md.isTrusted = true;
      return { range: new vscode.Range(d.line, 0, d.line, 0), hoverMessage: md };
    });
    editor.setDecorations(this.type, options);
    this.applied++;
  }

  dispose(): void {
    this.pending.dispose();
    this.subs.forEach((s) => {
      s.dispose();
    });
    this.type.dispose();
  }
}

export function registerDecorations(
  context: vscode.ExtensionContext,
  cache: IssueCache,
): FingerprintDecorator {
  const icon = vscode.Uri.joinPath(context.extensionUri, 'dist', 'media', 'fingerprint.svg');
  const type = vscode.window.createTextEditorDecorationType({
    opacity: '0.8',
    isWholeLine: true,
    gutterIconPath: icon,
    gutterIconSize: 'contain',
  });
  const host: EditorHost = {
    get visibleTextEditors() {
      return vscode.window.visibleTextEditors;
    },
    onDidChangeActiveTextEditor: (l) => vscode.window.onDidChangeActiveTextEditor(l),
    onDidChangeVisibleTextEditors: (l) => vscode.window.onDidChangeVisibleTextEditors(l),
    onDidChangeTextDocument: (l) => vscode.workspace.onDidChangeTextDocument(l),
  };
  const decorator = new FingerprintDecorator(cache, type, host);
  context.subscriptions.push(
    decorator,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`orqiva.${SETTING}`)) decorator.refreshAll();
    }),
  );
  return decorator;
}
