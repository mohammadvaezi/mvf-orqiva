// ── [PCODE-277 | S15 | v0.1.0] T28.6 PRD approval by named approvers, reopen on edit, promote to an epic with stories, client in ideation ──
//    Why:  who is still to decide, what a contact sees of a PRD's state, and the review panel's actions for
//          an approver and for the team.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReviewPanel, reviewSummary, type Review } from '../src/prdreview.js';
import { prdStateText } from '../src/v2/portalprd.js';

const review = (over: Partial<Review> = {}): Review => ({
  status: 'in_review',
  version: 2,
  approvers: [
    {
      userId: 'c',
      name: 'Cy',
      kind: 'team',
      decision: 'approved',
      signedName: 'Cy',
      note: '',
      at: 'x',
    },
    {
      userId: 'i',
      name: 'Ines',
      kind: 'client',
      decision: null,
      signedName: '',
      note: '',
      at: null,
    },
  ],
  versions: [
    { version: 2, state: 'in_review' },
    { version: 1, state: 'superseded' },
  ],
  mayDecide: false,
  promoted: null,
  ...over,
});
const text = (html: string): string => html.replace(/<!-- -->/g, '');

describe('the PRD review', () => {
  it('says how many approved and who is still to decide', () => {
    expect(reviewSummary(review())).toBe('1 of 2 approved · waiting for Ines');
    expect(
      prdStateText({ status: 'in_review', myDecision: 'approved', approvers: review().approvers }),
    ).toBe('You approved · waiting for Ines');
    expect(prdStateText({ status: 'in_review', myDecision: null, approvers: [] })).toBe(
      'Waiting for your decision',
    );
    expect(prdStateText({ status: 'approved', myDecision: 'approved', approvers: [] })).toBe(
      'Approved by everyone named',
    );
  });

  it('shows the approvers and asks again; an approver gets the signature form', () => {
    const team = text(
      renderToString(
        <ReviewPanel
          workspaceId="w"
          ideaId="i1"
          review={review()}
          canEdit
          myName="Ada Lovelace"
          onChanged={() => Promise.resolve()}
          go={() => undefined}
        />,
      ),
    );
    expect(team).toContain('approved, signed “Cy”');
    expect(team).toContain('to decide');
    expect(team).toContain('Ask them again');
    expect(team).not.toContain('Approve and sign');
    const approver = text(
      renderToString(
        <ReviewPanel
          workspaceId="w"
          ideaId="i1"
          review={review({ mayDecide: true })}
          canEdit={false}
          myName="Ines"
          onChanged={() => Promise.resolve()}
          go={() => undefined}
        />,
      ),
    );
    expect(approver).toContain('Your decision on version 2');
    expect(approver).toContain('Ask for changes');
    const approved = text(
      renderToString(
        <ReviewPanel
          workspaceId="w"
          ideaId="i1"
          review={review({ status: 'approved' })}
          canEdit
          myName="Ada"
          onChanged={() => Promise.resolve()}
          go={() => undefined}
        />,
      ),
    );
    expect(approved).toContain('Promote to an epic');
  });
});
