// ── [PCODE-4 | S01 | v0.1.0] Add the @vscode/test-electron activation smoke test with a fixture workspace ──
//    Why:  the entry VS Code calls inside the Extension Development Host; collects *.test.js next to it and runs mocha.
import Mocha from 'mocha';
import * as path from 'node:path';
import { globSync } from 'glob';

// ── [PCODE-4 | S01 | v0.1.0] run: bundled test files live beside this file in dist/test/suite ──
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 20000 });
  const here = __dirname;
  for (const f of globSync('**/*.test.js', { cwd: here }).sort()) mocha.addFile(path.join(here, f));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) reject(new Error(`${failures} e2e test(s) failed`));
      else resolve();
    });
  });
}
