// ── [PCODE-348 | S15 | v0.1.0] T35.2a Integrations hub; email-in for replies to messages and ideas by email ──
//    Why:  the hub groups integrations in the order the server gives them.
import { describe, expect, it } from 'vitest';
import { groupIntegrations } from '../src/v2/integrations.js';

describe('integrations hub', () => {
  it('groups in order of first appearance', () => {
    const i = (key: string, group: string) => ({
      key,
      name: key,
      group,
      state: 'off' as const,
      detail: '',
      where: null,
    });
    expect(
      groupIntegrations([i('git', 'Code'), i('alerts', 'Operations'), i('ci', 'Code')]).map(
        ([g, l]) => [g, l.map((x) => x.key)],
      ),
    ).toEqual([
      ['Code', ['git', 'ci']],
      ['Operations', ['alerts']],
    ]);
  });
});
