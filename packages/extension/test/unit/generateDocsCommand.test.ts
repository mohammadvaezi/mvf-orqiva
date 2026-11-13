// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-42 | S08 | v0.1.0] Add the Generate code documentation command with progress and Docs tree entries ──
//    Why:  the output folder setting (and the paths it refuses), a cancelled scan that writes nothing, the
//          pages a real run leaves in the fixture, and the summary the notification shows.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import {
  DEFAULT_OUTPUT,
  generateDocumentation,
  normalizeOutputFolder,
  outputFolder,
  summaryOf,
} from '../../src/commands/docsCommands';
import type { Services } from '../../src/services';
import { boardFromSprintsMd } from '../../src/state/board';
import { parseSprintsMd } from '../../src/state/sprintsMd';
import { Store } from '../../src/state/store';
import { Logger, resetLoggerForTests } from '../../src/util/log';
import { writeTree } from '../fixtures/fingerprints/tree';
import { recorded, resetRecorded } from '../mocks/vscode';

const SPRINTS_MD =
  '## Sprint 01 - Foundation (2026-01-01) — 0/1 done\n- [ ] DOC-1 Read the configuration — In Progress (high)\n';

function token(cancelled = false): vscode.CancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: () => ({ dispose: () => undefined }),
  };
}

function services(root: string): Services {
  const store = new Store();
  store.state.root = root;
  store.state.link = {
    project_id: 'p1',
    identifier: 'DOC',
    name: 'Fixture',
    workspace: 'ws',
    version: '0.4.2',
  };
  store.state.sprints = boardFromSprintsMd(parseSprintsMd(SPRINTS_MD), '2026-01-01');
  return {
    store,
    log: new Logger(),
    root: () => root,
    secrets: { hasApiKey: () => Promise.resolve(false) },
    client: {},
  } as unknown as Services;
}

describe('output folder setting', () => {
  beforeEach(() => {
    resetRecorded();
  });

  it('defaults, normalises and refuses a path outside the project', () => {
    expect(normalizeOutputFolder(undefined)).toBe(DEFAULT_OUTPUT);
    expect(normalizeOutputFolder('  ')).toBe(DEFAULT_OUTPUT);
    expect(normalizeOutputFolder('./docs/api/')).toBe('docs/api');
    expect(normalizeOutputFolder('docs\\api')).toBe('docs/api');
    expect(normalizeOutputFolder('/etc/docs')).toBe(DEFAULT_OUTPUT);
    expect(normalizeOutputFolder('C:/temp')).toBe(DEFAULT_OUTPUT);
    expect(normalizeOutputFolder('../outside')).toBe(DEFAULT_OUTPUT);
    expect(outputFolder()).toBe(DEFAULT_OUTPUT);
    recorded.configuration.set('orqiva.docs.outputFolder', 'documentation/code');
    expect(outputFolder()).toBe('documentation/code');
  });
});

describe('generateDocumentation', () => {
  let root = '';
  beforeEach(() => {
    resetRecorded();
    resetLoggerForTests();
    root = writeTree(fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-docscmd-')));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  // ── [PCODE-42 | S08 | v0.1.0] the happy path: pages in the configured folder, a readable summary ──
  it('writes the pages into the configured folder and reports what it did', async () => {
    recorded.configuration.set('orqiva.docs.outputFolder', 'documentation/code');
    const messages: string[] = [];
    let refreshed = 0;
    const result = await generateDocumentation({
      services: services(root),
      onGenerated: () => {
        refreshed++;
      },
      today: () => '2026-02-02',
      progress: (title, fn) => {
        messages.push(title);
        return fn((m) => messages.push(m), token());
      },
    });
    if (!result) throw new Error('nothing was generated');
    const out = path.join(root, 'documentation', 'code');
    expect(fs.existsSync(path.join(out, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'sprints', 'S01.md'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'tasks', 'DOC-1.md'))).toBe(true);
    expect(fs.readFileSync(path.join(out, 'README.md'), 'utf8')).toContain('version 0.4.2');
    // links climb out of the two-deep output folder
    expect(fs.readFileSync(path.join(out, 'tasks', 'DOC-1.md'), 'utf8')).toContain(
      '(../../../app/x.py#L1)',
    );
    expect(refreshed).toBe(1);
    expect(messages[0]).toBe('Orqiva: generating code documentation');
    expect(messages.some((m) => m.startsWith('scanning'))).toBe(true);
    expect(summaryOf(result)).toMatch(
      /^Documentation generated: 3 sprints, 4 tasks \(8 page\(s\) written\)\.$/,
    );
  });

  // ── [PCODE-42 | S08 | v0.1.0] cancelling leaves the previous documentation untouched ──
  it('writes nothing when the scan is cancelled', async () => {
    const result = await generateDocumentation({
      services: services(root),
      today: () => '2026-02-02',
      progress: (_title, fn) => fn(() => undefined, token(true)),
    });
    expect(result).toBeUndefined();
    expect(fs.existsSync(path.join(root, 'docs'))).toBe(false);
  });

  it('says so when the folder is not linked', async () => {
    const svc = services(root);
    svc.store.state.link = null;
    const result = await generateDocumentation({
      services: svc,
      progress: (_t, fn) => fn(() => undefined, token()),
    });
    expect(result).toBeUndefined();
    expect(recorded.infoMessages[0]).toBe('Link this folder to an Orqiva project first.');
  });
});
