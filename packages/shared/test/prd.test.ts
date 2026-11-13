// ── [PCODE-275 | S15 | v0.1.0] T28.4 PRD: templates per idea kind, citations per statement, version diff, MD, PDF and Word export ──
//    Why:  the template a kind brings, citations found and counted per statement, what changed between two
//          versions, and the Markdown every export starts from.
import { describe, expect, it } from 'vitest';
import {
  citationReport,
  citeParts,
  citesIn,
  prdMarkdown,
  proposalDiff,
  templateOf,
  withoutCites,
  wordDiff,
} from '../src/prd.js';
import { normalProposal, proposalProblems, type ProposalContent } from '../src/proposal.js';

const base: ProposalContent = {
  summary: 'Customers get a reminder the day before [R-1]. Fewer slots are lost.',
  problem: 'Customers forget bookings [S1].',
  goals: ['Fewer no-shows [R-1, R-2]', 'No extra calls'],
  scopeIn: ['SMS the day before [R-1]'],
  scopeOut: ['Reminders to drivers [R-4]'],
  risks: [],
  tasks: [
    { title: 'Send SMS', estimate: 3, description: '' },
    { title: 'Opt-out', estimate: 2, description: '' },
  ],
};

describe('the PRD', () => {
  it('brings the sections of its kind, a feature by default', () => {
    expect(templateOf('bug').map((s) => s.key)).toEqual(['steps', 'expected', 'affected']);
    expect(templateOf('change_request').map((s) => s.title)).toContain('Impact on cost and dates');
    expect(templateOf('nonsense')).toBe(templateOf('feature'));
  });

  it('keeps sections when given and leaves older proposals as they were', () => {
    const withSections = {
      ...base,
      sections: [{ key: 'steps', title: 'Steps', body: ' 1. Open ' }],
    };
    expect(proposalProblems(withSections)).toEqual([]);
    expect(normalProposal(withSections).sections).toEqual([
      { key: 'steps', title: 'Steps', body: '1. Open' },
    ]);
    expect('sections' in normalProposal(base)).toBe(false);
    expect(proposalProblems({ ...base, sections: [{ key: 'x' }] })).toEqual([
      'section 1 needs a key, a title and a body of up to 8000 characters',
    ]);
  });

  it('finds the citations of a statement and counts the uncited ones', () => {
    expect(citesIn('Fewer no-shows [R-1, R-2] and calls [S1] [R-1]')).toEqual(['R-1', 'R-2', 'S1']);
    expect(withoutCites('Fewer no-shows [R-1, R-2].')).toBe('Fewer no-shows.');
    expect(citeParts('A [R-1] b')).toEqual([{ text: 'A ' }, { codes: ['R-1'] }, { text: ' b' }]);
    const r = citationReport(base);
    expect(r.total).toBe(7);
    expect(r.cited).toBe(5);
    expect(r.uncited.map((s) => s.path)).toEqual(['summary.2', 'goals.2']);
  });

  it('shows what changed between two versions, by word and by line', () => {
    expect(wordDiff('the day before', 'two days before')).toEqual([
      { op: 'remove', text: 'the day' },
      { op: 'add', text: 'two days' },
      { op: 'same', text: ' before' },
    ]);
    const next: ProposalContent = {
      ...base,
      goals: ['Fewer no-shows [R-1, R-2]', 'Half the calls'],
      tasks: [{ title: 'Send SMS', estimate: 5, description: '' }],
      sections: [{ key: 'metrics', title: 'Success metrics', body: 'No-shows under 5 %' }],
    };
    const d = proposalDiff(base, next);
    expect(d.filter((x) => x.changed).map((x) => x.part)).toEqual([
      'Goals',
      'Success metrics',
      'Tasks',
    ]);
    expect(d.find((x) => x.part === 'Goals')?.ops).toEqual([
      { op: 'same', text: 'Fewer no-shows [R-1, R-2]' },
      { op: 'remove', text: 'No extra calls' },
      { op: 'add', text: 'Half the calls' },
    ]);
    expect(d.find((x) => x.part === 'Tasks')?.ops).toEqual([
      { op: 'remove', text: 'Send SMS (3 points)' },
      { op: 'remove', text: 'Opt-out (2 points)' },
      { op: 'add', text: 'Send SMS (5 points)' },
    ]);
  });

  it('writes Markdown with stories, tasks and the cited requirements', () => {
    const text = prdMarkdown({
      ref: 'BKG-I1',
      title: 'Booking reminders',
      kind: 'feature',
      version: 2,
      status: 'proposed',
      author: 'Ada',
      date: '12.10.2026',
      content: {
        ...base,
        sections: [{ key: 'metrics', title: 'Success metrics', body: 'Under 5 %' }],
      },
      estimate: { points: 5, days: 1 },
      refs: [
        {
          code: 'R-1',
          text: 'A reminder the day before',
          source: 'S1 Call notes',
          passage: 'remind them',
        },
        { code: 'R-3', text: 'Not cited', source: '', passage: '' },
      ],
      stories: [
        {
          code: 'R-2',
          text: 'As a customer, I want a reminder.',
          persona: 'Customer',
          scenarios: [{ given: 'a booking', when: '18:00', then: 'an SMS goes out' }],
        },
      ],
    });
    expect(text).toContain(
      '# BKG-I1 Booking reminders\n\n_Version 2 · proposed · feature · Ada · 12.10.2026_',
    );
    expect(text).toContain('## Goals\n\n- Fewer no-shows [R-1, R-2]\n- No extra calls');
    expect(text).toContain('## Success metrics\n\nUnder 5 %');
    expect(text).toContain(
      '### R-2 (Customer)\n\nAs a customer, I want a reminder.\n\n- **Given** a booking',
    );
    expect(text).toContain('| Send SMS | 3 |');
    expect(text).toContain('- **R-1** A reminder the day before — S1 Call notes: “remind them”');
    expect(text).not.toContain('Not cited');
  });
});
