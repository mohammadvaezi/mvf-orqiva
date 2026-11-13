// ── [PCODE-200 | S15 | v0.1.0] T16.4 Handover screens: design preview, team Handover tab, portal Handover section with signature ──
// ── [PCODE-158 | S15 | v0.1.0] D6 preview: Clients and portal, Incidents, Time, web and VS Code side by side ──
//    Why:  the client portal, seen as Ines Vogel of Helio. Clients work with the team here, not by e-mail:
//          they file requests with screenshots, voice and recordings and see the agreed response time;
//          follow a live roadmap; run their acceptance tests; approve designs, PRDs and change requests
//          (seeing cost and schedule impact first) with an electronic signature; get releases explained in
//          their language and rate them; read shared documents; watch budget and invoices; book meetings;
//          and see the status of their systems. They never see internal notes, agent traces or other clients.
import { useState, type ReactNode } from 'react';
// [PCODE-200 | S15 | v0.1.0]
import { PortalHandover } from './handover.js';
import { euro, person } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Bar, Button, Card, Chip, PageHead, Stat } from './ui.js';

export const PORTAL_SECTIONS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'requests', label: 'Requests', icon: 'request' },
  { key: 'roadmap', label: 'Roadmap', icon: 'canvas' },
  { key: 'uat', label: 'Acceptance tests', icon: 'test' },
  { key: 'approvals', label: 'Approvals', icon: 'signoff' },
  { key: 'releases', label: 'Releases', icon: 'releases' },
  { key: 'documents', label: 'Documents', icon: 'documents' },
  { key: 'handover', label: 'Handover', icon: 'approval' }, // [PCODE-200 | S15 | v0.1.0]
  { key: 'billing', label: 'Budget and invoices', icon: 'euro' },
  { key: 'meetings', label: 'Meetings', icon: 'clock' },
  { key: 'status', label: 'Status', icon: 'live' },
];

interface Req {
  id: string;
  title: string;
  type: 'Bug' | 'Change' | 'Feature' | 'Question';
  state: string;
  sla: string;
  late: boolean;
  thread: { who: string; text: string; at: string; files?: string[] }[];
}

const REQUESTS: Req[] = [
  {
    id: 'CR-9',
    title: 'SMS reminders 2 hours before appointments',
    type: 'Change',
    state: 'Quoted',
    sla: 'answered in 3 h',
    late: false,
    thread: [
      {
        who: 'c-ines',
        text: 'Patients forget appointments. Could the app send an SMS two hours before?',
        at: 'Mon 09:20',
      },
      {
        who: 'jonas',
        text: 'Yes. Our estimate is 8 points, €3 400, and it moves the release by two days. The quote is under Approvals.',
        at: 'Mon 12:05',
      },
    ],
  },
  {
    id: 'BUG-31',
    title: 'Calendar shows UTC instead of local time',
    type: 'Bug',
    state: 'In progress',
    sla: 'fix due Wed',
    late: false,
    thread: [
      {
        who: 'c-ines',
        text: 'All times in the calendar are two hours early.',
        at: 'Fri 16:40',
        files: ['screenshot-calendar.png', 'voice-note-0:24.m4a'],
      },
      {
        who: 'sara',
        text: 'Reproduced on iOS and Android. Jonas is fixing it in HEL-231; you will see it in rc.4.',
        at: 'Mon 08:15',
      },
    ],
  },
  {
    id: 'Q-8',
    title: 'How long are chat messages kept?',
    type: 'Question',
    state: 'Waiting for Broszio',
    sla: '2 days late',
    late: true,
    thread: [
      {
        who: 'c-ines',
        text: 'Our data protection officer asks how long chat messages between patients and practices are stored.',
        at: 'Thu 11:02',
      },
    ],
  },
  {
    id: 'BUG-29',
    title: 'Login loop on Android 12',
    type: 'Bug',
    state: 'Fixed in rc.3',
    sla: 'fixed in 1 day',
    late: false,
    thread: [
      {
        who: 'jonas',
        text: 'Fixed and shipped in 2.0.0-rc.3. Can you confirm on your test phone?',
        at: 'Wed 14:30',
      },
    ],
  },
];

