// ── [PCODE-147 | S15 | v0.1.0] Show the traceability graph from idea to deploy ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { layoutTrace, NODE_H, NODE_W, TraceGraph, type Trace } from '../src/trace.js';

const trace: Trace = {
  nodes: [
    {
      id: 'idea:1',
      kind: 'idea',
      label: 'APP-I1',
      sub: 'CSV export',
      status: 'approved',
      href: '/ideas/1',
    },
    {
      id: 'item:1',
      kind: 'item',
      label: 'APP-1',
      sub: 'Export endpoint',
      status: 'Done',
      href: '/items/1',
    },
    {
      id: 'item:2',
      kind: 'item',
      label: 'APP-2',
      sub: 'Export button',
      status: 'Todo',
      href: '/items/2',
    },
    {
      id: 'criterion:1',
      kind: 'criterion',
      label: 'One header row',
      sub: '',
      status: 'ticked',
      href: '/items/1',
    },
    {
      id: 'deploy:1',
      kind: 'deploy',
      label: 'Staging',
      sub: '2026-10-04 10:00',
      status: 'deployed',
      href: '/deploys/1',
    },
  ],
  edges: [
    { from: 'idea:1', to: 'item:1' },
    { from: 'idea:1', to: 'item:2' },
    { from: 'item:1', to: 'criterion:1' },
    { from: 'criterion:1', to: 'deploy:1' },
  ],
  gaps: [{ node: 'criterion:1', text: 'No test checks this criterion' }],
};

describe('the traceability graph', () => {
  it('lays steps out in columns from intent to delivery, dropping empty ones', () => {
    const { pos, width, height } = layoutTrace(trace);
    expect(pos.get('idea:1')).toEqual({ x: 0, y: 0 });
    expect(pos.get('item:1')?.x).toBe(NODE_W + 40);
    expect(pos.get('item:2')?.y).toBe(NODE_H + 14);
    expect(pos.get('criterion:1')?.x).toBe(2 * (NODE_W + 40));
    // no proposal, test or code column: the deploy sits right after the criterion
    expect(pos.get('deploy:1')?.x).toBe(3 * (NODE_W + 40));
    expect(width).toBe(4 * (NODE_W + 40) - 40);
    expect(height).toBe(2 * (NODE_H + 14) - 14);
  });

  it('draws nodes as links, edges as curves, and names the gaps', () => {
    const html = renderToString(<TraceGraph trace={trace} go={() => undefined} />);
    expect(html.match(/<a href=/g)).toHaveLength(5);
    expect(html.match(/class="pe-trace-edge"/g)).toHaveLength(4);
    expect(html).toContain('pe-trace-node--gap');
    expect(html).toContain('No test checks this criterion');
    expect(html).not.toContain('style=');
    expect(
      renderToString(
        <TraceGraph trace={{ nodes: [], edges: [], gaps: [] }} go={() => undefined} />,
      ),
    ).toContain('Nothing to trace yet');
  });
});
