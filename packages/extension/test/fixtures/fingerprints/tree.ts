// ── [PCODE-40 | S08 | v0.1.0] Implement the workspace fingerprint scanner and index matching fingerprint.py ──
//    Why:  one tree, written into a temp folder, scanned by both scanners (ours and the engine's) so their
//          indexes can be compared. The markers are assembled at runtime - a literal one in this file would
//          land in Orqiva's own fingerprint index.
import * as fs from 'node:fs';
import * as path from 'node:path';

const marker = (task: string, sprint: string, version: string, title: string): string =>
  `[${task} | ${sprint} | v${version}] ${title}`;

const hash = (task: string, sprint: string, version: string, title: string, header = false): string =>
  `# ${header ? '── ' : ''}${marker(task, sprint, version, title)}${header ? ' ──' : ''}`;

const slash = (task: string, sprint: string, version: string, title: string, header = false): string =>
  `// ${header ? '── ' : ''}${marker(task, sprint, version, title)}${header ? ' ──' : ''}`;

const FILES: Record<string, string> = {
  'app/x.py': [
    hash('DOC-1', 'S01', '0.1.0', 'Read the config', true),
    'import os',
    '',
    hash('DOC-1', 'S01', '0.1.0', 'load: read the file'),
    'def load():',
    '    return os.getcwd()',
    '',
    hash('DOC-2', 'S02', '0.2.0', 'save: write it back'),
    'def save():',
    '    pass',
  ].join('\n'),
  'src/a.ts': [
    slash('DOC-2', 'S02', '0.2.0', 'Persist the config', true),
    slash('DOC-1', 'S01', '0.2.0', 'Read the config', true),
    '',
    slash('DOC-2', 'S02', '0.2.0', 'save: the browser twin'),
    'export const save = (): void => undefined;',
  ].join('\n'),
  'web/style.css': `/* ── ${marker('DOC-3', 'S02', '0.1.0', 'Style the page')} ── */\nbody { margin: 0; }`,
  'sql/schema.sql': `-- ── ${marker('DOC-3', 'S02', '0.1.0', 'The config table')} ──\nCREATE TABLE config (id int);`,
  Dockerfile: `${hash('DOC-1', 'S01', '0.1.0', 'Runtime image', true)}\nFROM python:3.12-slim`,
  // extension-less build files carry '#' comments and count as code on both sides
  Makefile: `${hash('DOC-4', 'S03', '0.3.0', 'Developer commands', true)}\ntest:\n\tpytest -q`,
  '.github/workflows/ci.yml': `${hash('DOC-4', 'S03', '0.3.0', 'Run the tests', true)}\non: [push]`,
  // none of these may appear in the index
  'node_modules/lib.js': slash('DOC-9', 'S01', '0.1.0', 'vendored'),
  'dist/bundle.js': slash('DOC-9', 'S01', '0.1.0', 'built'),
  '.hidden/h.py': hash('DOC-9', 'S01', '0.1.0', 'hidden'),
  'app/app.min.js': slash('DOC-9', 'S01', '0.1.0', 'minified'),
  'data.json': `{"note": "${marker('DOC-9', 'S01', '0.1.0', 'json')}"}`,
  'README.md': `<!-- ${marker('DOC-9', 'S01', '0.1.0', 'docs')} -->`,
};

// ── [PCODE-40 | S08 | v0.1.0] writeTree: the fixture project on disk ──
export function writeTree(root: string): string {
  for (const [rel, content] of Object.entries(FILES)) {
    const file = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${content}\n`, 'utf8');
  }
  return root;
}

/** files the scanner must read (posix, sorted) */
export const SCANNED = [
  '.github/workflows/ci.yml',
  'Dockerfile',
  'Makefile',
  'app/x.py',
  'sql/schema.sql',
  'src/a.ts',
  'web/style.css',
];
