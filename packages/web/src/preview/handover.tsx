// ── [PCODE-200 | S15 | v0.1.0] T16.4 Handover screens: design preview, team Handover tab, portal Handover section with signature ──
//    Why:  the approved design had no handover screen. This is its design, drawn with the same components
//          the live pages use and sample data of the Helio patient app: the team's Handover tab (what the
//          pack still lacks, the team checklist, the pages it carries, sending, packs sent) and the
//          portal's Handover section where the client reads a pack and signs it.
import { useState, type ReactNode } from 'react';
import {
  HandoverView,
  PackView,
  PortalHandoverView,
  type HandoverData,
  type PackContentsView,
  type PackSummaryView,
} from '../v2/handover.js';

const CHECKS: HandoverData['checks'] = [
  { key: 'architecture', label: 'Architecture', state: 'ok', detail: 'Architecture' },
  {
    key: 'readme',
    label: 'Handover readme',
    state: 'missing',
    detail: 'Handover readme waits for a person’s approval',
  },
  { key: 'runbooks', label: 'Runbooks', state: 'ok', detail: '3 pages' },
  { key: 'code-docs', label: 'Docs built from the code', state: 'ok', detail: '4 pages' },
  {
    key: 'fresh',
    label: 'Pages reviewed and in line with the code',
    state: 'warn',
    detail: '1 page disagrees with the code',
  },
  { key: 'release', label: 'Release', state: 'ok', detail: '2.0.0 with notes for the client' },
  { key: 'tests', label: 'Tests', state: 'ok', detail: 'Regression 2.0: 184 passed' },
  { key: 'acceptance', label: 'Client acceptance', state: 'ok', detail: 'Round 2 accepted' },
  { key: 'security', label: 'Security', state: 'ok', detail: 'No open critical or high finding' },
  { key: 'open-work', label: 'Open work', state: 'warn', detail: '3 tasks are still open' },
];
const ITEMS: HandoverData['items'] = [
  {
    id: 'i1',
    label: 'Access and credentials handed over (outside Orqiva, never in a page)',
    done: true,
    doneBy: 'Ole Brandt',
    doneAt: '2026-10-07T10:00:00Z',
    note: '',
  },
  {
    id: 'i2',
    label: 'Repository and hosting moved to the client, or access granted',
    done: true,
    doneBy: 'Mara Klein',
    doneAt: '2026-10-08T09:30:00Z',
    note: '',
  },
  {
    id: 'i3',
    label: 'Support contact and hours named',
    done: false,
    doneBy: null,
    doneAt: null,
    note: '',
  },
  {
    id: 'i4',
    label: 'App store accounts transferred to Helio',
    done: false,
    doneBy: null,
    doneAt: null,
    note: '',
  },
];
const PAGES = [
  { id: 'p1', title: 'Handover readme', version: 4 },
  { id: 'p2', title: 'Architecture', version: 7 },
  { id: 'p3', title: 'Runbook: map provider outage', version: 3 },
  { id: 'p4', title: 'Runbook: rollback a deploy', version: 5 },
  { id: 'p5', title: 'System overview (from code)', version: 12 },
  { id: 'p6', title: 'Tours API (from code)', version: 9 },
];
const PACK_1: PackSummaryView = {
  id: 'k1',
  number: 1,
  status: 'changes_requested',
  note: '',
  hash: 'a'.repeat(64),
  sentBy: 'Ole Brandt',
  sentAt: '2026-09-28T14:00:00Z',
  decidedBy: 'Ines Vogel',
  decidedAt: '2026-09-30T08:10:00Z',
  signedName: '',
  decisionNote: 'Please add the runbook for a map provider outage.',
};
const PACK_2: PackSummaryView = {
  ...PACK_1,
  id: 'k2',
  number: 2,
  status: 'sent',
  sentAt: '2026-10-08T16:00:00Z',
  decidedBy: null,
  decidedAt: null,
  decisionNote: '',
  note: 'With the outage runbook you asked for. Support runs Mon–Fri 8–18.',
};
export const SAMPLE_HANDOVER: HandoverData = {
  checks: [
    ...CHECKS,
    ...ITEMS.map((i) => ({
      key: 'item:' + i.id,
      label: i.label,
      state: i.done ? 'ok' : 'missing',
      detail: i.done ? 'Done' : 'Not done yet',
    })),
  ],
  ready: false,
  items: ITEMS,
  suggested: ['Third-party licences and accounts listed'],
  client: 'Helio Health AG',
  pages: PAGES,
  packs: [PACK_2, PACK_1],
};
const CONTENTS: PackContentsView = {
  project: { key: 'HEL', name: 'Patient app' },
  client: 'Helio Health AG',
  checks: CHECKS.map((c) =>
    c.key === 'readme' ? { ...c, state: 'ok', detail: 'Handover readme' } : c,
  ),
  pages: PAGES.map((p) => ({ ...p, generated: p.title.includes('(from code)') })),
  release: { version: '2.0.0', notes: '', releasedAt: '2026-10-06T09:00:00Z' },
  tests: { name: 'Regression 2.0', passed: 184, failed: 0, finishedAt: '2026-10-05T17:00:00Z' },
  acceptance: {
    name: 'Round 2',
    accepted: true,
    signedName: 'Ines Vogel',
    at: '2026-10-07T11:00:00Z',
  },
  openTasks: [
    { ref: 'HEL-212', title: 'Dark mode for the booking screen', state: 'Backlog' },
    { ref: 'HEL-215', title: 'German plural in reminders', state: 'Backlog' },
    { ref: 'HEL-219', title: 'Faster map tiles on 3G', state: 'Todo' },
  ],
  note: PACK_2.note,
};
const BODIES: Record<string, string> = {
  p1: '# Handover readme\n\nThe patient app books, moves and reminds appointments.\n\n## Run it\n\n1. `docker compose up` in `deploy/`\n2. Sign in with the admin you created\n\n## Who to call\n\nOle Brandt, Mon–Fri 8–18.',
};
const open = (id: string): Promise<{ title: string; version: number; body: string } | null> => {
  const p = PAGES.find((x) => x.id === id);
  return Promise.resolve(
    p
      ? {
          title: p.title,
          version: p.version,
          body: BODIES[id] ?? '# ' + p.title + '\n\nAs sent with the pack.',
        }
      : null,
  );
};

