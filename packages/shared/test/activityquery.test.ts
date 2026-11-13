// ── [PCODE-183 | S15 | v0.1.0] B6.1 Activity at scale live: search, query language, facets, histogram, saved views, export, archive, hash chain, webhooks ──
import { describe, expect, it } from 'vitest';
import {
  collapseRepeats,
  formatActivityQuery,
  parseActivityQuery,
  spanHours,
  toCsv,
} from '../src/activityquery.js';

describe('activity query language', () => {
  it('reads fields, negation, quotes, spans and the archive', () => {
    const q = parseActivityQuery(
      'actor:agent project:APP -verb:progressed kind:item "live tracking" since:24h in:archive',
    );
    expect(q.terms).toEqual([
      { field: 'actor', value: 'agent', not: false },
      { field: 'project', value: 'app', not: false },
      { field: 'verb', value: 'progressed', not: true },
      { field: 'type', value: 'item', not: false },
      { field: 'text', value: 'live tracking', not: false },
    ]);
    expect([q.sinceHours, q.archive, q.errors]).toEqual([24, true, []]);
    expect(parseActivityQuery('colour:red since:soon actor:').errors).toEqual([
      'Unknown field colour: use actor, project, type, verb, since or in',
      'since takes a span like 30m, 24h, 7d or 2w',
      'actor needs a value',
    ]);
    expect([spanHours('30m'), spanHours('2w'), spanHours('x')]).toEqual([0.5, 336, null]);
    expect(formatActivityQuery(parseActivityQuery('actor:"Ada L" -verb:x since:7d'))).toBe(
      'actor:"ada l" -verb:x since:168h',
    );
  });

  it('collapses repeats and writes safe CSV', () => {
    const e = (actorId: string, verb: string, minute: number) => ({
      actorId,
      verb,
      objectType: 'agent_run',
      time: new Date(Date.UTC(2026, 9, 5, 8, minute)).toISOString(),
    });
    expect(
      collapseRepeats([
        e('a', 'progressed', 0),
        e('a', 'progressed', 2),
        e('a', 'progressed', 4),
        e('b', 'created', 5),
        e('a', 'progressed', 30),
      ]),
    ).toEqual([2, -1, -1, 0, 0]);
    expect(
      toCsv([
        ['when', 'what'],
        ['=SUM(A1)', 'say "hi"'],
      ]),
    ).toBe('"when","what"\r\n"\'=SUM(A1)","say ""hi"""\r\n');
  });
});
