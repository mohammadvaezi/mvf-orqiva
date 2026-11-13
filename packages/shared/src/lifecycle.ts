// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-117 | S15 | v0.1.0] Build the lifecycle engine: phases, stages, gates, criteria, sign-off, live ──
//    Why:  the shape of a lifecycle, the same for server and screens: phases in order, stages inside a
//          phase, and an optional gate after a phase with the criteria it checks and the role that signs.
//          The default is the plan's: 14 stages in four phases, three gates (G1 go / no-go, G2 environment
//          ready, G3 quality gate).

export type SignerRole = 'owner' | 'admin' | 'member';

export interface StageDef {
  key: string;
  name: string;
  /** the agent that drafts the work (T08 runs them) */
  agent: string;
  /** who owns the decision in this stage */
  owner: string;
}

export interface GateDef {
  key: string;
  name: string;
  signer: SignerRole;
  criteria: { key: string; text: string }[];
}

export interface PhaseDef {
  key: string;
  name: string;
  stages: StageDef[];
  gate?: GateDef;
}

export interface LifecycleDef {
  phases: PhaseDef[];
}

export const DEFAULT_LIFECYCLE_NAME = 'Orqiva default';

export const DEFAULT_LIFECYCLE: LifecycleDef = {
  phases: [
    {
      key: 'discover',
      name: 'Discover',
      stages: [
        { key: 'ideation', name: 'Ideation', agent: 'Analyst agent', owner: 'Product owner' },
        {
          key: 'interview',
          name: 'Owner interview',
          agent: 'Interviewer agent',
          owner: 'Product owner',
        },
        { key: 'proposal', name: 'Proposal', agent: 'Architect agent', owner: 'Tech lead' },
        { key: 'approval', name: 'Approval', agent: 'none', owner: 'Owner' },
      ],
      gate: {
        key: 'g1',
        name: 'G1 Go / no-go',
        signer: 'owner',
        criteria: [
          { key: 'proposal', text: 'Proposal written and shared with the owner' },
          { key: 'budget', text: 'Budget and timeline agreed' },
          { key: 'plan', text: 'First plan of sprints drafted' },
          { key: 'risks', text: 'Main risks listed with an answer for each' },
        ],
      },
    },
    {
      key: 'plan',
      name: 'Plan and set up',
      stages: [
        {
          key: 'sprint-planning',
          name: 'Sprint planning',
          agent: 'Planner agent',
          owner: 'Tech lead',
        },
        {
          key: 'infrastructure',
          name: 'Infrastructure',
          agent: 'DevOps agent',
          owner: 'Platform engineer',
        },
      ],
      gate: {
        key: 'g2',
        name: 'G2 Environment ready',
        signer: 'admin',
        criteria: [
          {
            key: 'provisioned',
            text: 'Environments provisioned (development, staging, production)',
          },
          { key: 'verified', text: 'Health checks pass in every environment' },
          { key: 'access', text: 'Access and secrets in place, nothing in the repository' },
          { key: 'backups', text: 'Backups configured and one restore tried' },
        ],
      },
    },
    {
      key: 'build',
      name: 'Build and verify',
      stages: [
        { key: 'development', name: 'Development', agent: 'Developer agents', owner: 'Developers' },
        { key: 'test', name: 'Test', agent: 'Tester agent', owner: 'QA' },
        {
          key: 'security',
          name: 'Security check',
          agent: 'Security agent',
          owner: 'Security lead',
        },
        {
          key: 'compliance',
          name: 'Compliance check',
          agent: 'Compliance agent',
          owner: 'Compliance lead',
        },
        { key: 'review', name: 'Review', agent: 'Reviewer agent', owner: 'Tech lead' },
      ],
      gate: {
        key: 'g3',
        name: 'G3 Quality gate',
        signer: 'admin',
        criteria: [
          { key: 'tests', text: 'All tests pass' },
          { key: 'security', text: 'No open high or critical security finding' },
          { key: 'compliance', text: 'Compliance checks pass' },
          { key: 'review', text: 'Code review approved' },
        ],
      },
    },
    {
      key: 'ship',
      name: 'Ship and hand over',
      stages: [
        {
          key: 'documentation',
          name: 'Documentation',
          agent: 'Documenter agent',
          owner: 'Tech lead',
        },
        { key: 'release', name: 'Release', agent: 'Release agent', owner: 'Release manager' },
        { key: 'handover', name: 'Handover', agent: 'none', owner: 'Client' },
      ],
    },
  ],
};

