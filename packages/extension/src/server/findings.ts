// ── [PCODE-194 | S15 | v0.1.0] B8.2 VS Code: agents view and runs, findings as problems, code-map lens, test results per criterion ──
//    Why:  what the scanners found in the code (the project's open findings on the server) shows where the
//          code is: in the Problems panel and as squiggles on the line. A quick fix makes a task for a
//          finding that has none, the same as "Make a task" on the web; one with a task names it. Read on
//          start, on focus and when the live stream reports a finding changing; never per keystroke.
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Api } from '../../../cli/src/loop/api';

export interface FindingsSource {
  api: Api;
  workspaceId: string;
  projectId: string;
  server: string;
  root: string;
}

export interface FindingJson {
  id: string;
  tool: string;
  rule: string;
  severity: string;
  title: string;
  message: string;
  file: string;
  line: number | null;
  status: string;
  itemRef: string | null;
}

export interface ProblemSpec {
  findingId: string;
  /** 0-based */
  line: number;
  severity: 'error' | 'warning' | 'information';
  message: string;
  source: string;
  code: string;
  itemRef: string | null;
}

export const FINDING_SOURCE = 'Orqiva';

const severityOf = (s: string): ProblemSpec['severity'] =>
  s === 'critical' || s === 'high' ? 'error' : s === 'medium' ? 'warning' : 'information';

/** The open findings that point at a file, grouped by that file (as the repo writes it). */
export function problemsOf(findings: readonly FindingJson[]): Map<string, ProblemSpec[]> {
  const out = new Map<string, ProblemSpec[]>();
  for (const f of findings) {
    if (f.status !== 'open' || !f.file) continue;
    const file = f.file.replace(/\\/g, '/').replace(/^\.?\//, '');
    const list = out.get(file) ?? [];
    list.push({
      findingId: f.id,
      line: Math.max(0, (f.line ?? 1) - 1),
      severity: severityOf(f.severity),
      message:
        f.title +
        (f.message && f.message !== f.title ? ': ' + f.message : '') +
        (f.itemRef ? ' (' + f.itemRef + ')' : ''),
      source: FINDING_SOURCE + ' · ' + f.tool,
      code: f.rule,
      itemRef: f.itemRef,
    });
    out.set(file, list);
  }
  return out;
}

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
};

interface FindingDiagnostic extends vscode.Diagnostic {
  findingId?: string;
  itemRef?: string | null;
}

export class FindingsProblems implements vscode.CodeActionProvider, vscode.Disposable {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];
  private readonly collection = vscode.languages.createDiagnosticCollection('orqiva-findings');
  private loading: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private count = 0;

  constructor(private readonly source: () => FindingsSource | null) {}

  get size(): number {
    return this.count;
  }

  refreshSoon(ms = 800): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, ms);
  }

  refresh(): Promise<void> {
    if (this.loading) return this.loading;
    const src = this.source();
    if (!src) {
      this.collection.clear();
      this.count = 0;
      return Promise.resolve();
    }
    this.loading = src.api
      .call<FindingJson[]>(
        'GET',
        '/api/workspaces/' +
          src.workspaceId +
          '/projects/' +
          src.projectId +
          '/findings?status=open',
      )
      .then((list) => {
        this.show(src.root, problemsOf(list));
      })
      .catch(() => undefined)
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  private show(root: string, problems: Map<string, ProblemSpec[]>): void {
    this.collection.clear();
    this.count = 0;
    for (const [file, specs] of problems) {
      const uri = vscode.Uri.file(path.join(root, file));
      this.collection.set(
        uri,
        specs.map((p) => {
          const d: FindingDiagnostic = new vscode.Diagnostic(
            new vscode.Range(p.line, 0, p.line, Number.MAX_SAFE_INTEGER),
            p.message,
            SEVERITY[p.severity],
          );
          d.source = p.source;
          d.code = p.code;
          d.findingId = p.findingId;
          d.itemRef = p.itemRef;
          return d;
        }),
      );
      this.count += specs.length;
    }
  }

  provideCodeActions(
    _doc: vscode.TextDocument,
    _range: vscode.Range,
    ctx: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const d of ctx.diagnostics as readonly FindingDiagnostic[]) {
      if (!d.findingId) continue;
      if (d.itemRef) continue;
      const a = new vscode.CodeAction(
        'Make a task for this finding',
        vscode.CodeActionKind.QuickFix,
      );
      a.diagnostics = [d];
      a.command = {
        command: 'orqiva.findings.makeTask',
        title: 'Make a task for this finding',
        arguments: [d.findingId],
      };
      actions.push(a);
    }
    return actions;
  }

  /** Makes a task for a finding; answers the new task's ref. */
  async makeTask(findingId: string): Promise<string | null> {
    const src = this.source();
    if (!src) throw new Error('Findings need the folder linked to Orqiva (orq link).');
    const f = await src.api.call<FindingJson>(
      'POST',
      '/api/workspaces/' + src.workspaceId + '/findings/' + findingId + '/task',
      {},
    );
    await this.refresh();
    return f.itemRef;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.collection.dispose();
  }
}
