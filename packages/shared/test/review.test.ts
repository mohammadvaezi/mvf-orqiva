// ── [PCODE-303 | S15 | v0.1.0] T31.4 Line comments from people and the AI, posted to the host with approve or request changes ──
// ── [PCODE-302 | S15 | v0.1.0] T31.3 PR review queue (riskiest first) and side-by-side diff with fingerprints and viewed files ──
//    Why:  every host's way of sending a change ends as the same hunks and rows; the fingerprints of new lines
//          are found; the risk is explained in words.
import { describe, expect, it } from 'vitest';
import {
  fileDiff,
  fileMarks,
  hostCommentText,
  numberedPatch,
  onDiff,
  parsePatch,
  parseSuggestions,
  patchHash,
  prRisk,
  sensitiveAreas,
  sideBySide,
  splitDiff,
  unifiedPatch,
} from '../src/index.js';

const PATCH = [
  '@@ -1,5 +1,7 @@ export function total',
  ' const a = 1;',
  '-const b = 2;',
  '+// [SHOP-2 | S3 | v0.1.0] Totals round to cents',
  '+const b = 3;',
  '+const c = 4;',
  ' const d = 5;',
  '',
  ' const e = 6;',
  '\\ No newline at end of file',
].join('\n');

describe('reading a pull request’s change', () => {
  it('parses a patch with line numbers on both sides', () => {
    const [h] = parsePatch(PATCH);
    expect(h?.header).toBe('export function total');
    expect(h?.lines.map((l) => l.kind)).toEqual([
      'context',
      'del',
      'add',
      'add',
      'add',
      'context',
      'context',
      'context',
    ]);
    expect(h?.lines[1]).toEqual({ kind: 'del', old: 2, new: null, text: 'const b = 2;' });
    expect(h?.lines[4]).toEqual({ kind: 'add', old: null, new: 4, text: 'const c = 4;' });
    // an empty context line without its space still counts on both sides
    expect(h?.lines[6]).toEqual({ kind: 'context', old: 4, new: 6, text: '' });
    expect(h?.lines[7]?.new).toBe(7);
  });

  it('pairs removed and added lines side by side', () => {
    const rows = sideBySide(parsePatch(PATCH));
    expect(rows[0]).toMatchObject({ kind: 'hunk', oldStart: 1, newStart: 1 });
    const pairs = rows
      .slice(1)
      .map((r) => (r.kind === 'lines' ? [r.left?.kind ?? '-', r.right?.kind ?? '-'] : []));
    expect(pairs.slice(0, 4)).toEqual([
      ['context', 'context'],
      ['del', 'add'],
      ['-', 'add'],
      ['-', 'add'],
    ]);
  });

  it('counts a file from its patch and finds its fingerprints', () => {
    const f = fileDiff({ path: 'src/total.ts', status: 'modified', patch: PATCH });
    expect(f).toMatchObject({ additions: 3, deletions: 1, status: 'modified', oldPath: null });
    const marks = fileMarks(f, parsePatch(f.patch), 'SHOP-2');
    expect(marks).toEqual({
      markers: [{ line: 2, task: 'SHOP-2', title: 'Totals round to cents' }],
      missing: false,
      foreign: [],
    });
    expect(fileMarks(f, parsePatch(f.patch), 'SHOP-9').foreign).toEqual(['SHOP-2']);
    const plain = fileDiff({ path: 'src/a.ts', patch: '@@ -0,0 +1 @@\n+const x = 1;' });
    expect(fileMarks(plain, parsePatch(plain.patch), 'SHOP-2').missing).toBe(true);
    const doc = fileDiff({ path: 'README.md', patch: '@@ -0,0 +1 @@\n+hello' });
    expect(fileMarks(doc, parsePatch(doc.patch), 'SHOP-2').missing).toBe(false);
  });

  it('splits a whole git diff into files: added, deleted, renamed, binary', () => {
    const diff = [
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      'index 0000000..1111111',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,2 @@',
      '+export const a = 1;',
      '+export const b = 2;',
      'diff --git a/src/old.ts b/src/old.ts',
      'deleted file mode 100644',
      '--- a/src/old.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-gone',
      'diff --git a/src/x.ts b/src/y.ts',
      'similarity index 100%',
      'rename from src/x.ts',
      'rename to src/y.ts',
      'diff --git a/logo.png b/logo.png',
      'Binary files a/logo.png and b/logo.png differ',
      '',
    ].join('\n');
    expect(
      splitDiff(diff).map((f) => [f.path, f.oldPath, f.status, f.additions, f.deletions, f.binary]),
    ).toEqual([
      ['src/new.ts', null, 'added', 2, 0, false],
      ['src/old.ts', null, 'deleted', 0, 1, false],
      ['src/y.ts', 'src/x.ts', 'renamed', 0, 0, false],
      ['logo.png', null, 'modified', 0, 0, true],
    ]);
  });

  it('diffs two versions into a patch the parser reads back', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].join('\n') + '\n';
    const after = ['a', 'B', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].join('\n');
    const patch = unifiedPatch(before, after, 2);
    expect(patch.split('\n')).toEqual([
      '@@ -1,4 +1,4 @@',
      ' a',
      '-b',
      '+B',
      ' c',
      ' d',
      '@@ -10,2 +10,3 @@',
      ' j',
      ' k',
      '+l',
    ]);
    const hunks = parsePatch(patch);
    expect(hunks[1]?.lines[2]).toEqual({ kind: 'add', old: null, new: 12, text: 'l' });
    expect(unifiedPatch('', 'x\ny')).toBe('@@ -0,0 +1,2 @@\n+x\n+y');
    expect(unifiedPatch('same', 'same')).toBe('');
  });
});

