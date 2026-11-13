// ── [PCODE-153 | S15 | v0.1.0] D1 preview: design system v2, shell, Cmd-K, Home, Inbox, project overview ──
//    Why:  Home answers "what needs me and how are we doing" for each role. A developer sees their work
//          and their agents; a lead sees every project's health and the decisions waiting; an admin sees
//          the workspace (seats, spend, tokens, posture); a tester sees runs and evidence; a client sees
//          their projects the way the client portal will show them.
import type { ReactNode } from 'react';
import {
  ACTIVITY,
  AGENTS_LIVE,
  CLIENTS,
  MY_TASKS,
  PROJECTS,
  SPEND,
  euro,
  person,
  project,
  type InboxItem,
  type Role,
} from './data.js';
import { KIND } from './inbox.js';
import { PIcon } from './picons.js';
import { BASE, link } from './shell.js';
import {
  Avatar,
  AvatarStack,
  Bar,
  Button,
  Card,
  Chip,
  HealthPill,
  PageHead,
  Ring,
  ShareBars,
  Stat,
} from './ui.js';

const STATE_TONE: Record<
  string,
  'neutral' | 'primary' | 'warning' | 'danger' | 'success' | 'info'
> = {
  Backlog: 'neutral',
  Todo: 'neutral',
  'In Progress': 'primary',
  Review: 'info',
  Test: 'info',
  Blocked: 'danger',
  Done: 'success',
};

