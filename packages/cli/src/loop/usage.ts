// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
//    Why:  Claude Code writes every model call of a session into its transcript, with the model and the
//          tokens it used. After each turn the hooks read the part of the transcript they have not read
//          yet, add the tokens up per model and report them for the task, so the task's record says which
//          model did the work and what it cost. One model call shows up on several lines (one per content
//          block, same message id); it is counted once.
import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { readJson, writeJson } from './config.js';

export interface ModelUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
}

interface Seen {
  offset: number;
  /** the message ids at the end of the last part read: a call can span the cut */
  last: string[];
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

const MAX_READ = 32 * 1024 * 1024;

/** The tokens of the transcript lines written since the last call, per model; remembers where it stopped. */
export function readTranscriptUsage(transcript: string, stateFile: string): ModelUsage[] {
  if (!existsSync(transcript)) return [];
  const state = readJson<Record<string, Seen>>(stateFile) ?? {};
  const seen = state[transcript] ?? { offset: 0, last: [] };
  const fd = openSync(transcript, 'r');
  let text = '';
  let start = seen.offset;
  try {
    const size = fstatSync(fd).size;
    // a transcript that got shorter is a new one under the same name
    if (size < start) start = 0;
    const length = Math.min(size - start, MAX_READ);
    if (length <= 0) return [];
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, start);
    text = buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
  // only whole lines: the one being written stays for the next time
  const end = text.lastIndexOf('\n');
  if (end < 0) return [];
  const whole = text.slice(0, end + 1);
  const calls = new Map<string, { model: string; usage: Usage }>();
  for (const line of whole.split('\n')) {
    if (!line.trim()) continue;
    let v: { type?: string; message?: { id?: string; model?: string; usage?: Usage } };
    try {
      v = JSON.parse(line) as typeof v;
    } catch {
      continue;
    }
    const m = v.message;
    if (v.type !== 'assistant' || !m?.usage || !m.id || !m.model || m.model === '<synthetic>')
      continue;
    calls.set(m.id, { model: m.model, usage: m.usage });
  }
  const before = new Set(seen.last);
  const byModel = new Map<string, ModelUsage>();
  for (const [id, { model, usage }] of calls) {
    if (before.has(id)) continue;
    const u = byModel.get(model) ?? {
      model,
      tokensIn: 0,
      tokensOut: 0,
      cacheRead: 0,
      cacheWrite: 0,
    };
    u.tokensIn += usage.input_tokens ?? 0;
    u.tokensOut += usage.output_tokens ?? 0;
    u.cacheRead += usage.cache_read_input_tokens ?? 0;
    u.cacheWrite += usage.cache_creation_input_tokens ?? 0;
    byModel.set(model, u);
  }
  state[transcript] = {
    offset: start + Buffer.byteLength(whole, 'utf8'),
    last: [...calls.keys()].slice(-50),
  };
  // the files of a few dozen sessions are plenty to remember
  const keys = Object.keys(state);
  for (const k of keys.slice(0, Math.max(0, keys.length - 40))) Reflect.deleteProperty(state, k);
  writeJson(stateFile, state);
  return [...byModel.values()].filter((u) => u.tokensIn + u.tokensOut + u.cacheRead + u.cacheWrite);
}
