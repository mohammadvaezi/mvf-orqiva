// ── [PCODE-355 | S15 | v0.1.0] T35.4c Activity: query autocomplete, columns, group-by, drag to zoom, heat map ──
//    Why:  the query box offers fields and the values in view and takes one in place; events group by who,
//          kind, project or day; a heat map's cells have levels relative to the busiest hour.
import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../src/events.js';
import {
  acceptSuggestion,
  groupEvents,
  heatLevels,
  querySuggestions,
  wordAt,
} from '../src/activityviews.js';

const values = {
  actor: ['Ada Lovelace', 'Bob'],
  project: ['APP', 'OPS'],
  type: ['item', 'agent_run'],
  verb: ['created', 'moved'],
};

describe('query autocomplete', () => {
  it('finds the word at the caret', () => {
    expect(wordAt('since:7d act', 12)).toEqual({ start: 9, word: 'act' });
    expect(wordAt('x ', 2)).toEqual({ start: 2, word: '' });
  });
  it('offers fields, then the values of the field typed', () => {
    expect(querySuggestions('since:7d a', 10, values)).toEqual(['actor:']);
    expect(querySuggestions('actor:a', 7, values)).toEqual(['actor:"Ada Lovelace"']);
    expect(querySuggestions('-project:', 9, values)).toEqual(['-project:APP', '-project:OPS']);
    expect(querySuggestions('since:', 6, values)).toEqual([
      'since:1h',
      'since:24h',
      'since:7d',
      'since:30d',
    ]);
    expect(querySuggestions('', 0, values)).toEqual([]);
    expect(querySuggestions('type:item', 9, values)).toEqual([]);
  });
  it('puts a suggestion in place of the word', () => {
    expect(acceptSuggestion('since:7d act', 12, 'actor:')).toEqual({
      query: 'since:7d actor:',
      caret: 15,
    });
    expect(acceptSuggestion('proj since:7d', 4, 'project:APP')).toEqual({
      query: 'project:APP since:7d',
      caret: 12,
    });
  });
});

describe('groups and the heat map', () => {
  const ev = (who: string, type: string, time: string, projectid?: string) => ({
    event: {
      time,
      ...(projectid ? { projectid } : {}),
      data: {
        actor: { kind: 'user', id: who, name: who },
        verb: 'created',
        object: { type, id: who + time },
      },
    } as unknown as ActivityEvent,
  });
  it('groups by who, largest first, and by day, newest first', () => {
    const hits = [
      ev('Ada', 'item', '2026-10-14T10:00:00Z'),
      ev('Bob', 'item', '2026-10-15T09:00:00Z'),
      ev('Bob', 'agent_run', '2026-10-15T08:00:00Z', 'p1'),
    ];
    expect(
      groupEvents(
        hits,
        'actor',
        () => '',
        (x) => x,
      ).map((g) => [g.key, g.hits.length]),
    ).toEqual([
      ['Bob', 2],
      ['Ada', 1],
    ]);
    expect(
      groupEvents(
        hits,
        'day',
        () => '',
        (x) => x.slice(0, 10),
      ).map((g) => g.key),
    ).toEqual(['2026-10-15', '2026-10-14']);
    expect(
      groupEvents(
        hits,
        'project',
        (id) => (id === 'p1' ? 'APP' : 'No project'),
        (x) => x,
      ).map((g) => g.key),
    ).toEqual(['No project', 'APP']);
    expect(
      groupEvents(
        hits,
        'type',
        () => '',
        (x) => x,
      )[1]?.key,
    ).toBe('agent run');
  });
  it('gives each hour a level against the busiest', () => {
    expect(heatLevels([[0, 1, 4, 8]])).toEqual([[0, 1, 2, 4]]);
    expect(heatLevels([[0, 0]])).toEqual([[0, 0]]);
  });
});
