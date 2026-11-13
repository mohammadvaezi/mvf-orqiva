// ── [PCODE-206 | S15 | v0.1.0] T17.4 Release management in the web app: trains, environments with promote and rollback, notes approval, backport, go/no-go notes, changelog ──
// ── [PCODE-156 | S15 | v0.1.0] D4 preview: Versions, Security, Code map and Releases ──
//    Why:  the Versions tab and the Releases page. Pull requests show what a reviewer needs before
//          opening them, and warn when a change has no task or touches another task's code. A version is a
//          go/no-go decision with its contents (tasks, tests, findings), release notes for the team and
//          for the client, backports and a freeze window; environments show what runs where, and promotion
//          and rollback are one click with an approval. DORA measures the whole delivery.
import { useState, type ReactNode } from 'react';
import { DORA, ENVIRONMENTS, FLAGS, PRS, VERSIONS } from './data4.js';
import { PROJECTS, person } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Button, Card, Chip, PageHead, Stat } from './ui.js';
// [PCODE-206 | S15 | v0.1.0] the live train views, with sample data
import { TrainList, TrainTable, type TrainView } from '../v2/releasing.js';

const SAMPLE_TRAIN: TrainView = {
  id: 'train-october',
  name: 'October',
  state: 'frozen',
  freezeAt: '2026-10-10T16:00:00Z',
  targetDate: '2026-10-16',
  note: '',
  shippedBy: null,
  shippedAt: null,
  rollbackReason: '',
  releases: [
    {
      releaseId: 'r1',
      projectId: 'p-nwl',
      projectKey: 'NWL',
      projectName: 'Nordwind Logistics',
      version: '1.4.0',
      state: 'frozen',
      environmentId: 'e1',
      environmentName: 'Production',
      items: 14,
      done: 14,
      deploy: null,
    },
    {
      releaseId: 'r2',
      projectId: 'p-hel',
      projectKey: 'HEL',
      projectName: 'Helio patient app',
      version: '2.1.0',
      state: 'frozen',
      environmentId: 'e2',
      environmentName: 'Production',
      items: 9,
      done: 8,
      deploy: null,
    },
  ],
};
const SAMPLE_CHECK = {
  ready: false,
  releases: [
    { project: 'NWL', version: '1.4.0', ready: true, missing: [] },
    { project: 'HEL', version: '2.1.0', ready: false, missing: ['1 task is not done'] },
  ],
};

