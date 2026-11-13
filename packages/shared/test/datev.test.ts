// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
// ── [PCODE-343 | S15 | v0.1.0] T34.3a Hour budgets with alerts, time reports by person, sprint and task, DATEV export ──
//    Why:  the DATEV file's header, columns and lines as DATEV reads them; and hour budgets warn once each.
import { describe, expect, it } from 'vitest';
import { budgetStep, datevBuchungsstapel, hourBudgetAlert } from '../src/datev.js';

describe('DATEV Buchungsstapel', () => {
  it('writes the header, the columns and one line per booking, in CRLF', () => {
    const f = datevBuchungsstapel(
      {
        consultant: '1001',
        client: '1',
        fiscalYearStart: '2026-01-01',
        from: '2026-10-01',
        to: '2026-10-31',
        label: 'Leistungen 2026-10',
        now: new Date('2026-10-31T17:05:09.123Z'),
      },
      [
        {
          cents: 123450,
          account: '10042',
          contra: '8400',
          date: '2026-10-31',
          document: 'ORQ202610-1',
          text: 'Leistungen "Helio"; HEL',
        },
        {
          cents: 0,
          account: '10042',
          contra: '8400',
          date: '2026-10-31',
          document: 'x',
          text: 'nothing',
        },
      ],
    );
    const lines = f.split('\r\n');
    expect(lines[0]).toBe(
      '"EXTF";700;21;"Buchungsstapel";13;20261031170509123;;"OR";"orqiva";"";1001;1;20260101;4;20261001;20261031;"Leistungen 2026-10";"";1;0;0;"EUR"',
    );
    expect(lines[1]?.split(';')).toHaveLength(14);
    expect(lines[2]).toBe(
      '1234,50;"S";"EUR";;;;10042;8400;"";3110;"ORQ202610-1";"";;"Leistungen ""Helio"" HEL"',
    );
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe('');
  });
});

describe('hour budget alerts', () => {
  const b = { hours: 10, warnPct: 80, warnedKey: null, overKey: null };
  it('warns at the level, reports over at the full hours, once per period', () => {
    // [PCODE-351 | S15 | v0.1.0] half the hours first
    expect(hourBudgetAlert(b, 4.9, '2026-10')).toBeNull();
    expect(hourBudgetAlert(b, 5, '2026-10')).toBe('half');
    expect(hourBudgetAlert({ ...b, halfKey: '2026-10' }, 7.9, '2026-10')).toBeNull();
    expect(hourBudgetAlert(b, 8, '2026-10')).toBe('warn');
    expect(hourBudgetAlert({ ...b, warnedKey: '2026-10' }, 9, '2026-10')).toBeNull();
    expect(hourBudgetAlert({ ...b, warnedKey: '2026-10' }, 10, '2026-10')).toBe('over');
    expect(
      hourBudgetAlert({ ...b, warnedKey: '2026-10', overKey: '2026-10' }, 12, '2026-10'),
    ).toBeNull();
    expect(budgetStep(49, 80)).toBeNull();
    expect(budgetStep(50, 80)).toBe('half');
    expect(budgetStep(80, 80)).toBe('warn');
    expect(budgetStep(55, 50)).toBe('warn');
    expect(budgetStep(100, 80)).toBe('full');
    expect(hourBudgetAlert({ ...b, warnedKey: '2026-09', overKey: '2026-09' }, 9, '2026-10')).toBe(
      'warn',
    );
  });
});
