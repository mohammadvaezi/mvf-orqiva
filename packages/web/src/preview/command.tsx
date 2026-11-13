// ── [PCODE-210 | S15 | v0.1.0] T18.2 Command center screen: lanes with people and agents, heatmap, alerts, 24 h replay slider (design preview and live) ──
//    Why:  the approved design had no command center. This is its design, drawn with the live page's view
//          and sample data of an agency with six client projects: lanes with moving cards, people and
//          agents on them, the heatmap, alerts and a replay of the last day.
import type { PresenceEntry } from '@orqiva/shared';
import { useState, type ReactNode } from 'react';
import { CommandView, type CcData, type CcEvent, type CcProject } from '../v2/command.js';

const NOW = Date.parse('2026-10-09T15:00:00Z');
const ago = (h: number): string => new Date(NOW - h * 3_600_000).toISOString();
const ok = (note: string) => ({ level: 'ok', note });
const gates = (a: string, b: string, c: string) => [
  { key: 'g1', name: 'Ready to plan', status: a },
  { key: 'g2', name: 'Ready to build', status: b },
  { key: 'g3', name: 'Ready to ship', status: c },
];
const card = (
  id: string,
  ref: string,
  title: string,
  who: string | null,
  agent?: string,
): CcProject['cards'][number] => ({
  id,
  ref,
  title,
  state: 'In Progress',
  assignee: who ? { id: who.toLowerCase(), name: who } : null,
  agents: agent ? [{ name: agent, status: 'running' }] : [],
  updatedAt: ago(1),
});
const base = {
  heat: {
    delivery: ok('on plan'),
    quality: ok('tests pass'),
    security: ok('no serious finding'),
    operations: ok('running well'),
    budget: ok('42 % of the AI budget'),
  },
  counts: { open: 24, inProgress: 3, doneThisWeek: 9 },
};

const PROJECTS: CcProject[] = [
  {
    ...base,
    id: 'p-nwl',
    key: 'NWL',
    name: 'Nordwind dispatch',
    client: 'Nordwind Logistics',
    phase: 'Build',
    gates: gates('approved', 'approved', 'open'),
    health: 'at-risk',
    reasons: ['2 tasks overdue, sprint behind'],
    heat: { ...base.heat, delivery: { level: 'warn', note: '2 tasks overdue, sprint behind' } },
    cards: [
      card('c1', 'NWL-212', 'Live re-routing for dispatchers', 'Ole Brandt', 'Developer agent'),
      card('c2', 'NWL-219', 'Faster map tiles on 3G', 'Mara Klein'),
      card('c3', 'NWL-224', 'Driver app: new stop order', null, 'Tester agent'),
    ],
  },
  {
    ...base,
    id: 'p-hel',
    key: 'HEL',
    name: 'Patient app',
    client: 'Helio Health AG',
    phase: 'Ship and hand over',
    gates: gates('approved', 'approved', 'ready'),
    health: 'critical',
    reasons: ['1 SEV-1/2 incident open', '1 high finding'],
    heat: {
      ...base.heat,
      operations: { level: 'bad', note: '1 SEV-1/2 incident open' },
      security: { level: 'warn', note: '1 high finding' },
    },
    cards: [
      card('c4', 'HEL-301', 'Reminder SMS retries', 'Ines Vogel', 'Developer agent'),
      card('c5', 'HEL-305', 'Booking audit log', 'Tom Weber'),
    ],
  },
  {
    ...base,
    id: 'p-aur',
    key: 'AUR',
    name: 'Aurum banking portal',
    client: 'Aurum Bank',
    phase: 'Plan',
    gates: gates('approved', 'open', 'open'),
    health: 'on-track',
    reasons: [],
    cards: [card('c6', 'AUR-41', 'KYC document upload', 'Lena Roth')],
  },
  {
    ...base,
    id: 'p-orq',
    key: 'ORQ',
    name: 'Orqiva itself',
    client: null,
    phase: 'Build',
    gates: gates('approved', 'approved', 'open'),
    health: 'at-risk',
    reasons: ['91 % of the AI budget used'],
    heat: { ...base.heat, budget: { level: 'warn', note: '91 % of the AI budget used' } },
    cards: [
      card('c7', 'ORQ-210', 'Command center replay', 'Ada Lovelace', 'Developer agent'),
      card('c8', 'ORQ-211', 'Load test, 50 users', 'Bob Brandt'),
    ],
  },
  {
    ...base,
    id: 'p-kfw',
    key: 'KFW',
    name: 'Grant calculator',
    client: 'Förderbank',
    phase: 'Discover',
    gates: gates('open', 'open', 'open'),
    health: 'on-track',
    reasons: [],
    heat: { ...base.heat, quality: { level: 'none', note: 'no test run' } },
    cards: [],
  },
];