const KEY = /^[a-z][a-z0-9-]{0,39}$/;

/** What is wrong with a definition, as readable sentences; empty when it is fine. */
export function lifecycleProblems(def: LifecycleDef): string[] {
  const out: string[] = [];
  if (!Array.isArray(def.phases) || def.phases.length === 0)
    return ['A lifecycle needs at least one phase.'];
  if (def.phases.length > 12) out.push('At most 12 phases.');
  const phaseKeys = new Set<string>();
  const stageKeys = new Set<string>();
  const gateKeys = new Set<string>();
  for (const p of def.phases) {
    if (!KEY.test(p.key))
      out.push('Phase key "' + p.key + '" must be lower case letters, digits and dashes.');
    if (phaseKeys.has(p.key)) out.push('Phase key "' + p.key + '" is used twice.');
    phaseKeys.add(p.key);
    if (!p.name.trim()) out.push('Every phase needs a name.');
    if (p.stages.length === 0) out.push('Phase "' + p.name + '" needs at least one stage.');
    if (p.stages.length > 20) out.push('Phase "' + p.name + '" has more than 20 stages.');
    for (const st of p.stages) {
      if (!KEY.test(st.key))
        out.push('Stage key "' + st.key + '" must be lower case letters, digits and dashes.');
      if (stageKeys.has(st.key)) out.push('Stage key "' + st.key + '" is used twice.');
      stageKeys.add(st.key);
      if (!st.name.trim()) out.push('Every stage needs a name.');
    }
    if (p.gate) {
      const g = p.gate;
      if (!KEY.test(g.key))
        out.push('Gate key "' + g.key + '" must be lower case letters, digits and dashes.');
      if (gateKeys.has(g.key)) out.push('Gate key "' + g.key + '" is used twice.');
      gateKeys.add(g.key);
      if (!g.name.trim()) out.push('Every gate needs a name.');
      if (!['owner', 'admin', 'member'].includes(g.signer))
        out.push('Gate "' + g.name + '" needs a signer role.');
      const ck = new Set<string>();
      for (const c of g.criteria) {
        if (!KEY.test(c.key))
          out.push('Criterion key "' + c.key + '" must be lower case letters, digits and dashes.');
        if (ck.has(c.key))
          out.push('Criterion key "' + c.key + '" is used twice in "' + g.name + '".');
        ck.add(c.key);
        if (!c.text.trim()) out.push('Every criterion needs a text.');
      }
    }
  }
  return out;
}

/** The project's lifecycle as the API answers it. */
export type StageStatus = 'not_started' | 'active' | 'done' | 'skipped';
export type GateStatus = 'locked' | 'open' | 'ready' | 'approved' | 'rejected';

export interface LifecycleState {
  templateName: string;
  startedAt: string;
  /** the phase work happens in: the first phase whose gate is not approved */
  currentPhase: string;
  phases: {
    key: string;
    name: string;
    stages: {
      id: string;
      key: string;
      name: string;
      agent: string;
      owner: string;
      status: StageStatus;
      startedAt: string | null;
      finishedAt: string | null;
      note: string;
      /** why it cannot start now, when it cannot */
      blockedBy: string | null;
    }[];
    gate: {
      key: string;
      name: string;
      signer: SignerRole;
      status: GateStatus;
      /** what still stands in the way of approval */
      missing: string[];
      criteria: {
        id: string;
        key: string;
        text: string;
        met: boolean;
        evidence: string;
        metBy: string | null;
        metAt: string | null;
      }[];
      signoffs: {
        decision: 'approve' | 'reject' | 'reopen';
        note: string;
        by: string;
        at: string;
      }[];
    } | null;
  }[];
}
