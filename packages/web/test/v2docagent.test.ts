// ── [PCODE-198 | S15 | v0.1.0] T16.2 Documenter agent: document tools with knowledge scopes, agent-written drafts, Ask the Documenter ──
//    Why:  what "Ask the Documenter" asks for: a runbook names its operation, the other kinds take the note
//          as an extra, and every instruction asks to read first and name the files.
import { describe, expect, it } from 'vitest';
import { DOC_ASKS, documenterInstruction } from '../src/v2/documents.js';

describe('Ask the Documenter', () => {
  it('words each kind of request', () => {
    expect(DOC_ASKS.map((a) => a.key)).toEqual(['runbook', 'architecture', 'handover', 'other']);
    expect(documenterInstruction('runbook', 'a rollback')).toMatch(
      /^Write a runbook \(a page titled "Runbook: …"\) for a rollback: /,
    );
    expect(documenterInstruction('handover', 'mention the SLA')).toContain(
      '"Handover readme" for the client',
    );
    expect(documenterInstruction('handover', 'mention the SLA')).toContain('Also: mention the SLA');
    expect(documenterInstruction('other', 'Explain the billing jobs')).toBe(
      'Explain the billing jobs Read the pages you may read first and name the repository files you describe.',
    );
  });
});