/** The team's Handover tab, as designed. */
export function HandoverTab(): ReactNode {
  const [pack, setPack] = useState<string | null>(null);
  const [data, setData] = useState(SAMPLE_HANDOVER);
  if (pack)
    return (
      <PackView
        pack={pack === 'k1' ? PACK_1 : PACK_2}
        contents={CONTENTS}
        pdfHref="/preview/handover-pack.pdf"
        mayDecide={false}
        openPage={open}
        onBack={() => {
          setPack(null);
        }}
      />
    );
  return (
    <HandoverView
      data={data}
      canEdit
      pdfHref={() => '/preview/handover-pack.pdf'}
      onToggle={(i) => {
        setData({
          ...data,
          items: data.items.map((x) =>
            x.id === i.id
              ? { ...x, done: !x.done, doneBy: 'You', doneAt: new Date().toISOString() }
              : x,
          ),
        });
      }}
      onAdd={(label) => {
        setData({
          ...data,
          items: [
            ...data.items,
            {
              id: 'n' + String(data.items.length),
              label,
              done: false,
              doneBy: null,
              doneAt: null,
              note: '',
            },
          ],
        });
      }}
      onSuggested={() => {
        setData({ ...data, suggested: [] });
      }}
      onRemove={(i) => {
        setData({ ...data, items: data.items.filter((x) => x.id !== i.id) });
      }}
      onSend={() => undefined}
      onOpenPack={setPack}
    />
  );
}

/** The portal's Handover section, as designed: a pack waiting for the client's signature. */
export function PortalHandover(): ReactNode {
  const [pack, setPack] = useState<PackSummaryView | null>(null);
  if (pack)
    return (
      <PackView
        pack={pack}
        contents={CONTENTS}
        pdfHref="/preview/handover-pack.pdf"
        mayDecide
        openPage={open}
        onDecide={(decision, text) => {
          setPack({
            ...pack,
            status: decision,
            signedName: decision === 'accepted' ? text : '',
            decisionNote: decision === 'accepted' ? '' : text,
            decidedAt: new Date().toISOString(),
          });
          return Promise.resolve('');
        }}
        onBack={() => {
          setPack(null);
        }}
      />
    );
  return (
    <PortalHandoverView
      packs={[
        { projectKey: 'HEL', projectName: 'Patient app', latest: true, pack: PACK_2 },
        { projectKey: 'HEL', projectName: 'Patient app', latest: false, pack: PACK_1 },
      ]}
      pdfHref={() => '/preview/handover-pack.pdf'}
      onOpen={(id) => {
        setPack(id === 'k1' ? PACK_1 : PACK_2);
      }}
    />
  );
}
