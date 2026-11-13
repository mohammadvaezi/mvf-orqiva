// ── [PCODE-349 | S15 | v0.1.0] T35.2b Slack and Teams bridges, personal calendar feed, CI pipeline runs ──
//    Why:  Slack and Teams stay optional: a bridge only posts what a team chose there (incidents, releases,
//          deploys, CI failures, a mirrored channel) through the chat's own incoming webhook. And a person's
//          calendar takes their dates from one secret link.
import { describe } from './activitytext.js';
import type { ActivityEvent } from './events.js';

export const BRIDGE_TOPICS = {
  incidents: 'Incidents opened and resolved',
  releases: 'Releases shipped and rolled back',
  deploys: 'Deploys finished or failed',
  ci: 'Failed CI runs and test runs',
} as const;
export type BridgeTopic = keyof typeof BRIDGE_TOPICS;
export type BridgeKind = 'slack' | 'teams';

/** The topic an event belongs to for the bridges, or null when no bridge posts it. */
export function bridgeTopic(e: ActivityEvent): BridgeTopic | null {
  const { object, verb, changes } = e.data;
  if (object.type === 'incident')
    return verb === 'created' || changes?.['state']?.to === 'resolved' ? 'incidents' : null;
  if (object.type === 'project' && changes?.['release'])
    return /\b(released|rolled_back)$/.test(String(changes['release'].to)) ? 'releases' : null;
  if (object.type === 'deploy') return verb === 'completed' || verb === 'failed' ? 'deploys' : null;
  if (object.type === 'ci_run' || object.type === 'test_run')
    return verb === 'failed' ? 'ci' : null;
  return null;
}

/** The line a bridge posts for an event. */
export const bridgeLine = (e: ActivityEvent): string => describe(e);

/** Whether a webhook address belongs to the chat: Slack's hooks, or a Teams workflow (Power Automate). */
export function bridgeUrlOk(kind: BridgeKind, url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (kind === 'slack')
    return u.hostname === 'hooks.slack.com' && u.pathname.startsWith('/services/');
  return /(^|\.)(webhook\.office\.com|logic\.azure\.com|environment\.api\.powerplatform\.com)$/.test(
    u.hostname,
  );
}

/** The JSON a chat's incoming webhook takes: Slack's text with a link, or a Teams adaptive card. */
export function bridgeBody(
  kind: BridgeKind,
  m: { title: string; text: string; url?: string },
): unknown {
  if (kind === 'slack') {
    const esc = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return {
      text:
        '*' +
        esc(m.title) +
        '*' +
        (m.text ? '\n' + esc(m.text) : '') +
        (m.url ? '\n<' + m.url + '|Open in Orqiva>' : ''),
    };
  }
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: m.title, weight: 'Bolder', wrap: true },
            ...(m.text ? [{ type: 'TextBlock', text: m.text, wrap: true }] : []),
          ],
          ...(m.url
            ? { actions: [{ type: 'Action.OpenUrl', title: 'Open in Orqiva', url: m.url }] }
            : {}),
        },
      },
    ],
  };
}

export interface CalendarEntry {
  uid: string;
  summary: string;
  description?: string;
  /** YYYY-MM-DD for a whole day, or an ISO time */
  start: string;
  /** exclusive for whole days; for times, the end */
  end: string;
  url?: string;
}

const text = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const bytes = new TextEncoder();
const fold = (line: string): string => {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (bytes.encode(cur + ch).length > 74) {
      out.push(cur);
      cur = ' ';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
};

const when = (name: string, v: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? name + ';VALUE=DATE:' + v.replace(/-/g, '')
    : name +
      ':' +
      new Date(v)
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');

/** A person's calendar (RFC 5545): their dates as events, read again by the calendar app every few hours. */
export function personalIcs(
  name: string,
  stamp: string,
  entries: readonly CalendarEntry[],
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Orqiva//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + text(name),
    'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
  ];
  for (const e of entries)
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + e.uid + '@orqiva',
      'DTSTAMP:' + stamp,
      when('DTSTART', e.start),
      when('DTEND', e.end),
      'SUMMARY:' + text(e.summary),
      ...(e.description ? ['DESCRIPTION:' + text(e.description)] : []),
      ...(e.url ? ['URL:' + e.url] : []),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
