// ── [PCODE-38 | S07 | v0.1.0] Add an Insert fingerprint header command for the active task and file type ──
//    Why:  header vs block, the three comment syntaxes, shebang / xml handling, the cursor indentation and
//          the no-active-task message.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  NO_ACTIVE_TASK,
  headerLine,
  insertFingerprint,
  planInsertion,
  type EditorTarget,
} from '../../src/commands/insertFingerprint';
import type { Services } from '../../src/services';
import { Store } from '../../src/state/store';
import type { ActiveTask } from '../../src/state/types';
import { Logger, resetLoggerForTests } from '../../src/util/log';
import { recorded, resetRecorded } from '../mocks/vscode';

const ACTIVE: ActiveTask = {
  task: 'PCODE-12',
  issue_id: 'i',
  title: 'Reprice orders',
  sprint: 'S03',
  sprint_name: 'Sprint 03 - Orders',
  version: '0.1.0',
  session_id: 's',
  host: 'h',
  started_at: '2026-01-01T00:00:00',
  files: [],
  url: 'https://plane.example.test/i/12/',
};

class FakeEditor implements EditorTarget {
  inserted: { line: number; text: string }[] = [];
  constructor(
    public fileName: string,
    private text: string,
    public cursorLine = 0,
  ) {}
  getText(): string {
    return this.text;
  }
  insert(line: number, text: string): Promise<boolean> {
    this.inserted.push({ line, text });
    const lines = this.text.split('\n');
    lines.splice(line, 0, ...text.replace(/\n$/, '').split('\n'));
    this.text = lines.join('\n');
    return Promise.resolve(true);
  }
}

function services(active: ActiveTask | null): Services {
  const store = new Store();
  store.state.active = active;
  return { store, log: new Logger() } as unknown as Services;
}

describe('planInsertion', () => {
  it('writes the // header at line 1 of a new .ts file, # for .py, /* */ for .css', () => {
    const ts = planInsertion('', 'C:\\p\\src\\a.ts', ACTIVE, 0);
    expect(ts).toMatchObject({ kind: 'header', line: 0 });
    expect(ts.text).toBe(
      '// -- [PCODE-12 | S03 | v0.1.0] Reprice orders --\n//    Task: https://plane.example.test/i/12/\n',
    );
    const py = planInsertion('x = 1\n', 'C:\\p\\a.py', ACTIVE, 0);
    expect(py.text.split('\n')[0]).toBe('# -- [PCODE-12 | S03 | v0.1.0] Reprice orders --');
    expect(py.text.endsWith('\n\n')).toBe(true); // blank line before existing code
    const css = planInsertion('', 'C:\\p\\a.css', ACTIVE, 0);
    expect(css.text.split('\n')[0]).toBe('/* -- [PCODE-12 | S03 | v0.1.0] Reprice orders -- */');
    expect(css.text.split('\n')[1]).toBe('/*    Task: https://plane.example.test/i/12/ */');
  });

  // ── [PCODE-38 | S07 | v0.1.0] shebang and xml prologue keep line 1 ──
  it('goes after a shebang or <?xml line', () => {
    expect(headerLine('#!/usr/bin/env python3\nimport x\n')).toBe(1);
    expect(headerLine('<?xml version="1.0"?>\n<a/>')).toBe(1);
    expect(headerLine('import x\n')).toBe(0);
    expect(planInsertion('#!/bin/sh\necho hi\n', 'C:\\p\\run.sh', ACTIVE, 0).line).toBe(1);
  });

  it('adds a block line at the cursor, indented like the cursor line, once the header exists', () => {
    const text =
      '// -- [PCODE-12 | S03 | v0.1.0] Reprice orders --\n\nclass A {\n  method() {}\n}\n';
    const p = planInsertion(text, 'C:\\p\\a.ts', ACTIVE, 3, 'method: does a thing');
    expect(p).toEqual({
      kind: 'block',
      line: 3,
      text: '  // [PCODE-12 | S03 | v0.1.0] method: does a thing\n',
      needsWhat: true,
    });
    // another task's header does not count
    const other = text.replace('PCODE-12', 'PCODE-99');
    expect(planInsertion(other, 'C:\\p\\a.ts', ACTIVE, 3).kind).toBe('header');
  });
});

describe('insertFingerprint', () => {
  beforeEach(() => {
    resetRecorded();
    resetLoggerForTests();
  });

  it('inserts the header first, then a block line with the entered text on the second run', async () => {
    const editor = new FakeEditor('C:\\p\\src\\new.ts', '', 0);
    const first = await insertFingerprint({ services: services(ACTIVE), editor });
    expect(first?.kind).toBe('header');
    expect(editor.inserted[0]).toMatchObject({ line: 0 });
    expect(editor.getText()).toContain('// -- [PCODE-12 | S03 | v0.1.0] Reprice orders --');
    editor.cursorLine = 2;
    const second = await insertFingerprint({
      services: services(ACTIVE),
      editor,
      askWhat: () => Promise.resolve('  helper: trims input  '),
    });
    expect(second?.kind).toBe('block');
    expect(editor.inserted[1]).toEqual({
      line: 2,
      text: '// [PCODE-12 | S03 | v0.1.0] helper: trims input\n',
    });
    // cancelling the input box inserts nothing
    const third = await insertFingerprint({
      services: services(ACTIVE),
      editor,
      askWhat: () => Promise.resolve(undefined),
    });
    expect(third).toBeUndefined();
    expect(editor.inserted).toHaveLength(2);
  });

  it('says so without an active task and without an editor', async () => {
    const editor = new FakeEditor('C:\\p\\a.py', '');
    expect(await insertFingerprint({ services: services(null), editor })).toBeUndefined();
    expect(recorded.infoMessages).toEqual([NO_ACTIVE_TASK]);
    expect(editor.inserted).toEqual([]);
    expect(
      await insertFingerprint({ services: services(ACTIVE), editor: undefined }),
    ).toBeUndefined();
    expect(recorded.infoMessages[1]).toBe('Open a file first.');
  });
});
