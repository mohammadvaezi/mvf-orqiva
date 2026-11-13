// ── [PCODE-205 | S15 | v0.1.0] T17.3 Release agent with release tools, approved release notes, changelogs per release, project and train ──
//    Why:  a changelog section groups the changes by kind with breaking changes first, and a changelog
//          lists the versions newest first.
import { describe, expect, it } from 'vitest';
import { changelog, changelogSection, compareVersions } from '../src/index.js';

const item = (ref: string, kind: string, breaking = false) => ({
  ref,
  title: 'Task ' + ref,
  kind,
  breaking,
});

describe('changelogs', () => {
  it('groups a version by kind, breaking first', () => {
    expect(
      changelogSection({
        version: '2.0.0',
        date: '2026-10-16',
        items: [
          item('A-1', 'story'),
          item('A-2', 'bug'),
          item('A-3', 'task', true),
          item('A-4', 'task'),
        ],
      }),
    ).toBe(
      [
        '## [2.0.0] - 2026-10-16',
        '',
        '### Breaking',
        '',
        '- Task A-3 (A-3)',
        '',
        '### Added',
        '',
        '- Task A-1 (A-1)',
        '',
        '### Fixed',
        '',
        '- Task A-2 (A-2)',
        '',
        '### Changed',
        '',
        '- Task A-4 (A-4)',
        '',
      ].join('\n'),
    );
    expect(changelogSection({ version: '1.0.1', date: null, items: [], rolledBack: true })).toBe(
      '## [1.0.1] - Unreleased [ROLLED BACK]\n\n- Maintenance release.\n',
    );
  });

  it('lists versions newest first', () => {
    const text = changelog(
      'Changelog',
      [
        { version: '1.2.0', date: '2026-09-01', items: [] },
        { version: '1.10.0', date: '2026-10-01', items: [] },
      ],
      compareVersions,
    );
    expect(text.indexOf('[1.10.0]')).toBeLessThan(text.indexOf('[1.2.0]'));
    expect(text.startsWith('# Changelog\n')).toBe(true);
  });
});