describe('the risk of a pull request', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const base = {
    additions: 4,
    deletions: 2,
    changedFiles: 1,
    checksState: 'passing',
    reviewState: 'none',
    draft: false,
    noTask: false,
    openedAt: '2026-10-13T12:00:00Z',
  };

  it('is low for a small, linked, passing change', () => {
    expect(prRisk(base, now)).toEqual({ score: 0, level: 'low', reasons: [] });
  });

  it('adds up the reasons, in words', () => {
    const r = prRisk(
      {
        ...base,
        additions: 900,
        deletions: 300,
        changedFiles: 31,
        checksState: 'failing',
        noTask: true,
        openedAt: '2026-10-01T12:00:00Z',
        paths: ['server/migrations/0104_x.sql', 'src/auth/session.ts', 'src/ui.ts'],
        unmarked: 2,
      },
      now,
    );
    expect(r.level).toBe('high');
    expect(r.reasons).toEqual([
      '1200 lines changed',
      '31 files',
      'checks fail',
      'no task',
      'touches migrations, access',
      '2 code files without a fingerprint',
      'open 13 days',
    ]);
    expect(r.score).toBe(8 + 2 + 4 + 2 + 4 + 1 + 1);
  });

  it('counts approvals down and drafts at half', () => {
    const big = { ...base, additions: 500, checksState: 'failing' };
    expect(prRisk(big, now).score).toBe(9);
    expect(prRisk({ ...big, reviewState: 'approved' }, now).score).toBe(7);
    expect(prRisk({ ...big, draft: true }, now)).toMatchObject({ score: 4, level: 'medium' });
  });

  it('knows the sensitive areas', () => {
    expect(sensitiveAreas(['.github/workflows/ci.yml', 'Dockerfile', 'src/billing/x.ts'])).toEqual([
      'money',
      'the pipeline',
      'the build',
    ]);
    expect(sensitiveAreas(['src/cart.ts', 'docs/author.md'])).toEqual([]);
  });

  it('hashes a patch so a change of it is noticed', () => {
    expect(patchHash('a')).toMatch(/^[0-9a-f]{16}$/);
    expect(patchHash('a')).toBe(patchHash('a'));
    expect(patchHash('a')).not.toBe(patchHash('b'));
  });
});

// [PCODE-303 | S15 | v0.1.0] comments sit on lines the diff shows; the AI's answer is checked against them
describe('line comments', () => {
  const hunks = parsePatch(PATCH);
  it('knows which lines take a comment on each side', () => {
    expect(onDiff(hunks, 'new', 2)).toBe(true);
    expect(onDiff(hunks, 'old', 2)).toBe(true);
    expect(onDiff(hunks, 'old', 1)).toBe(false);
    expect(onDiff(hunks, 'new', 40)).toBe(false);
  });

  it('numbers the new lines for the model', () => {
    const text = numberedPatch('src/total.ts', hunks).split('\n');
    expect(text.slice(0, 4)).toEqual([
      'FILE src/total.ts',
      '@@ export function total',
      '    1   const a = 1;',
      '      - const b = 2;',
    ]);
  });

  it('keeps suggestions on lines of the change, once each', () => {
    const files = new Map([['src/total.ts', hunks]]);
    const answer =
      'Sure:\n[{"path":"src/total.ts","line":2,"severity":"risk","body":" Check b. "},' +
      '{"path":"src/total.ts","line":2,"body":"again"},{"path":"src/total.ts","line":90,"body":"x"},' +
      '{"path":"other.ts","line":1,"body":"x"},{"path":"src/total.ts","line":1,"body":""}]';
    expect(parseSuggestions(answer, files)).toEqual([
      { path: 'src/total.ts', line: 2, severity: 'risk', body: 'Check b.' },
    ]);
    expect(parseSuggestions('No issues.', files)).toEqual([]);
    expect(parseSuggestions('[not json]', files)).toEqual([]);
  });

  it('names the writer in the text the host gets', () => {
    expect(hostCommentText(' Fix it. ', 'Ada', true)).toBe(
      'Fix it.\n\n— Ada, from an AI suggestion (via Orqiva)',
    );
  });
});
