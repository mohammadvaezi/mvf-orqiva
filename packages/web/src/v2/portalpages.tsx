// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-338 | S15 | v0.1.0] T34.1c Meeting notes and actions into tasks; the team's client overview with health, revenue, activity and people ──
// ── [PCODE-336 | S15 | v0.1.0] T34.1a Portal home with health, milestone, release and budget; release deliverables and demos; client sign-off per release; files on acceptance results ──
// ── [PCODE-294 | S15 | v0.1.0] T30.8a Overlay compare of mockup versions, client pins in the portal ──
// ── [PCODE-293 | S15 | v0.1.0] T30.7 Generated asset sizes and a download portal ──
// ── [PCODE-277 | S15 | v0.1.0] T28.6 PRD approval by named approvers, reopen on edit, promote to an epic with stories, client in ideation ──
// ── [PCODE-200 | S15 | v0.1.0] T16.4 Handover screens: design preview, team Handover tab, portal Handover section with signature ──
// ── [PCODE-191 | S15 | v0.1.0] B7.6 Client status page with uptime probes, own portal domains with DNS verification and on-demand TLS ──
// ── [PCODE-189 | S15 | v0.1.0] B7.5 Portal budget and invoices with PDF, quotes, meeting booking with agenda and calendar file ──
// ── [PCODE-186 | S15 | v0.1.0] B7.2 Client portal live: roadmap, acceptance tests, approvals, releases with ratings, shared documents ──
//    Why:  the portal's sections as the approved screens show them, live: the roadmap with what moved and
//          why, acceptance rounds to test and accept, quotes and designs to approve with a signature, release
//          notes to read and rate, shared documents with what is new. A team member opens the same pages
//          for a client ("view as client", read only) with ?client=… in the address.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Bar, Button, Card, Chip, PageHead, Stat } from '../preview/ui.js';
import { Markdown } from './markdown.js';
import { PORTAL_PAGES } from './portal.js';
// [PCODE-200 | S15 | v0.1.0]
import {
  PackView,
  PortalHandoverView,
  type PackContentsView,
  type PackSummaryView,
} from './handover.js';
import { PortalPrds, PortalQuestions } from './portalprd.js'; // [PCODE-277 | S15 | v0.1.0]
import { PortalAssets } from './assetsizes.js'; // [PCODE-293 | S15 | v0.1.0]
import { PortalDesign } from './portaldesign.js'; // [PCODE-294 | S15 | v0.1.0]
import { impactChips } from './requests.js';
import { euroCents } from './shell.js';
// [PCODE-336 | S15 | v0.1.0]
import { DeliverableList, signOffText, type Deliverable, type SignOff } from './deliverables.js';
import { uploadFile } from './files.js';
import { PortalMeetingNotes } from './clientwork.js'; // [PCODE-338 | S15 | v0.1.0]
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

interface Frame {
  client: { id: string; name: string };
  projects: { id: string; key: string; name: string }[];
  shares: Record<string, boolean>;
  roles: string[];
  asTeam: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A short date in the interface's language: 8 Oct. */
const dmy = (d: string | null): string => {
  if (!d) return '—';
  const x = new Date(d.length === 10 ? d + 'T00:00:00' : d);
  return String(x.getDate()) + ' ' + (MONTHS[x.getMonth()] ?? '');
};

/** The roadmap's bars: x and width in a 900-wide box, the today line, and month ticks. */
export function roadmapGeometry(
  items: { start: string | null; due: string | null }[],
  today: string,
): {
  bars: { x: number; w: number }[];
  todayX: number | null;
  ticks: { x: number; label: string }[];
} {
  const LEFT = 220;
  const WIDTH = 660;
  const days = (d: string): number => Date.parse(d + 'T00:00:00Z') / 86_400_000;
  const all = items.flatMap((i) => [i.start, i.due]).filter((d): d is string => Boolean(d));
  if (!all.length) return { bars: [], todayX: null, ticks: [] };
  const lo = Math.min(...all.map(days), days(today)) - 3;
  const hi = Math.max(...all.map(days), days(today)) + 3;
  const x = (d: string): number => LEFT + ((days(d) - lo) / (hi - lo)) * WIDTH;
  const ticks: { x: number; label: string }[] = [];
  const first = new Date(lo * 86_400_000);
  for (
    let m = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
    m.getTime() / 86_400_000 < hi;
    m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))
  )
    ticks.push({
      x: x(m.toISOString().slice(0, 10)),
      label: MONTHS[m.getUTCMonth()] ?? '',
    });
  return {
    bars: items.map((i) => {
      const a = i.start ?? i.due ?? today;
      const b = i.due ?? i.start ?? today;
      return { x: x(a), w: Math.max(6, x(b) - x(a)) };
    }),
    todayX: x(today),
    ticks,
  };
}

