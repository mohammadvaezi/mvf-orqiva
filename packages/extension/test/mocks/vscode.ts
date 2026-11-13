// ── [PCODE-3 | S01 | v0.1.0] Add the vitest unit runner with a vscode API mock ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/62be410b-f577-454a-826f-06227b5e5fde/
//    Why:  the subset of the VS Code API the project uses, recording calls so tests can assert on them.
//          Extend it when a module needs more; never add behaviour the real API does not have.

// ── [PCODE-3 | S01 | v0.1.0] recorded calls: tests read these and reset them in beforeEach ──
export interface RecordedOutput {
  name: string;
  lines: string[];
  shown: number;
}
export const recorded = {
  outputs: [] as RecordedOutput[],
  infoMessages: [] as string[],
  warningMessages: [] as string[],
  errorMessages: [] as string[],
  configuration: new Map<string, unknown>(),
  secrets: new Map<string, string>(),
  executedCommands: [] as { command: string; args: unknown[] }[],
  disposedCommands: [] as string[],
  errorItems: [] as string[][],
  quickPickAnswer: undefined as number | undefined,
  inputBoxAnswers: [] as (string | undefined)[],
  clipboard: '' as string,
  openedExternal: [] as string[],
  workspaceTrusted: true as boolean,
};
export function resetRecorded(): void {
  recorded.outputs.length = 0;
  recorded.infoMessages.length = 0;
  recorded.warningMessages.length = 0;
  recorded.errorMessages.length = 0;
  recorded.configuration.clear();
  recorded.secrets.clear();
  recorded.executedCommands.length = 0;
  recorded.disposedCommands.length = 0;
  recorded.errorItems.length = 0;
  recorded.quickPickAnswer = undefined;
  recorded.inputBoxAnswers.length = 0;
  recorded.clipboard = '';
  recorded.openedExternal.length = 0;
  recorded.workspaceTrusted = true;
}

// ── [PCODE-3 | S01 | v0.1.0] Disposable / EventEmitter ──
export class Disposable {
  constructor(private readonly fn?: () => void) {}
  dispose(): void {
    this.fn?.();
  }
  static from(...items: { dispose(): void }[]): Disposable {
    return new Disposable(() => {
      items.forEach((i) => {
        i.dispose();
      });
    });
  }
}

export type Event<T> = (listener: (e: T) => unknown) => Disposable;

export class EventEmitter<T> {
  private listeners = new Set<(e: T) => unknown>();
  event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return new Disposable(() => this.listeners.delete(listener));
  };
  fire(data: T): void {
    for (const l of this.listeners) l(data);
  }
  dispose(): void {
    this.listeners.clear();
  }
}

