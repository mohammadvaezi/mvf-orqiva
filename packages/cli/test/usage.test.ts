// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
//    Why:  the transcript as Claude Code writes it: one model call on several lines counts once, each
//          model on its own, only what was written since the last read, a line still being written waits.
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTranscriptUsage } from '../src/loop/usage.js';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orq-usage-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const call = (id: string, model: string, i: number, o: number, cr = 0, cw = 0): string =>
  JSON.stringify({
    type: 'assistant',
    message: {
      id,
      model,
      usage: {
        input_tokens: i,
        output_tokens: o,
        cache_read_input_tokens: cr,
        cache_creation_input_tokens: cw,
      },
    },
  }) + '\n';

describe('the tokens in a Claude Code transcript', () => {
  it('counts a call once, per model, and only what is new', () => {
    const t = join(dir, 's.jsonl');
    const state = join(dir, 'usage.json');
    writeFileSync(
      t,
      JSON.stringify({ type: 'user', message: { content: 'hi' } }) +
        '\n' +
        call('m1', 'claude-opus-5-5', 10, 5, 1000, 200) +
        call('m1', 'claude-opus-5-5', 10, 5, 1000, 200) + // the same call, a second content block
        call('m2', 'claude-haiku-5-5', 3, 1),
    );
    expect(readTranscriptUsage(t, state)).toEqual([
      { model: 'claude-opus-5-5', tokensIn: 10, tokensOut: 5, cacheRead: 1000, cacheWrite: 200 },
      { model: 'claude-haiku-5-5', tokensIn: 3, tokensOut: 1, cacheRead: 0, cacheWrite: 0 },
    ]);
    expect(readTranscriptUsage(t, state)).toEqual([]);
    // the next turn, and a line still being written
    appendFileSync(t, call('m2', 'claude-haiku-5-5', 3, 1) + call('m3', 'claude-opus-5-5', 7, 2));
    appendFileSync(t, '{"type":"assistant","message":{"id":"m4"');
    expect(readTranscriptUsage(t, state)).toEqual([
      { model: 'claude-opus-5-5', tokensIn: 7, tokensOut: 2, cacheRead: 0, cacheWrite: 0 },
    ]);
  });

  it('reads nothing from a transcript that is not there, and starts again on a new one', () => {
    const state = join(dir, 'usage.json');
    expect(readTranscriptUsage(join(dir, 'none.jsonl'), state)).toEqual([]);
    const t = join(dir, 's.jsonl');
    writeFileSync(
      t,
      call('a', 'claude-sonnet-5-5', 100, 10) + call('b', 'claude-sonnet-5-5', 100, 10),
    );
    expect(readTranscriptUsage(t, state)[0]?.tokensIn).toBe(200);
    writeFileSync(t, call('c', 'claude-sonnet-5-5', 5, 1));
    expect(readTranscriptUsage(t, state)[0]?.tokensIn).toBe(5);
  });
});