export function PortalPage(props: {
  workspaceId: string;
  section: string;
  docId: string | null;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const W = '/api/workspaces/' + props.workspaceId;
  const clientParam =
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('client');
  const qs = clientParam ? '?clientId=' + encodeURIComponent(clientParam) : '';
  const [frame, setFrame] = useState<Frame | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Frame>('GET', W + '/portal' + qs).then((r) => {
      if (r.ok) setFrame(r.data);
      else setError(r.error.message);
    });
  }, [W, qs]);
  const page = PORTAL_PAGES.find((p) => p.key === props.section) ?? PORTAL_PAGES[0];
  const ctx = { base: W, qs, hub: props.hub, go: props.go, frame };
  return (
    <div className="pv-page">
      <PageHead
        title={page?.label ?? 'Portal'}
        sub={
          frame
            ? frame.client.name +
              ' · ' +
              (frame.projects.map((p) => p.name).join(', ') || 'no project yet') +
              (frame.asTeam ? ' · as the client sees it' : '')
            : 'Loading…'
        }
        icon={page?.icon ?? 'home'}
      />
      {frame?.asTeam ? (
        <nav className="pv-subtabs" aria-label="Portal sections">
          {PORTAL_PAGES.map((p) => (
            <button
              key={p.key}
              type="button"
              className="pv-subtab"
              aria-pressed={p.key === props.section}
              onClick={() => {
                props.go('/portal/' + p.key + '?client=' + frame.client.id);
              }}
            >
              <PIcon name={p.icon} size={14} />
              {p.label}
            </button>
          ))}
        </nav>
      ) : null}
      {frame?.asTeam ? (
        <div className="pv-callout">
          <PIcon name="user" size={16} />
          <div>
            You are looking at {frame.client.name}’s portal as their contacts see it. Nothing here
            can be changed from this view.
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {props.section === 'roadmap' ? <Roadmap {...ctx} /> : null}
      {props.section === 'acceptance' ? <Acceptance {...ctx} /> : null}
      {props.section === 'approvals' ? <Approvals {...ctx} /> : null}
      {props.section === 'releases' ? <Releases {...ctx} /> : null}
      {props.section === 'documents' ? <Documents {...ctx} docId={props.docId} /> : null}
      {props.section === 'handover' ? <Handover {...ctx} /> : null}
      {/* [PCODE-189 | S15 | v0.1.0] */}
      {props.section === 'billing' ? <Billing {...ctx} /> : null}
      {props.section === 'meetings' ? <Meetings {...ctx} /> : null}
      {props.section === 'status' ? <Status {...ctx} /> : null}
      {/* [PCODE-293 | S15 | v0.1.0] the download portal */}
      {props.section === 'assets' ? (
        <PortalAssets base={W} qs={qs} clientName={frame?.client.name ?? 'you'} />
      ) : null}
    </div>
  );
}

interface Ctx {
  base: string;
  qs: string;
  hub: EventHub;
  go: (p: string) => void;
  frame: Frame | null;
}

/** Loads a portal section and reloads it on live changes. */
function useSection<T>(ctx: Ctx, path: string): [T | null, string, () => Promise<void>] {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<T>('GET', ctx.base + '/portal' + path + ctx.qs);
    if (r.ok) {
      setData(r.data);
      setError('');
    } else setError(r.error.message);
  }, [ctx.base, ctx.qs, path]);
  useEffect(() => {
    void load();
    return ctx.hub.on(() => void load());
  }, [load, ctx.hub]);
  return [data, error, load];
}

function NotShared(props: { error: string }): ReactNode {
  return (
    <Card>
      <div className="pv-empty">
        <PIcon name="lock" size={28} />
        <strong>{props.error}</strong>
        <span>Ask your team if you need it here.</span>
      </div>
    </Card>
  );
}

function Empty(props: { icon: PIconName; title: string; text: string }): ReactNode {
  return (
    <Card>
      <div className="pv-empty">
        <PIcon name={props.icon} size={28} />
        <strong>{props.title}</strong>
        <span>{props.text}</span>
      </div>
    </Card>
  );
}

// ── roadmap ──
interface RoadmapData {
  today: string;
  projects: { id: string; key: string; name: string }[];
  items: {
    id: string;
    projectId: string;
    title: string;
    kind: string;
    start: string | null;
    due: string | null;
    status: 'done' | 'now' | 'next' | 'later';
  }[];
  moved: {
    id: string;
    title: string;
    from: string;
    to: string;
    days: number;
    baseline: string;
    baselineAt: string;
    changes: { ref: string; title: string }[];
  }[];
}

function Roadmap(props: Ctx): ReactNode {
  const [d, error] = useSection<RoadmapData>(props, '/roadmap');
  if (error) return <NotShared error={error} />;
  if (!d) return null;
  if (!d.items.length)
    return (
      <Empty
        icon="canvas"
        title="No dated epics or milestones yet."
        text="When your team plans the big steps with dates, they show here."
      />
    );
  return (
    <div className="pv-stack">
      {d.projects
        .filter((p) => d.items.some((i) => i.projectId === p.id))
        .map((p) => {
          const items = d.items.filter((i) => i.projectId === p.id);
          const g = roadmapGeometry(items, d.today);
          const h = 40 + items.length * 36;
          return (
            <Card key={p.id} title={p.name + ' · what happens when'}>
              <svg
                className="pv-portfolio"
                viewBox={'0 0 900 ' + String(h)}
                role="img"
                aria-label="Roadmap"
              >
                {g.ticks.map((t) => (
                  <g key={t.label + String(t.x)}>
                    <line className="pv-gridline" x1={t.x} x2={t.x} y1="10" y2={h - 6} />
                    <text className="pv-axis" x={t.x + 4} y="20">
                      {t.label}
                    </text>
                  </g>
                ))}
                {items.map((it, i) => (
                  <g key={it.id}>
                    <text className="pv-mind-text pv-mind-text--epic" x="10" y={52 + i * 36}>
                      {it.title.length > 28 ? it.title.slice(0, 27) + '…' : it.title}
                    </text>
                    {it.kind === 'milestone' ? (
                      <rect
                        className={'pv-road pv-road--' + it.status}
                        x={(g.bars[i]?.x ?? 0) + (g.bars[i]?.w ?? 0) - 7}
                        y={41 + i * 36}
                        width="14"
                        height="14"
                        rx="2"
                        transform={
                          'rotate(45 ' +
                          String((g.bars[i]?.x ?? 0) + (g.bars[i]?.w ?? 0)) +
                          ' ' +
                          String(48 + i * 36) +
                          ')'
                        }
                      />
                    ) : (
                      <rect
                        className={'pv-road pv-road--' + it.status}
                        x={g.bars[i]?.x ?? 0}
                        y={38 + i * 36}
                        width={g.bars[i]?.w ?? 0}
                        height="20"
                        rx="5"
                      />
                    )}
                  </g>
                ))}
                {g.todayX !== null ? (
                  <line className="pv-today" x1={g.todayX} x2={g.todayX} y1="26" y2={h - 6} />
                ) : null}
              </svg>
              <div className="pv-attach pv-mt">
                <Chip tone="success">done</Chip>
                <Chip tone="primary">now</Chip>
                <Chip tone="info">next two weeks</Chip>
                <Chip>later</Chip>
              </div>
            </Card>
          );
        })}
      <Card title="What moved and why">
        {d.moved.length ? (
          <ul className="pv-changes">
            {d.moved.map((m) => (
              <li key={m.id}>
                <strong>
                  {m.title} moved from {dmy(m.from)} to {dmy(m.to)}
                </strong>{' '}
                —{' '}
                {m.days > 0
                  ? String(m.days) + (m.days === 1 ? ' day later' : ' days later')
                  : String(-m.days) + (m.days === -1 ? ' day earlier' : ' days earlier')}{' '}
                than planned in “{m.baseline}” ({dmy(m.baselineAt)})
                {m.changes.length
                  ? '; since then you approved ' +
                    m.changes.map((c) => c.ref + ' ' + c.title).join(', ')
                  : ''}
                .
              </li>
            ))}
          </ul>
        ) : (
          <p className="pv-muted pv-small">Everything is where the last agreed plan put it.</p>
        )}
      </Card>
    </div>
  );
}