function NeedsYou(props: { items: InboxItem[]; go: (p: string) => void }): ReactNode {
  return (
    <Card
      title={
        <>
          Needs you <span className="pv-count">{props.items.length}</span>
        </>
      }
      action={
        <a className="pv-link" href={BASE + '/inbox'} onClick={link('/inbox', props.go)}>
          Open inbox
        </a>
      }
      flush
    >
      <ul className="pv-rows">
        {props.items.slice(0, 5).map((i) => (
          <li key={i.id}>
            <a
              className="pv-row"
              href={BASE + '/inbox'}
              onClick={link('/inbox?item=' + i.id, props.go)}
            >
              <span className={'pv-kind pv-kind--' + i.kind}>
                <PIcon name={KIND[i.kind].icon} size={15} />
              </span>
              <span className="pv-row-main">
                <span className="pv-row-title">{i.title}</span>
                <span className="pv-row-sub">
                  <span className="pv-mono">{i.project}</span> · {person(i.from).name} · {i.age}
                </span>
              </span>
              {i.priority === 'urgent' ? <Chip tone="danger">Urgent</Chip> : null}
              {i.cost !== undefined ? <Chip tone="agent">{euro(i.cost, 2)}</Chip> : null}
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AgentsNow(props: { go: (p: string) => void }): ReactNode {
  return (
    <Card
      title="Agents working now"
      action={
        <a className="pv-link" href={BASE + '/agents'} onClick={link('/agents', props.go)}>
          All agents
        </a>
      }
      flush
    >
      <ul className="pv-rows">
        {AGENTS_LIVE.map((a, i) => (
          <li key={i} className="pv-row pv-row--static">
            <Avatar id={a.agent} />
            <span className="pv-row-main">
              <span className="pv-row-title">
                {person(a.agent).name} <span className="pv-mono pv-muted">{a.task}</span>
              </span>
              <span className="pv-row-sub">{a.what}</span>
              <Bar
                value={a.step}
                max={a.steps}
                tone={a.waiting ? 'warning' : 'agent'}
                label={'step ' + String(a.step) + ' of ' + String(a.steps)}
              />
            </span>
            <span className="pv-row-end">
              <span className="pv-num">{euro(a.cost, 2)}</span>
              {a.waiting ? (
                <Chip tone="warning">Waiting</Chip>
              ) : (
                <Chip tone="agent">
                  Step {a.step}/{a.steps}
                </Chip>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ActivityCard(props: {
  filter?: (p: string) => boolean;
  go: (p: string) => void;
}): ReactNode {
  const rows = ACTIVITY.filter((a) => !props.filter || props.filter(a.project));
  return (
    <Card
      title="Latest activity"
      action={
        <a className="pv-link" href={BASE + '/activity'} onClick={link('/activity', props.go)}>
          All activity
        </a>
      }
      flush
    >
      <ul className="pv-feed">
        {rows.slice(0, 7).map((a) => (
          <li key={a.id} className="pv-feed-item">
            <Avatar id={a.who} size="xs" />
            <span className="pv-feed-text">
              <strong>{person(a.who).name}</strong> {a.text}
            </span>
            <span className="pv-mono pv-feed-project">{a.project}</span>
            <span className="pv-feed-time pv-num">{a.at}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ProjectTile(props: { pkey: string; go: (p: string) => void }): ReactNode {
  const p = project(props.pkey);
  if (!p) return null;
  const c = CLIENTS.find((x) => x.id === p.clientId);
  return (
    <a
      className="pv-tile"
      href={BASE + '/projects/' + p.key}
      onClick={link('/projects/' + p.key, props.go)}
    >
      <div className="pv-tile-head">
        <span className="pv-mono pv-tile-key">{p.key}</span>
        <span className="pv-tile-name">{p.name}</span>
        <HealthPill health={p.health} />
      </div>
      <div className="pv-tile-meta">
        {c ? <span>{c.short}</span> : <span>Internal</span>}
        <span>·</span>
        <span>{p.phase}</span>
        <span>·</span>
        <span>
          {p.sprint.name}, day {p.sprint.day} of {p.sprint.days}
        </span>
      </div>
      <div className="pv-tile-bars">
        <div>
          <span className="pv-tile-label">Sprint</span>
          <Bar
            value={p.sprint.done}
            max={p.sprint.total}
            marker={(p.sprint.total * p.sprint.day) / p.sprint.days}
            tone={p.health === 'on-track' ? 'success' : p.health === 'late' ? 'danger' : 'warning'}
          />
          <span className="pv-num pv-tile-val">
            {p.sprint.done}/{p.sprint.total} pts
          </span>
        </div>
        <div>
          <span className="pv-tile-label">Budget</span>
          <Bar
            value={p.budget.used}
            max={p.budget.total}
            tone={p.budget.used / p.budget.total > 0.9 ? 'danger' : 'primary'}
          />
          <span className="pv-num pv-tile-val">
            {Math.round((p.budget.used / p.budget.total) * 100)} %
          </span>
        </div>
      </div>
      <div className="pv-tile-foot">
        <span className="pv-tile-note">{p.healthNote}</span>
        <AvatarStack ids={[...p.team, ...p.agents]} max={5} />
      </div>
    </a>
  );
}

function MyWork(props: { go: (p: string) => void }): ReactNode {
  return (
    <Card
      title="My work"
      action={
        <Button size="sm" icon="plus" kind="ghost">
          New task
        </Button>
      }
      flush
    >
      <table className="pv-table">
        <tbody>
          {MY_TASKS.map((t) => (
            <tr key={t.ref}>
              <td className="pv-mono pv-cell-ref">
                <a
                  href={BASE + '/projects/' + t.project + '/planning'}
                  onClick={link('/projects/' + t.project + '/planning', props.go)}
                >
                  {t.ref}
                </a>
              </td>
              <td className="pv-cell-grow">{t.title}</td>
              <td>
                <Chip tone={STATE_TONE[t.state]}>{t.state}</Chip>
              </td>
              <td className="pv-num pv-muted">{t.points} pt</td>
              <td className="pv-muted">{t.due ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function SpendCard(): ReactNode {
  return (
    <Card title="AI spend this month">
      <div className="pv-spend-head">
        <span className="pv-big pv-num">{euro(SPEND.month)}</span>
        <span className="pv-muted">
          of {euro(SPEND.monthBudget)} budget · forecast {euro(2_210)}
        </span>
      </div>
      <Bar
        value={SPEND.month}
        max={SPEND.monthBudget}
        marker={SPEND.monthBudget * (4 / 31)}
        tone="agent"
      />
      <ShareBars
        rows={SPEND.byProject.map((r) => ({
          label: <span className="pv-mono">{r.key}</span>,
          value: r.value,
          display: euro(r.value),
        }))}
      />
    </Card>
  );
}

function greeting(role: Role): { title: string; sub: string } {
  const who = { developer: 'Lea', lead: 'Mara', admin: 'Ada', tester: 'Sara', client: 'Ines' }[
    role
  ];
  return {
    title: 'Good morning, ' + who,
    sub: 'Saturday 4 October · Sprint 14 day 6 · 3 agents working',
  };
}

export function HomePage(props: {
  role: Role;
  inbox: InboxItem[];
  go: (p: string) => void;
}): ReactNode {
  const g = greeting(props.role);
  if (props.role === 'client') return <ClientHome />;
  const head = (
    <PageHead
      title={g.title}
      sub={g.sub}
      actions={
        <Button kind="primary" icon="plus">
          Create
        </Button>
      }
    />
  );

  if (props.role === 'developer')
    return (
      <div className="pv-page">
        {head}
        <div className="pv-stats">
          <Stat label="Assigned to me" value="5" sub="1 blocked" icon="planning" />
          <Stat label="Reviews waiting" value="2" sub="oldest 35 min" icon="review" />
          <Stat
            label="My agents today"
            value={euro(4.61, 2)}
            sub="3 runs, 1 waiting"
            icon="agents"
          />
          <Stat label="Time today" value="3 h 12" sub="NWL-191 running" icon="time" />
        </div>
        <div className="pv-grid pv-grid--2-1">
          <div className="pv-stack">
            <NeedsYou items={props.inbox} go={props.go} />
            <MyWork go={props.go} />
          </div>
          <div className="pv-stack">
            <AgentsNow go={props.go} />
            <ActivityCard go={props.go} />
          </div>
        </div>
      </div>
    );

  if (props.role === 'tester')
    return (
      <div className="pv-page">
        {head}
        <div className="pv-stats">
          <Stat label="Cases assigned" value="23" sub="12 due today" icon="test" />
          <Stat label="Failed today" value="4" sub="3 with evidence" tone="danger" icon="x" />
          <Stat label="Flaky tests" value="6" sub="2 quarantined" tone="warning" icon="flag" />
          <Stat label="Client UAT" value="Round 2" sub="HEL · Wed 8 Oct" icon="clients" />
        </div>
        <div className="pv-grid pv-grid--2-1">
          <div className="pv-stack">
            <NeedsYou items={props.inbox} go={props.go} />
            <Card title="Runs in progress" flush>
              <table className="pv-table">
                <tbody>
                  {[
                    ['NWD', 'Run 41 · iOS 18 · iPhone 15', 31, 43, 2],
                    ['HEL', 'Run 17 · Booking regression · Chrome', 58, 64, 3],
                    ['NWL', 'Run 88 · Export tours · Firefox', 12, 20, 1],
                  ].map(([k, n, d, t, f]) => (
                    <tr key={String(n)}>
                      <td className="pv-mono pv-cell-ref">{k}</td>
                      <td className="pv-cell-grow">{n}</td>
                      <td className="pv-cell-bar">
                        <Bar value={Number(d)} max={Number(t)} tone="success" />
                      </td>
                      <td className="pv-num pv-muted">
                        {d}/{t}
                      </td>
                      <td>{Number(f) ? <Chip tone="danger">{f} failed</Chip> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
          <div className="pv-stack">
            <AgentsNow go={props.go} />
            <ActivityCard go={props.go} />
          </div>
        </div>
      </div>
    );

  if (props.role === 'admin')
    return (
      <div className="pv-page">
        {head}
        <div className="pv-stats">
          <Stat label="Seats" value="14 / 18" sub="2 invitations open" icon="people" />
          <Stat
            label="AI spend this month"
            value={euro(SPEND.month)}
            sub={'54 % of ' + euro(SPEND.monthBudget)}
            icon="euro"
          />
          <Stat
            label="Tokens expiring"
            value="3"
            sub="within 14 days"
            tone="warning"
            icon="tokens"
          />
          <Stat
            label="Open critical findings"
            value="1"
            sub="HEL · SLA 2 days"
            tone="danger"
            icon="security"
          />
        </div>
        <div className="pv-grid pv-grid--2-1">
          <div className="pv-stack">
            <NeedsYou items={props.inbox} go={props.go} />
            <Card title="Workspace health" flush>
              <table className="pv-table">
                <tbody>
                  {[
                    ['Server', 'v0.1.0 · up 12 days · last backup 03:00', 'success', 'Healthy'],
                    ['Runners', '2 of 2 online · 1 deploy queued', 'success', 'Healthy'],
                    ['Model providers', 'Anthropic 120 ms · rate limit 61 %', 'success', 'Healthy'],
                    [
                      'Access review',
                      'Q4 review due 15 Oct · 4 of 14 certified',
                      'warning',
                      'Due soon',
                    ],
                    ['Single sign-on', 'Not set up · 2 users without MFA', 'warning', 'Action'],
                  ].map(([a, b, tone, label]) => (
                    <tr key={a}>
                      <td className="pv-cell-strong">{a}</td>
                      <td className="pv-cell-grow pv-muted">{b}</td>
                      <td>
                        <Chip tone={tone as 'success' | 'warning'}>{label}</Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
          <div className="pv-stack">
            <SpendCard />
            <ActivityCard go={props.go} />
          </div>
        </div>
      </div>
    );

  // lead
  return (
    <div className="pv-page">
      {head}
      <div className="pv-stats">
        <Stat label="Projects" value="5" sub="3 on track · 1 at risk · 1 late" icon="projects" />
        <Stat
          label="Decisions waiting"
          value={String(props.inbox.length)}
          sub="2 urgent"
          tone="warning"
          icon="approval"
        />
        <Stat label="Clients" value="3" sub="2 SLA breaches at Helio" icon="clients" />
        <Stat
          label="AI spend this month"
          value={euro(SPEND.month)}
          sub={'forecast ' + euro(2_210)}
          icon="euro"
        />
      </div>
      <div className="pv-tiles">
        {PROJECTS.map((p) => (
          <ProjectTile key={p.key} pkey={p.key} go={props.go} />
        ))}
      </div>
      <div className="pv-grid pv-grid--2-1">
        <div className="pv-stack">
          <NeedsYou items={props.inbox} go={props.go} />
          <Card title="Team and agents this sprint" flush>
            <table className="pv-table">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Load</th>
                  <th className="pv-num">Points</th>
                  <th>Working on</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['mara', 18, 20, 'AUR planning'],
                  ['lea', 21, 18, 'NWL-188, NWL-191'],
                  ['jonas', 16, 18, 'HEL-212'],
                  ['sara', 12, 16, 'Run 41, Run 17'],
                  ['a-coder', 34, 40, '3 runs · ' + euro(4.61, 2) + ' today'],
                  ['a-tester', 9, 20, 'NWD-77'],
                ].map(([id, used, cap, what]) => (
                  <tr key={String(id)}>
                    <td>
                      <span className="pv-who">
                        <Avatar id={String(id)} size="xs" />
                        {person(String(id)).name}
                      </span>
                    </td>
                    <td className="pv-cell-bar">
                      <Bar
                        value={Number(used)}
                        max={Number(cap)}
                        tone={Number(used) > Number(cap) ? 'danger' : 'primary'}
                      />
                    </td>
                    <td
                      className={'pv-num' + (Number(used) > Number(cap) ? ' pv-text-danger' : '')}
                    >
                      {used}/{cap}
                    </td>
                    <td className="pv-muted">{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        <div className="pv-stack">
          <SpendCard />
          <AgentsNow go={props.go} />
        </div>
      </div>
    </div>
  );
}

function ClientHome(): ReactNode {
  const p = project('HEL');
  if (!p) return null;
  return (
    <div className="pv-page">
      <PageHead
        title="Good morning, Ines"
        sub="Helio Health AG · your projects with Broszio Engineering"
        actions={
          <>
            <Button icon="request">New request</Button>
            <Button kind="primary" icon="test">
              Start acceptance test
            </Button>
          </>
        }
      />
      <div className="pv-client-hero">
        <div className="pv-client-hero-main">
          <div className="pv-tile-head">
            <span className="pv-mono pv-tile-key">HEL</span>
            <span className="pv-tile-name">Patient app</span>
            <HealthPill health={p.health} />
          </div>
          <p className="pv-client-note">
            We are in testing. Two change requests you approved added work to this sprint, so the
            release on 17 October is at risk. Your acceptance test round 2 on Wednesday decides the
            date.
          </p>
          <ol className="pv-phase-line">
            {p.phases.map((ph) => (
              <li key={ph.key} className={'pv-phase-step pv-phase-step--' + ph.state}>
                <span className="pv-phase-dot" aria-hidden="true" />
                <span>{ph.label}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="pv-client-hero-side">
          <Ring value={p.quality.tests} max={p.quality.testsTotal} tone="success" size={72} />
          <div>
            <div className="pv-stat-label">Tests passing</div>
            <div className="pv-muted">
              {p.quality.tests} of {p.quality.testsTotal}
            </div>
          </div>
        </div>
      </div>
      <div className="pv-stats">
        <Stat
          label="Next milestone"
          value="App store release"
          sub="Fri 17 Oct · 13 days"
          icon="flag"
        />
        <Stat
          label="Budget used"
          value={euro(p.budget.used)}
          sub={'of ' + euro(p.budget.total) + ' · 93 %'}
          tone="warning"
          icon="euro"
        />
        <Stat
          label="Your open requests"
          value="11"
          sub="2 past the agreed response time"
          tone="danger"
          icon="request"
        />
        <Stat
          label="Latest release"
          value="v2.0.0-rc.3"
          sub="on staging since Thu"
          icon="releases"
        />
      </div>
      <div className="pv-grid pv-grid--2-1">
        <div className="pv-stack">
          <Card title="Waiting for you" flush>
            <ul className="pv-rows">
              {[
                {
                  icon: 'test' as const,
                  t: 'Acceptance test round 2: 8 cases',
                  s: 'Due Wed 8 Oct · Booking flow',
                  tone: 'warning' as const,
                  chip: 'Due in 4 days',
                },
                {
                  icon: 'euro' as const,
                  t: 'Quote for CR-9 SMS reminders: 8 points, €3 400',
                  s: 'Moves the release by 2 days if approved this week',
                  tone: 'primary' as const,
                  chip: 'Approve or decline',
                },
                {
                  icon: 'question' as const,
                  t: 'May cancelled appointments be re-booked within 24 h?',
                  s: 'Question Q-17 from the interview · asked by Analyst',
                  tone: 'info' as const,
                  chip: 'Answer',
                },
                {
                  icon: 'uikit' as const,
                  t: 'Design “Reminder settings” v1 ready for your review',
                  s: '3 screens · Nico Brandt',
                  tone: 'primary' as const,
                  chip: 'Review',
                },
              ].map((r) => (
                <li key={r.t} className="pv-row pv-row--static">
                  <span className="pv-kind pv-kind--signoff">
                    <PIcon name={r.icon} size={15} />
                  </span>
                  <span className="pv-row-main">
                    <span className="pv-row-title">{r.t}</span>
                    <span className="pv-row-sub">{r.s}</span>
                  </span>
                  <Chip tone={r.tone}>{r.chip}</Chip>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Your requests" flush>
            <table className="pv-table">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Status</th>
                  <th>Response</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['CR-9 SMS reminders 2 h before', 'Quoted', 'warning', 'in time'],
                  ['BUG-31 Calendar shows UTC times', 'In progress', 'primary', 'in time'],
                  ['BUG-29 Login loop on Android 12', 'Fixed, in rc.3', 'success', 'in time'],
                  ['Q-8 Data retention for chats', 'Waiting for us', 'danger', '2 days late'],
                ].map(([t, s, tone, sla]) => (
                  <tr key={t}>
                    <td className="pv-cell-grow">{t}</td>
                    <td>
                      <Chip tone={tone as 'primary'}>{s}</Chip>
                    </td>
                    <td className={(sla ?? '').includes('late') ? 'pv-text-danger' : 'pv-muted'}>
                      {sla}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        <div className="pv-stack">
          <Card title="Your team at Broszio">
            <ul className="pv-people">
              {['jonas', 'sara', 'nico', 'mara'].map((id) => (
                <li key={id} className="pv-person">
                  <Avatar id={id} size="md" />
                  <span>
                    <strong>{person(id).name}</strong>
                    <span className="pv-muted">{person(id).title}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Button icon="clock">Book a review meeting</Button>
          </Card>
          <Card title="What changed this week">
            <ul className="pv-changes">
              <li>Booking step 3 redesigned after your comments (v4 approved).</li>
              <li>Login loop on Android 12 fixed in release candidate 3.</li>
              <li>
                Security check found a problem in the booking API; fix planned before release.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
