// ── [PCODE-350 | S15 | v0.1.0] T35.3a Templates library for projects, PRDs, sprints and agents ──
//    Why:  each template says in a few words what it holds.
import { describe, expect, it } from 'vitest';
import { templateContents } from '../src/v2/templatelibrary.js';

describe('templates library', () => {
  it('says what a template holds', () => {
    expect(
      templateContents({ kind: 'project', body: { labels: [1, 2], epics: [1], settings: {} } }),
    ).toBe('the standard board · 2 labels · 1 epics');
    expect(
      templateContents({
        kind: 'project',
        body: { states: [1, 2, 3], labels: [], epics: [], settings: {} },
      }),
    ).toBe('3 states · 0 labels · 0 epics');
    expect(
      templateContents({ kind: 'sprint', body: { days: 14, goal: '', tasks: ['a', 'b'] } }),
    ).toBe('14 days · 2 tasks');
    expect(
      templateContents({ kind: 'prd', body: { ideaKind: 'change_request', sections: [1] } }),
    ).toBe('1 sections for change request ideas');
  });
});
