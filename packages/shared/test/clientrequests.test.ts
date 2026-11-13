// ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
import { describe, expect, it } from 'vitest';
import {
  impactText,
  mayApproveChange,
  mayFileRequest,
  requestRef,
  responseState,
  stepOf,
} from '../src/clientrequests.js';

describe('client requests', () => {
  it('numbers requests the way people say them', () => {
    expect(requestRef('change', 9)).toBe('CR-9');
    expect(requestRef('bug', 31)).toBe('BUG-31');
    expect(requestRef('question', 8)).toBe('Q-8');
  });

  it('places each state on the client’s steps', () => {
    expect(stepOf('new')).toBe(0);
    expect(stepOf('quoted')).toBe(1);
    expect(stepOf('in_progress')).toBe(3);
    expect(stepOf('done')).toBe(4);
  });

  it('says whether the first answer is late', () => {
    const created = new Date('2026-10-05T08:00:00Z');
    const due = new Date('2026-10-05T12:00:00Z');
    expect(responseState(due, null, created, new Date('2026-10-05T09:00:00Z'))).toEqual({
      late: false,
      text: 'first answer within 3 h',
    });
    expect(responseState(due, null, created, new Date('2026-10-07T12:00:00Z'))).toEqual({
      late: true,
      text: '2 days late',
    });
    expect(responseState(due, new Date('2026-10-05T11:00:00Z'), created)).toEqual({
      late: false,
      text: 'answered in 3 h',
    });
  });

  it('lets viewers read only, and approvers sign', () => {
    expect(mayFileRequest(['viewer'])).toBe(false);
    expect(mayFileRequest(['viewer', 'tester'])).toBe(true);
    expect(mayApproveChange(['tester'])).toBe(false);
    expect(mayApproveChange(['product_owner'])).toBe(true);
  });

  it('signs exactly the impact shown', () => {
    expect(impactText('CR-9', 'SMS', { points: 8, priceCents: 340000, days: 2 })).toBe(
      'CR-9\nSMS\n8 points\n340000 cents\n2 days',
    );
  });
});
