// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
// ── [PCODE-343 | S15 | v0.1.0] T34.3a Hour budgets with alerts, time reports by person, sprint and task, DATEV export ──
//    Why:  the tax adviser books revenue from DATEV files: the billable time of a period becomes one
//          booking per client and project in DATEV's EXTF "Buchungsstapel" format (version 700, category
//          21), which DATEV Rechnungswesen imports as it is. And hour budgets warn once per period.

export interface DatevBooking {
  /** euro cents, positive */
  cents: number;
  /** debtor account of the client */
  account: string;
  /** revenue account, e.g. 8400 */
  contra: string;
  /** the document date, YYYY-MM-DD */
  date: string;
  /** document number, up to 36 characters */
  document: string;
  /** booking text, up to 60 characters */
  text: string;
}

export interface DatevHeader {
  consultant: string;
  client: string;
  /** first day of the fiscal year, YYYY-MM-DD */
  fiscalYearStart: string;
  from: string;
  to: string;
  label: string;
  /** when the file was made */
  now: Date;
  /** length of the general ledger accounts, 4 by default */
  accountLength?: number;
}

const COLUMNS = [
  'Umsatz (ohne Soll/Haben-Kz)',
  'Soll/Haben-Kennzeichen',
  'WKZ Umsatz',
  'Kurs',
  'Basis-Umsatz',
  'WKZ Basis-Umsatz',
  'Konto',
  'Gegenkonto (ohne BU-Schlüssel)',
  'BU-Schlüssel',
  'Belegdatum',
  'Belegfeld 1',
  'Belegfeld 2',
  'Skonto',
  'Buchungstext',
];

/** A text field: in quotes, quotes doubled, no separators or line breaks inside, cut to length. */
const q = (s: string, max = 60): string =>
  '"' +
  s
    .replace(/\s*[\r\n;]+\s*/g, ' ')
    .slice(0, max)
    .replace(/"/g, '""') +
  '"';

const ymd = (iso: string): string => iso.slice(0, 10).replace(/-/g, '');
const stamp = (d: Date): string =>
  d
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 17)
    .padEnd(17, '0');

/** The EXTF file: header line, column line, one line per booking; lines end in CRLF. */
export function datevBuchungsstapel(h: DatevHeader, rows: readonly DatevBooking[]): string {
  const header = [
    '"EXTF"',
    '700',
    '21',
    '"Buchungsstapel"',
    '13',
    stamp(h.now),
    '',
    '"OR"',
    '"orqiva"',
    '""',
    h.consultant,
    h.client,
    ymd(h.fiscalYearStart),
    String(h.accountLength ?? 4),
    ymd(h.from),
    ymd(h.to),
    q(h.label, 30),
    '""',
    '1',
    '0',
    '0',
    '"EUR"',
  ].join(';');
  const lines = rows
    .filter((r) => r.cents > 0)
    .map((r) =>
      [
        (r.cents / 100).toFixed(2).replace('.', ','),
        '"S"',
        '"EUR"',
        '',
        '',
        '',
        r.account,
        r.contra,
        '""',
        r.date.slice(8, 10) + r.date.slice(5, 7),
        q(r.document, 36),
        '""',
        '',
        q(r.text, 60),
      ].join(';'),
    );
  return [header, COLUMNS.join(';'), ...lines].join('\r\n') + '\r\n';
}

/** Which alert an hour budget owes now: none, the warning, or over; each once per period. */
export function hourBudgetAlert(
  b: {
    hours: number;
    warnPct: number;
    warnedKey: string | null;
    overKey: string | null;
    // [PCODE-351 | S15 | v0.1.0] the period the half was reported in
    halfKey?: string | null;
  },
  usedHours: number,
  periodKey: string,
): 'half' | 'warn' | 'over' | null {
  if (usedHours >= b.hours) return b.overKey === periodKey ? null : 'over';
  if (usedHours >= (b.hours * b.warnPct) / 100) return b.warnedKey === periodKey ? null : 'warn';
  // [PCODE-351 | S15 | v0.1.0] and at half, when the warning level is higher
  if (b.warnPct > 50 && usedHours >= b.hours / 2)
    return b.halfKey === periodKey || b.warnedKey === periodKey ? null : 'half';
  return null;
}

/** [PCODE-351 | S15 | v0.1.0] The step a budget has reached: half, its warning level, or full; null below half. */
export function budgetStep(pct: number, warnPct: number): 'half' | 'warn' | 'full' | null {
  if (pct >= 100) return 'full';
  if (pct >= warnPct) return 'warn';
  return warnPct > 50 && pct >= 50 ? 'half' : null;
}
