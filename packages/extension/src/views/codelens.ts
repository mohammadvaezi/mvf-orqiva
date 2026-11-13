// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-196 | S15 | v0.1.0] B8.4 VS Code: ideation interview, and presence per file and block (workspace switch, off by default) ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-36 | S07 | v0.1.0] Add a fingerprint CodeLens provider showing task title and state above markers ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  every fingerprint line gets "PCODE-12 Title · In Progress" above it (design-system.md "CodeLens");
//          clicking opens the task panel. The provider scans the document text with the same scanner the
//          panel and `plane done` use, and asks the IssueCache for title and state.
import * as vscode from 'vscode';
import type { IssueCache, CacheEntry } from '../plane/issueCache';
import { scanText } from '../util/fingerprint';
import { shouldScan } from '../util/fingerprintScan';

export const SETTING = 'codeLens.enabled';

// ── [PCODE-36 | S07 | v0.1.0] lensLabel: one label per cache state ──
export function lensLabel(ref: string, entry: CacheEntry): string {
  switch (entry.kind) {
    case 'known':
      return `${ref} ${entry.info.title} · ${entry.info.state.name}`;
    case 'missing':
      return `${ref} · not found in Orqiva`;
    case 'offline':
      return `${ref} · offline`;
    case 'pending':
      return `${ref} · …`;
  }
}

export interface LensSpec {
  line: number; // 1-based
  ref: string;
  title: string;
}

/** pure: the lenses a document text produces */
export function lensesFor(
  text: string,
  cache: Pick<IssueCache, 'get'>,
  /** [PCODE-196 | S15 | v0.1.0] who else is on this block (its task, in this file) */
  here: (ref: string) => string[] = () => [],
): LensSpec[] {
  return scanText(text).map((m) => {
    const names = here(m.task);
    return {
      line: m.line,
      ref: m.task,
      title:
        lensLabel(m.task, cache.get(m.task)) +
        (names.length
          ? ' · ' + names.join(', ') + (names.length === 1 ? ' is here' : ' are here')
          : ''),
    };
  });
}

// ── [PCODE-36 | S07 | v0.1.0] FingerprintCodeLensProvider: '*' files, gated by the setting ──
export class FingerprintCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;
  private readonly subs: { dispose(): void }[] = [];

  constructor(
    private readonly cache: IssueCache,
    private readonly enabled: () => boolean = () =>
      vscode.workspace.getConfiguration('orqiva').get<boolean>(SETTING, true),
  ) {
    this.subs.push(
      cache.onDidChange(() => {
        this.refresh();
      }),
    );
  }

  refresh(): void {
    this.emitter.fire();
  }

  /** [PCODE-196 | S15 | v0.1.0] who else is on a task in a file, from presence */
  private here: (ref: string, fsPath: string) => string[] = () => [];
  setPresence(here: (ref: string, fsPath: string) => string[]): void {
    this.here = here;
    this.refresh();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.enabled() || !shouldScan(document.fileName)) return [];
    return lensesFor(document.getText(), this.cache, (ref) =>
      this.here(ref, document.fileName),
    ).map((l) => {
      const range = new vscode.Range(l.line - 1, 0, l.line - 1, 0);
      return new vscode.CodeLens(range, {
        title: l.title,
        command: 'orqiva.openTask',
        arguments: [l.ref],
        tooltip: 'Open the task panel',
      });
    });
  }

  dispose(): void {
    this.subs.forEach((s) => {
      s.dispose();
    });
    this.emitter.dispose();
  }
}

export function registerCodeLens(
  context: vscode.ExtensionContext,
  cache: IssueCache,
): FingerprintCodeLensProvider {
  const provider = new FingerprintCodeLensProvider(cache);
  context.subscriptions.push(
    provider,
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, provider),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`orqiva.${SETTING}`)) provider.refresh();
    }),
  );
  return provider;
}
