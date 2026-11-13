// ── [PCODE-436 | S15 | v0.1.0] T37 low: Untangle the three folder import cycles ──
//    Why:  folders depend one way: the files at the top of src use the folders below them, never the other
//          way round, so no two folders import each other.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

/** The relative imports of the files in one folder of src. */
function importsIn(folder: string): { file: string; spec: string }[] {
  return files(join(SRC, folder)).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/(?:from|import\()\s*'(\.{1,2}\/[^']+)'/g)].map(
      (m) => ({
        file: file.slice(SRC.length),
        spec: m[1] ?? '',
      }),
    ),
  );
}

describe('the folders of src', () => {
  it('never import the files at the top of src', () => {
    const folders = readdirSync(SRC).filter((n) => statSync(join(SRC, n)).isDirectory());
    const up = folders.flatMap((f) =>
      importsIn(f).filter((x) => /^\.\.\/[^/]+$/.test(x.spec) && x.file.split(/[\/]/).length === 2),
    );
    expect(up).toEqual([]);
  });

  it('keep lib free of the routes', () => {
    expect(importsIn('lib').filter((x) => x.spec.startsWith('../api/'))).toEqual([]);
  });
});
