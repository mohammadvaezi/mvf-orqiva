// ── [PCODE-160 | S15 | v0.1.0] Gate A1 answers: agent-vs-people comparisons for admins only, sign-off recorded ──
// ── [PCODE-157 | S15 | v0.1.0] D5 preview: Agents, People, Tokens and costs, Activity, Insights, Settings ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { events } from '../src/preview/data5.js';
import { InsightsPage } from '../src/preview/insights.js';
import { ActivityPage, parseQuery } from '../src/preview/pactivity.js';
import { AgentsPage } from '../src/preview/pagents.js';
import { PeoplePage } from '../src/preview/people.js';
import { SettingsPagePreview } from '../src/preview/psettings.js';
import { TokensPage } from '../src/preview/tokens.js';

const text = (html: string): string => html.replace(/<!-- -->/g, '');

describe('D5: the platform sections', () => {
  it('shows every agent with state, autonomy, money in euro and the kill switch', () => {
    const html = text(renderToString(<AgentsPage />));
    expect(html).toContain('Pause all agents');
    expect(html).toContain('Acts, asks first');
    expect(html).toContain('per merged PR');
    expect(html).toContain('accountable');
  });

  it('renders only the visible rows of 20 000 events, and reads the query language', () => {
    const html = text(renderToString(<ActivityPage />));
    expect(html).toContain('20,000');
    const rows = (html.match(/class="pv-ev"/g) ?? []).length;
    expect(rows).toBeGreaterThan(10);
    expect(rows).toBeLessThan(40);
    expect(parseQuery('actor:agent -kind:test hello')).toEqual([
      { field: 'actor', value: 'agent', not: false },
      { field: 'kind', value: 'test', not: true },
      { field: 'text', value: 'hello', not: false },
    ]);
  });

  it('makes a working day: more events at 11:00 than at 03:00, always the same', () => {
    const a = events(5000);
    const at = (clock: string): number => a.filter((e) => e.t.startsWith(clock)).length;
    expect(at('11')).toBeGreaterThan(at('03') * 5);
    expect(events(50)).toEqual(events(50));
  });

  it('draws People, Tokens and costs, Insights and Settings', () => {
    expect(text(renderToString(<PeoplePage />))).toContain('Second factor');
    expect(text(renderToString(<TokensPage />))).toContain('Spend per day');
    expect(text(renderToString(<InsightsPage role="admin" />))).toContain(
      'Done per week: people and agents',
    );
    // [PCODE-160 | S15 | v0.1.0] owner at gate A1: only admins compare agents with people
    const lead = text(renderToString(<InsightsPage role="lead" />));
    expect(lead).not.toContain('Agents vs people');
    expect(lead).not.toContain('people cost per point');
    expect(text(renderToString(<SettingsPagePreview />))).toContain(
      'workspace, overridden per person',
    );
  });
});
