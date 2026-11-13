// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
//    Why:  what appears on its own is told to screen readers the same way on every screen: an error
//          message is an alert, a loading line a status.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'preview' ? [] : files(p);
    return n.endsWith('.tsx') ? [p] : [];
  });

describe('messages that appear', () => {
  it('are announced: errors as alerts, loading as a status', () => {
    const bad: string[] = [];
    for (const f of files(SRC)) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/<(?:p|div|span)\s+className="v2-error[^"]*"[^>\n]*>/g))
        if (!m[0].includes('role=')) bad.push(f.slice(SRC.length) + ': ' + m[0]);
      for (const m of s.matchAll(/<p[^>\n]*>Loading[^<\n]*…<\/p>/g))
        if (!m[0].includes('role=')) bad.push(f.slice(SRC.length) + ': ' + m[0]);
    }
    expect(bad).toEqual([]);
  });
});
