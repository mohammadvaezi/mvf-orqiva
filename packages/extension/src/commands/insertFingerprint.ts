// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-38 | S07 | v0.1.0] Add an Insert fingerprint header command for the active task and file type ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the marker every task must leave in the code, typed by the extension instead of by hand: the file
//          header once (after a shebang or <?xml line), then one block line per section at the cursor. Pure
//          planning is separated from the editor so the placement rules are unit-tested.
import * as vscode from 'vscode';
import type { Services } from '../services';
import type { ActiveTask } from '../state/types';
import { blockLine, headerBlock, scanText } from '../util/fingerprint';
import { info } from './notify';

export const NO_ACTIVE_TASK = 'No active task. Start one from the Sprints view.';

export type Insertion =
  | { kind: 'header'; line: number; text: string }
  | { kind: 'block'; line: number; text: string; needsWhat: true };

// ── [PCODE-38 | S07 | v0.1.0] headerLine: 0, or 1 after a shebang / <?xml prologue ──
export function headerLine(text: string): number {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  return /^#!/.test(first) || /^<\?xml/i.test(first) ? 1 : 0;
}

export function hasHeaderFor(text: string, task: string): boolean {
  return scanText(text).some((m) => m.task === task);
}

/** the indentation of the cursor line, reused for a block line */
function indentOf(text: string, line: number): string {
  const l = text.split(/\r?\n/)[line] ?? '';
  return /^\s*/.exec(l)?.[0] ?? '';
}

// ── [PCODE-38 | S07 | v0.1.0] planInsertion: header when the file has none for the task, else a block line ──
export function planInsertion(
  text: string,
  filePath: string,
  active: ActiveTask,
  cursorLine: number,
  what?: string,
): Insertion {
  if (!hasHeaderFor(text, active.task)) {
    const line = headerLine(text);
    const block = headerBlock(
      filePath,
      active.task,
      active.sprint,
      active.version,
      active.title,
      active.url,
    );
    return { kind: 'header', line, text: `${block}\n${line === 0 && text.length ? '\n' : ''}` };
  }
  const indent = indentOf(text, cursorLine);
  return {
    kind: 'block',
    line: cursorLine,
    text: `${indent}${blockLine(filePath, active.task, active.sprint, active.version, what ?? '')}\n`,
    needsWhat: true,
  };
}

/** the editor surface the command needs; injected for tests */
export interface EditorTarget {
  fileName: string;
  getText(): string;
  cursorLine: number;
  insert(line: number, text: string): Promise<boolean>;
}

export interface InsertDeps {
  services: Pick<Services, 'store' | 'log'>;
  editor?: EditorTarget | undefined;
  askWhat?: () => Promise<string | undefined>;
}

function vscodeEditor(): EditorTarget | undefined {
  const e = vscode.window.activeTextEditor;
  if (!e) return undefined;
  return {
    fileName: e.document.fileName,
    getText: () => e.document.getText(),
    cursorLine: e.selection.active.line,
    insert: (line, text) =>
      Promise.resolve(
        e.edit((b) => {
          b.insert(new vscode.Position(line, 0), text);
        }),
      ),
  };
}

// ── [PCODE-38 | S07 | v0.1.0] insertFingerprint: the command body ──
export async function insertFingerprint(deps: InsertDeps): Promise<Insertion | undefined> {
  const active = deps.services.store.state.active;
  if (!active) {
    info(NO_ACTIVE_TASK);
    return undefined;
  }
  const editor = deps.editor ?? vscodeEditor();
  if (!editor) {
    info('Open a file first.');
    return undefined;
  }
  const text = editor.getText();
  let plan = planInsertion(text, editor.fileName, active, editor.cursorLine);
  if (plan.kind === 'block') {
    const what = await (
      deps.askWhat ??
      (() =>
        vscode.window.showInputBox({
          title: `Fingerprint block for ${active.task}`,
          prompt: 'What does this block do? (one line, goes after the marker)',
          placeHolder: 'e.g. reprice: rebuild totals from the POS payload',
        }))
    )();
    if (what === undefined) return undefined;
    plan = planInsertion(text, editor.fileName, active, editor.cursorLine, what.trim());
  }
  await editor.insert(plan.line, plan.text);
  deps.services.log.info(
    `fingerprint ${plan.kind} inserted for ${active.task} in ${editor.fileName}`,
  );
  return plan;
}

export function registerInsertFingerprint(
  context: vscode.ExtensionContext,
  services: Services,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.insertFingerprint', () =>
      insertFingerprint({ services }),
    ),
  );
}
