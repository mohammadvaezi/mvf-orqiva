// ── [PCODE-349 | S15 | v0.1.0] T35.2b Slack and Teams bridges, personal calendar feed, CI pipeline runs ──
//    Why:  which events a bridge may post, which addresses are a chat's, what Slack and Teams receive, and a
//          calendar file calendar apps read.
import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../src/events.js';
import { bridgeBody, bridgeTopic, bridgeUrlOk, personalIcs } from '../src/bridges.js';

const ev = (data: Partial<ActivityEvent['data']>): ActivityEvent =>
  ({
    data: {
      actor: { kind: 'user', id: 'u', name: 'Ada' },
      verb: 'created',
      object: { type: 'item', id: 'x' },
      ...data,
    },
  }) as ActivityEvent;

describe('bridges', () => {
  it('sorts events into topics', () => {
    expect(bridgeTopic(ev({ object: { type: 'incident', id: 'i' }, verb: 'created' }))).toBe(
      'incidents',
    );
    expect(
      bridgeTopic(
        ev({
          object: { type: 'incident', id: 'i' },
          verb: 'updated',
          changes: { state: { from: 'identified', to: 'resolved' } },
        }),
      ),
    ).toBe('incidents');
    expect(
      bridgeTopic(
        ev({
          object: { type: 'incident', id: 'i' },
          verb: 'updated',
          changes: { state: { from: 'a', to: 'identified' } },
        }),
      ),
    ).toBeNull();
    expect(
      bridgeTopic(
        ev({
          object: { type: 'project', id: 'p' },
          verb: 'updated',
          changes: { release: { from: null, to: '1.2.0 released' } },
        }),
      ),
    ).toBe('releases');
    expect(bridgeTopic(ev({ object: { type: 'deploy', id: 'd' }, verb: 'failed' }))).toBe(
      'deploys',
    );
    expect(bridgeTopic(ev({ object: { type: 'ci_run', id: 'c' }, verb: 'failed' }))).toBe('ci');
    expect(bridgeTopic(ev({ object: { type: 'item', id: 'x' } }))).toBeNull();
  });
  it('accepts only the chats’ own webhook addresses', () => {
    expect(bridgeUrlOk('slack', 'https://hooks.slack.com/services/T0/B0/x')).toBe(true);
    expect(bridgeUrlOk('slack', 'http://hooks.slack.com/services/T0/B0/x')).toBe(false);
    expect(bridgeUrlOk('slack', 'https://hooks.slack.com.evil.test/services/x')).toBe(false);
    expect(
      bridgeUrlOk('teams', 'https://prod-12.westeurope.logic.azure.com:443/workflows/abc'),
    ).toBe(true);
    expect(bridgeUrlOk('teams', 'https://contoso.webhook.office.com/webhookb2/x')).toBe(true);
    expect(bridgeUrlOk('teams', 'https://example.test/x')).toBe(false);
  });
  it('writes Slack text and a Teams card', () => {
    expect(bridgeBody('slack', { title: 'A <b> & c', text: 'x', url: 'https://o.test/i' })).toEqual(
      {
        text: '*A &lt;b&gt; &amp; c*\nx\n<https://o.test/i|Open in Orqiva>',
      },
    );
    const card = bridgeBody('teams', { title: 'T', text: '', url: 'https://o.test' }) as {
      attachments: { content: { body: unknown[]; actions: { url: string }[] } }[];
    };
    expect(card.attachments[0]?.content.body).toHaveLength(1);
    expect(card.attachments[0]?.content.actions[0]?.url).toBe('https://o.test');
  });
  it('writes a calendar with whole days and times, escaped and folded', () => {
    const ics = personalIcs('Dev, Ada', '20261015T120000Z', [
      { uid: 'due-1', summary: 'Due: APP-1 Ship; now', start: '2026-12-01', end: '2026-12-02' },
      {
        uid: 'm-1',
        summary: 'Kick-off',
        start: '2026-10-20T09:00:00.000Z',
        end: '2026-10-20T09:45:00.000Z',
        description: 'x'.repeat(120),
      },
    ]);
    expect(ics).toContain('X-WR-CALNAME:Dev\\, Ada');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261201\r\nDTEND;VALUE=DATE:20261202');
    expect(ics).toContain('SUMMARY:Due: APP-1 Ship\\; now');
    expect(ics).toContain('DTSTART:20261020T090000Z');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});
