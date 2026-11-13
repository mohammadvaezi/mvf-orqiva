// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-37 | S07 | v0.1.0] Add editor decorations for fingerprint lines with hover details ──
//    Why:  ranges on marker lines only, the hover content, the update on a store/cache change, and a
//          2000-line file with 50 markers decorated well under 50 ms.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { CacheEntry, IssueCache } from '../../src/plane/issueCache';
import {
  FingerprintDecorator,
  decorationsFor,
  hoverMarkdown,
  type EditorHost,
  type EditorLike,
} from '../../src/views/decorations';
import { recorded, resetRecorded } from '../mocks/vscode';

const SAMPLE = fs.readFileSync(
  path.resolve(__dirname, '..', 'fixtures', 'workspace', 'src', 'sample.ts'),
  'utf8',
);

function fakeCache(entries: Record<string, CacheEntry>): IssueCache & { fire: () => void } {
  const listeners: (() => void)[] = [];
  return {
    fire: () => {
      listeners.forEach((l) => {
        l();
      });
    },
    get: (ref: string) => entries[ref] ?? { kind: 'pending' },
    onDidChange: (l: () => void) => {
      listeners.push(l);
      return { dispose: () => undefined };
    },
  } as unknown as IssueCache & { fire: () => void };
}

class FakeEditor implements EditorLike {
  sets: vscode.DecorationOptions[][] = [];
  constructor(
    public fileName: string,
    public text: string,
  ) {}
  get document() {
    return {
      fileName: this.fileName,
      getText: () => this.text,
      uri: { toString: () => `file:///${this.fileName}` },
    };
  }
  setDecorations(_t: vscode.TextEditorDecorationType, o: vscode.DecorationOptions[]): void {
    this.sets.push(o);
  }
}

function fakeHost(editors: FakeEditor[]) {
  const active: (() => void)[] = [];
  const docs: ((e: { document: { uri: { toString(): string } } }) => void)[] = [];
  const host: EditorHost = {
    visibleTextEditors: editors,
    onDidChangeActiveTextEditor: (l) => {
      active.push(l);
      return { dispose: () => undefined };
    },
    onDidChangeVisibleTextEditors: () => ({ dispose: () => undefined }),
    onDidChangeTextDocument: (l) => {
      docs.push(l);
      return { dispose: () => undefined };
    },
  };
  return { host, active, docs };
}

const type = { dispose: () => undefined } as unknown as vscode.TextEditorDecorationType;

describe('fingerprint decorations', () => {
  beforeEach(() => {
    resetRecorded();
  });

  it('computes ranges for marker lines only and a hover with task, sprint, version, state', () => {
    const cache = fakeCache({
      'FIX-2': {
        kind: 'known',
        info: {
          ref: 'FIX-2',
          title: 'Add the greeting function',
          state: { name: 'Todo', group: 'unstarted' },
          url: 'https://plane.example.test/i/2/',
        },
      },
    });
    const d = decorationsFor(SAMPLE, cache);
    expect(d.map((x) => x.line)).toEqual([0, 1, 4, 7]);
    expect(d[1]?.hover).toBe(
      '**FIX-2** Add the greeting function\n\nSprint 01 · v0.1.0 · Todo · header\n\n[Open task](command:orqiva.openTask?%5B%22FIX-2%22%5D) · [Open in Orqiva](https://plane.example.test/i/2/)',
    );
    expect(d[0]?.hover).toContain('**FIX-1** Create the sample module');
    expect(d[0]?.hover).toContain('· … · header');
    expect(
      hoverMarkdown(
        { task: 'X-1', sprint: 'S02', version: '1.2.3', title: 't', line: 1, kind: 'block' },
        { kind: 'missing' },
      ),
    ).toContain('Sprint 02 · v1.2.3 · not found in Orqiva · block');
  });

  // ── [PCODE-37 | S07 | v0.1.0] applies to visible editors and re-applies on cache change / edits ──
  it('decorates visible code editors, skips others, and updates on cache change and edits', () => {
    vi.useFakeTimers();
    try {
      const cache = fakeCache({});
      const code = new FakeEditor('C:\\p\\src\\sample.ts', SAMPLE);
      const md = new FakeEditor('C:\\p\\README.md', SAMPLE);
      const { host, docs } = fakeHost([code, md]);
      const deco = new FingerprintDecorator(cache, type, host, () => true, 300);
      expect(code.sets).toHaveLength(1);
      expect(code.sets[0]).toHaveLength(4);
      expect(code.sets[0]?.[3]?.range.start.line).toBe(7);
      expect((code.sets[0]?.[0]?.hoverMessage as vscode.MarkdownString).isTrusted).toBe(true);
      expect(md.sets).toEqual([[]]);
      cache.fire();
      expect(code.sets).toHaveLength(2);
      docs.forEach((l) => {
        l({ document: { uri: { toString: () => 'file:///C:\\p\\src\\sample.ts' } } });
        l({ document: { uri: { toString: () => 'file:///C:\\p\\src\\sample.ts' } } });
      });
      expect(code.sets).toHaveLength(2);
      vi.advanceTimersByTime(299);
      expect(code.sets).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(code.sets).toHaveLength(3);
      docs.forEach((l) => {
        l({ document: { uri: { toString: () => 'file:///elsewhere.ts' } } });
      });
      vi.advanceTimersByTime(400);
      expect(code.sets).toHaveLength(3);
      deco.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears decorations when the setting is off', () => {
    recorded.configuration.set('orqiva.codeLens.enabled', false);
    const code = new FakeEditor('C:\\p\\src\\sample.ts', SAMPLE);
    const deco = new FingerprintDecorator(fakeCache({}), type, fakeHost([code]).host);
    expect(code.sets).toEqual([[]]);
    deco.dispose();
  });

  // ── [PCODE-37 | S07 | v0.1.0] 2000 lines, 50 markers: one refresh under 50 ms ──
  it('decorates a 2000-line file with 50 markers in under 50 ms', () => {
    const lines: string[] = [];
    for (let i = 0; i < 2000; i++)
      lines.push(
        i % 40 === 0
          ? `// ── [FIX-${String((i % 7) + 1)} | S01 | v0.1.0] block ${String(i)} ──`
          : `const v${String(i)} = ${String(i)}; // some code on line ${String(i)}`,
      );
    const big = new FakeEditor('C:\\p\\src\\big.ts', lines.join('\n'));
    const deco = new FingerprintDecorator(fakeCache({}), type, fakeHost([big]).host, () => true);
    const t0 = performance.now();
    deco.refresh(big);
    const ms = performance.now() - t0;
    expect(big.sets.at(-1)).toHaveLength(50);
    expect(ms).toBeLessThan(50);
    deco.dispose();
  });
});
