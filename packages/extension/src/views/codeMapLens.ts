// ── [PCODE-194 | S15 | v0.1.0] B8.2 VS Code: agents view and runs, findings as problems, code-map lens, test results per criterion ──
//    Why:  what the code map knows about a file, on top of the file: how hot a spot it is, its health,
//          how often it changed, who owns most of it and the tasks that shaped it. A click opens the file
//          on the web's code map. The map is read once (and again on focus or a push); a file the map
//          does not know gets no lens.
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Api } from '../../../cli/src/loop/api';
import { SETTING } from './codelens';

export interface CodeMapSource {
  api: Api;
  workspaceId: string;
  projectId: string;
  server: string;
  root: string;
}

export interface CodeFileJson {
  path: string;
  lines: number;
  complexity: number;
  churn: number;
  health: number;
  hotspot: number;
  owner: string | null;
  tasks: string[];
}

const de = (n: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: 1 });

/** The lens line of a file. */
export function codeMapLabel(f: CodeFileJson): string {
  const parts = [
    (f.hotspot >= 60 ? '$(flame) ' : '') + 'hot spot ' + String(f.hotspot),
    'health ' + de(f.health) + '/10',
    'changed ' + String(f.churn) + '×',
    'complexity ' + String(f.complexity),
  ];
  if (f.owner) parts.push('mostly ' + f.owner);
  if (f.tasks.length)
    parts.push(
      f.tasks.slice(0, 3).join(', ') +
        (f.tasks.length > 3 ? ' +' + String(f.tasks.length - 3) : ''),
    );
  return parts.join(' · ');
}

/** The repo path of a file under the root, with forward slashes; null outside the root. */
export function repoPath(root: string, file: string): string | null {
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

export class CodeMapLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;
  private files = new Map<string, CodeFileJson>();
  private loading: Promise<void> | null = null;

  constructor(
    private readonly source: () => CodeMapSource | null,
    private readonly enabled: () => boolean = () =>
      vscode.workspace.getConfiguration('orqiva').get<boolean>(SETTING, true),
  ) {}

  refresh(): Promise<void> {
    if (this.loading) return this.loading;
    const src = this.source();
    if (!src) {
      this.files = new Map();
      this.emitter.fire();
      return Promise.resolve();
    }
    this.loading = src.api
      .call<CodeFileJson[]>(
        'GET',
        '/api/workspaces/' + src.workspaceId + '/projects/' + src.projectId + '/code-map/files',
      )
      .then((list) => {
        this.files = new Map(list.map((f) => [f.path, f]));
        this.emitter.fire();
      })
      .catch(() => undefined)
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  fileOf(fsPath: string): CodeFileJson | null {
    const src = this.source();
    const rel = src ? repoPath(src.root, fsPath) : null;
    return rel ? (this.files.get(rel) ?? null) : null;
  }

  urlOf(file: CodeFileJson): string | null {
    const src = this.source();
    return src
      ? src.server.replace(/\/$/, '') +
          '/projects/' +
          src.projectId +
          '/codemap?file=' +
          encodeURIComponent(file.path)
      : null;
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.enabled()) return [];
    const f = this.fileOf(doc.uri.fsPath);
    if (!f) return [];
    return [
      new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
        title: codeMapLabel(f),
        tooltip: 'From the code map; click to open it on the web',
        command: 'orqiva.codeMap.open',
        arguments: [f],
      }),
    ];
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
