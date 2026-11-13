// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-183 | S15 | v0.1.0] B6.1 Activity at scale live: search, query language, facets, histogram, saved views, export, archive, hash chain, webhooks ──
//    Why:  facets add and remove their term in the query people can read; events are coloured by what
//          they are about; the page renders without inline styles.
import type { ActivityEvent } from '@orqiva/shared';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EventHub } from '../src/core/hub.js';
import { ActivityHub, kindOf, toggleTerm } from '../src/v2/activitypage.js';

const ev = (type: string, actor = 'user'): ActivityEvent =>
  ({
    specversion: '1.0',
    id: 'x',
    source: '/w',
    type: 'orqiva.' + type + '.created',
    time: '2026-10-05T08:00:00Z',
    subject: 's',
    datacontenttype: 'application/json',
    workspaceid: 'w',
    sequence: 1,
    data: { actor: { kind: actor, id: 'a' }, verb: 'created', object: { type, id: 'o' } },
  }) as ActivityEvent;

describe('activity page', () => {
  it('toggles facet terms in the query', () => {
    expect(toggleTerm('since:7d', 'project', 'app')).toBe('since:7d project:app');
    expect(toggleTerm('since:7d project:ops', 'project', 'app')).toBe('since:7d project:app');
    expect(toggleTerm('since:7d project:app', 'project', 'app')).toBe('since:7d');
    expect(toggleTerm('', 'actor', 'Ada Lovelace')).toBe('actor:"Ada Lovelace"');
  });

  it('colours events by what they are about', () => {
    expect([
      kindOf(ev('deploy')),
      kindOf(ev('finding')),
      kindOf(ev('item', 'agent')),
      kindOf(ev('item')),
    ]).toEqual(['deploy', 'security', 'agent', '']);
  });

  it('renders without inline styles', () => {
    const html = renderToString(
      <ActivityHub workspaceId="w" role="admin" hub={new EventHub()} go={() => undefined} />,
    );
    expect(html).toContain('Activity');
    expect(html).not.toContain('style=');
  });
});
