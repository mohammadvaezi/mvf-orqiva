// ── [PCODE-332 | S15 | v0.1.0] T33.4a Nested traces with latency and commits, agent rate limits, provider limits and health ──
//    Why:  a tool result sits under its model turn with its own time and each tool's; a connection's
//          health and limits read in one line.
import { describe, expect, it } from 'vitest';
import { healthLine } from '../src/aiproviders.js';
import { traceOf } from '../src/v2/agentspage.js';

describe('nested traces', () => {
  it('marks steps under a turn and keeps their times', () => {
    const base = { tokensIn: 0, tokensOut: 0, costMicros: 0 };
    const lines = traceOf(
      {
        createdAt: '2026-10-15T08:00:00Z',
        startedAt: '2026-10-15T08:00:00Z',
        finishedAt: '2026-10-15T08:00:05Z',
      },
      [
        {
          ...base,
          seq: 1,
          kind: 'model',
          content: { blocks: [] },
          at: '2026-10-15T08:00:02Z',
          latencyMs: 1800,
        },
        {
          ...base,
          seq: 2,
          kind: 'tool_result',
          content: {
            results: [],
            durations: [
              { toolUseId: 'a', tool: 'list_items', ms: 40 },
              { toolUseId: 'b', tool: 'get_item', ms: 12 },
            ],
          },
          at: '2026-10-15T08:00:03Z',
          latencyMs: 52,
          parentSeq: 1,
        },
      ],
    );
    expect(lines.map((l) => [l.nested, l.latencyMs])).toEqual([
      [false, 1800],
      [true, 52],
    ]);
    expect(lines[1]?.tools).toEqual([
      { tool: 'list_items', ms: 40 },
      { tool: 'get_item', ms: 12 },
    ]);
  });
});

describe('connection health', () => {
  it('says how a connection is doing and what limits it has', () => {
    expect(healthLine({})).toBe('');
    expect(
      healthLine({
        health: { status: 'ok', calls: 42, failures: 1, avgMs: 1234, maxMs: 4000 },
        requestsPerMinute: 60,
        tokensPerMinute: 100000,
      }),
    ).toBe(
      'working · 42 calls, 1 failed in 2 days · 1,2 s on average · at most 60 calls and 100.000 tokens a minute',
    );
    expect(
      healthLine({ health: { status: 'unused', calls: 0, failures: 0, avgMs: null, maxMs: null } }),
    ).toBe('unused');
  });
});