function PullRequests(): ReactNode {
  return (
    <Card
      flush
      title="Pull requests · 4 open"
      action={<Chip icon="git">GitHub · nordwind/fleet-portal</Chip>}
    >
      <ul className="pv-rows">
        {PRS.map((p) => (
          <li key={p.n} className="pv-row pv-row--static pv-pr">
            <Avatar id={p.author} size="sm" />
            <span className="pv-row-main">
              <span className="pv-row-title">
                <span className="pv-mono pv-muted">#{p.n}</span> {p.title}
              </span>
              <span className="pv-row-sub">
                <span className="pv-mono">{p.branch}</span> ·{' '}
                {p.task === '—' ? <span className="pv-text-warning">no task linked</span> : p.task}{' '}
                · opened {p.age} ago
                {p.ai ? ' · ' + String(p.ai) + ' AI comments' : ''}
              </span>
            </span>
            <span className="pv-pr-size pv-mono pv-small">
              <span className="pv-text-success">+{p.size[0]}</span>{' '}
              <span className="pv-text-danger">−{p.size[1]}</span>
            </span>
            <Chip
              tone={p.checks === 'passed' ? 'success' : p.checks === 'failed' ? 'danger' : 'info'}
              icon={p.checks === 'passed' ? 'check' : p.checks === 'failed' ? 'x' : 'clock'}
            >
              checks {p.checks}
            </Chip>
            <Chip tone={p.reviews === 'approved' ? 'success' : 'neutral'}>
              {p.reviews === 'approved' ? 'approved' : 'reviews ' + p.reviews}
            </Chip>
            <Chip tone={p.risk === 'low' ? 'neutral' : 'warning'}>{p.risk} risk</Chip>
            {p.stale ? <Chip tone="warning">stale</Chip> : null}
            {p.conflicts ? <Chip tone="danger">conflicts</Chip> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Release(): ReactNode {
  const [notes, setNotes] = useState<'team' | 'client'>('client');
  const [promoted, setPromoted] = useState(false);
  const checks: [string, boolean, string][] = [
    ['All tasks done or moved out', true, '11 tasks, 3 fixes'],
    ['Tests', false, '412 of 431 passing · C-412 failed in Firefox'],
    ['Security gate', true, '0 critical, 0 known-exploited reachable'],
    ['Licences', true, 'no blocked licence in the web app'],
    ['Client acceptance', false, 'Nordwind round 2 on Thu 9 Oct'],
    ['Release notes approved', true, 'by Mara, 09:50'],
  ];
  const ready = checks.filter((c) => c[1]).length;
  return (
    <div className="pv-stack">
      <div className="pv-split">
        <Card
          title={
            <>
              v1.4.0 <Chip tone="warning">release candidate</Chip>
            </>
          }
          action={
            <span className="pv-muted pv-small">
              Train “October” · freeze from Fri 10 Oct 18:00
            </span>
          }
        >
          <div className="pv-golive">
            <div className="pv-golive-score">
              <span className="pv-big pv-num">
                {ready}/{checks.length}
              </span>
              <span className="pv-muted">ready for production</span>
            </div>
            <ul className="pv-checks">
              {checks.map(([t, ok, d]) => (
                <li key={t} className={ok ? 'pv-check pv-check--ok' : 'pv-check pv-check--no'}>
                  <PIcon name={ok ? 'check' : 'x'} size={15} />
                  <span>
                    <strong>{t}</strong> <span className="pv-muted pv-small">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="pv-page-actions pv-mt">
            {promoted ? (
              <Chip tone="success" icon="check">
                Promotion to Pilot requested · Ole approves · deploys with the runner
              </Chip>
            ) : (
              <Button
                kind="primary"
                icon="releases"
                onClick={() => {
                  setPromoted(true);
                }}
              >
                Promote rc.2 to Pilot
              </Button>
            )}
            <Button kind="ghost">Go / no-go meeting notes</Button>
          </div>
        </Card>
        <Card title="Is a fix in a version?">
          <div className="pv-ask">
            <input defaultValue="NWL-191 CSV export at scale" aria-label="Task or commit" />
          </div>
          <ul className="pv-checks">
            <li className="pv-check pv-check--ok">
              <PIcon name="check" size={15} />
              <span>
                <strong>v1.4.0-rc.2</strong>{' '}
                <span className="pv-muted pv-small">contains #323 (not merged yet: no)</span>
              </span>
            </li>
            <li className="pv-check pv-check--no">
              <PIcon name="x" size={15} />
              <span>
                <strong>v1.3.8 in production</strong>{' '}
                <span className="pv-muted pv-small">not included</span>
              </span>
            </li>
          </ul>
          <Button size="sm" icon="git">
            Backport to 1.3.x
          </Button>
        </Card>
      </div>
      <Card
        title="Release notes"
        action={
          <div className="pv-segmented" role="radiogroup" aria-label="Audience">
            <button
              type="button"
              role="radio"
              aria-checked={notes === 'client'}
              className="pv-seg"
              onClick={() => {
                setNotes('client');
              }}
            >
              For Nordwind
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={notes === 'team'}
              className="pv-seg"
              onClick={() => {
                setNotes('team');
              }}
            >
              For the team
            </button>
          </div>
        }
      >
        {notes === 'client' ? (
          <article className="pv-doc">
            <h3>What is new in 1.4</h3>
            <ul>
              <li>
                Dispatchers can change the order of stops on the map; drivers get the new route
                within seconds.
              </li>
              <li>Supervisors can look at tours without changing them.</li>
              <li>Tour exports now work for any size of month.</li>
            </ul>
            <p className="pv-muted pv-small">
              Written by Analyst from the tasks, approved by Mara. Shown in the client portal after
              the release.
            </p>
          </article>
        ) : (
          <pre className="pv-code">
            {
              'feat(dispatch): live re-routing (NWL-188, #318)\nfeat(auth): read-only supervisor role (NWL-198, #321)\nfix(export): CSV in pages of 5 000 (NWL-191, #323)\nchore(deps): map-sdk 4.2 (F-79)\n\nBreaking: PATCH /tours/{id}/route replaces POST /tours/{id}/reorder'
            }
          </pre>
        )}
      </Card>
      <Card flush title="Versions">
        <table className="pv-table">
          <thead>
            <tr>
              <th>Version</th>
              <th>State</th>
              <th>Date</th>
              <th className="pv-num">Tasks</th>
              <th>Tests</th>
              <th>Findings</th>
              <th>Running on</th>
            </tr>
          </thead>
          <tbody>
            {VERSIONS.map((v) => (
              <tr key={v.v}>
                <td className="pv-mono pv-strong">{v.v}</td>
                <td>
                  <Chip
                    tone={
                      v.state === 'in production'
                        ? 'success'
                        : v.state === 'rolled back'
                          ? 'danger'
                          : v.state === 'release candidate'
                            ? 'warning'
                            : 'neutral'
                    }
                  >
                    {v.state}
                  </Chip>
                </td>
                <td className="pv-muted">{v.date}</td>
                <td className="pv-num">
                  {v.tasks} + {v.fixes} fixes
                </td>
                <td className="pv-num">{v.tests}</td>
                <td>{v.findings}</td>
                <td>{v.env}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Environments(): ReactNode {
  return (
    <div className="pv-stack">
      <div className="pv-env-row">
        {ENVIRONMENTS.map((e, i) => (
          <div key={e.name} className="pv-env-wrap">
            <Card className={'pv-env pv-env--' + e.health}>
              <div className="pv-env-head">
                <strong>{e.name}</strong>
                <Chip tone={e.health === 'healthy' ? 'success' : 'warning'}>{e.health}</Chip>
              </div>
              <div className="pv-mono pv-env-version">{e.version}</div>
              <div className="pv-muted pv-small">{e.url}</div>
              <div className="pv-who pv-small pv-mt">
                <Avatar id={e.by} size="xs" />
                {e.deployed}
              </div>
              <div className="pv-page-actions pv-mt">
                {i < ENVIRONMENTS.length - 1 ? (
                  <Button size="sm" icon="arrowRight">
                    Promote
                  </Button>
                ) : null}
                <Button size="sm" kind="ghost">
                  Roll back
                </Button>
              </div>
            </Card>
            {i < ENVIRONMENTS.length - 1 ? (
              <span className="pv-env-arrow">
                <PIcon name="arrowRight" />
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <Card title="Staging vs Production">
        <ul className="pv-changes">
          <li>11 tasks and 3 fixes are on Staging but not in Production.</li>
          <li>1 database migration waits: 0042_route_versions (adds a column, reversible).</li>
          <li>
            2 settings differ: MAP_TIMEOUT_MS (2000 vs 5000), FEATURE live-reroute (on vs off).
          </li>
        </ul>
      </Card>
    </div>
  );
}

function Flags(): ReactNode {
  return (
    <Card flush title="Feature flags">
      <table className="pv-table">
        <thead>
          <tr>
            <th>Flag</th>
            <th>Task</th>
            <th>Where it is on</th>
            <th>Age</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {FLAGS.map((f) => (
            <tr key={f.key}>
              <td className="pv-mono">{f.key}</td>
              <td className="pv-mono">{f.task}</td>
              <td className="pv-cell-grow">{f.state}</td>
              <td className={f.stale ? 'pv-text-warning' : 'pv-muted'}>{f.age}</td>
              <td>
                {f.stale ? (
                  <Button size="sm">Remove flag (task)</Button>
                ) : (
                  <Button size="sm" kind="ghost">
                    Change
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Delivery(): ReactNode {
  const weeks = [2, 3, 3, 4, 5, 4, 6, 4];
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        {DORA.map((d) => (
          <Stat
            key={d.label}
            label={d.label}
            value={d.value}
            sub={d.band + ' · ' + d.trend + ' vs last month'}
            icon="releases"
          />
        ))}
      </div>
      <Card title="Deploys per week and what went wrong">
        <svg className="pv-chart" viewBox="0 0 520 150" role="img" aria-label="Deploys per week">
          {weeks.map((n, i) => (
            <g key={i}>
              <rect
                className="pv-bar-done"
                x={20 + i * 62}
                y={130 - n * 18}
                width="34"
                height={n * 18}
                rx="4"
              />
              {i === 5 ? (
                <rect
                  className="pv-bar-fail"
                  x={20 + i * 62}
                  y={130 - n * 18}
                  width="34"
                  height="18"
                  rx="4"
                />
              ) : null}
              <text className="pv-axis" x={37 + i * 62} y="146" textAnchor="middle">
                {'W' + String(33 + i)}
              </text>
            </g>
          ))}
        </svg>
        <p className="pv-muted pv-small">
          W38: 1 of 4 deploys failed (1.3.9, map tiles slow) and was rolled back in 38 min.
        </p>
      </Card>
    </div>
  );
}

const VIEWS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'prs', label: 'Pull requests', icon: 'git' },
  { key: 'release', label: 'Versions and releases', icon: 'releases' },
  { key: 'env', label: 'Environments', icon: 'projects' },
  { key: 'flags', label: 'Feature flags', icon: 'flag' },
  { key: 'dora', label: 'Delivery metrics', icon: 'insights' },
];

export function VersionsTab(): ReactNode {
  const [view, setView] = useState('prs');
  return (
    <div className="pv-stack">
      <nav className="pv-subtabs" aria-label="Versions view">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            className="pv-subtab"
            aria-pressed={view === v.key}
            onClick={() => {
              setView(v.key);
            }}
          >
            <PIcon name={v.icon} size={14} />
            {v.label}
          </button>
        ))}
      </nav>
      {view === 'prs' ? <PullRequests /> : null}
      {view === 'release' ? <Release /> : null}
      {view === 'env' ? <Environments /> : null}
      {view === 'flags' ? <Flags /> : null}
      {view === 'dora' ? <Delivery /> : null}
    </div>
  );
}

/** The top-level page: every project's next release and what runs where. */
export function ReleasesPage(): ReactNode {
  const rows = [
    {
      key: 'NWL',
      next: 'v1.4.0',
      date: 'Mon 13 Oct',
      state: 'rc.2 on staging',
      ready: '4/6',
      prod: 'v1.3.8',
    },
    {
      key: 'HEL',
      next: 'v2.0.0',
      date: 'Fri 17 Oct',
      state: 'rc.3 · blocked by F-81',
      ready: '3/6',
      prod: 'v1.9.2',
    },
    {
      key: 'NWD',
      next: 'v1.0.0',
      date: 'resubmitting',
      state: 'store review',
      ready: '5/6',
      prod: '—',
    },
    { key: 'AUR', next: 'v0.1.0', date: '14 Nov', state: 'not started', ready: '0/6', prod: '—' },
    {
      key: 'PE',
      next: 'v0.2.0',
      date: 'after gate A1',
      state: 'design',
      ready: '—',
      prod: 'v0.1.0',
    },
  ];
  return (
    <div className="pv-page">
      <PageHead
        title="Releases and environments"
        sub="Next release per project, what runs where, and how the department delivers"
        icon="releases"
        actions={<Chip icon="flag">Freeze for the October train: Fri 10 Oct 18:00</Chip>}
      />
      <div className="pv-stats">
        {DORA.map((d) => (
          <Stat
            key={d.label}
            label={d.label}
            value={d.value}
            sub={'all projects · ' + d.band}
            icon="releases"
          />
        ))}
      </div>
      <Card flush title="Next releases" className="pv-mt">
        <table className="pv-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Next version</th>
              <th>Planned</th>
              <th>Now</th>
              <th>Go / no-go</th>
              <th>In production</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <span className="pv-mono pv-tile-key">{r.key}</span>{' '}
                  {PROJECTS.find((p) => p.key === r.key)?.name}
                </td>
                <td className="pv-mono pv-strong">{r.next}</td>
                <td>{r.date}</td>
                <td className={r.state.includes('blocked') ? 'pv-text-danger' : ''}>{r.state}</td>
                <td className="pv-num">{r.ready}</td>
                <td className="pv-mono">{r.prod}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {/* [PCODE-206 | S15 | v0.1.0] T17: the October train carries two projects */}
      <Card flush title="Release trains" className="pv-mt">
        <TrainList trains={[SAMPLE_TRAIN]} open={SAMPLE_TRAIN.id} onOpen={() => undefined} />
        <div className="pv-pad">
          <TrainTable train={SAMPLE_TRAIN} check={SAMPLE_CHECK} go={() => undefined} />
          <div className="pv-page-actions pv-mt">
            <Button kind="ghost" icon="snooze">
              Freeze the train
            </Button>
            <Button kind="primary" icon="releases">
              Ship the train (2)
            </Button>
            <Button kind="ghost">Changelog</Button>
          </div>
        </div>
      </Card>
      <p className="pv-muted pv-small pv-mt">
        Deploys run through the project’s runner; who may promote to production is set per
        environment ({person('ole').name} for Nordwind).
      </p>
    </div>
  );
}
