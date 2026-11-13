// ── [PCODE-352 | S15 | v0.1.0] T35.3c Policies for approvals, budgets and data, with a dry run ──
//    Why:  a workspace sets rules the server keeps, whatever a person or an agent does: what may enter a
//          sprint, what agents may never do, how much one agent run may use, what data never leaves for an
//          AI provider. The catalogue says what each rule takes; server and web agree on it here.
import { maskPersonal } from './testdata.js';

export const POLICY_RULES = {
  sprint_requires_criteria: {
    kind: 'approval',
    title: 'Tasks without acceptance criteria cannot enter a sprint',
  },
  agents_no_merge: {
    kind: 'approval',
    title: 'Agents may not merge',
  },
  run_token_cap: {
    kind: 'budget',
    title: 'An agent run stops at a number of tokens',
  },
  mask_personal_data: {
    kind: 'data',
    title: 'Personal data is masked before it goes to an AI provider',
  },
} as const;

export type WorkspaceRule = keyof typeof POLICY_RULES;
export const isWorkspaceRule = (r: string): r is WorkspaceRule => r in POLICY_RULES;

/** Why a rule's parameters do not fit it, or null. */
export function policyProblem(rule: WorkspaceRule, params: Record<string, unknown>): string | null {
  if (rule === 'run_token_cap') {
    const n = params['maxTokens'];
    return typeof n === 'number' && Number.isInteger(n) && n >= 1000 && n <= 10_000_000
      ? null
      : 'The cap is a number of tokens from 1 000 to 10 000 000';
  }
  return Object.keys(params).length ? 'This rule takes no settings' : null;
}

/** The rule in words, with its setting. */
export function policyText(rule: WorkspaceRule, params: Record<string, unknown>): string {
  if (rule === 'run_token_cap')
    return (
      'An agent run stops at ' +
      Number(params['maxTokens'] ?? 0).toLocaleString('de-DE') +
      ' tokens'
    );
  return POLICY_RULES[rule].title;
}

interface MessageLike {
  role: string;
  content: ({ type: string; text?: string; content?: string } & Record<string, unknown>)[];
}

/** The messages with personal data masked in what people and tools wrote; how many places were masked. */
export function maskMessages<T extends MessageLike>(
  messages: readonly T[],
): { messages: T[]; masked: number } {
  let masked = 0;
  const out = messages.map((m) => {
    if (m.role !== 'user') return m;
    return {
      ...m,
      content: m.content.map((b) => {
        if (b.type === 'text' && typeof b.text === 'string') {
          const r = maskPersonal(b.text);
          masked += r.count;
          return { ...b, text: r.text };
        }
        if (b.type === 'tool_result' && typeof b.content === 'string') {
          const r = maskPersonal(b.content);
          masked += r.count;
          return { ...b, content: r.text };
        }
        return b;
      }),
    };
  });
  return { messages: out, masked };
}
