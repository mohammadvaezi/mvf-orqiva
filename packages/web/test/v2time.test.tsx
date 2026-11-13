// ── [PCODE-187 | S15 | v0.1.0] B7.3 Time live: timer from the active task, weekly timesheets with approval and lock, rates, absences, reports per client ──
//    Why:  the page's small words (day heads, week spans, the running clock, absence spans), the tabs each
//          role gets (billing sees reports only, members no reports), and no inline styles.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TimeHub, clock, dayHead, spanText, weekSpan } from '../src/v2/timepage.js';

describe('time page', () => {
  it('writes days, weeks, clocks and absences briefly', () => {
    expect(dayHead('2026-09-29', 1)).toBe('Tue 29');
    expect(weekSpan(['2026-09-28', '2026-09-29', '2026-10-02'])).toBe('28 Sep – 2 Oct');
    expect(clock(2 * 3600_000 + 14 * 60_000 + 8_000)).toBe('2:14:08');
    expect(spanText({ startsOn: '2026-10-06', endsOn: '2026-10-07', halfDay: false })).toBe(
      'Tue 6 Oct – Wed 7 Oct',
    );
    expect(spanText({ startsOn: '2026-10-17', endsOn: '2026-10-17', halfDay: true })).toBe(
      'Sat 17 Oct · half a day',
    );
  });

  it('shows each role its tabs, without inline styles', () => {
    const page = (role: string) => renderToString(<TimeHub workspaceId="w" role={role} />);
    expect(page('member')).toContain('My time');
    expect(page('member')).not.toContain('Reports and billing');
    expect(page('billing')).toContain('Reports and billing');
    expect(page('billing')).not.toContain('My time');
    expect(page('owner')).toContain('Reports and billing');
    expect(page('owner')).not.toContain('style=');
  });
});
