// ── [PCODE-352 | S15 | v0.1.0] T35.3c Policies for approvals, budgets and data, with a dry run ──
//    Why:  a rule takes only its own setting; the masked messages keep everything but people's data.
import { describe, expect, it } from 'vitest';
import { maskMessages, policyProblem, policyText } from '../src/policies.js';

describe('policies', () => {
  it('checks a rule’s setting and says it in words', () => {
    expect(policyProblem('run_token_cap', { maxTokens: 200000 })).toBeNull();
    expect(policyProblem('run_token_cap', { maxTokens: 10 })).toContain('from 1 000');
    expect(policyProblem('agents_no_merge', { x: 1 })).toBe('This rule takes no settings');
    expect(policyText('run_token_cap', { maxTokens: 200000 })).toBe(
      'An agent run stops at 200.000 tokens',
    );
  });
  it('masks people’s and tools’ text, not the assistant’s', () => {
    const { messages, masked } = maskMessages([
      { role: 'user', content: [{ type: 'text', text: 'Write to ada@example.test' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'I will mail bob@example.test' }] },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't', content: 'IBAN DE89 3704 0044 0532 0130 00' },
        ],
      },
    ]);
    expect(masked).toBe(2);
    expect(messages[0]?.content[0]).toEqual({ type: 'text', text: 'Write to [email]' });
    expect(messages[1]?.content[0]).toEqual({ type: 'text', text: 'I will mail bob@example.test' });
    expect(JSON.stringify(messages[2])).not.toContain('3704');
  });
});
