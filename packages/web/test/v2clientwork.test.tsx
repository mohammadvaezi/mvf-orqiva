// ── [PCODE-338 | S15 | v0.1.0] T34.1c Meeting notes and actions into tasks; the team's client overview with health, revenue, activity and people ──
//    Why:  the editor counts the action items the server will take from the notes.
import { describe, expect, it } from 'vitest';
import { actionLines } from '../src/v2/clientwork.js';

describe('meeting notes', () => {
  it('counts open action lines, not ticked ones', () => {
    expect(actionLines('- [ ] One\n- [x] Done\nAction: Two\nTODO: three\njust text')).toBe(3);
    expect(actionLines('')).toBe(0);
  });
});
