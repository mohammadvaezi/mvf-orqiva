// ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
//    Why:  the small rules of client requests, shared by server, web and IDE: how a request is numbered
//          (CR-9), the steps the client sees, whether the first answer is late, which portal roles may
//          file or approve, and the exact text a signature on a change's impact covers.

export const REQUEST_KINDS = ['bug', 'change', 'feature', 'question'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_STATES = [
  'new',
  'understood',
  'quoted',
  'planned',
  'in_progress',
  'done',
  'declined',
] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

const PREFIX: Record<RequestKind, string> = {
  bug: 'BUG',
  change: 'CR',
  feature: 'F',
  question: 'Q',
};

/** The request's reference as the client and the team say it: BUG-31, CR-9. */
export const requestRef = (kind: RequestKind, n: number): string => PREFIX[kind] + '-' + String(n);

/** The steps the client follows, in order. */
export const REQUEST_STEPS = ['Received', 'Understood', 'Planned', 'In progress', 'Done'] as const;

/** How far along the steps a state is (0–4); a declined request stays where it was understood. */
export function stepOf(state: RequestState): number {
  switch (state) {
    case 'new':
      return 0;
    case 'understood':
    case 'quoted':
    case 'declined':
      return 1;
    case 'planned':
      return 2;
    case 'in_progress':
      return 3;
    case 'done':
      return 4;
  }
}

export const STATE_TEXT: Record<RequestState, string> = {
  new: 'Received',
  understood: 'Understood',
  quoted: 'Quoted · waiting for approval',
  planned: 'Planned',
  in_progress: 'In progress',
  done: 'Done',
  declined: 'Declined',
};

export const DEFAULT_RESPONSE_HOURS: Record<RequestKind, number> = {
  bug: 4,
  change: 24,
  feature: 24,
  question: 24,
};

const span = (ms: number): string => {
  const h = Math.round(ms / 3_600_000);
  if (h < 1) return String(Math.max(1, Math.round(ms / 60_000))) + ' min';
  if (h < 48) return String(h) + ' h';
  return String(Math.round(h / 24)) + ' days';
};

/** Whether the first answer is (or was) late, and how to say it. */
export function responseState(
  dueAt: Date,
  firstResponseAt: Date | null,
  createdAt: Date,
  now = new Date(),
): { late: boolean; text: string } {
  if (firstResponseAt)
    return {
      late: firstResponseAt > dueAt,
      text: 'answered in ' + span(firstResponseAt.getTime() - createdAt.getTime()),
    };
  const left = dueAt.getTime() - now.getTime();
  return left >= 0
    ? { late: false, text: 'first answer within ' + span(left) }
    : { late: true, text: span(-left) + ' late' };
}

export type PortalRole =
  'sponsor' | 'approver' | 'product_owner' | 'tester' | 'requester' | 'viewer';

/** Everyone but a viewer may file a request and write in its thread. */
export const mayFileRequest = (roles: readonly string[]): boolean =>
  roles.some((r) => r !== 'viewer');

/** Sponsors, approvers and product owners approve a change's cost and schedule. */
export const mayApproveChange = (roles: readonly string[]): boolean =>
  roles.some((r) => r === 'sponsor' || r === 'approver' || r === 'product_owner');

export interface ChangeImpact {
  points: number;
  priceCents: number;
  days: number;
}

/** The exact text a signature covers; its SHA-256 is the version kept with the approval. */
export const impactText = (ref: string, title: string, i: ChangeImpact): string =>
  [
    ref,
    title,
    String(i.points) + ' points',
    String(i.priceCents) + ' cents',
    String(i.days) + ' days',
  ].join('\n');
