// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-36 | S07 | v0.1.0] Add a fingerprint CodeLens provider showing task title and state above markers ──
//    Why:  lenses on marker lines only, the label per cache state, the setting switch, and a refresh when
//          the cache learns something.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CacheEntry, IssueCache } from '../../src/plane/issueCache';
import { FingerprintCodeLensProvider, lensLabel, lensesFor } from '../../src/views/codelens';
import { recorded, resetRecorded } from '../mocks/vscode';

const SAMPLE = fs.readFileSync(
  path.resolve(__dirname, '..', 'fixtures', 'workspace', 'src', 'sample.ts'),
  'utf8',
);

const known = (ref: string, title: string, state: string): CacheEntry => ({
  kind: 'known',
  info: { ref, title, state: { name: state, group: 'started' } },
});

function fakeCache(entries: Record<string, CacheEntry>): IssueCache & { fired: (() => void)[] } {
  const fired: (() => void)[] = [];
  return {
    fired,
    get: (ref: string) => entries[ref] ?? { kind: 'pending' },
    onDidChange: (l: () => void) => {
      fired.push(l);
      return { dispose: () => undefined };
    },
  } as unknown as IssueCache & { fired: (() => void)[] };
}

function doc(fileName: string, text: string) {
  return { fileName, getText: () => text } as unknown as import('vscode').TextDocument;
}

describe('fingerprint CodeLens', () => {
  beforeEach(() => {
    resetRecorded();
  });

  it('labels per cache state', () => {
    expect(lensLabel('FIX-2', known('FIX-2', 'Add the greeting function', 'In Progress'))).toBe(
      'FIX-2 Add the greeting function · In Progress',
    );
    expect(lensLabel('FIX-9', { kind: 'missing' })).toBe('FIX-9 · not found in Orqiva');
    expect(lensLabel('FIX-9', { kind: 'offline' })).toBe('FIX-9 · offline');
    expect(lensLabel('FIX-9', { kind: 'pending' })).toBe('FIX-9 · …');
  });

  // ── [PCODE-36 | S07 | v0.1.0] the fixture: four marker lines, two tasks ──
  it('puts a lens on every marker line of sample.ts and nowhere else', () => {
    const cache = fakeCache({
      'FIX-1': known('FIX-1', 'Create the sample module', 'Done'),
      'FIX-2': known('FIX-2', 'Add the greeting function', 'In Progress'),
    });
    const lenses = lensesFor(SAMPLE, cache);
    expect(lenses.map((l) => l.line)).toEqual([1, 2, 5, 8]);
    expect(lenses.map((l) => l.title)).toEqual([
      'FIX-1 Create the sample module · Done',
      'FIX-2 Add the greeting function · In Progress',
      'FIX-1 Create the sample module · Done',
      'FIX-2 Add the greeting function · In Progress',
    ]);
    const provider = new FingerprintCodeLensProvider(cache, () => true);
    const out = provider.provideCodeLenses(doc('C:\\p\\src\\sample.ts', SAMPLE));
    expect(out).toHaveLength(4);
    expect(out[0]?.range.start.line).toBe(0);
    expect(out[3]?.range.start.line).toBe(7);
    expect(out[1]?.command).toMatchObject({ command: 'orqiva.openTask', arguments: ['FIX-2'] });
    expect(provider.provideCodeLenses(doc('C:\\p\\README.md', SAMPLE))).toEqual([]);
    expect(provider.provideCodeLenses(doc('C:\\p\\src\\other.ts', 'no markers here'))).toEqual([]);
    provider.dispose();
  });

  it('is switched off by the setting and refreshes when the cache changes', () => {
    const cache = fakeCache({});
    recorded.configuration.set('orqiva.codeLens.enabled', false);
    const provider = new FingerprintCodeLensProvider(cache);
    expect(provider.provideCodeLenses(doc('C:\\p\\src\\sample.ts', SAMPLE))).toEqual([]);
    let fired = 0;
    provider.onDidChangeCodeLenses(() => fired++);
    cache.fired.forEach((l) => {
      l();
    });
    expect(fired).toBe(1);
    recorded.configuration.set('orqiva.codeLens.enabled', true);
    expect(provider.provideCodeLenses(doc('C:\\p\\src\\sample.ts', SAMPLE))).toHaveLength(4);
    provider.dispose();
  });
});
