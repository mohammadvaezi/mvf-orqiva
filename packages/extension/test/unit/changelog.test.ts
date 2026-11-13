// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-47 | S09 | v0.1.0] Generate the CHANGELOG.md section from Done items since the last tag ──
//    Why:  only items done after the tag, grouped and ordered the same way every run, commits without a Done
//          item kept visible, and a second write for the same version replacing its section.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHANGELOG_FILE,
  collectChangelog,
  groupOfLabels,
  renderSection,
  upsertSection,
  writeChangelog,
} from '../../src/release/changelog';
import type { Issue, Label, State } from '../../src/plane/types';
import type { Commit } from '../../src/util/git';

const STATES: State[] = [
  { id: 's-todo', name: 'Todo', group: 'unstarted', color: '' },
  { id: 's-prog', name: 'In Progress', group: 'started', color: '' },
  { id: 's-done', name: 'Done', group: 'completed', color: '' },
];
const LABELS: Label[] = [
  { id: 'l-feature', name: 'feature', color: '' },
  { id: 'l-bug', name: 'bug', color: '' },
  { id: 'l-test', name: 'test', color: '' },
];

const issue = (
  seq: number,
  name: string,
  state: string,
  completed: string | null,
  labels: string[] = [],
): Issue => ({
  id: `i-${String(seq)}`,
  sequence_id: seq,
  name,
  state,
  priority: 'medium',
  labels,
  ...(completed ? { completed_at: completed } : {}),
});

const commit = (hash: string, subject: string): Commit => ({
  hash,
  subject,
  ref: /^([A-Z]{2,5}-\d+)\s/.exec(subject)?.[1] ?? null,
});

const INPUT = {
  issues: [
    issue(1, 'Read the configuration', 's-done', '2026-01-01T10:00:00Z', ['l-feature']), // before the tag
    issue(2, 'Persist the configuration', 's-done', '2026-02-02T10:00:00Z', ['l-feature']),
    issue(3, 'Fix the parser', 's-done', '2026-02-03T10:00:00Z', ['l-bug']),
    issue(4, 'Still working on it', 's-prog', null, ['l-feature']),
    issue(5, 'Cover the parser', 's-done', '2026-02-04T10:00:00Z', ['l-test']),
    issue(10, 'Tidy the scripts', 's-done', '2026-02-05T10:00:00Z', []),
  ],
  states: STATES,
  labels: LABELS,
  identifier: 'DOC',
  commits: [
    commit('aaa1111', 'DOC-2 Persist the configuration'),
    commit('bbb2222', 'DOC-3 Fix the parser'),
    commit('ccc3333', 'chore(plane): version 0.1.0'),
    commit('ddd4444', 'DOC-9 A task that is not done yet'),
  ],
};

describe('changelog', () => {
  it('maps labels to sections', () => {
    expect(groupOfLabels(['feature'])).toBe('Features');
    expect(groupOfLabels(['bug'])).toBe('Fixes');
    expect(groupOfLabels(['hotfix'])).toBe('Fixes');
    expect(groupOfLabels(['test'])).toBe('Tests');
    expect(groupOfLabels(['chore'])).toBe('Chores');
    expect(groupOfLabels([])).toBe('Changes');
    expect(groupOfLabels(['documentation'])).toBe('Changes');
  });

  // ── [PCODE-47 | S09 | v0.1.0] only_done_since_tag ──
  it('takes only items done after the tag, and never an open one', () => {
    const data = collectChangelog({ ...INPUT, sinceIso: '2026-02-01T00:00:00Z' });
    expect(data.entries.map((e) => e.ref)).toEqual(['DOC-2', 'DOC-3', 'DOC-5', 'DOC-10']);
    expect(data.entries.map((e) => e.group)).toEqual(['Features', 'Fixes', 'Tests', 'Changes']);
    // without a tag every Done item counts, including the older one
    const all = collectChangelog({ ...INPUT, sinceIso: null });
    expect(all.entries.map((e) => e.ref)).toEqual(['DOC-1', 'DOC-2', 'DOC-3', 'DOC-5', 'DOC-10']);
    // the commits without a Done item behind them stay visible
    expect(data.otherCommits.map((c) => c.hash)).toEqual(['ccc3333', 'ddd4444']);
  });

  it('renders a stable section', () => {
    const section = renderSection(
      '0.2.0',
      '2026-02-06',
      collectChangelog({ ...INPUT, sinceIso: '2026-02-01T00:00:00Z' }),
    );
    // a group without entries (Chores here) is left out entirely
    expect(section).toBe(
      [
        '## v0.2.0 (2026-02-06)',
        '',
        '### Features',
        '',
        '- DOC-2 Persist the configuration',
        '',
        '### Fixes',
        '',
        '- DOC-3 Fix the parser',
        '',
        '### Tests',
        '',
        '- DOC-5 Cover the parser',
        '',
        '### Changes',
        '',
        '- DOC-10 Tidy the scripts',
        '',
        '### Other commits',
        '',
        '- ccc3333 chore(plane): version 0.1.0',
        '- ddd4444 DOC-9 A task that is not done yet',
        '',
      ].join('\n'),
    );
    const empty = renderSection('0.2.1', '2026-02-07', {
      entries: [],
      otherCommits: [],
      since: null,
    });
    expect(empty).toContain('_Nothing recorded for this release._');
  });

  // ── [PCODE-47 | S09 | v0.1.0] writing the file: created, prepended, replaced ──
  it('creates, prepends and replaces without duplicating a version', () => {
    const section = '## v0.2.0 (2026-02-06)\n\n### Features\n\n- DOC-2 Persist\n';
    const created = upsertSection(null, '0.2.0', section);
    expect(created.startsWith('# Changelog')).toBe(true);
    expect(created).toContain('## v0.2.0 (2026-02-06)');

    const next = upsertSection(created, '0.3.0', '## v0.3.0 (2026-03-01)\n\n- DOC-4 Later\n');
    expect(next.indexOf('## v0.3.0')).toBeLessThan(next.indexOf('## v0.2.0')); // newest first
    expect(next).toContain('## v0.2.0 (2026-02-06)');

    const again = upsertSection(
      next,
      '0.3.0',
      '## v0.3.0 (2026-03-02)\n\n- DOC-4 Later, corrected\n',
    );
    expect(again.match(/## v0\.3\.0/g)).toHaveLength(1);
    expect(again).toContain('Later, corrected');
    expect(again).toContain('## v0.2.0 (2026-02-06)');
    expect(again).toContain('# Changelog');
  });

  describe('writeChangelog', () => {
    let root = '';
    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-changelog-'));
    });
    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('writes the file and then updates it in place', () => {
      const first = writeChangelog(root, '0.2.0', '## v0.2.0 (2026-02-06)\n\n- DOC-2 Persist\n');
      expect(first.created).toBe(true);
      const file = path.join(root, CHANGELOG_FILE);
      expect(fs.readFileSync(file, 'utf8')).toContain('- DOC-2 Persist');
      const second = writeChangelog(root, '0.3.0', '## v0.3.0 (2026-03-01)\n\n- DOC-4 Later\n');
      expect(second.created).toBe(false);
      const text = fs.readFileSync(file, 'utf8');
      expect(text.indexOf('v0.3.0')).toBeLessThan(text.indexOf('v0.2.0'));
      writeChangelog(root, '0.3.0', '## v0.3.0 (2026-03-01)\n\n- DOC-4 Later\n');
      expect(fs.readFileSync(file, 'utf8').match(/## v0\.3\.0/g)).toHaveLength(1);
    });
  });
});
