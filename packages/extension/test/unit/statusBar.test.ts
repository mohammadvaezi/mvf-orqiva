// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-15 | S03 | v0.1.0] Add the status bar item showing active task, fingerprint and queue length ──
//    Why:  text/tooltip per state, the queue segment only when pending, the warning background, and the
//          fingerprint helper matching fingerprint.py (same cases as tests/test_fingerprint.py).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFingerprint } from '../../src/commands/fingerprintCommands';
import type { Services } from '../../src/services';
import { Store } from '../../src/state/store';
import type { ActiveTask } from '../../src/state/types';
import {
  blockLine,
  hasMarker,
  headerBlock,
  isCode,
  MARK,
  scanText,
} from '../../src/util/fingerprint';
import { StatusBar, statusText } from '../../src/views/statusBar';
import { nodeBackend } from '../../src/state/watcher';
import { recorded, resetRecorded } from '../mocks/vscode';

const ACTIVE: ActiveTask = {
  task: 'FIX-2',
  issue_id: 'i2',
  title: 'Add the greeting function',
  sprint: 'S01',
  sprint_name: 'Sprint 01 - Foundation',
  version: '0.1.0',
  session_id: 's',
  host: 'fixture-host',
  started_at: '2026-01-01T09:00:00',
  files: ['src/sample.ts'],
  url: 'https://x/2/',
};
const LINK = {
  workspace: 'w',
  project_id: 'p',
  identifier: 'FIX',
  name: 'Fixture',
  version: '0.1.0',
};

describe('statusText', () => {
  it('renders the active task, the queue segment only when pending, and offline', () => {
    const store = new Store();
    store.state.link = LINK;
    store.state.root = 'C:\\proj';
    store.state.active = ACTIVE;
    let s = statusText(store.state);
    expect(s.text).toBe('$(tasklist) FIX-2 · S01 · v0.1.0');
    expect(s.tooltip).toContain('[FIX-2 | S01 | v0.1.0] Add the greeting function');
    expect(s.tooltip).toContain('Started 2026-01-01 09:00:00');
    expect(s.warning).toBe(false);
    store.state.queueLength = 3;
    s = statusText(store.state);
    expect(s.text).toBe('$(tasklist) FIX-2 · S01 · v0.1.0  $(cloud-upload) 3');
    expect(s.warning).toBe(true);
    store.state.queueLength = 0;
    store.state.active = null;
    store.state.online = false;
    store.state.lastError = 'ECONNREFUSED';
    s = statusText(store.state);
    expect(s.text).toBe('$(circle-slash) No task  $(cloud-offline)');
    expect(s.warning).toBe(true);
  });
});

describe('StatusBar', () => {
  let root: string;
  beforeEach(() => {
    resetRecorded();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-sb-'));
    fs.mkdirSync(path.join(root, '.plane', 'state'), { recursive: true });
    fs.writeFileSync(path.join(root, '.plane', 'project.json'), JSON.stringify(LINK));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  // ── [PCODE-15 | S03 | v0.1.0] the item follows a new active.json within a second ──
  it('updates within a second after the engine writes active.json', async () => {
    const store = new Store();
    store.load(root);
    store.watch(nodeBackend, 50);
    const bar = new StatusBar(store);
    expect(bar.current.text).toBe('$(circle-slash) No task');
    fs.writeFileSync(path.join(root, '.plane', 'state', 'active.json'), JSON.stringify(ACTIVE));
    const started = Date.now();
    while (!bar.current.text.includes('FIX-2') && Date.now() - started < 1000)
      await new Promise((r) => setTimeout(r, 20));
    expect(bar.current.text).toBe('$(tasklist) FIX-2 · S01 · v0.1.0');
    bar.dispose();
    store.dispose();
  });
});

describe('fingerprint helper (twin of fingerprint.py)', () => {
  it('matches the same markers as the Python regex', () => {
    for (const line of [
      '# -- [SBX-3 | S01 | v0.1.0] Hello endpoint --',
      '// [PRODC-77 | Test Sprint 2 | v1.2.3] x',
      '<!-- [AB-1|S02|v0.0.1] -->',
      '{# [ABCDE-999 | S99 | v10.20.30] jinja #}',
    ])
      expect(MARK.test(line), line).toBe(true);
    expect(MARK.test('[sbx-3 | S01 | v0.1.0]')).toBe(false);
    expect(MARK.test('[SBX-3 | S01 | 0.1.0]')).toBe(false);
  });

  it('produces the header per language exactly like header_block()', () => {
    expect(headerBlock('a.py', 'SBX-1', 'S01', '0.1.0', 'T')).toBe(
      '# -- [SBX-1 | S01 | v0.1.0] T --',
    );
    expect(headerBlock('a.ts', 'FIX-2', 'S01', '0.1.0', 'Title')).toBe(
      '// -- [FIX-2 | S01 | v0.1.0] Title --',
    );
    expect(headerBlock('a.html', 'SBX-1', 'S01', '0.1.0', 'T')).toBe(
      '<!-- -- [SBX-1 | S01 | v0.1.0] T -- -->',
    );
    expect(headerBlock('a.css', 'SBX-1', 'S01', '0.1.0', 'T')).toMatch(/\*\/$/);
    expect(headerBlock('a.html.j2', 'SBX-1', 'S01', '0.1.0', 'T')).toMatch(/^\{#/);
    expect(headerBlock('a.py', 'SBX-1', 'S01', '0.1.0', 'T', 'http://x', 'because')).toBe(
      '# -- [SBX-1 | S01 | v0.1.0] T --\n#    Task: http://x\n#    Why:  because',
    );
    expect(blockLine('a.sql', 'SBX-1', 'S01', '0.1.0', 'the view')).toBe(
      '-- [SBX-1 | S01 | v0.1.0] the view',
    );
    expect(isCode('README.md')).toBe(false);
    expect(isCode('x.json')).toBe(false);
    expect(isCode('Makefile')).toBe(true);
  });

  it('scans headers and blocks', () => {
    const text =
      '# -- [SBX-2 | S01 | v0.1.0] Hello --\nimport os\n# [SBX-2 | S01 | v0.1.0] handler\n# [SBX-3 | S02 | v0.1.0] second\n';
    const m = scanText(text);
    expect(m.map((x) => [x.task, x.line, x.kind])).toEqual([
      ['SBX-2', 1, 'header'],
      ['SBX-2', 3, 'block'],
      ['SBX-3', 4, 'header'],
    ]);
    expect(m[0]?.title).toBe('Hello');
    expect(hasMarker(text, 'SBX-4')).toBe(false);
  });

  // ── [PCODE-15 | S03 | v0.1.0] Copy fingerprint: .ts gives the // form, .py the # form ──
  it('copyFingerprint puts the language-specific header on the clipboard', async () => {
    const store = new Store();
    store.state.active = ACTIVE;
    const services = { store } as unknown as Services;
    await copyFingerprint(services, 'C:\\proj\\src\\a.ts');
    expect(recorded.clipboard.split('\n')[0]).toBe(
      '// -- [FIX-2 | S01 | v0.1.0] Add the greeting function --',
    );
    expect(recorded.clipboard.split('\n')[1]).toBe('//    Task: https://x/2/');
    await copyFingerprint(services, 'C:\\proj\\app.py');
    expect(recorded.clipboard.split('\n')[0]).toBe(
      '# -- [FIX-2 | S01 | v0.1.0] Add the greeting function --',
    );
    store.state.active = null;
    await copyFingerprint(services, 'x.ts');
    expect(recorded.infoMessages.at(-1)).toContain('No active task');
  });
});
