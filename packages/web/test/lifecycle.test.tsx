// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-118 | S15 | v0.1.0] Show and drive the lifecycle in the web app: stepper, stages, gate checklist and sign-off ──
import type { LifecycleState } from '@orqiva/shared';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LifecycleView, maySign, phaseState } from '../src/lifecycle.js';
import { appRoute } from '../src/core/nav.js';

const stage = (
  key: string,
  status: 'not_started' | 'active' | 'done' | 'skipped',
  blockedBy: string | null = null,
) => ({
  id: 'id-' + key,
  key,
  name: key.charAt(0).toUpperCase() + key.slice(1),
  agent: 'Analyst agent',
  owner: 'Product owner',
  status,
  startedAt: null,
  finishedAt: null,
  note: '',
  blockedBy,
});

const life: LifecycleState = {
  templateName: 'Orqiva default',
  startedAt: '2026-10-03T10:00:00Z',
  currentPhase: 'discover',
  phases: [
    {
      key: 'discover',
      name: 'Discover',
      stages: [stage('ideation', 'done'), stage('approval', 'active')],
      gate: {
        key: 'g1',
        name: 'G1 Go / no-go',
        signer: 'owner',
        status: 'open',
        missing: ['Stage Approval is not finished', 'Not met: Budget agreed'],
        criteria: [
          {
            id: 'c1',
            key: 'proposal',
            text: 'Proposal shared',
            met: true,
            evidence: 'docs/proposal.md',
            metBy: 'Ada',
            metAt: '2026-10-03T10:00:00Z',
          },
          {
            id: 'c2',
            key: 'budget',
            text: 'Budget agreed',
            met: false,
            evidence: '',
            metBy: null,
            metAt: null,
          },
        ],
        signoffs: [
          { decision: 'reject', note: 'Too expensive', by: 'Ada', at: '2026-10-03T11:00:00Z' },
        ],
      },
    },
    {
      key: 'plan',
      name: 'Plan and set up',
      stages: [stage('sprint-planning', 'not_started', 'Waiting for the gate before this phase')],
      gate: {
        key: 'g2',
        name: 'G2 Environment ready',
        signer: 'admin',
        status: 'locked',
        missing: [],
        criteria: [],
        signoffs: [],
      },
    },
  ],
};

const view = (role: string): string =>
  renderToString(
    <LifecycleView
      life={life}
      role={role}
      canEdit={role !== 'guest'}
      canAdmin={role === 'owner' || role === 'admin'}
      onStage={() => undefined}
      onCriterion={() => undefined}
      onDecision={() => undefined}
    />,
  ).replace(/<!-- -->/g, '');

describe('the lifecycle in the web app', () => {
  it('has its own tab address', () => {
    expect(appRoute('/projects/0b6f2f43-7d6e-4f6c-9a39-2f1e3c4d5e6f/lifecycle')).toMatchObject({
      view: 'lifecycle',
    });
  });

  it('knows who signs which gate', () => {
    expect(maySign('owner', 'owner')).toBe(true);
    expect(maySign('admin', 'owner')).toBe(false);
    expect(maySign('admin', 'admin')).toBe(true);
    expect(maySign('member', 'admin')).toBe(false);
    expect(maySign('member', 'member')).toBe(true);
    expect(maySign('guest', 'member')).toBe(false);
  });

  it('draws the phases with their gates, the current one marked', () => {
    const [discover, plan] = life.phases;
    if (!discover || !plan) throw new Error('fixture');
    expect(phaseState(discover, 'discover')).toBe('current');
    expect(phaseState(plan, 'discover')).toBe('waiting');
    const html = view('owner');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('G1 · Open');
    expect(html).toContain('G2 · Waiting');
  });

  it('shows why a stage cannot start and what the gate still misses, and keeps Approve off until complete', () => {
    const html = view('owner');
    expect(html).toContain('Waiting for the gate before this phase');
    expect(html).toContain('Not met: Budget agreed');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Approve<\/button>/);
    expect(html).toContain('>Reject</button>');
    expect(html).toContain('value="docs/proposal.md"');
    expect(html).toContain('Too expensive');
  });

  it('offers signing only to the gate’s role, and nothing to a guest', () => {
    expect(view('admin')).toContain('An owner signs this gate.');
    expect(view('admin')).not.toContain('>Approve</button>');
    const guest = view('guest');
    expect(guest).not.toContain('>Start</button>');
    expect(guest).not.toContain('>Mark done</button>');
  });
});
