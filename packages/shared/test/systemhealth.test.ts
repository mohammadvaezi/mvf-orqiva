// ── [PCODE-353 | S15 | v0.1.0] T35.4a System health page with backup, restore and upgrade wizards ──
//    Why:  backups are read from what orq backup writes, and the page names what needs attention.
import { describe, expect, it } from 'vitest';
import { backupsOf, healthProblems, type HealthReport } from '../src/systemhealth.js';

const at = (h: number): string => new Date(Date.UTC(2026, 9, 15, 12) - h * 3600_000).toISOString();

describe('system health', () => {
  it('lists the dumps newest first with their checksum and files', () => {
    const list = backupsOf([
      { name: 'orqiva-20261014-0200.dump', bytes: 10, at: at(34) },
      { name: 'orqiva-20261015-0200.dump', bytes: 12, at: at(10) },
      { name: 'orqiva-20261015-0200.dump.sha256', bytes: 1, at: at(10) },
      { name: 'orqiva-20261015-0200-files', bytes: 0, at: at(10), dir: true },
      { name: 'notes.txt', bytes: 3, at: at(1) },
    ]);
    expect(list.map((b) => [b.name, b.checked, b.withFiles])).toEqual([
      ['orqiva-20261015-0200.dump', true, true],
      ['orqiva-20261014-0200.dump', false, false],
    ]);
  });
  it('names what needs attention', () => {
    const now = new Date(Date.UTC(2026, 9, 15, 12));
    const newest = {
      name: 'orqiva-20261015-0200.dump',
      bytes: 1,
      at: at(10),
      checked: true,
      withFiles: true,
    };
    const base: HealthReport = {
      version: '0.1.0',
      startedAt: at(5),
      database: { bytes: 1, migration: '141' },
      queues: {
        mailPending: 0,
        mailStuck: 0,
        mailFailed: 0,
        webhooksFailing: 0,
        bridgesFailing: 0,
        runsQueued: 0,
        runsWaiting: 0,
        deploysQueued: 0,
      },
      runners: [],
      ai: [],
      backups: [
        { name: 'orqiva-20261015-0200.dump', bytes: 1, at: at(10), checked: true, withFiles: true },
      ],
    };
    expect(healthProblems(base, now)).toEqual([]);
    expect(healthProblems({ ...base, backups: [] }, now)).toEqual([
      'There is no backup yet: run orq backup on the server.',
    ]);
    expect(healthProblems({ ...base, backups: [{ ...newest, at: at(30) }] }, now)[0]).toContain(
      'older than a day',
    );
    expect(healthProblems({ ...base, backups: null }, now)).toEqual([]);
    expect(
      healthProblems(
        {
          ...base,
          queues: { ...base.queues, mailStuck: 3 },
          runners: [{ name: 'ci-1', lastSeenAt: at(1) }],
          ai: [{ name: 'Claude', calls: 10, failures: 4 }],
        },
        now,
      ),
    ).toEqual([
      '3 mails wait longer than 15 minutes: check the mail server settings.',
      'Deploy runners not seen for 10 minutes: ci-1.',
      'The AI connection Claude failed 40 % of its calls today.',
    ]);
  });
});
