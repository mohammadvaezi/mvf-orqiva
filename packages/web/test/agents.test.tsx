// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-122 | S15 | v0.1.0] Show agents in the web app: agents page, ask from a task, live run view, approvals, card badge ──
import { describe as describeEvent, inFeed, type ActivityEvent } from '@orqiva/shared';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AgentBadge,
  AgentWork,
  RunStatus,
  StepRow,
  actionText,
  openApprovals,
  tokenText,
  usd,
  type Step,
} from '../src/agents.js';
import { appRoute } from '../src/core/nav.js';

const ID = '11111111-1111-4111-8111-111111111111';
const step = (seq: number, kind: string, content: Record<string, unknown>): Step => ({
  seq,
  kind,
  content,
  tokensIn: 0,
  tokensOut: 0,
  costMicros: 0,
  at: '2026-10-03T10:00:00Z',
});

describe('agent pages', () => {
  it('have their own addresses, and the provider its settings section', () => {
    expect(appRoute('/agents')).toEqual({ kind: 'agents' });
    expect(appRoute('/runs/' + ID)).toEqual({ kind: 'run', id: ID });
    expect(appRoute('/settings/ai')).toEqual({ kind: 'settings', section: 'ai' });
  });

  it('show figures people read: tokens, dollars, status', () => {
    expect(tokenText(950)).toBe('950');
    expect(tokenText(12_400)).toBe('12k');
    expect(tokenText(1_250_000)).toBe('1.3M');
    expect(usd(3150)).toBe('$0.0032');
    expect(usd(2_500_000)).toBe('$2.50');
    expect(renderToString(<RunStatus status="waiting" />)).toContain('Waiting for approval');
  });
});

describe('the badge on a card', () => {
  it('shows only while an agent works on the item', () => {
    const work = new Map([['i1', 'Analyst agent']]);
    const html = renderToString(
      <AgentWork.Provider value={work}>
        <AgentBadge itemId="i1" />
        <AgentBadge itemId="i2" />
      </AgentWork.Provider>,
    );
    expect(html).toContain('Analyst agent is working on this');
    expect(html.match(/pe-agent-badge"/g)).toHaveLength(1);
    expect(renderToString(<AgentBadge itemId="i1" />)).toBe('');
  });
});

describe('a run, step by step', () => {
  it('asks a person only about approvals no decision has answered', () => {
    const steps = [
      step(1, 'approval', {
        toolUseId: 'a',
        tool: 'move_item',
        input: { ref: 'APP-1', state: 'Review' },
      }),
      step(2, 'decision', { toolUseId: 'a', approve: true, by: 'Cy' }),
      step(3, 'approval', {
        toolUseId: 'b',
        tool: 'move_item',
        input: { ref: 'APP-2', state: 'Todo' },
      }),
    ];
    expect(openApprovals(steps).map((s) => s.seq)).toEqual([3]);
    expect(actionText('move_item', { ref: 'APP-2', state: 'Todo' })).toBe('move APP-2 to Todo');
    expect(actionText('add_comment', { ref: 'APP-2' })).toBe('comment on APP-2');
  });

  it('reads each kind of step', () => {
    const names = new Map([['t1', 'list_items']]);
    const model = renderToString(
      <StepRow
        agent="Analyst agent"
        toolNames={names}
        step={step(1, 'model', {
          blocks: [
            { type: 'text', text: 'Listing first.' },
            { type: 'tool_use', id: 't1', name: 'list_items', input: {} },
          ],
        })}
      />,
    );
    expect(model).toContain('Listing first.');
    expect(model).toContain('list_items');
    const result = renderToString(
      <StepRow
        agent="Analyst agent"
        toolNames={names}
        step={step(2, 'tool_result', {
          results: [{ tool_use_id: 't1', content: 'nope', is_error: true }],
        })}
      />,
    );
    expect(result).toContain('list_items');
    expect(result).toContain('refused');
    const decision = renderToString(
      <StepRow
        agent="Analyst agent"
        toolNames={names}
        step={step(3, 'decision', { approve: false, by: 'Cy', note: 'not now' })}
      />,
    );
    expect(decision.replace(/<!-- -->/g, '')).toContain('Declined by Cy: not now');
  });
});

describe('agent runs in the activity feed', () => {
  const ev = (
    verb: string,
    changes: Record<string, { from: unknown; to: unknown }> = {},
    actor = 'Ada',
  ) =>
    ({
      type: 'orqiva.agent_run.' + verb,
      data: {
        actor: { kind: actor === 'Ada' ? 'user' : 'agent', id: 'x', name: actor },
        verb,
        object: { type: 'agent_run', id: 'r1', label: 'Analyst agent on APP-1' },
        parent: { type: 'item', id: 'i1', label: 'APP-1' },
        changes,
      },
    }) as unknown as ActivityEvent;

  it('reads as sentences, and leaves single steps out', () => {
    expect(describeEvent(ev('created'))).toBe('Ada asked Analyst agent to work on APP-1');
    expect(
      describeEvent(ev('updated', { status: { from: 'running', to: 'waiting' } }, 'Analyst agent')),
    ).toBe('Analyst agent is waiting for approval on APP-1');
    expect(describeEvent(ev('updated', { decision: { from: 'waiting', to: 'approved' } }))).toBe(
      'Ada approved an action of Analyst agent on APP-1',
    );
    expect(describeEvent(ev('completed', {}, 'Analyst agent'))).toBe(
      'Analyst agent finished its run on APP-1',
    );
    expect(inFeed(ev('progressed', {}, 'Analyst agent'))).toBe(false);
    expect(inFeed(ev('created'))).toBe(true);
  });
});
