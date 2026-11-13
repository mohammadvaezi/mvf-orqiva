// ── [PCODE-72 | S14 | v0.1.0] Handover: refresh architecture.md, list known issues and next-release candidates ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  architecture.md and criticals.md were written before the code and described a layout that no
//          longer existed by Sprint 13 - thirty modules the document had never heard of, and three guard
//          tests named in criticals.md that were never written under those names. A document that can
//          drift silently is worse than none, because it is believed. These checks make the drift a
//          failing build: every path either exists or the document is wrong.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
// ── [PCODE-84 | S08 | v0.1.0] Set up the platform monorepo with npm workspaces, own build scripts and CI ──
//    the extension moved into packages/extension; the project's folder stays at the repository root
// [PCODE-455 | S15 | v0.1.0] Rename the project folder .plane to .orqiva on Orqiva folders, with a one-time move
const REPO_ROOT = path.resolve(ROOT, '..', '..');
const read = (rel: string): string =>
  fs.readFileSync(path.join(rel.startsWith('.orqiva/') ? REPO_ROOT : ROOT, rel), 'utf8');
const ARCHITECTURE = read('.orqiva/architecture.md');
const CRITICALS = read('.orqiva/criticals.md');

/** every `src/…` or `test/…` file path the document names */
function pathsIn(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/\b((?:src|test)\/[\w/.-]+\.(?:ts|mjs))/g)].map((m) => m[1] ?? ''),
    ),
  ];
}

function sourceFiles(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.ts')) out.add(rel);
    }
  };
  walk('src');
  return out;
}

describe('architecture.md describes the code that exists', () => {
  it('names no file that is not there', () => {
    const missing = pathsIn(ARCHITECTURE).filter((p) => !fs.existsSync(path.join(ROOT, p)));
    expect(missing).toEqual([]);
  });

  // ── [PCODE-72 | S14 | v0.1.0] the direction that actually rotted: modules nobody wrote down ──
  it('names every module that exists, by its basename', () => {
    const unmentioned = [...sourceFiles()]
      .map((p) => path.basename(p))
      .filter((base) => !ARCHITECTURE.includes(base))
      .sort();
    expect(unmentioned).toEqual([]);
  });

  it('still states the rules that shape the modules', () => {
    for (const phrase of [
      'Nothing writes to Plane',
      'Nothing writes `.plane/state/`',
      'raises an error notification',
    ]) {
      expect(ARCHITECTURE, phrase).toContain(phrase);
    }
  });
});

describe('criticals.md points at guards that exist', () => {
  it('names a real test file for every critical', () => {
    const missing = pathsIn(CRITICALS).filter((p) => !fs.existsSync(path.join(ROOT, p)));
    expect(missing).toEqual([]);
  });

  it('gives all twelve criticals a guard', () => {
    const rows = CRITICALS.split('\n').filter((l) => /^\| \d+ \|/.test(l));
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(row, row.slice(0, 30)).toMatch(/test\/[\w/.-]+\.ts/);
    }
  });
});

describe('known issues are written down', () => {
  const KNOWN = read('docs/known-issues.md');

  it('lists what is not finished, and what the next release should look at', () => {
    expect(KNOWN).toContain('## Known issues');
    expect(KNOWN).toContain('## Not tested on');
    expect(KNOWN).toContain('## Candidates for the next release');
  });

  // [PCODE-222 | S15 | v0.1.0] from the developer notes, now that the README is the Marketplace listing
  it('is reachable from the developer notes', () => {
    expect(read('docs/development.md')).toContain('known-issues.md');
  });
});
