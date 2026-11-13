// ── [PCODE-333 | S15 | v0.1.0] T33.4b Sandbox per run with repo tools, pull requests by a bot Git identity ──
//    Why:  a sandbox file says how many lines it adds and removes against the repository.
import { describe, expect, it } from 'vitest';
import { changeCount } from '../src/v2/sandbox.js';

describe('sandbox files', () => {
  it('counts added and removed lines', () => {
    expect(changeCount(null, '# New\nline')).toBe('+2');
    expect(changeCount('a\nb\nc', 'a\nB\nc\nd')).toBe('+2 −1');
    expect(changeCount('same', 'same')).toBe('+0');
  });
});
