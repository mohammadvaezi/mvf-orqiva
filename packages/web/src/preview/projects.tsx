// ── [PCODE-200 | S15 | v0.1.0] T16.4 Handover screens: design preview, team Handover tab, portal Handover section with signature ──
// ── [PCODE-159 | S15 | v0.1.0] D7 preview: full click-through, fixes and the gate A1 package ──
// ── [PCODE-156 | S15 | v0.1.0] D4 preview: Versions, Security, Code map and Releases ──
// ── [PCODE-155 | S15 | v0.1.0] D3 preview: Documents, UI kit and Test ──
// ── [PCODE-154 | S15 | v0.1.0] D2 preview: Ideation, Planning and Canvas ──
// ── [PCODE-153 | S15 | v0.1.0] D1 preview: design system v2, shell, Cmd-K, Home, Inbox, project overview ──
//    Why:  Projects across all clients, one project's overview with its ten tabs in lifecycle order, and
//          the page a section shows until its design step draws it. The overview answers in one screen:
//          where is the project in its lifecycle, will it hit the sprint goal and the milestone, what does
//          it cost (people and AI, in euro), how good is it, who and which agents work on it, what is next.
import { useState, type ReactNode } from 'react';
// [PCODE-200 | S15 | v0.1.0]
import { HandoverTab } from './handover.js';
import {
  ACTIVITY,
  CLIENTS,
  PROJECT_TABS,
  client,
  euro,
  person,
  project,
  type Project,
  type Role,
} from './data.js';
import { PIcon } from './picons.js';
import { BASE, link, visibleProjects } from './shell.js';
import {
  Avatar,
  AvatarStack,
  Bar,
  Button,
  Card,
  Chip,
  HealthPill,
  MiniBurndown,
  PageHead,
  Ring,
  Stat,
} from './ui.js';
import { SECTIONS, TABS, type Upcoming } from './upcoming.js';
// [PCODE-154 | S15 | v0.1.0]
import { CanvasTab } from './canvas.js';
// [PCODE-156 | S15 | v0.1.0]
import { CodeMapTab } from './codemap.js';
import { SecurityTab } from './security.js';
import { VersionsTab } from './versions.js';
// [PCODE-155 | S15 | v0.1.0]
import { DocumentsTab } from './documents.js';
import { TestTab } from './testtab.js';
import { UiKitTab } from './uikit.js';
import { IdeationTab } from './ideation.js';
import { PlanningTab } from './planning.js';

export function UpcomingPage(props: { u: Upcoming; embedded?: boolean }): ReactNode {
  const u = props.u;
  return (
    <div className={props.embedded ? 'pv-upcoming pv-upcoming--embedded' : 'pv-page'}>
      {!props.embedded ? <PageHead title={u.title} sub={u.summary} icon={u.icon} /> : null}
      <div className="pv-upcoming-card">
        <div className="pv-upcoming-head">
          <span className="pv-upcoming-icon">
            <PIcon name={u.icon} size={28} />
          </span>
          <div>
            <div className="pv-upcoming-step">{'Designed in step ' + u.step}</div>
            <h2 className="pv-upcoming-title">
              {props.embedded ? u.title + ': ' + u.summary : 'What this section will hold'}
            </h2>
          </div>
        </div>
        <ul className="pv-upcoming-list">
          {u.highlights.map((h) => (
            <li key={h}>
              <PIcon name="check" size={16} />
              <span>{h}</span>
            </li>
          ))}
        </ul>
        <p className="pv-muted pv-small">
          The full list is in docs/strategy/command-center-spec.md.
        </p>
      </div>
    </div>
  );
}