const EVENTS: CcEvent[] = [
  {
    sequence: 1,
    at: ago(20),
    projectId: 'p-nwl',
    object: 'item',
    objectId: 'c1',
    label: 'NWL-212 Live re-routing for dispatchers',
    verb: 'moved',
    actor: 'Ole Brandt',
    actorKind: 'user',
    state: { from: 'Todo', to: 'In Progress' },
  },
  {
    sequence: 2,
    at: ago(14),
    projectId: 'p-hel',
    object: 'item',
    objectId: 'c9',
    label: 'HEL-299 Calendar export',
    verb: 'moved',
    actor: 'Ines Vogel',
    actorKind: 'user',
    state: { from: 'In Progress', to: 'Review' },
  },
  {
    sequence: 3,
    at: ago(9),
    projectId: 'p-orq',
    object: 'item',
    objectId: 'c7',
    label: 'ORQ-210 Command center replay',
    verb: 'moved',
    actor: 'Ada Lovelace',
    actorKind: 'user',
    state: { from: 'Todo', to: 'In Progress' },
  },
  {
    sequence: 4,
    at: ago(5),
    projectId: 'p-hel',
    object: 'incident',
    objectId: 'i1',
    label: 'SMS gateway down',
    verb: 'created',
    actor: 'Grafana',
    actorKind: 'integration',
    state: null,
  },
  {
    sequence: 5,
    at: ago(2),
    projectId: 'p-nwl',
    object: 'item',
    objectId: 'c3',
    label: 'NWL-224 Driver app: new stop order',
    verb: 'moved',
    actor: 'Tester agent',
    actorKind: 'agent',
    state: { from: 'Todo', to: 'In Progress' },
  },
  {
    sequence: 6,
    at: ago(0.5),
    projectId: 'p-orq',
    object: 'item',
    objectId: 'c8',
    label: 'ORQ-211 Load test, 50 users',
    verb: 'created',
    actor: 'Bob Brandt',
    actorKind: 'user',
    state: null,
  },
];

export const SAMPLE_COMMAND: CcData = {
  projects: PROJECTS,
  alerts: [
    {
      id: 'a1',
      projectKey: 'HEL',
      source: 'grafana',
      severity: 'sev2',
      title: 'SMS gateway: 30 % of messages failing',
      count: 14,
      lastAt: ago(0.2),
    },
    {
      id: 'a2',
      projectKey: 'NWL',
      source: 'sentry',
      severity: 'sev3',
      title: 'Map tiles timing out on 3G',
      count: 3,
      lastAt: ago(1.5),
    },
  ],
  at: new Date(NOW).toISOString(),
  startedStates: ['In Progress'],
};

const PEOPLE: PresenceEntry[] = [
  {
    userId: 'mara klein',
    name: 'Mara Klein',
    kind: 'user',
    projectId: 'p-nwl',
    itemId: 'c1',
    state: 'viewing',
    since: ago(0.1),
  },
  {
    userId: 'tom weber',
    name: 'Tom Weber',
    kind: 'user',
    projectId: 'p-hel',
    itemId: 'c4',
    state: 'editing',
    since: ago(0.1),
  },
];

export function CommandPreview(): ReactNode {
  const [at, setAt] = useState<number | null>(null);
  return (
    <CommandView
      data={SAMPLE_COMMAND}
      events={EVENTS}
      people={PEOPLE}
      now={NOW}
      at={at}
      onAt={setAt}
      agentsRunning={4}
    />
  );
}