// ── [PCODE-3 | S01 | v0.1.0] Uri / ThemeIcon / TreeItem / enums ──
export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly fsPath: string,
  ) {}
  get path(): string {
    return this.fsPath.replace(/\\/g, '/');
  }
  static file(p: string): Uri {
    return new Uri('file', p);
  }
  static parse(s: string): Uri {
    return new Uri(s.split(':')[0] ?? 'file', s.replace(/^[a-z]+:\/\//, ''));
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(base.scheme, [base.fsPath, ...parts].join('/'));
  }
  toString(): string {
    return `${this.scheme}://${this.path}`;
  }
  with(): this {
    return this;
  }
}

export class ThemeIcon {
  constructor(
    public readonly id: string,
    public readonly color?: ThemeColor,
  ) {}
}
export class ThemeColor {
  constructor(public readonly id: string) {}
}
export class MarkdownString {
  value = '';
  isTrusted = false;
  supportThemeIcons = false;
  constructor(value = '') {
    this.value = value;
  }
  appendMarkdown(s: string): this {
    this.value += s;
    return this;
  }
}

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;
export class TreeItem {
  label?: string;
  description?: string;
  tooltip?: string | MarkdownString;
  iconPath?: ThemeIcon | Uri;
  contextValue?: string;
  command?: { command: string; title: string; arguments?: unknown[] };
  collapsibleState: number;
  constructor(label: string, collapsibleState: number = TreeItemCollapsibleState.None) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

// ── [PCODE-36 | S07 | v0.1.0] Position / Range / CodeLens / languages ──
export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}
export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
    if (a instanceof Position && b instanceof Position) {
      this.start = a;
      this.end = b;
    } else {
      const line = typeof a === 'number' ? a : a.line;
      const ch = typeof b === 'number' ? b : b.character;
      this.start = new Position(line, ch);
      this.end = new Position(c ?? line, d ?? ch);
    }
  }
}
export class CodeLens {
  constructor(
    public readonly range: Range,
    public command?: { title: string; command: string; arguments?: unknown[]; tooltip?: string },
  ) {}
}
// [PCODE-194 | S15 | v0.1.0] diagnostics and quick fixes, for the code findings
export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;
export class Diagnostic {
  source?: string;
  code?: string | number;
  constructor(
    public range: Range,
    public message: string,
    public severity: number = DiagnosticSeverity.Error,
  ) {}
}
export class CodeActionKind {
  static readonly QuickFix = new CodeActionKind('quickfix');
  constructor(readonly value: string) {}
}
export class CodeAction {
  diagnostics?: Diagnostic[];
  command?: { command: string; title: string; arguments?: unknown[] };
  constructor(
    public title: string,
    public kind?: CodeActionKind,
  ) {}
}
export class DiagnosticCollectionMock {
  readonly entries = new Map<string, Diagnostic[]>();
  set(uri: Uri, list: Diagnostic[]): void {
    this.entries.set(uri.fsPath, list);
  }
  clear(): void {
    this.entries.clear();
  }
  dispose(): void {
    this.entries.clear();
  }
}
export const languages = {
  registerCodeLensProvider: (): Disposable => new Disposable(),
  registerCodeActionsProvider: (): Disposable => new Disposable(), // [PCODE-194 | S15 | v0.1.0]
  createDiagnosticCollection: (): DiagnosticCollectionMock => new DiagnosticCollectionMock(),
};

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export const env = {
  clipboard: {
    writeText: (t: string): Promise<void> => {
      recorded.clipboard = t;
      return Promise.resolve();
    },
  },
  openExternal: (u: Uri): Promise<boolean> => {
    recorded.openedExternal.push(u.toString());
    return Promise.resolve(true);
  },
};
export const ViewColumn = { One: 1, Two: 2, Beside: -2, Active: -1 } as const;
export const ProgressLocation = { Notification: 15, Window: 10 } as const;

// ── [PCODE-3 | S01 | v0.1.0] window: output channels, messages, status bar ──
class OutputChannelMock {
  private readonly rec: RecordedOutput;
  constructor(public readonly name: string) {
    this.rec = { name, lines: [], shown: 0 };
    recorded.outputs.push(this.rec);
  }
  appendLine(line: string): void {
    this.rec.lines.push(line);
  }
  append(text: string): void {
    this.rec.lines.push(text);
  }
  show(): void {
    this.rec.shown += 1;
  }
  clear(): void {
    this.rec.lines.length = 0;
  }
  hide(): void {
    /* no-op */
  }
  dispose(): void {
    /* no-op */
  }
}

class StatusBarItemMock {
  name = '';
  text = '';
  tooltip?: string | MarkdownString;
  command?: string;
  color?: ThemeColor | string;
  backgroundColor?: ThemeColor;
  visible = false;
  show(): void {
    this.visible = true;
  }
  hide(): void {
    this.visible = false;
  }
  dispose(): void {
    /* no-op */
  }
}

