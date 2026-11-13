// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-426 | S15 | v0.1.0] T37 low: Portal home shows the budget only when there is one ──
// ── [PCODE-432 | S15 | v0.1.0] T37 medium: The empty home guides a new workspace ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-347 | S15 | v0.1.0] T35.1b Homes for developers and testers with widgets the person chooses ──
// ── [PCODE-337 | S15 | v0.1.0] T34.1b Request votes and duplicate merge, NPS survey, embeddable feedback widget ──
// ── [PCODE-336 | S15 | v0.1.0] T34.1a Portal home with health, milestone, release and budget; release deliverables and demos; client sign-off per release; files on acceptance results ──
// ── [PCODE-164 | S15 | v0.1.0] B1.3 The v2 shell live in the web app: Home per role, Inbox, Clients, portal mode, settings ──
//    Why:  Home answers "what needs me now" for each role on live numbers: everyone sees what waits in their
//          inbox; leads see agents and AI spend; billing sees the money; a client contact gets the portal's
//          own home with their projects and what waits for their answer. The team's existing dashboard
//          (tasks, activity, projects, charts) follows below the band.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { KIND } from '../preview/inbox.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Bar, Card, Chip, PageHead, Stat } from '../preview/ui.js';
import { ago, type LiveInboxItem } from './inbox.js';
import { euroCents, roleLabel, type ShellSummary } from './shell.js';
import { NpsPrompt } from './clientvoice.js'; // [PCODE-337 | S15 | v0.1.0]
import { HomeWidgets } from './homewidgets.js'; // [PCODE-347 | S15 | v0.1.0]
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const kindIcon = (k: string): PIconName =>
  (KIND as Record<string, { icon: PIconName }>)[k]?.icon ?? 'inbox';

const go_ =
  (to: string, go: (p: string) => void) =>
  (e: { preventDefault: () => void; metaKey: boolean; ctrlKey: boolean }) => {
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    go(to);
  };

/** The first open entries of the inbox, refreshed with events. */
function useInboxTop(workspaceId: string, hub: EventHub, n: number): LiveInboxItem[] | null {
  const [items, setItems] = useState<LiveInboxItem[] | null>(null);
  useEffect(() => {
    const load = async (): Promise<void> => {
      const r = await api<{ items: LiveInboxItem[] }>(
        'GET',
        '/api/workspaces/' + workspaceId + '/inbox?state=open',
      );
      if (r.ok) setItems(r.data.items.slice(0, n));
    };
    void load();
    return hub.on(() => void load());
  }, [workspaceId, hub, n]);
  return items;
}