// ── acceptance tests ──
interface Round {
  id: string;
  projectId: string; // [PCODE-336 | S15 | v0.1.0]
  name: string;
  open: boolean;
  dueOn: string | null;
  tested: number;
  problems: number;
  accepted: { by: string; at: string; note: string } | null;
  cases: {
    id: string;
    title: string;
    steps: { action: string; expected: string }[];
    expected: string;
    result: 'works' | 'problem' | null;
    note: string;
    tester: string | null;
    files?: { id: string; name: string; mime: string; kind: string }[]; // [PCODE-336 | S15 | v0.1.0]
  }[];
}

function Acceptance(props: Ctx): ReactNode {
  const [d, error, load] = useSection<{ rounds: Round[]; mayTest: boolean; mayAccept: boolean }>(
    props,
    '/acceptance',
  );
  if (error) return <NotShared error={error} />;
  if (!d) return null;
  if (!d.rounds.length)
    return (
      <Empty
        icon="test"
        title="No acceptance round yet."
        text="When your team shares a round, you test each case here, also on your phone."
      />
    );
  return (
    <div className="pv-stack">
      {d.rounds.map((r) => (
        <RoundCard
          key={r.id}
          round={r}
          base={props.base}
          mayTest={d.mayTest}
          mayAccept={d.mayAccept}
          onChanged={() => void load()}
        />
      ))}
    </div>
  );
}

