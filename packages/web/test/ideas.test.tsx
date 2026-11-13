// ── [PCODE-126 | S15 | v0.1.0] Show ideas, the interview, proposals and signing in the web app ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  IdeaStepper,
  ProposalEditor,
  ProposalView,
  SignDialog,
  ideaStage,
  type Proposal,
} from '../src/ideas.js';
import { appRoute } from '../src/core/nav.js';

const ID = '11111111-1111-4111-8111-111111111111';
const text = (html: string): string => html.replace(/<!-- -->/g, '');
const proposal: Proposal = {
  id: 'p1',
  version: 2,
  content: {
    summary: 'CSV export.',
    problem: 'Finance retypes numbers.',
    goals: ['No retyping'],
    scopeIn: ['Monthly report'],
    scopeOut: [],
    risks: ['Large files'],
    tasks: [
      { title: 'Export endpoint', estimate: 3, description: 'Stream rows' },
      { title: 'Button', estimate: 2, description: '' },
    ],
  },
  estimate: { points: 5, days: 1 },
  source: 'person',
  author: 'Ada',
  runId: null,
  createdAt: '2026-10-03T10:00:00Z',
};

describe('idea pages', () => {
  it('have their own addresses', () => {
    expect(appRoute('/projects/' + ID + '/ideas')).toEqual({
      kind: 'project',
      id: ID,
      view: 'ideas',
    });
    expect(appRoute('/ideas/' + ID)).toEqual({ kind: 'idea', id: ID });
  });

  it('place an idea in its stage', () => {
    expect(ideaStage({ status: 'new', interviewDone: false })).toBe(0);
    expect(ideaStage({ status: 'interviewing', interviewDone: false })).toBe(1);
    expect(ideaStage({ status: 'interviewing', interviewDone: true })).toBe(2);
    expect(ideaStage({ status: 'proposed', interviewDone: true })).toBe(3);
    expect(ideaStage({ status: 'approved', interviewDone: true })).toBe(4);
    const html = renderToString(<IdeaStepper idea={{ status: 'proposed', interviewDone: true }} />);
    expect(html.match(/pe-idea-step--done/g)).toHaveLength(3);
    expect(html).toContain('aria-current="step"');
  });
});

describe('a proposal', () => {
  it('shows its estimate, lists and tasks, and who wrote it', () => {
    const html = text(renderToString(<ProposalView proposal={proposal} go={() => undefined} />));
    expect(html).toContain('Story points');
    expect(html).toContain('Export endpoint');
    expect(html).toContain('Large files');
    expect(html).toContain('Version 2 · edited by Ada');
    expect(html).not.toContain('Out of scope');
  });

  it('is edited with the estimate kept up to date', () => {
    const html = text(
      renderToString(
        <ProposalEditor
          initial={proposal.content}
          onSave={() => Promise.resolve(null)}
          onCancel={() => undefined}
        />,
      ),
    );
    expect(html).toContain('Tasks · 5 points, 1 days');
    expect(html).toContain('Save as a new version');
  });

  it('is signed only with consent and a typed name', () => {
    const html = text(
      renderToString(
        <SignDialog
          decision="approve"
          version={2}
          estimate={{ points: 5, days: 1 }}
          myName="Ada Lovelace"
          onSign={() => Promise.resolve(null)}
          onClose={() => undefined}
        />,
      ),
    );
    expect(html).toContain('Approve version 2');
    expect(html).toContain('Type your full name: Ada Lovelace');
    expect(html).toContain('By typing my name I sign');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Sign and approve/);
  });
});