function InboxCard(props: {
  items: LiveInboxItem[] | null;
  title: string;
  go: (p: string) => void;
}): ReactNode {
  return (
    <Card
      title={props.title}
      action={
        <a href="/inbox" className="pv-link" onClick={go_('/inbox', props.go)}>
          Open the inbox
        </a>
      }
      flush
    >
      {!props.items ? (
        <p className="pv-muted v2-pad" role="status">
          Loading…
        </p>
      ) : !props.items.length ? (
        <p className="pv-muted v2-pad">Nothing waits for you.</p>
      ) : (
        <ul className="pv-rows">
          {props.items.map((i) => (
            <li key={i.id}>
              <a href={i.url} className="pv-row" onClick={go_(i.url, props.go)}>
                <span className={'pv-kind pv-kind--' + i.kind}>
                  <PIcon name={kindIcon(i.kind)} size={15} />
                </span>
                <span className="pv-row-main">
                  <span className="pv-row-title">{i.title}</span>
                  <span className="pv-row-sub">
                    {i.projectKey ? i.projectKey + ' · ' : ''}
                    {ago(i.createdAt)} ago
                  </span>
                </span>
                {i.priority === 'urgent' ? (
                  <Chip tone="danger">Urgent</Chip>
                ) : i.priority === 'high' ? (
                  <Chip tone="warning">High</Chip>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const greeting = (d: Date): string =>
  d.getHours() < 12 ? 'Good morning' : d.getHours() < 18 ? 'Good afternoon' : 'Good evening';

/** The band at the top of Home for the team: the numbers that matter to this role, and the inbox. */
export function TodayBand(props: {
  workspaceId: string;
  workspaceName: string;
  userName: string;
  userId?: string; // [PCODE-347 | S15 | v0.1.0]
  role: string;
  summary: ShellSummary | null;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const s = props.summary;
  const top = useInboxTop(props.workspaceId, props.hub, 5);
  const first = props.userName.split(' ')[0] ?? props.userName;
  const lead = props.role === 'owner' || props.role === 'admin';
  const money = lead || props.role === 'billing';
  const dash = '…';
  return (
    <div className="pv-page v2-band">
      <PageHead
        title={greeting(new Date()) + ', ' + first}
        sub={props.workspaceName + ' · ' + roleLabel(props.role)}
        icon="home"
      />
      {/* [PCODE-432 | S15 | v0.1.0] a new workspace's first steps, for those who can take them */}
      {lead ? <GetStarted workspaceId={props.workspaceId} go={props.go} /> : null}
      <div className="pv-stats">
        <Stat
          label="Waiting for you"
          icon="inbox"
          value={s ? s.inbox.open : dash}
          sub={s ? String(s.inbox.unread) + ' unread' : undefined}
          tone={s && s.inbox.open ? 'warning' : undefined}
        />
        {props.role !== 'billing' ? (
          <Stat
            label="Agents at work"
            icon="agents"
            value={s ? s.agents.running : dash}
            sub={
              s
                ? String(s.agents.waiting) +
                  ' waiting for a decision · ' +
                  String(s.agents.queued) +
                  ' queued'
                : undefined
            }
            tone={s && s.agents.waiting ? 'warning' : undefined}
          />
        ) : null}
        {money ? (
          <>
            <Stat
              label="AI spend today"
              icon="euro"
              value={s ? euroCents(s.spend.todayCents) : dash}
            />
            <Stat
              label="AI spend this month"
              icon="tokens"
              value={s ? euroCents(s.spend.monthCents, 0) : dash}
              sub={
                s
                  ? '1 USD = ' +
                    s.spend.usdEur.toLocaleString(fmtLocale()) +
                    ' € · ' +
                    (s.spend.rateDate ?? s.spend.rateSource)
                  : undefined
              }
            />
          </>
        ) : (
          <Stat
            label="VS Code"
            icon="ide"
            value={s ? (s.ide.connected ? 'Synced' : 'Not connected') : dash}
            sub={
              s?.ide.lastSeen
                ? 'last seen ' + ago(s.ide.lastSeen) + ' ago'
                : 'connect it with a personal token'
            }
            tone={s ? (s.ide.connected ? 'success' : undefined) : undefined}
          />
        )}
      </div>
      <div className="pv-grid">
        <InboxCard items={top} title="Needs you now" go={props.go} />
      </div>
      {/* [PCODE-347 | S15 | v0.1.0] the widgets of this person's kind of home */}
      {props.userId && !['billing', 'guest', 'auditor'].includes(props.role) ? (
        <HomeWidgets workspaceId={props.workspaceId} userId={props.userId} go={props.go} />
      ) : null}
    </div>
  );
}

/** The portal's home for a client contact: their projects and what waits for their answer. */
// [PCODE-336 | S15 | v0.1.0] each project's health, next milestone and latest release, and the budget
export interface PortalHomeData {
  projects: {
    id: string;
    key: string;
    name: string;
    health: 'on-track' | 'at-risk' | 'critical';
    reasons: string[];
    nextMilestone: { title: string; due: string } | null;
    latestRelease: {
      id: string;
      version: string;
      name: string;
      state: string;
      at: string | null;
    } | null;
  }[];
  budget: { budgetCents: number | null; usedCents: number; forecastCents: number | null } | null;
}
const HEALTH_TONE = { 'on-track': 'success', 'at-risk': 'warning', critical: 'danger' } as const;
const HEALTH_WORDS = { 'on-track': 'on track', 'at-risk': 'at risk', critical: 'needs attention' };
const dmyDay = (d: string): string => d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4);

/** "62 % of the budget used, heading for 94 %" or the money without a budget. */
export function budgetLine(b: NonNullable<PortalHomeData['budget']>): string {
  if (!b.budgetCents) return euroCents(b.usedCents, 0) + ' so far';
  const pct = (c: number): string => String(Math.round((c / (b.budgetCents ?? 1)) * 100)) + ' %';
  return (
    pct(b.usedCents) +
    ' of the budget used' +
    (b.forecastCents !== null ? ', heading for ' + pct(b.forecastCents) : '')
  );
}

export function PortalHome(props: {
  workspaceId: string;
  clientName: string;
  userName: string;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const top = useInboxTop(props.workspaceId, props.hub, 6);
  const [home, setHome] = useState<PortalHomeData | null>(null);
  useEffect(() => {
    const load = async (): Promise<void> => {
      const r = await api<PortalHomeData>(
        'GET',
        '/api/workspaces/' + props.workspaceId + '/portal/home',
      );
      if (r.ok) setHome(r.data);
    };
    void load();
    return props.hub.on(() => void load());
  }, [props.workspaceId, props.hub]);
  const first = props.userName.split(' ')[0] ?? props.userName;
  return (
    <div className="pv-page">
      <PageHead
        title={greeting(new Date()) + ', ' + first}
        sub={props.clientName + ' · your projects with us'}
        icon="home"
      />
      <div className="pv-grid pv-grid--2-1">
        <div className="pv-stack">
          <Card title="Your projects" flush>
            {!home ? (
              <p className="pv-muted v2-pad" role="status">
                Loading…
              </p>
            ) : !home.projects.length ? (
              <p className="pv-muted v2-pad">No project is shared with you yet.</p>
            ) : (
              <ul className="pv-rows">
                {home.projects.map((p) => (
                  <li key={p.id}>
                    <a
                      href={'/projects/' + p.id}
                      className="pv-row"
                      onClick={go_('/projects/' + p.id, props.go)}
                    >
                      <span className="pv-kind">
                        <PIcon name="projects" size={15} />
                      </span>
                      <span className="pv-row-main">
                        <span className="pv-row-title">
                          {p.name}{' '}
                          <Chip tone={HEALTH_TONE[p.health]}>{HEALTH_WORDS[p.health]}</Chip>
                        </span>
                        <span className="pv-row-sub">
                          <span className="pv-mono">{p.key}</span>
                          {p.reasons.length ? ' · ' + p.reasons.join(', ') : ''}
                        </span>
                        <span className="pv-row-sub">
                          {p.nextMilestone
                            ? 'Next: ' +
                              p.nextMilestone.title +
                              ' on ' +
                              dmyDay(p.nextMilestone.due)
                            : 'No milestone ahead'}
                          {p.latestRelease
                            ? ' · ' +
                              (p.latestRelease.state === 'released' ? 'released ' : 'to test: ') +
                              p.latestRelease.version
                            : ''}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {/* [PCODE-426 | S15 | v0.1.0] only when there is a budget, or money spent */}
          {home?.budget && (home.budget.budgetCents || home.budget.usedCents > 0) ? (
            <Card title="Budget">
              {home.budget.budgetCents ? (
                <Bar
                  value={home.budget.usedCents}
                  max={home.budget.budgetCents}
                  tone={
                    (home.budget.forecastCents ?? 0) > home.budget.budgetCents
                      ? 'warning'
                      : 'success'
                  }
                  {...(home.budget.forecastCents !== null
                    ? { marker: home.budget.forecastCents }
                    : {})}
                />
              ) : null}
              <p className="pv-small">{budgetLine(home.budget)}</p>
            </Card>
          ) : null}
        </div>
        <div className="pv-stack">
          {/* [PCODE-337 | S15 | v0.1.0] the recommendation question, every 90 days */}
          <NpsPrompt workspaceId={props.workspaceId} />
          <InboxCard items={top} title="Waiting for your answer" go={props.go} />
        </div>
      </div>
    </div>
  );
}

// [PCODE-432 | S15 | v0.1.0]
interface StartStep {
  key: string;
  title: string;
  hint: string;
  to: string;
  done: boolean;
  optional?: boolean;
}

/** The first steps of a new workspace, each ticked off by what is really there; hidden once all are
 *  done, or when the person hides it. */
export function GetStarted(props: { workspaceId: string; go: (p: string) => void }): ReactNode {
  const W = '/api/workspaces/' + props.workspaceId;
  const hideKey = 'orqiva-started-' + props.workspaceId;
  const [hidden, setHidden] = useState(() => {
    try {
      return window.localStorage.getItem(hideKey) === '1';
    } catch {
      return false;
    }
  });
  const [steps, setSteps] = useState<StartStep[] | null>(null);
  useEffect(() => {
    if (hidden) return;
    void Promise.all([
      api<{ id: string; archived: boolean }[]>('GET', W + '/projects'),
      api<{ service: boolean }[]>('GET', W + '/members'),
      api<{
        projects: { started: number; unstarted: number; backlog: number; completed: number }[];
      }>('GET', W + '/stats'),
      api<unknown[]>('GET', W + '/ai/connections'),
    ]).then(([projects, members, stats, ai]) => {
      const live = projects.ok ? projects.data.filter((p) => !p.archived) : [];
      const firstProject = live[0]?.id;
      const tasks = stats.ok
        ? stats.data.projects.reduce(
            (n, p) => n + p.started + p.unstarted + p.backlog + p.completed,
            0,
          )
        : 0;
      setSteps([
        {
          key: 'project',
          title: 'Start a project',
          hint: 'A project holds the work of one product or client.',
          to: '/projects',
          done: live.length > 0,
        },
        {
          key: 'tasks',
          title: 'Write the first tasks',
          hint: 'What needs doing; plan them into a sprint later.',
          to: firstProject ? '/projects/' + firstProject + '/list' : '/projects',
          done: tasks > 0,
        },
        {
          key: 'team',
          title: 'Invite your team',
          hint: 'Colleagues by email, with the role they need.',
          to: '/settings/members',
          done: members.ok && members.data.filter((m) => !m.service).length > 1,
        },
        {
          key: 'ai',
          title: 'Connect an AI provider',
          hint: 'Agents run on the demo model until you add your own key.',
          to: '/settings/ai',
          done: ai.ok && ai.data.length > 0,
          optional: true,
        },
      ]);
    });
  }, [W, hidden]);
  if (hidden || !steps || steps.every((x) => x.done)) return null;
  const open = steps.filter((x) => !x.done && !x.optional).length;
  return (
    <Card
      title="Get started"
      className="v2-start"
      action={
        <button
          type="button"
          className="pv-link-btn"
          onClick={() => {
            setHidden(true);
            try {
              window.localStorage.setItem(hideKey, '1');
            } catch {
              // a private window: hidden until the page closes
            }
          }}
        >
          Hide
        </button>
      }
    >
      <p className="pv-muted pv-small">
        {open
          ? String(open) + ' steps to a working setup'
          : 'The setup works; one more if you like'}
      </p>
      <ol className="v2-start-steps">
        {steps.map((x) => (
          <li
            key={x.key}
            className={x.done ? 'v2-start-step v2-start-step--done' : 'v2-start-step'}
          >
            <PIcon name={x.done ? 'check' : 'plus'} size={16} />
            <span className="v2-start-text">
              <a
                href={x.to}
                onClick={(e) => {
                  e.preventDefault();
                  props.go(x.to);
                }}
              >
                {x.title}
              </a>
              {x.optional ? <span className="pv-muted pv-small"> · optional</span> : null}
              <span className="pv-muted pv-small">{x.hint}</span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