export function ProjectsPage(props: { role: Role; go: (p: string) => void }): ReactNode {
  const [group, setGroup] = useState<'client' | 'none'>('client');
  const list = visibleProjects(props.role);
  const groups =
    group === 'client'
      ? [
          ...CLIENTS.map((c) => ({
            label: c.name,
            items: list.filter((p) => p.clientId === c.id),
          })),
          { label: 'Internal', items: list.filter((p) => !p.clientId) },
        ].filter((g) => g.items.length)
      : [{ label: '', items: list }];
  return (
    <div className="pv-page">
      <PageHead
        title="Projects"
        sub={String(list.length) + ' projects · ' + String(CLIENTS.length) + ' clients'}
        icon="projects"
        actions={
          props.role === 'client' ? null : (
            <>
              <div className="pv-segmented" role="radiogroup" aria-label="Group by">
                <button
                  type="button"
                  role="radio"
                  aria-checked={group === 'client'}
                  className="pv-seg"
                  onClick={() => {
                    setGroup('client');
                  }}
                >
                  By client
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={group === 'none'}
                  className="pv-seg"
                  onClick={() => {
                    setGroup('none');
                  }}
                >
                  All
                </button>
              </div>
              <Button kind="primary" icon="plus">
                New project
              </Button>
            </>
          )
        }
      />
      <Card flush>
        <table className="pv-table pv-table--projects">
          <thead>
            <tr>
              <th>Project</th>
              <th>Health</th>
              <th>Phase</th>
              <th>Sprint</th>
              <th>Milestone</th>
              <th>Budget</th>
              <th className="pv-num">AI</th>
              <th>Quality</th>
              <th>Team</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.label}>
              {g.label ? (
                <tr className="pv-group-row">
                  <td colSpan={9}>{g.label}</td>
                </tr>
              ) : null}
              {g.items.map((p) => (
                <tr key={p.key} className="pv-click-row">
                  <td>
                    <a
                      className="pv-project-cell"
                      href={BASE + '/projects/' + p.key}
                      onClick={link('/projects/' + p.key, props.go)}
                    >
                      <span className="pv-mono pv-tile-key">{p.key}</span>
                      <span>
                        <strong>{p.name}</strong>
                        <span className="pv-muted pv-block">{person(p.lead).name}</span>
                      </span>
                    </a>
                  </td>
                  <td>
                    <HealthPill health={p.health} />
                  </td>
                  <td>{p.phase}</td>
                  <td className="pv-cell-bar">
                    <Bar
                      value={p.sprint.done}
                      max={p.sprint.total}
                      marker={(p.sprint.total * p.sprint.day) / p.sprint.days}
                      tone="success"
                    />
                    <span className="pv-muted pv-small">
                      {p.sprint.name} · {p.sprint.done}/{p.sprint.total} pts
                    </span>
                  </td>
                  <td>
                    <span className={p.milestone.daysLeft < 0 ? 'pv-text-danger' : ''}>
                      {p.milestone.name}
                    </span>
                    <span className="pv-muted pv-block pv-small">
                      {p.milestone.date} ·{' '}
                      {p.milestone.daysLeft < 0
                        ? String(-p.milestone.daysLeft) + ' d late'
                        : String(p.milestone.daysLeft) + ' d'}
                    </span>
                  </td>
                  <td className="pv-cell-bar">
                    <Bar
                      value={p.budget.used}
                      max={p.budget.total}
                      tone={p.budget.used / p.budget.total > 0.9 ? 'danger' : 'primary'}
                    />
                    <span className="pv-muted pv-small pv-num">
                      {euro(p.budget.used)} of {euro(p.budget.total)}
                    </span>
                  </td>
                  <td className="pv-num">{euro(p.budget.ai)}</td>
                  <td>
                    {p.quality.testsTotal ? (
                      <span className="pv-quality">
                        <Ring
                          value={p.quality.tests}
                          max={p.quality.testsTotal}
                          size={28}
                          tone={
                            p.quality.tests / p.quality.testsTotal > 0.95 ? 'success' : 'warning'
                          }
                        />
                        {p.quality.critical ? (
                          <Chip tone="danger">{p.quality.critical} critical</Chip>
                        ) : null}
                      </span>
                    ) : (
                      <span className="pv-muted">—</span>
                    )}
                  </td>
                  <td>
                    <AvatarStack ids={[...p.team, ...p.agents]} max={4} />
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </Card>
    </div>
  );
}

function Overview(props: { p: Project; role: Role; go: (p: string) => void }): ReactNode {
  const p = props.p;
  const c = client(p.clientId);
  const sprintPct = Math.round((p.sprint.done / p.sprint.total) * 100);
  return (
    <div className="pv-overview">
      <Card className="pv-lifecycle-card">
        <div className="pv-lifecycle">
          {p.phases.map((ph, i) => (
            <div key={ph.key} className={'pv-life pv-life--' + ph.state}>
              <div className="pv-life-top">
                <span className="pv-life-num">
                  {ph.state === 'done' ? <PIcon name="check" size={13} /> : i + 1}
                </span>
                <span className="pv-life-label">{ph.label}</span>
                {ph.state === 'active' ? <Chip tone="primary">Now</Chip> : null}
              </div>
              <Bar value={ph.done} max={100} tone={ph.state === 'done' ? 'success' : 'primary'} />
              <span className="pv-life-gate">
                {
                  [
                    'G0 idea approved',
                    'G1 plan signed',
                    'G2 built and deployed',
                    'G3 tested and secure',
                    'Handover',
                  ][i]
                }
              </span>
            </div>
          ))}
        </div>
        <p className="pv-health-note">
          <HealthPill health={p.health} /> {p.healthNote}
        </p>
      </Card>

      <div className="pv-stats pv-stats--6">
        <Stat
          label={p.sprint.name}
          value={String(sprintPct) + ' %'}
          sub={'day ' + String(p.sprint.day) + ' of ' + String(p.sprint.days)}
          icon="planning"
        />
        <Stat
          label="Milestone"
          value={
            p.milestone.daysLeft < 0
              ? String(-p.milestone.daysLeft) + ' d late'
              : String(p.milestone.daysLeft) + ' days'
          }
          sub={p.milestone.name}
          tone={p.milestone.daysLeft < 0 ? 'danger' : undefined}
          icon="flag"
        />
        <Stat
          label="Budget"
          value={String(Math.round((p.budget.used / p.budget.total) * 100)) + ' %'}
          sub={euro(p.budget.used) + ' of ' + euro(p.budget.total)}
          tone={p.budget.used / p.budget.total > 0.9 ? 'danger' : undefined}
          icon="euro"
        />
        <Stat
          label="AI cost"
          value={euro(p.budget.ai)}
          sub={String(Math.round((p.budget.ai / p.budget.used) * 100)) + ' % of spend'}
          icon="agents"
        />
        <Stat
          label="Tests"
          value={
            p.quality.testsTotal
              ? String(Math.round((p.quality.tests / p.quality.testsTotal) * 100)) + ' %'
              : '—'
          }
          sub={
            p.quality.testsTotal
              ? String(p.quality.tests) + ' of ' + String(p.quality.testsTotal) + ' passing'
              : 'no runs yet'
          }
          icon="test"
        />
        <Stat
          label="Findings"
          value={String(p.quality.findings)}
          sub={p.quality.critical ? String(p.quality.critical) + ' critical' : 'none critical'}
          tone={p.quality.critical ? 'danger' : undefined}
          icon="security"
        />
      </div>

      <div className="pv-grid pv-grid--2-1">
        <div className="pv-stack">
          <Card
            title={'Sprint goal: ' + p.sprint.goal}
            action={
              <a
                className="pv-link"
                href={BASE + '/projects/' + p.key + '/planning'}
                onClick={link('/projects/' + p.key + '/planning', props.go)}
              >
                Open planning
              </a>
            }
          >
            <div className="pv-burn-wrap">
              <MiniBurndown actual={p.burndown} ideal={p.ideal} days={p.sprint.days} />
              <div className="pv-burn-legend">
                <span>
                  <span className="pv-swatch pv-swatch--actual" /> Remaining
                </span>
                <span>
                  <span className="pv-swatch pv-swatch--ideal" /> Ideal
                </span>
                <span className="pv-muted">{p.sprint.total - p.sprint.done} points left</span>
              </div>
            </div>
          </Card>
          <Card title="Latest in this project" flush>
            <ul className="pv-feed">
              {ACTIVITY.filter((a) => a.project === p.key).map((a) => (
                <li key={a.id} className="pv-feed-item">
                  <Avatar id={a.who} size="xs" />
                  <span className="pv-feed-text">
                    <strong>{person(a.who).name}</strong> {a.text}
                  </span>
                  <span className="pv-feed-time pv-num">{a.at}</span>
                </li>
              ))}
              {!ACTIVITY.some((a) => a.project === p.key) ? (
                <li className="pv-feed-item pv-muted">Nothing yet today.</li>
              ) : null}
            </ul>
          </Card>
        </div>
        <div className="pv-stack">
          <Card title="Next up">
            <ul className="pv-next">
              {p.next.map((n) => (
                <li key={n.text}>
                  <span className="pv-next-date">{n.date}</span>
                  <span>{n.text}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Risks">
            {p.risks.length ? (
              <ul className="pv-risks">
                {p.risks.map((r) => (
                  <li key={r.text}>
                    <Chip
                      tone={
                        r.level === 'high' ? 'danger' : r.level === 'medium' ? 'warning' : 'neutral'
                      }
                    >
                      {r.level}
                    </Chip>
                    <span className="pv-risk-text">{r.text}</span>
                    <Avatar id={r.owner} size="xs" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pv-muted">No open risks.</p>
            )}
          </Card>
          <Card title="People and agents">
            <ul className="pv-people">
              {[...p.team, ...p.agents].map((id) => (
                <li key={id} className="pv-person">
                  <Avatar id={id} size="sm" />
                  <span>
                    <strong>{person(id).name}</strong>
                    <span className="pv-muted">{person(id).where ?? person(id).title}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          {c && props.role !== 'client' ? (
            <Card title={'Client: ' + c.name}>
              <div className="pv-kv">
                <span>Account owner</span>
                <span>{person(c.owner).name}</span>
                <span>Open requests</span>
                <span>
                  {c.openRequests}
                  {c.slaBreaches ? (
                    <span className="pv-text-danger"> · {c.slaBreaches} past SLA</span>
                  ) : null}
                </span>
                <span>Satisfaction</span>
                <span>{c.csat.toFixed(1)} of 5</span>
              </div>
              <Button icon="user">View as client</Button>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ProjectPage(props: {
  pkey: string;
  tab: string;
  role: Role;
  go: (p: string) => void;
}): ReactNode {
  const p = project(props.pkey);
  if (!p)
    return (
      <UpcomingPage
        u={
          SECTIONS['projects'] ?? {
            title: 'Projects',
            icon: 'projects',
            step: 'D1',
            summary: '',
            highlights: [],
          }
        }
      />
    );
  const c = client(p.clientId);
  // [PCODE-159 | S15 | v0.1.0] a client sees the overview only; the portal has its own sections for the rest
  const tabs =
    props.role === 'client' ? PROJECT_TABS.filter((t) => t.key === 'overview') : PROJECT_TABS;
  const tab = tabs.some((t) => t.key === props.tab) ? props.tab : 'overview';
  const u = TABS[tab];
  return (
    <div className="pv-page">
      <header className="pv-project-head">
        <div className="pv-project-id">
          <span className="pv-project-key pv-mono">{p.key}</span>
          <div>
            <h1 className="pv-page-title">{p.name}</h1>
            <div className="pv-project-meta">
              {c ? <Chip icon="clients">{c.name}</Chip> : <Chip>Internal</Chip>}
              <HealthPill health={p.health} />
              <Chip tone="primary">{p.phase}</Chip>
              <Chip mono>{p.version}</Chip>
              <span className="pv-muted">Lead {person(p.lead).name}</span>
            </div>
          </div>
        </div>
        <div className="pv-page-actions">
          <AvatarStack ids={[...p.team, ...p.agents]} max={6} />
          {props.role !== 'client' ? (
            <>
              <Button
                icon="ide"
                title="Opens this project in VS Code with the same task, sprint and live updates"
              >
                Open in VS Code
              </Button>
              <Button kind="primary" icon="plus">
                Create
              </Button>
            </>
          ) : (
            <Button kind="primary" icon="request">
              New request
            </Button>
          )}
        </div>
      </header>
      <nav className="pv-tabs" aria-label="Project">
        {tabs.map((t) => (
          <a
            key={t.key}
            href={BASE + '/projects/' + p.key + (t.key === 'overview' ? '' : '/' + t.key)}
            className="pv-tab"
            aria-current={t.key === tab ? 'page' : undefined}
            onClick={link(
              '/projects/' + p.key + (t.key === 'overview' ? '' : '/' + t.key),
              props.go,
            )}
          >
            {t.key !== 'overview' ? (
              <PIcon name={TABS[t.key]?.icon ?? 'overview'} size={15} />
            ) : (
              <PIcon name="overview" size={15} />
            )}
            {t.label}
          </a>
        ))}
      </nav>
      {/* [PCODE-154 | S15 | v0.1.0] Ideation, Planning and Canvas are designed in D2 */}
      {tab === 'overview' || !u ? (
        <Overview p={p} role={props.role} go={props.go} />
      ) : tab === 'ideation' ? (
        <IdeationTab pkey={p.key} />
      ) : tab === 'planning' ? (
        <PlanningTab pkey={p.key} />
      ) : tab === 'canvas' ? (
        <CanvasTab />
      ) : /* [PCODE-155 | S15 | v0.1.0] Documents, UI kit and Test are designed in D3 */
      tab === 'documents' ? (
        <DocumentsTab />
      ) : tab === 'uikit' ? (
        <UiKitTab />
      ) : tab === 'test' ? (
        <TestTab />
      ) : /* [PCODE-156 | S15 | v0.1.0] Versions, Security and Code map are designed in D4 */
      tab === 'versions' ? (
        <VersionsTab />
      ) : tab === 'security' ? (
        <SecurityTab />
      ) : tab === 'codemap' ? (
        <CodeMapTab />
      ) : /* [PCODE-200 | S15 | v0.1.0] */ tab === 'handover' ? (
        <HandoverTab />
      ) : (
        <UpcomingPage u={u} embedded />
      )}
    </div>
  );
}
