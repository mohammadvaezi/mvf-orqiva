// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-103 | S15 | v0.1.0] Build the CLI `orq` and the Claude Code hooks against the new server ──
//    Why:  the fingerprint scan runs where the code is: on the developer's machine. It walks the repository
//          as fingerprint.py did (skipping dependencies, builds and hidden folders) and reads every code
//          file's markers with the shared rules.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isCode, scanText, walkDir, type FingerprintHit } from '@orqiva/shared';

const MAX_FILE = 2 * 1024 * 1024;

export function scanRepo(root: string, task?: string): FingerprintHit[] {
  const out: FingerprintHit[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (walkDir(e.name)) walk(full);
      } else if (e.isFile() && isCode(e.name)) {
        let text: string;
        try {
          if (statSync(full).size > MAX_FILE) continue;
          text = readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        const rel = relative(root, full).replace(/\\/g, '/');
        for (const hit of scanText(text, rel)) if (!task || hit.task === task) out.push(hit);
      }
    }
  };
  walk(root);
  return out;
}

export function fileHasMarker(path: string, task: string): boolean {
  try {
    return scanText(readFileSync(path, 'utf8')).some((h) => h.task === task);
  } catch {
    return false;
  }
}