function RoundCard(props: {
  round: Round;
  base: string;
  mayTest: boolean;
  mayAccept: boolean;
  onChanged: () => void;
}): ReactNode {
  const r = props.round;
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ caseId: string; note: string } | null>(null);
  // [PCODE-336 | S15 | v0.1.0] screenshots or recordings with a problem
  const [shots, setShots] = useState<File[]>([]);
  const ws = props.base.split('/')[3] ?? '';
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const R = props.base + '/portal/acceptance/' + r.id;
  const post = async (path: string, body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    const res = await api('POST', R + path, body);
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return false;
    }
    setError('');
    props.onChanged();
    return true;
  };
  const can = props.mayTest && r.open;
  return (
    <div className="pv-split">
      <Card
        title={r.name + (r.dueOn ? ' · due ' + dmy(r.dueOn) : '')}
        action={
          <Chip tone="info">
            {r.tested} of {r.cases.length} tested
          </Chip>
        }
      >
        <ol className="pv-steps">
          {r.cases.map((c, i) => (
            <li
              key={c.id}
              className={'pv-step' + (c.result === 'problem' ? ' pv-step--failed' : '')}
            >
              <span className="pv-step-num">{i + 1}</span>
              <div className="pv-step-body">
                <button
                  type="button"
                  className="pv-link-btn pv-strong v2-left"
                  aria-expanded={open === c.id}
                  onClick={() => {
                    setOpen(open === c.id ? null : c.id);
                  }}
                >
                  {c.title}
                </button>
                {c.result === 'problem' ? (
                  <span className="pv-text-danger pv-small">Problem: {c.note}</span>
                ) : c.result === 'works' ? (
                  <span className="pv-muted pv-small">Works{c.tester ? ' · ' + c.tester : ''}</span>
                ) : (
                  <span className="pv-muted pv-small">Steps and expected result open on tap</span>
                )}
                {open === c.id ? (
                  <ol className="pv-small">
                    {(c.steps.length ? c.steps : [{ action: 'Try it', expected: c.expected }]).map(
                      (s, k) => (
                        <li key={k}>
                          {s.action}
                          {s.expected ? <span className="pv-muted"> → {s.expected}</span> : null}
                        </li>
                      ),
                    )}
                  </ol>
                ) : null}
                {c.files?.length ? (
                  <span className="pv-small">
                    {c.files.map((f) => (
                      <a
                        key={f.id}
                        className="pv-file-link"
                        href={props.base + '/files/' + f.id + '/content'}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {f.name}
                      </a>
                    ))}
                  </span>
                ) : null}
                {problem?.caseId === c.id ? (
                  <div className="pv-ask">
                    <input
                      value={problem.note}
                      placeholder="What went wrong?"
                      aria-label="What went wrong"
                      onChange={(e) => {
                        setProblem({ caseId: c.id, note: e.target.value });
                      }}
                    />
                    <input
                      type="file"
                      multiple
                      accept="image/*,video/*,application/pdf"
                      aria-label="Screenshots or a recording"
                      onChange={(e) => {
                        setShots([...(e.target.files ?? [])].slice(0, 10));
                      }}
                    />
                    <Button
                      kind="primary"
                      size="sm"
                      disabled={busy || !problem.note.trim()}
                      onClick={() =>
                        void (async () => {
                          const fileIds: string[] = [];
                          for (const f of shots) {
                            const up = await uploadFile(ws, r.projectId, f);
                            if (!up.ok) {
                              setError(up.error.message);
                              return;
                            }
                            fileIds.push(up.data.id);
                          }
                          const ok = await post('/results', {
                            caseId: c.id,
                            result: 'problem',
                            note: problem.note.trim(),
                            ...(fileIds.length ? { fileIds } : {}),
                          });
                          if (ok) {
                            setProblem(null);
                            setShots([]);
                          }
                        })()
                      }
                    >
                      Report
                    </Button>
                  </div>
                ) : null}
              </div>
              {can ? (
                <div className="pv-step-results">
                  <button
                    type="button"
                    className="pv-step-btn pv-step-btn--passed"
                    aria-pressed={c.result === 'works'}
                    disabled={busy}
                    onClick={() => void post('/results', { caseId: c.id, result: 'works' })}
                  >
                    Works
                  </button>
                  <button
                    type="button"
                    className="pv-step-btn pv-step-btn--failed"
                    aria-pressed={c.result === 'problem'}
                    disabled={busy}
                    onClick={() => {
                      setProblem({ caseId: c.id, note: '' });
                    }}
                  >
                    Problem
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </Card>
      <div className="pv-stack">
        <Card title="Your result">
          <Bar
            value={r.tested}
            max={Math.max(1, r.cases.length)}
            tone={r.problems ? 'warning' : 'success'}
          />
          <p className="pv-muted pv-small">
            {r.tested} tested · {r.problems} with a problem. Each problem reaches your team as a bug
            request.
          </p>
          {r.accepted ? (
            <Chip tone="success" icon="signoff">
              Accepted by {r.accepted.by} · {dmy(r.accepted.at)} · {r.accepted.note}
            </Chip>
          ) : props.mayAccept && r.open ? (
            <div className="pv-sign">
              <p className="pv-small">
                Accepting signs this round with the results above. Your name, the time and a
                fingerprint of the results are recorded.
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
                  icon="signoff"
                  disabled={busy || name.trim().length < 3 || r.tested < r.cases.length}
                  onClick={() => void post('/accept', { signedName: name.trim() })}
                >
                  Accept the round
                </Button>
              </div>
            </div>
          ) : null}
          {error ? (
            <p className="v2-error" role="alert">
              {error}
            </p>
          ) : null}
        </Card>
        <Card title="Test on your phone">
          <p className="pv-muted pv-small">
            Open the portal on your phone and add it to the home screen; your results go straight to
            this round.
          </p>
        </Card>
      </div>
    </div>
  );
}

// ── approvals ──
interface Approval {
  kind: 'change' | 'design';
  id: string;
  ref: string;
  title: string;
  waiting: boolean;
  impact: { points: number; priceCents: number; days: number } | null;
  fileId: string | null;
  version: number | null;
  note: string | null;
  decision: { decision: string; by: string | null; at: string | null; note: string | null } | null;
}

function Approvals(props: Ctx): ReactNode {
  const [d, error, load] = useSection<{ items: Approval[]; mayDecide: boolean }>(
    props,
    '/approvals',
  );
  const [signing, setSigning] = useState<string | null>(null);
  const [looking, setLooking] = useState<string | null>(null); // [PCODE-294 | S15 | v0.1.0] the design open to pin
  const [declining, setDeclining] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // [PCODE-277 | S15 | v0.1.0] the PRDs to sign and the questions to answer come first, shared or not
  const ideation = (
    <>
      <PortalPrds base={props.base} qs={props.qs} hub={props.hub} />
      <PortalQuestions base={props.base} qs={props.qs} hub={props.hub} />
    </>
  );
  if (error)
    return (
      <div className="pv-stack">
        {ideation}
        <NotShared error={error} />
      </div>
    );
  if (!d) return ideation;
  if (!d.items.length)
    return (
      <div className="pv-stack">
        {ideation}
        <Empty
          icon="signoff"
          title="No quote or design waits for your decision."
          text="Quotes for changes and designs your team shares for approval show here."
        />
      </div>
    );
  const decide = async (a: Approval, decision: 'approved' | 'declined'): Promise<void> => {
    setBusy(true);
    const path =
      a.kind === 'change'
        ? '/client-requests/' + a.id + '/decision'
        : '/portal/designs/' + a.id + '/decision';
    const body =
      decision === 'approved'
        ? { decision, signedName: text.trim() }
        : { decision, ...(text.trim() ? { note: text.trim() } : {}) };
    const r = await api('POST', props.base + path, body);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error.message);
      return;
    }
    setErr('');
    setSigning(null);
    setDeclining(null);
    setText('');
    await load();
  };
  return (
    <div className="pv-stack">
      {ideation}
      {d.items.map((a) => (
        <Card key={a.kind + a.id}>
          <div className="pv-approval">
            <div className="pv-row-main">
              <span className="pv-muted pv-small">
                {a.kind === 'change' ? 'Change request' : 'Design · version ' + String(a.version)} ·{' '}
                <span className="pv-mono">{a.ref}</span>
              </span>
              <strong className="pv-approval-title">{a.title}</strong>
              <div className="pv-attach">
                {a.impact
                  ? impactChips(a.impact).map((x) => (
                      <Chip key={x} tone="info">
                        {x}
                      </Chip>
                    ))
                  : null}
                {a.note ? <span className="pv-muted pv-small">{a.note}</span> : null}
              </div>
            </div>
            {a.decision && !a.waiting ? (
              <Chip
                tone={a.decision.decision === 'approved' ? 'success' : 'neutral'}
                icon={a.decision.decision === 'approved' ? 'signoff' : 'x'}
              >
                {a.decision.decision === 'approved'
                  ? 'Approved and signed by ' + (a.decision.by ?? '')
                  : a.kind === 'design'
                    ? 'Changes asked for'
                    : 'Declined'}
              </Chip>
            ) : d.mayDecide && a.waiting ? (
              <div className="pv-page-actions">
                {a.kind === 'change' ? (
                  <Button
                    kind="ghost"
                    onClick={() => {
                      props.go('/requests/' + a.id);
                    }}
                  >
                    Open
                  </Button>
                ) : null}
                <Button
                  onClick={() => {
                    setDeclining(a.id);
                    setSigning(null);
                    setText('');
                  }}
                >
                  {a.kind === 'design' ? 'Ask for changes' : 'Decline'}
                </Button>
                <Button
                  kind="primary"
                  icon="signoff"
                  onClick={() => {
                    setSigning(a.id);
                    setDeclining(null);
                    setText('');
                  }}
                >
                  Approve
                </Button>
              </div>
            ) : a.waiting ? (
              <Chip tone="warning">waiting for an approver</Chip>
            ) : null}
          </div>
          {/* [PCODE-294 | S15 | v0.1.0] a design opens to look closely and pin comments to it */}
          {a.kind === 'design' && looking === a.id ? (
            <PortalDesign base={props.base} qs={props.qs} id={a.id} />
          ) : a.fileId ? (
            <img
              className="v2-asset-img pv-mt"
              src={props.base + '/files/' + a.fileId + '/content'}
              alt={a.title}
            />
          ) : null}
          {a.kind === 'design' ? (
            <button
              type="button"
              className="pv-link-btn pv-small"
              onClick={() => {
                setLooking(looking === a.id ? null : a.id);
              }}
            >
              {looking === a.id ? 'Close' : 'Look closely and pin comments'}
            </button>
          ) : null}
          {signing === a.id || declining === a.id ? (
            <div className="pv-sign">
              <p className="pv-small">
                {signing === a.id ? (
                  <>
                    Signing approves <strong>{a.title}</strong>
                    {a.impact ? ' with the impact shown above' : ' in this version'}. Your name, the
                    time and a fingerprint of this version are recorded.
                  </>
                ) : a.kind === 'design' ? (
                  'Say what should change; your team gets it with the design.'
                ) : (
                  'Declining closes the request. A note helps your team.'
                )}
              </p>
              <div className="pv-ask">
                <input
                  value={text}
                  placeholder={signing === a.id ? 'Type your full name' : 'What should change?'}
                  aria-label={signing === a.id ? 'Your name' : 'Note'}
                  onChange={(e) => {
                    setText(e.target.value);
                  }}
                />
                <Button
                  kind="primary"
                  disabled={busy || (signing === a.id && text.trim().length < 3)}
                  onClick={() => void decide(a, signing === a.id ? 'approved' : 'declined')}
                >
                  {signing === a.id ? 'Sign' : 'Send'}
                </Button>
              </div>
              {err ? (
                <p className="v2-error" role="alert">
                  {err}
                </p>
              ) : null}
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

// ── [PCODE-200 | S15 | v0.1.0] handover packs: read, download, accept or ask for changes ──
type PortalPacks = {
  mayDecide: boolean;
  packs: { projectKey: string; projectName: string; latest: boolean; pack: PackSummaryView }[];
};

function Handover(props: Ctx): ReactNode {
  const [d, error, load] = useSection<PortalPacks>(props, '/handover');
  const [open, setOpen] = useState<{ pack: PackSummaryView; contents: PackContentsView } | null>(
    null,
  );
  const H = (id: string, p = ''): string => props.base + '/portal/handover/' + id + p;
  const show = async (id: string): Promise<void> => {
    const r = await api<{ pack: PackSummaryView; contents: PackContentsView }>(
      'GET',
      H(id) + props.qs,
    );
    if (r.ok) setOpen(r.data);
  };
  if (error) return <NotShared error={error} />;
  if (!d) return null;
  if (open)
    return (
      <PackView
        pack={open.pack}
        contents={open.contents}
        pdfHref={H(open.pack.id, '/pdf') + props.qs}
        mayDecide={d.mayDecide}
        openPage={async (pageId) => {
          const r = await api<{ title: string; version: number; body: string }>(
            'GET',
            H(open.pack.id, '/pages/' + pageId) + props.qs,
          );
          return r.ok ? r.data : null;
        }}
        onDecide={async (decision, text) => {
          const r = await api(
            'POST',
            H(open.pack.id, '/decision'),
            decision === 'accepted' ? { decision, signedName: text } : { decision, note: text },
          );
          if (!r.ok) return r.error.message;
          await load();
          await show(open.pack.id);
          return '';
        }}
        onBack={() => {
          setOpen(null);
        }}
      />
    );
  return (
    <PortalHandoverView
      packs={d.packs}
      pdfHref={(id) => H(id, '/pdf') + props.qs}
      onOpen={(id) => void show(id)}
    />
  );
}

// ── releases ──
interface ReleaseNote {
  id: string;
  projectKey: string;
  version: string;
  name: string;
  state: 'candidate' | 'released';
  targetDate: string | null;
  releasedAt: string | null;
  notes: string;
  myRating: number | null;
  rating: number | null;
  ratings: number;
  deliverables?: Deliverable[]; // [PCODE-336 | S15 | v0.1.0]
  signOff?: SignOff | null;
}

function Releases(props: Ctx): ReactNode {
  const [d, error, load] = useSection<{
    releases: ReleaseNote[];
    mayRate: boolean;
    maySignOff?: boolean;
  }>(props, '/releases');
  if (error) return <NotShared error={error} />;
  if (!d) return null;
  if (!d.releases.length)
    return (
      <Empty
        icon="releases"
        title="No release notes yet."
        text="Each release your team prepares for you is explained here, in your words."
      />
    );
  const rate = async (id: string, n: number): Promise<void> => {
    const r = await api('POST', props.base + '/portal/releases/' + id + '/rating', { rating: n });
    if (r.ok) await load();
  };
  return (
    <div className="pv-stack">
      {d.releases.map((r) => (
        <div key={r.id} className="pv-split">
          <Card
            title={
              r.projectKey +
              ' ' +
              r.version +
              (r.name ? ' · ' + r.name : '') +
              (r.state === 'released'
                ? ' · released ' + dmy(r.releasedAt)
                : ' · candidate on your test environment')
            }
          >
            <article className="pv-doc">
              <Markdown text={r.notes} />
            </article>
            {/* [PCODE-336 | S15 | v0.1.0] links and demos of the release */}
            <DeliverableList base={props.base} items={r.deliverables ?? []} />
          </Card>
          <Card title="How happy are you with this release?">
            {d.mayRate ? (
              <div className="pv-stars" role="radiogroup" aria-label="Rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={r.myRating === n}
                    aria-label={String(n) + (n === 1 ? ' star' : ' stars')}
                    className={'pv-star' + (n <= (r.myRating ?? 0) ? ' pv-star--on' : '')}
                    onClick={() => void rate(r.id, n)}
                  >
                    ★
                  </button>
                ))}
              </div>
            ) : null}
            <p className="pv-muted pv-small">
              {r.myRating
                ? 'Thank you. Your account owner reads every rating.'
                : r.ratings
                  ? String(r.ratings) +
                    (r.ratings === 1 ? ' rating' : ' ratings') +
                    ', ' +
                    String(r.rating).replace('.', ',') +
                    ' on average.'
                  : 'One click; a comment is optional.'}
            </p>
            {/* [PCODE-336 | S15 | v0.1.0] the client's sign-off */}
            {r.signOff ? (
              <Chip tone={r.signOff.decision === 'approved' ? 'success' : 'danger'} icon="signoff">
                {signOffText(r.signOff)}
              </Chip>
            ) : d.maySignOff ? (
              <ReleaseSignOff base={props.base} releaseId={r.id} onDone={() => void load()} />
            ) : null}
          </Card>
        </div>
      ))}
    </div>
  );
}

// [PCODE-336 | S15 | v0.1.0] sign off or decline a release with a typed name
function ReleaseSignOff(props: { base: string; releaseId: string; onDone: () => void }): ReactNode {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const send = async (decision: 'approved' | 'declined'): Promise<void> => {
    const r = await api('POST', props.base + '/portal/releases/' + props.releaseId + '/sign-off', {
      decision,
      signedName: name.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!r.ok) setError(r.error.message);
    else props.onDone();
  };
  return (
    <div className="pv-sign">
      <p className="pv-small">Sign off the release with your name, or decline it and say why.</p>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <input
        className="v2-input v2-input--sm"
        aria-label="Your name"
        placeholder="Your full name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <input
        className="v2-input v2-input--sm"
        aria-label="Note"
        placeholder="A note (needed to decline)"
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
      />
      <span className="pv-page-actions">
        <Button
          kind="primary"
          size="sm"
          disabled={name.trim().length < 3}
          onClick={() => void send('approved')}
        >
          Sign off
        </Button>
        <Button
          size="sm"
          kind="ghost"
          disabled={name.trim().length < 3 || !note.trim()}
          onClick={() => void send('declined')}
        >
          Decline
        </Button>
      </span>
    </div>
  );
}

// ── documents ──
interface Doc {
  kind: 'page' | 'file';
  id: string;
  title: string;
  type: string;
  updatedAt: string;
  isNew: boolean;
  mime: string | null;
  size: number | null;
}

function Documents(props: Ctx & { docId: string | null }): ReactNode {
  const [d, error, load] = useSection<{ documents: Doc[] }>(props, '/documents');
  const [page, setPage] = useState<{ title: string; body: string; updatedAt: string } | null>(null);
  useEffect(() => {
    if (!props.docId) {
      setPage(null);
      return;
    }
    void api<{ title: string; body: string; updatedAt: string }>(
      'GET',
      props.base + '/portal/documents/' + props.docId + props.qs,
    ).then((r) => {
      if (r.ok) {
        setPage(r.data);
        void load();
      }
    });
  }, [props.base, props.docId, props.qs, load]);
  if (error) return <NotShared error={error} />;
  if (!d) return null;
  if (page)
    return (
      <Card
        title={page.title}
        action={
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              props.go(
                '/portal/documents' + (props.qs ? props.qs.replace('clientId', 'client') : ''),
              );
            }}
          >
            All documents
          </Button>
        }
      >
        <article className="pv-doc">
          <Markdown text={page.body} />
        </article>
        <p className="pv-muted pv-small pv-mt">Updated {dmy(page.updatedAt)}</p>
      </Card>
    );
  if (!d.documents.length)
    return (
      <Empty
        icon="documents"
        title="Nothing shared yet."
        text="Contracts, requirements, meeting notes and answers your team shares show here."
      />
    );
  const fileRead = (id: string): void => {
    void api('POST', props.base + '/portal/documents/files/' + id + '/read', {}).then(() => load());
  };
  return (
    <Card flush title={'Shared with ' + (props.frame?.client.name ?? 'you')}>
      <table className="pv-table">
        <tbody>
          {d.documents.map((x) => (
            <tr key={x.kind + x.id}>
              <td className="pv-cell-grow">
                {x.kind === 'page' ? (
                  <button
                    type="button"
                    className="pv-link-btn pv-strong"
                    onClick={() => {
                      props.go(
                        '/portal/documents/' +
                          x.id +
                          (props.qs ? props.qs.replace('clientId', 'client') : ''),
                      );
                    }}
                  >
                    {x.title}
                  </button>
                ) : (
                  <a
                    className="pv-strong"
                    href={props.base + '/files/' + x.id + '/content'}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => {
                      fileRead(x.id);
                    }}
                  >
                    {x.title}
                  </a>
                )}
                <span className="pv-muted pv-block pv-small">
                  {x.type}
                  {x.size !== null
                    ? ' · ' + String(Math.max(1, Math.round(x.size / 1024))) + ' KB'
                    : ''}
                </span>
              </td>
              <td className="pv-muted v2-nowrap">{dmy(x.updatedAt)}</td>
              <td>
                {x.isNew ? <Chip tone="primary">new</Chip> : <Chip tone="success">read</Chip>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ── [PCODE-189 | S15 | v0.1.0] budget and invoices ──
interface BillingData {
  budgetCents: number | null;
  usedCents: number;
  peopleCents: number;
  aiCents: number | null;
  forecastCents: number | null;
  forecastOn: string | null;
  planCents: number | null;
  addedByChangesCents: number;
  openInvoices: number;
  invoices: {
    id: string;
    number: string;
    periodLabel: string;
    grossCents: number;
    state: string;
    overdue: boolean;
    dueOn: string | null;
    paidOn: string | null;
  }[];
  quotes: { id: string; ref: string; title: string; priceCents: number }[];
}

/** An invoice's state in the client's words, and its colour. */
export function invoiceState(i: { state: string; overdue: boolean; dueOn: string | null }): {
  text: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
} {
  if (i.state === 'paid') return { text: 'paid', tone: 'success' };
  if (i.state === 'void') return { text: 'cancelled', tone: 'neutral' };
  if (i.overdue) return { text: 'overdue since ' + dmy(i.dueOn), tone: 'danger' };
  return { text: 'open · due ' + dmy(i.dueOn), tone: 'warning' };
}

function Billing(props: Ctx): ReactNode {
  const [d, error] = useSection<BillingData>(props, '/billing');
  if (error) return <NotShared error={error} />;
  if (!d) return null;
  const pct = d.budgetCents ? Math.round((d.usedCents / d.budgetCents) * 100) : null;
  const planPct =
    d.budgetCents && d.planCents !== null ? Math.round((d.planCents / d.budgetCents) * 100) : null;
  const over = pct !== null && planPct !== null && pct > planPct + 5;
  const overdue = d.invoices.some((i) => i.overdue);
  const toApprovals = props.qs ? props.qs.replace('clientId', 'client') : '';
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat
          label="Budget used"
          value={euroCents(d.usedCents, 0)}
          sub={
            d.budgetCents
              ? 'of ' + euroCents(d.budgetCents, 0) + ' · ' + String(pct) + ' %'
              : 'no budget agreed'
          }
          tone={over ? 'warning' : undefined}
          icon="euro"
        />
        <Stat
          label="Forecast at the last milestone"
          value={d.forecastCents === null ? '—' : euroCents(d.forecastCents, 0)}
          sub={
            d.forecastOn
              ? (d.budgetCents && d.forecastCents !== null
                  ? d.forecastCents <= d.budgetCents
                    ? 'within budget'
                    : 'above budget'
                  : 'at the recent pace') +
                ' · ' +
                dmy(d.forecastOn)
              : 'no milestone dates yet'
          }
          icon="insights"
        />
        {d.aiCents !== null ? (
          <Stat
            label="Of which AI agents"
            value={euroCents(d.aiCents, 0)}
            sub={
              (d.usedCents ? String(Math.round((d.aiCents / d.usedCents) * 100)) + ' % · ' : '') +
              'shown separately as agreed'
            }
            icon="agents"
          />
        ) : null}
        <Stat
          label="Open invoices"
          value={String(d.openInvoices)}
          sub={overdue ? 'one is overdue' : 'nothing overdue'}
          tone={overdue ? 'danger' : undefined}
          icon="documents"
        />
      </div>
      {d.budgetCents ? (
        <Card title="Budget burn">
          <Bar
            value={Math.min(d.usedCents, d.budgetCents)}
            max={d.budgetCents}
            tone={over ? 'warning' : 'primary'}
            {...(d.planCents !== null ? { marker: d.planCents } : {})}
            label={
              String(pct) +
              ' % used' +
              (planPct !== null ? ', plan said ' + String(planPct) + ' % by now' : '')
            }
          />
          <p className="pv-muted pv-small">
            {planPct !== null
              ? 'The line marks the plan for today, from the project timeline. '
              : ''}
            {d.addedByChangesCents
              ? 'The change requests you approved added ' +
                euroCents(d.addedByChangesCents, 0) +
                '.'
              : ''}
          </p>
        </Card>
      ) : null}
      <Card flush title="Invoices and quotes">
        {d.invoices.length || d.quotes.length ? (
          <table className="pv-table">
            <tbody>
              {d.invoices.map((i) => {
                const st = invoiceState(i);
                return (
                  <tr key={i.id}>
                    <td className="pv-mono v2-nowrap">{i.number}</td>
                    <td className="pv-cell-grow">{i.periodLabel || 'Invoice'}</td>
                    <td className="pv-num">{euroCents(i.grossCents)}</td>
                    <td>
                      <Chip tone={st.tone}>{st.text}</Chip>
                    </td>
                    <td>
                      <a
                        className="pv-btn pv-btn--ghost pv-btn--sm"
                        href={props.base + '/portal/invoices/' + i.id + '/pdf' + props.qs}
                        target="_blank"
                        rel="noreferrer"
                      >
                        PDF
                      </a>
                    </td>
                  </tr>
                );
              })}
              {d.quotes.map((q) => (
                <tr key={q.id}>
                  <td className="pv-mono v2-nowrap">{q.ref}</td>
                  <td className="pv-cell-grow">Quote · {q.title}</td>
                  <td className="pv-num">{euroCents(q.priceCents)}</td>
                  <td>
                    <Chip tone="info">waiting for you</Chip>
                  </td>
                  <td>
                    <Button
                      size="sm"
                      kind="ghost"
                      onClick={() => {
                        props.go('/portal/approvals' + toApprovals);
                      }}
                    >
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pv-muted pv-small pv-pad">No invoices yet.</p>
        )}
      </Card>
    </div>
  );
}

// ── [PCODE-189 | S15 | v0.1.0] meetings ──
interface MeetingsData {
  hosts: { id: string; name: string }[];
  slots: string[];
  mayBook: boolean;
  agenda: string;
  upcoming: {
    id: string;
    title: string;
    kind: string;
    startsAt: string;
    minutes: number;
    attendees: string[];
    agenda: string;
    videoUrl: string;
  }[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Tue 7 Oct 10:30" in the viewer's time zone. */
export function slotText(iso: string): string {
  const d = new Date(iso);
  return (
    (WEEKDAYS[d.getDay()] ?? '') +
    ' ' +
    String(d.getDate()) +
    ' ' +
    (MONTHS[d.getMonth()] ?? '') +
    ' ' +
    d.toLocaleTimeString(fmtLocale(), { hour: '2-digit', minute: '2-digit' })
  );
}

const KINDS: [string, string][] = [
  ['review', 'Review'],
  ['demo', 'Demo'],
  ['other', 'Other'],
];

function Meetings(props: Ctx): ReactNode {
  const [d, error, load] = useSection<MeetingsData>(props, '/meetings');
  const [slot, setSlot] = useState<string | null>(null);
  const [kind, setKind] = useState('review');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (error) return <NotShared error={error} />;
  if (!d) return null;
  const book = async (): Promise<void> => {
    if (!slot) return;
    setBusy(true);
    const r = await api('POST', props.base + '/portal/meetings', { startsAt: slot, kind });
    setBusy(false);
    if (!r.ok) setErr(r.error.message);
    else {
      setErr('');
      setSlot(null);
    }
    await load();
  };
  return (
    <div className="pv-stack">
      {/* [PCODE-338 | S15 | v0.1.0] the notes the team shared */}
      <PortalMeetingNotes base={props.base} qs={props.qs} />
      <div className="pv-split">
        <Card title="Book a review or demo">
          <p className="pv-muted pv-small">
            {d.hosts.length
              ? 'Free times of ' + d.hosts.map((h) => h.name).join(', ') + ', 45 minutes.'
              : 'Your team has not named an account owner yet.'}
          </p>
          <div className="pv-slots">
            {d.slots.slice(0, 16).map((s) => (
              <button
                key={s}
                type="button"
                className="pv-slot"
                aria-pressed={slot === s}
                disabled={!d.mayBook}
                onClick={() => {
                  setSlot(s);
                }}
              >
                {slotText(s)}
              </button>
            ))}
          </div>
          {d.mayBook && slot ? (
            <div className="pv-stack pv-mt">
              <div className="pv-segmented" role="radiogroup" aria-label="Kind">
                {KINDS.map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    className="pv-seg"
                    onClick={() => {
                      setKind(k);
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <p className="pv-small">
                <strong>Agenda</strong> (drafted from your open items)
              </p>
              <pre className="pv-code">{d.agenda}</pre>
              <div className="pv-page-actions">
                <Button kind="primary" disabled={busy} onClick={() => void book()}>
                  Book {slotText(slot)}
                </Button>
              </div>
            </div>
          ) : null}
          {err ? (
            <p className="v2-error" role="alert">
              {err}
            </p>
          ) : null}
        </Card>
        <Card flush title="Coming up">
          {d.upcoming.length ? (
            <ul className="pv-rows">
              {d.upcoming.map((m) => (
                <li key={m.id} className="pv-row pv-row--static">
                  <span className="pv-next-date">{slotText(m.startsAt)}</span>
                  <span className="pv-row-main">
                    <span className="pv-row-title">{m.title}</span>
                    <span className="pv-row-sub">with {m.attendees.join(', ')}</span>
                  </span>
                  <a
                    className="pv-btn pv-btn--ghost pv-btn--sm"
                    href={props.base + '/meetings/' + m.id + '/ics'}
                  >
                    Calendar
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pv-muted pv-small pv-pad">Nothing booked.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── [PCODE-191 | S15 | v0.1.0] the status page ──
interface StatusData {
  incidents: {
    id: string;
    title: string;
    severity: string;
    state: string;
    update: string;
    updatedAt: string;
    nextUpdateAt: string | null;
    openFor: string;
  }[];
  components: {
    id: string;
    name: string;
    state: 'working' | 'slow' | 'down' | 'unknown';
    probed: boolean;
    uptimePct: number | null;
    days: { day: string; state: 'ok' | 'slow' | 'down' | 'none' }[];
  }[];
  postmortems: { id: string; title: string; severity: string; resolvedAt: string; text: string }[];
}

export const STATE_CHIP: Record<
  string,
  { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  working: { text: 'working', tone: 'success' },
  slow: { text: 'slow', tone: 'warning' },
  down: { text: 'disrupted', tone: 'danger' },
  unknown: { text: 'no data', tone: 'neutral' },
};

/** "99,98 %" for an uptime. */
export const uptimeText = (pct: number | null): string =>
  pct === null ? 'not probed' : String(pct).replace('.', ',') + ' % in 30 days';

function Status(props: Ctx): ReactNode {
  const [d, error] = useSection<StatusData>(props, '/status');
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <NotShared error={error} />;
  if (!d) return null;
  const hm = (iso: string): string =>
    new Date(iso).toLocaleTimeString(fmtLocale(), { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="pv-stack">
      {d.incidents.map((i) => (
        <div key={i.id} className="pv-callout pv-callout--warn">
          <PIcon name="incident" size={16} />
          <div>
            <strong>{i.title}</strong> · {i.update}
            <span className="pv-muted pv-small">
              {' '}
              (updated {hm(i.updatedAt)}
              {i.nextUpdateAt ? '; next update by ' + hm(i.nextUpdateAt) : ''})
            </span>
          </div>
        </div>
      ))}
      {!d.incidents.length && d.components.length ? (
        <div className="pv-callout">
          <PIcon name="check" size={16} />
          <div>Nothing is reported. Your team posts here as soon as something affects you.</div>
        </div>
      ) : null}
      {d.components.map((c) => {
        const chip = STATE_CHIP[c.state] ?? { text: c.state, tone: 'neutral' as const };
        return (
          <Card key={c.id}>
            <div className="pv-status-row">
              <strong>{c.name}</strong>
              <Chip tone={chip.tone}>{chip.text}</Chip>
              <span className="pv-muted pv-small">{uptimeText(c.uptimePct)}</span>
            </div>
            <svg
              className="pv-uptime"
              viewBox="0 0 300 20"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {c.days.map((x, i) => (
                <rect
                  key={x.day}
                  className={'pv-up pv-up--' + x.state}
                  x={i * 10 + 1}
                  y="2"
                  width="8"
                  height="16"
                  rx="2"
                />
              ))}
            </svg>
          </Card>
        );
      })}
      {!d.components.length ? (
        <Empty
          icon="live"
          title="No status page yet."
          text="Your team adds your systems here; then you see whether they work, at any time."
        />
      ) : null}
      {d.postmortems.length ? (
        <Card flush title="What happened, and what changes">
          <ul className="pv-rows">
            {d.postmortems.map((p) => (
              <li key={p.id} className="pv-row pv-row--static pv-row--top">
                <span className="pv-row-main">
                  <button
                    type="button"
                    className="pv-link-btn pv-strong v2-left"
                    aria-expanded={open === p.id}
                    onClick={() => {
                      setOpen(open === p.id ? null : p.id);
                    }}
                  >
                    {p.severity} · {p.title}
                  </button>
                  <span className="pv-row-sub">resolved {dmy(p.resolvedAt)}</span>
                  {open === p.id ? (
                    <article className="pv-doc pv-mt">
                      <Markdown text={p.text} />
                    </article>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