function Requests(): ReactNode {
  const [list, setList] = useState(REQUESTS);
  const [sel, setSel] = useState('CR-9');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<Req['type']>('Bug');
  const [reply, setReply] = useState('');
  const r = list.find((x) => x.id === sel) ?? list[0];
  return (
    <div className="pv-portal-split">
      <div className="pv-stack">
        <Button
          kind="primary"
          icon="plus"
          onClick={() => {
            setCreating(true);
          }}
        >
          New request
        </Button>
        {creating ? (
          <Card title="New request">
            <div className="pv-segmented pv-segmented--full" role="radiogroup" aria-label="Type">
              {(['Bug', 'Change', 'Feature', 'Question'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={type === t}
                  className="pv-seg"
                  onClick={() => {
                    setType(t);
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            <label className="pv-field pv-mt">
              <span>What happened or what do you need?</span>
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
                placeholder="One sentence"
              />
            </label>
            <div className="pv-attach pv-mt">
              <Button size="sm" kind="ghost" icon="uikit">
                Screenshot
              </Button>
              <Button size="sm" kind="ghost" icon="play">
                Record screen
              </Button>
              <Button size="sm" kind="ghost" icon="mention">
                Voice note
              </Button>
              <Button size="sm" kind="ghost" icon="documents">
                File
              </Button>
            </div>
            <div className="pv-page-actions pv-mt">
              <Button
                kind="primary"
                onClick={() => {
                  const id =
                    (type === 'Bug'
                      ? 'BUG-'
                      : type === 'Change'
                        ? 'CR-'
                        : type === 'Feature'
                          ? 'F-'
                          : 'Q-') + String(32 + list.length);
                  setList((l) => [
                    {
                      id,
                      title: title || 'New request',
                      type,
                      state: 'New',
                      sla: type === 'Bug' ? 'first answer within 4 h' : 'first answer within 1 day',
                      late: false,
                      thread: [{ who: 'c-ines', text: title || 'New request', at: 'now' }],
                    },
                    ...l,
                  ]);
                  setSel(id);
                  setCreating(false);
                  setTitle('');
                }}
              >
                Send
              </Button>
              <span className="pv-muted pv-small">
                Your team sees it at once, here and in their tools.
              </span>
            </div>
          </Card>
        ) : null}
        <ul className="pv-req-list">
          {list.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                className="pv-req"
                aria-current={x.id === r?.id ? 'true' : undefined}
                onClick={() => {
                  setSel(x.id);
                }}
              >
                <span className="pv-idea-top">
                  <span className="pv-mono pv-muted">{x.id}</span>
                  <Chip
                    tone={x.type === 'Bug' ? 'danger' : x.type === 'Change' ? 'warning' : 'info'}
                  >
                    {x.type}
                  </Chip>
                </span>
                <span className="pv-idea-title">{x.title}</span>
                <span className="pv-idea-meta">
                  <span>{x.state}</span>
                  <span>·</span>
                  <span className={x.late ? 'pv-text-danger' : ''}>{x.sla}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Card title="Report from inside your app">
          <p className="pv-muted pv-small">
            Add the feedback button to the Helio app: patients and staff report with a screenshot
            and device data, and it lands here.
          </p>
          <pre className="pv-code">
            {'<script src="https://pe.broszio.dev/widget.js" data-project="HEL"></script>'}
          </pre>
        </Card>
      </div>
      {r ? (
        <Card
          title={
            <>
              <span className="pv-mono pv-muted">{r.id}</span> {r.title}
            </>
          }
          action={<Chip tone={r.late ? 'danger' : 'success'}>{r.sla}</Chip>}
        >
          <ol className="pv-req-steps">
            {['Received', 'Understood', 'Planned', 'In progress', 'Done'].map((s, i) => (
              <li
                key={s}
                className={
                  i <=
                  (r.state === 'New'
                    ? 0
                    : r.state.startsWith('Fixed')
                      ? 4
                      : r.state === 'In progress'
                        ? 3
                        : 1)
                    ? 'pv-req-step pv-req-step--done'
                    : 'pv-req-step'
                }
              >
                {s}
              </li>
            ))}
          </ol>
          <div className="pv-chat pv-chat--flat">
            {r.thread.map((m, i) => (
              <div
                key={i}
                className={'pv-msg' + (person(m.who).kind === 'client' ? '' : ' pv-msg--agent')}
              >
                <Avatar id={m.who} size="sm" />
                <div className="pv-msg-body">
                  <div className="pv-msg-head">
                    <strong>{person(m.who).name}</strong>
                    <span className="pv-muted pv-small">{m.at}</span>
                  </div>
                  <p>{m.text}</p>
                  {m.files ? (
                    <div className="pv-attach">
                      {m.files.map((f) => (
                        <Chip key={f} icon="documents">
                          {f}
                        </Chip>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <div className="pv-composer pv-composer--flat">
            <textarea
              value={reply}
              placeholder="Reply to your team…"
              aria-label="Reply"
              onChange={(e) => {
                setReply(e.target.value);
              }}
            />
            <div className="pv-composer-row">
              <Button kind="ghost" size="sm" icon="documents">
                Attach
              </Button>
              <span className="pv-spacer" />
              <Button
                kind="primary"
                size="sm"
                onClick={() => {
                  if (!reply.trim()) return;
                  setList((l) =>
                    l.map((x) =>
                      x.id === r.id
                        ? {
                            ...x,
                            thread: [...x.thread, { who: 'c-ines', text: reply.trim(), at: 'now' }],
                          }
                        : x,
                    ),
                  );
                  setReply('');
                }}
              >
                Send
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Roadmap(): ReactNode {
  const items: [string, number, number, string][] = [
    ['Booking flow', 0, 28, 'done'],
    ['Reminders and calendar', 20, 22, 'now'],
    ['Acceptance tests', 36, 10, 'now'],
    ['Store release 2.0', 46, 4, 'next'],
    ['Video consultations', 52, 30, 'later'],
  ];
  return (
    <div className="pv-stack">
      <Card title="Patient app · what happens when">
        <svg className="pv-portfolio" viewBox="0 0 900 220" role="img" aria-label="Roadmap">
          {[0, 15, 30, 45, 60, 75].map((d, i) => (
            <g key={d}>
              <line
                className="pv-gridline"
                x1={200 + d * 8.4}
                x2={200 + d * 8.4}
                y1="10"
                y2="210"
              />
              <text className="pv-axis" x={204 + d * 8.4} y="20">
                {['Sep', 'mid Sep', 'Oct', 'mid Oct', 'Nov', 'mid Nov'][i]}
              </text>
            </g>
          ))}
          {items.map(([n, s, d, st], i) => (
            <g key={n}>
              <text className="pv-mind-text pv-mind-text--epic" x="10" y={52 + i * 36}>
                {n}
              </text>
              <rect
                className={'pv-road pv-road--' + st}
                x={200 + s * 8.4}
                y={38 + i * 36}
                width={d * 8.4}
                height="20"
                rx="5"
              />
            </g>
          ))}
          <line className="pv-today" x1={200 + 33 * 8.4} x2={200 + 33 * 8.4} y1="26" y2="210" />
        </svg>
      </Card>
      <Card title="What moved and why">
        <ul className="pv-changes">
          <li>
            <strong>Store release moved from 15 to 17 October</strong> — you added two change
            requests (CR-7, CR-8) on 30 September.
          </li>
          <li>
            <strong>Video consultations start in November</strong> — as agreed in the review on 2
            October.
          </li>
        </ul>
      </Card>
    </div>
  );
}

function Uat(): ReactNode {
  const cases = [
    'Book an appointment as a new patient',
    'Cancel and re-book within 24 hours',
    'Get a reminder and open it',
    'Change the practice’s opening hours',
    'Book on a slow mobile network',
    'Book with a screen reader',
    'See past appointments',
    'Delete my account',
  ];
  const [res, setRes] = useState<Record<number, 'pass' | 'fail'>>({
    0: 'pass',
    1: 'fail',
    2: 'pass',
  });
  const [signed, setSigned] = useState(false);
  const done = Object.keys(res).length;
  const failed = Object.values(res).filter((v) => v === 'fail').length;
  return (
    <div className="pv-split">
      <Card
        title="Round 2 · due Wednesday 8 October"
        action={<Chip tone="info">{done} of 8 tested</Chip>}
      >
        <ol className="pv-steps">
          {cases.map((c, i) => (
            <li key={c} className={'pv-step' + (res[i] === 'fail' ? ' pv-step--failed' : '')}>
              <span className="pv-step-num">{i + 1}</span>
              <div className="pv-step-body">
                <strong>{c}</strong>
                {res[i] === 'fail' ? (
                  <span className="pv-text-danger pv-small">
                    You reported: the new slot is not offered. Bug BUG-33 was created for your team.
                  </span>
                ) : (
                  <span className="pv-muted pv-small">Steps and expected result open on tap</span>
                )}
              </div>
              <div className="pv-step-results">
                <button
                  type="button"
                  className="pv-step-btn pv-step-btn--passed"
                  aria-pressed={res[i] === 'pass'}
                  onClick={() => {
                    setRes((r) => ({ ...r, [i]: 'pass' }));
                  }}
                >
                  Works
                </button>
                <button
                  type="button"
                  className="pv-step-btn pv-step-btn--failed"
                  aria-pressed={res[i] === 'fail'}
                  onClick={() => {
                    setRes((r) => ({ ...r, [i]: 'fail' }));
                  }}
                >
                  Problem
                </button>
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <div className="pv-stack">
        <Card title="Your result">
          <Bar value={done} max={8} tone={failed ? 'warning' : 'success'} />
          <p className="pv-muted pv-small">
            {done} tested · {failed} with a problem. Add a screenshot or voice note to any problem;
            the team gets it with your device data.
          </p>
          {signed ? (
            <Chip tone="success" icon="signoff">
              Accepted by Ines Vogel · 4 Oct 10:12 · with 1 known issue
            </Chip>
          ) : (
            <Button
              kind="primary"
              icon="signoff"
              onClick={() => {
                setSigned(true);
              }}
            >
              Accept round 2
            </Button>
          )}
        </Card>
        <Card title="Test on your phone">
          <p className="pv-muted pv-small">
            Open the portal on your phone and add it to the home screen; your results and recordings
            go straight to this round.
          </p>
        </Card>
      </div>
    </div>
  );
}

function Approvals(): ReactNode {
  const [signing, setSigning] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, 'approved' | 'declined'>>({});
  const [name, setName] = useState('');
  const items = [
    {
      id: 'CR-9',
      kind: 'Change request',
      title: 'SMS reminders 2 hours before',
      impact: ['8 points', euro(3400), 'release +2 days (19 Oct)'],
    },
    {
      id: 'D-12',
      kind: 'Design',
      title: 'Reminder settings v1 · 3 screens',
      impact: ['no cost change', 'part of CR-9', 'comment on any screen'],
    },
    {
      id: 'PRD-4',
      kind: 'Requirements',
      title: 'Video consultations PRD v2',
      impact: ['estimate 34–41 points', euro(14500) + ' to ' + euro(17400), 'November start'],
    },
  ];
  return (
    <div className="pv-stack">
      {items.map((it) => (
        <Card key={it.id}>
          <div className="pv-approval">
            <div className="pv-row-main">
              <span className="pv-muted pv-small">
                {it.kind} · <span className="pv-mono">{it.id}</span>
              </span>
              <strong className="pv-approval-title">{it.title}</strong>
              <div className="pv-attach">
                {it.impact.map((x) => (
                  <Chip key={x} tone="info">
                    {x}
                  </Chip>
                ))}
              </div>
            </div>
            {done[it.id] ? (
              <Chip
                tone={done[it.id] === 'approved' ? 'success' : 'neutral'}
                icon={done[it.id] === 'approved' ? 'signoff' : 'x'}
              >
                {done[it.id] === 'approved' ? 'Approved and signed' : 'Declined'}
              </Chip>
            ) : (
              <div className="pv-page-actions">
                <Button kind="ghost">Open</Button>
                <Button
                  onClick={() => {
                    setDone((d) => ({ ...d, [it.id]: 'declined' }));
                  }}
                >
                  Decline
                </Button>
                <Button
                  kind="primary"
                  icon="signoff"
                  onClick={() => {
                    setSigning(it.id);
                  }}
                >
                  Approve
                </Button>
              </div>
            )}
          </div>
          {signing === it.id ? (
            <div className="pv-sign">
              <p className="pv-small">
                Signing approves <strong>{it.title}</strong> with the impact shown above. Your name,
                the time and a fingerprint of this version are recorded.
              </p>
              <div className="pv-ask">
                <input
                  value={name}
                  placeholder="Type your full name"
                  aria-label="Your name"
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                />
                <Button
                  kind="primary"
                  onClick={() => {
                    if (!name.trim()) return;
                    setDone((d) => ({ ...d, [it.id]: 'approved' }));
                    setSigning(null);
                    setName('');
                  }}
                >
                  Sign
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function Releases(): ReactNode {
  const [stars, setStars] = useState(0);
  return (
    <div className="pv-split">
      <Card title="2.0.0 release candidate 3 · on your test environment since Thursday">
        <article className="pv-doc">
          <h3>New for patients</h3>
          <ul>
            <li>Book an appointment in three steps, also as a guest.</li>
            <li>Login works again on Android 12.</li>
          </ul>
          <h3>New for practices</h3>
          <ul>
            <li>Opening hours and holidays in one screen.</li>
          </ul>
          <h3>Known issues</h3>
          <ul>
            <li>Calendar times show in UTC (BUG-31, fix in rc.4).</li>
          </ul>
        </article>
        <div className="pv-page-actions pv-mt">
          <Button icon="play">Watch the 3-minute demo</Button>
          <Button kind="ghost" icon="external">
            Open the test environment
          </Button>
        </div>
      </Card>
      <Card title="How happy are you with this release?">
        <div className="pv-stars" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={stars === n}
              className={'pv-star' + (n <= stars ? ' pv-star--on' : '')}
              onClick={() => {
                setStars(n);
              }}
            >
              ★
            </button>
          ))}
        </div>
        {stars ? (
          <p className="pv-muted pv-small">
            Thank you. Mara Schulz, your account owner, reads every rating.
          </p>
        ) : (
          <p className="pv-muted pv-small">One click; a comment is optional.</p>
        )}
      </Card>
    </div>
  );
}

function Documents(): ReactNode {
  return (
    <Card flush title="Shared with Helio">
      <table className="pv-table">
        <tbody>
          {[
            ['Statement of work 2026.pdf', 'Contract', 'signed 2 Jun', true],
            ['Booking flow PRD v3', 'Requirements', 'approved by you 24 Sep', true],
            ['Review 2 Oct – notes', 'Meeting notes', 'new', false],
            ['Data protection: what we store', 'Answer to Q-8', 'draft, coming', false],
          ].map(([n, k, s, read]) => (
            <tr key={String(n)}>
              <td className="pv-cell-grow">
                <strong>{n}</strong>
                <span className="pv-muted pv-block pv-small">{k}</span>
              </td>
              <td className="pv-muted">{s}</td>
              <td>{read ? <Chip tone="success">read</Chip> : <Chip tone="primary">new</Chip>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Billing(): ReactNode {
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat
          label="Budget used"
          value={euro(88300)}
          sub={'of ' + euro(95000) + ' · 93 %'}
          tone="warning"
          icon="euro"
        />
        <Stat
          label="Forecast at release"
          value={euro(94100)}
          sub="within budget if CR-9 is not added"
          icon="insights"
        />
        <Stat
          label="Of which AI agents"
          value={euro(6120)}
          sub="7 % · shown separately as agreed"
          icon="agents"
        />
        <Stat label="Open invoices" value="1" sub="due 15 Oct" icon="documents" />
      </div>
      <Card title="Budget burn">
        <Bar
          value={88300}
          max={95000}
          tone="warning"
          marker={81000}
          label="93 % used, plan said 85 % by now"
        />
        <p className="pv-muted pv-small">
          Plan for today: 85 %. The two change requests you approved added €7 200.
        </p>
      </Card>
      <Card flush title="Invoices and quotes">
        <table className="pv-table">
          <tbody>
            {[
              ['INV-2026-041', 'September', euro(18400), 'open · due 15 Oct', 'warning'],
              ['INV-2026-033', 'August', euro(21200), 'paid', 'success'],
              ['Q-2026-019', 'Quote CR-9 SMS reminders', euro(3400), 'waiting for you', 'info'],
            ].map(([id, w, a, s, t]) => (
              <tr key={id}>
                <td className="pv-mono">{id}</td>
                <td className="pv-cell-grow">{w}</td>
                <td className="pv-num">{a}</td>
                <td>
                  <Chip tone={t as 'success'}>{s}</Chip>
                </td>
                <td>
                  <Button size="sm" kind="ghost">
                    PDF
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Meetings(): ReactNode {
  const [slot, setSlot] = useState<string | null>(null);
  const slots = [
    'Tue 7 Oct 10:00',
    'Tue 7 Oct 14:30',
    'Wed 8 Oct 09:00',
    'Thu 9 Oct 11:00',
    'Thu 9 Oct 15:00',
  ];
  return (
    <div className="pv-split">
      <Card title="Book a review or demo">
        <p className="pv-muted pv-small">
          Free times of Jonas, Sara and Mara, 45 minutes, video link included.
        </p>
        <div className="pv-slots">
          {slots.map((s) => (
            <button
              key={s}
              type="button"
              className="pv-slot"
              aria-pressed={slot === s}
              onClick={() => {
                setSlot(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
        {slot ? (
          <Chip tone="success" icon="check">
            {'Booked: ' + slot + ' · invitation sent · agenda drafted from your open items'}
          </Chip>
        ) : null}
      </Card>
      <Card flush title="Coming up">
        <ul className="pv-rows">
          {[
            ['Wed 8 Oct 10:00', 'Acceptance test round 2 walkthrough', 'Sara Yilmaz'],
            ['Fri 17 Oct 09:00', 'Release go / no-go', 'Mara Schulz'],
          ].map(([d, t, w]) => (
            <li key={d} className="pv-row pv-row--static">
              <span className="pv-next-date">{d}</span>
              <span className="pv-row-main">
                <span className="pv-row-title">{t}</span>
                <span className="pv-row-sub">with {w}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Status(): ReactNode {
  const days = Array.from({ length: 30 }, (_, i) => (i === 21 ? 'down' : i === 9 ? 'slow' : 'ok'));
  return (
    <div className="pv-stack">
      <div className="pv-callout pv-callout--warn">
        <PIcon name="incident" size={16} />
        <div>
          <strong>Booking is slow on the test environment</strong> since 09:40. The team is on it;
          next update by 10:30. Your production app is not affected.
        </div>
      </div>
      {['Production app', 'Booking service', 'Test environment', 'SMS provider'].map((s, k) => (
        <Card key={s}>
          <div className="pv-status-row">
            <strong>{s}</strong>
            <Chip tone={k === 2 ? 'warning' : 'success'}>{k === 2 ? 'slow' : 'working'}</Chip>
            <span className="pv-muted pv-small">{k === 2 ? '99.2 %' : '99.98 %'} in 30 days</span>
          </div>
          <svg
            className="pv-uptime"
            viewBox="0 0 300 20"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {days.map((d, i) => (
              <rect
                key={i}
                className={
                  'pv-up pv-up--' + (k === 2 && i > 27 ? 'slow' : k === 0 || k === 2 ? d : 'ok')
                }
                x={i * 10 + 1}
                y="2"
                width="8"
                height="16"
                rx="2"
              />
            ))}
          </svg>
        </Card>
      ))}
    </div>
  );
}

const TITLES: Record<string, string> = Object.fromEntries(
  PORTAL_SECTIONS.map((s) => [s.key, s.label]),
);

export function ClientPortalPage(props: { section: string }): ReactNode {
  const s = props.section;
  const body: Record<string, ReactNode> = {
    requests: <Requests />,
    roadmap: <Roadmap />,
    uat: <Uat />,
    approvals: <Approvals />,
    releases: <Releases />,
    documents: <Documents />,
    handover: <PortalHandover />,
    billing: <Billing />,
    meetings: <Meetings />,
    status: <Status />,
  };
  const icon = PORTAL_SECTIONS.find((x) => x.key === s)?.icon ?? 'home';
  return (
    <div className="pv-page">
      <PageHead title={TITLES[s] ?? 'Portal'} sub="Helio Health AG · Patient app" icon={icon} />
      {body[s]}
    </div>
  );
}