export const window = {
  createOutputChannel: (name: string): OutputChannelMock => new OutputChannelMock(name),
  createStatusBarItem: (): StatusBarItemMock => new StatusBarItemMock(),
  showInformationMessage: (message: string, ...items: string[]): Promise<string | undefined> => {
    recorded.infoMessages.push(message);
    return Promise.resolve(items[0]);
  },
  showWarningMessage: (message: string, ...items: string[]): Promise<string | undefined> => {
    recorded.warningMessages.push(message);
    return Promise.resolve(items[0]);
  },
  showErrorMessage: (message: string, ...items: string[]): Promise<string | undefined> => {
    recorded.errorMessages.push(message);
    recorded.errorItems.push(items);
    return Promise.resolve(items[0]);
  },
  // ── [PCODE-14 | S03 | v0.1.0] quick pick / input box answered from recorded.*; withProgress runs the task ──
  showQuickPick: <T>(items: T[]): Promise<T | undefined> =>
    Promise.resolve(
      recorded.quickPickAnswer === undefined ? undefined : items[recorded.quickPickAnswer],
    ),
  showInputBox: (): Promise<string | undefined> =>
    Promise.resolve(recorded.inputBoxAnswers.shift()),
  withProgress: <T>(_o: unknown, task: () => Promise<T>): Promise<T> => task(),
  activeTextEditor: undefined as unknown, // [PCODE-38 | S07 | v0.1.0] the real editor shape is not mocked
  terminals: [] as TerminalMock[],
  onDidCloseTerminal: new EventEmitter<unknown>().event, // [PCODE-32 | S06 | v0.1.0]
  onDidChangeWindowState: new EventEmitter<{ focused: boolean }>().event, // [PCODE-193 | S15 | v0.1.0]
  // [PCODE-37 | S07 | v0.1.0] editors + decorations
  visibleTextEditors: [] as unknown[],
  onDidChangeActiveTextEditor: new EventEmitter<unknown>().event,
  onDidChangeVisibleTextEditors: new EventEmitter<unknown>().event,
  createTextEditorDecorationType: (): { dispose(): void } => ({ dispose: () => undefined }),
  registerTreeDataProvider: (): Disposable => new Disposable(),
  createTreeView: (): { description?: string; dispose(): void } => ({ dispose: () => undefined }),
  state: { focused: true },
  // ── [PCODE-16 | S03 | v0.1.0] terminals ──
  createTerminal: (o: {
    name: string;
    cwd?: string;
    env?: Record<string, string>;
  }): TerminalMock => {
    const t = new TerminalMock(o.name, o.cwd ?? '', o.env ?? {});
    window.terminals.push(t);
    return t;
  },
};

export class TerminalMock {
  sent: string[] = [];
  shown = 0;
  exitStatus: unknown = undefined;
  constructor(
    public name: string,
    public cwd: string,
    public env: Record<string, string>,
  ) {}
  sendText(text: string): void {
    this.sent.push(text);
  }
  show(): void {
    this.shown++;
  }
  dispose(): void {
    this.exitStatus = { code: 0 };
  }
}
export const _terminalsPlaceholder = 0;

// ── [PCODE-3 | S01 | v0.1.0] workspace: configuration + folders ──
export const workspace = {
  workspaceFolders: [] as { uri: Uri; name: string; index: number }[],
  getConfiguration: (section?: string): { get<T>(key: string, fallback?: T): T | undefined } => ({
    get<T>(key: string, fallback?: T): T | undefined {
      const full = section ? `${section}.${key}` : key;
      return recorded.configuration.has(full) ? (recorded.configuration.get(full) as T) : fallback;
    },
  }),
  onDidChangeConfiguration: new EventEmitter<unknown>().event,
  onDidChangeTextDocument: new EventEmitter<unknown>().event, // [PCODE-37 | S07 | v0.1.0]
  // ── [PCODE-73 | S03 | v0.1.0] workspace trust ──
  get isTrusted(): boolean {
    return recorded.workspaceTrusted;
  },
  onDidGrantWorkspaceTrust: new EventEmitter<void>().event,
};

// ── [PCODE-3 | S01 | v0.1.0] commands + in-memory SecretStorage ──
export const commands = {
  registerCommand: (command: string): Disposable =>
    new Disposable(() => {
      recorded.disposedCommands.push(command);
    }),
  executeCommand: (command: string, ...args: unknown[]): Promise<undefined> => {
    recorded.executedCommands.push({ command, args });
    return Promise.resolve(undefined);
  },
};

export class SecretStorageMock {
  private readonly emitter = new EventEmitter<{ key: string }>();
  onDidChange = this.emitter.event;
  get(key: string): Promise<string | undefined> {
    return Promise.resolve(recorded.secrets.get(key));
  }
  store(key: string, value: string): Promise<void> {
    recorded.secrets.set(key, value);
    this.emitter.fire({ key });
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    recorded.secrets.delete(key);
    this.emitter.fire({ key });
    return Promise.resolve();
  }
}

export function makeExtensionContext(): {
  subscriptions: { dispose(): void }[];
  secrets: SecretStorageMock;
  extension: { packageJSON: { version: string } };
} {
  return {
    subscriptions: [],
    secrets: new SecretStorageMock(),
    extension: { packageJSON: { version: '0.1.0' } },
  };
}
