// ── [PCODE-158 | S15 | v0.1.0] D6 preview: Clients and portal, Incidents, Time, web and VS Code side by side ──
//    Why:  Incidents and on-call, from the first alert to the postmortem. An incident shows its timeline
//          (built from events), its roles, and the changes that may have caused it: recent deploys and the
//          fingerprinted code they touched, with a rollback button. Updates go to the team and to the
//          client's status page. The postmortem is drafted from the timeline; its actions become tasks.
import { useState, type ReactNode } from 'react';
import { euro, person } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Bar, Button, Card, Chip, PageHead, Stat } from './ui.js';

const TIMELINE = [
  {
    at: '09:40',
    who: 'system',
    text: 'Alert: booking API p95 above 3 s on staging (HEL), 3 alerts grouped',
  },
  { at: '09:41', who: 'jonas', text: 'Acknowledged from the phone' },
  {
    at: '09:43',
    who: 'a-security',
    text: 'Suspect change: deploy 2.0.0-rc.3 at 09:12 touched src/api/booking.ts (HEL-212)',
  },
  { at: '09:47', who: 'jonas', text: 'Database waits on slot_lock; migration 0041 added no index' },
  {
    at: '09:52',
    who: 'mara',
    text: 'Status update to Helio: “Booking is slow on the test environment; production not affected.”',
  },
];

function Active(): ReactNode {
  const [acked, setAcked] = useState(true);
  const [rolled, setRolled] = useState(false);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState(TIMELINE);
  return (
    <div className="pv-split">
      <div className="pv-stack">
        <Card>
          <div className="pv-inc-head">
            <Chip tone="danger">SEV-2</Chip>
            <strong className="pv-inc-title">Booking API slow on HEL staging</strong>
            <Chip tone={rolled ? 'success' : 'warning'}>
              {rolled ? 'mitigated' : 'investigating'}
            </Chip>
            <span className="pv-spacer" />
            <span className="pv-muted pv-small pv-num">open 18 min</span>
          </div>
          <div className="pv-inc-roles">
            <span className="pv-who pv-small">
              <Avatar id="jonas" size="xs" /> Commander: Jonas
            </span>
            <span className="pv-who pv-small">
              <Avatar id="mara" size="xs" /> Communication: Mara
            </span>
            <span className="pv-who pv-small">
              <Avatar id="a-security" size="xs" /> Helper: Sentinel
            </span>
            <span className="pv-muted pv-small">Channel #inc-hel-0412 · bridge open</span>
          </div>
          {!acked ? (
            <Button
              kind="primary"
              onClick={() => {
                setAcked(true);
              }}
            >
              Acknowledge
            </Button>
          ) : null}
        </Card>
        <Card title="Timeline">
          <ol className="pv-inc-timeline">
            {lines.map((l, i) => (
              <li key={i}>
                <span className="pv-num pv-muted pv-small">{l.at}</span>
                {l.who === 'system' ? (
                  <span className="pv-kind pv-kind--incident pv-kind--sm">
                    <PIcon name="incident" size={12} />
                  </span>
                ) : (
                  <Avatar id={l.who} size="xs" />
                )}
                <span>{l.text}</span>
              </li>
            ))}
          </ol>
          <div className="pv-ask pv-mt">
            <input
              value={note}
              placeholder="Add to the timeline…"
              aria-label="Note"
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
            <Button
              onClick={() => {
                if (!note.trim()) return;
                setLines((l) => [...l, { at: '09:58', who: 'jonas', text: note.trim() }]);
                setNote('');
              }}
            >
              Add
            </Button>
          </div>
        </Card>
      </div>
      <div className="pv-stack">
        <Card title="Suspect changes">
          <ul className="pv-rows pv-rows--tight">
            <li className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">Deploy 2.0.0-rc.3 to staging · 09:12</span>
                <span className="pv-row-sub">
                  HEL-212 booking slots · migration 0041 · 6 files · by Coder, reviewed by Jonas
                </span>
              </span>
              <Chip tone="danger">likely</Chip>
            </li>
            <li className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">Config change MAP_TIMEOUT_MS · 08:55</span>
                <span className="pv-row-sub">not in the failing path</span>
              </span>
              <Chip>unlikely</Chip>
            </li>
          </ul>
          {rolled ? (
            <Chip tone="success" icon="check">
              Rolled back to rc.2 at 09:59 · p95 back to 410 ms
            </Chip>
          ) : (
            <div className="pv-page-actions">
              <Button
                kind="danger"
                icon="releases"
                onClick={() => {
                  setRolled(true);
                }}
              >
                Roll back to rc.2
              </Button>
              <Button kind="ghost" icon="agents">
                Ask Coder for an index fix
              </Button>
            </div>
          )}
        </Card>
        <Card title="Status page (Helio sees this)">
          <div className="pv-callout pv-callout--warn">
            <PIcon name="incident" size={16} />
            <div>
              Booking is slow on the test environment. Production is not affected. Next update by
              10:30.
            </div>
          </div>
          <Button size="sm">Post an update</Button>
        </Card>
      </div>
    </div>
  );
}

function OnCall(): ReactNode {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const primary = ['jonas', 'jonas', 'ole', 'ole', 'ole', 'lea', 'lea'];
  const backup = ['ole', 'ole', 'jonas', 'jonas', 'jonas', 'tim', 'tim'];
  return (
    <div className="pv-stack">
      <Card
        flush
        title="This week · rotation “Product engineering”"
        action={<Button size="sm">Swap a shift</Button>}
      >
        <div className="pv-rota">
          <div className="pv-rota-label">Day</div>
          {days.map((d) => (
            <div key={d} className="pv-rota-head">
              {d}
            </div>
          ))}
          <div className="pv-rota-label">Primary</div>
          {primary.map((p, i) => (
            <div key={i} className="pv-rota-cell">
              <Avatar id={p} size="xs" /> {person(p).name.split(' ')[0]}
            </div>
          ))}
          <div className="pv-rota-label">Backup</div>
          {backup.map((p, i) => (
            <div key={i} className="pv-rota-cell pv-rota-cell--backup">
              <Avatar id={p} size="xs" /> {person(p).name.split(' ')[0]}
            </div>
          ))}
        </div>
      </Card>
      <Card title="Escalation">
        <ol className="pv-numbered">
          <li>Primary gets a push and, after 5 minutes, a phone call.</li>
          <li>After 10 minutes without acknowledgement: backup.</li>
          <li>
            After 20 minutes: Mara Schulz (lead), and the account owner for client-facing systems.
          </li>
        </ol>
        <p className="pv-muted pv-small">
          Holidays come from Time; Tim’s days off on 6–7 Oct are already covered.
        </p>
      </Card>
    </div>
  );
}

function Postmortems(): ReactNode {
  const [tasks, setTasks] = useState(false);
  return (
    <Card
      title="Postmortem · SEV-3 tour map tiles slow (NWL, 3 Oct)"
      action={
        <Chip tone="agent" icon="agents">
          drafted by Analyst from the timeline
        </Chip>
      }
    >
      <article className="pv-doc">
        <h3>What happened</h3>
        <p>
          Map tiles took 4.1 s at p95 for 38 minutes after deploy 1.3.9; dispatchers saw grey maps.
        </p>
        <h3>Why</h3>
        <p>
          The cache headers of the tile proxy were removed in NWL-196; every tile went to the
          provider and hit its rate limit.
        </p>
        <h3>What we change</h3>
        <ul>
          <li>Test for cache headers in the deploy check</li>
          <li>Alert on provider rate limit at 70 %</li>
          <li>Runbook “Map provider outage”: add the rollback step</li>
        </ul>
      </article>
      <div className="pv-page-actions pv-mt">
        {tasks ? (
          <Chip tone="success" icon="check">
            3 tasks created in NWL Sprint 15 · runbook owner notified
          </Chip>
        ) : (
          <Button
            kind="primary"
            onClick={() => {
              setTasks(true);
            }}
          >
            Turn actions into tasks
          </Button>
        )}
        <Button kind="ghost">Share with Nordwind</Button>
      </div>
    </Card>
  );
}

function Reliability(): ReactNode {
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat
          label="Time to acknowledge"
          value="2 min"
          sub="median, 30 days"
          tone="success"
          icon="clock"
        />
        <Stat label="Time to restore" value="38 min" sub="median, 30 days" icon="time" />
        <Stat label="Incidents" value="4" sub="0 SEV-1 · 1 SEV-2 · 3 SEV-3" icon="incident" />
        <Stat
          label="Caused by a deploy"
          value="3 of 4"
          sub="all found by suspect changes"
          icon="releases"
        />
      </div>
      <Card flush title="Service level objectives">
        <table className="pv-table">
          <thead>
            <tr>
              <th>Objective</th>
              <th>Error budget left (30 days)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[
              ['NWL dispatch API: 99.9 % of requests under 300 ms', 64, ''],
              ['NWL tracking page available 99.95 %', 88, ''],
              ['HEL booking: 99.5 % successful', 21, 'burns fast: 3× normal today'],
            ].map(([o, v, w]) => (
              <tr key={String(o)}>
                <td className="pv-cell-grow">{o}</td>
                <td className="pv-cell-bar">
                  <Bar value={Number(v)} max={100} tone={Number(v) < 30 ? 'danger' : 'success'} />
                  <span className="pv-small pv-muted">{v} %</span>
                </td>
                <td className="pv-text-danger pv-small">{w}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="pv-muted pv-small">
        Paging is free; phone calls cost about {euro(0.05, 2)} each through the SMS and voice
        provider.
      </p>
    </div>
  );
}

const VIEWS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'active', label: 'Now: SEV-2 HEL', icon: 'incident' },
  { key: 'oncall', label: 'On-call', icon: 'people' },
  { key: 'post', label: 'Postmortems', icon: 'documents' },
  { key: 'rel', label: 'Reliability', icon: 'insights' },
];

export function IncidentsPage(): ReactNode {
  const [view, setView] = useState('active');
  return (
    <div className="pv-page">
      <PageHead
        title="Incidents and on-call"
        sub="1 open incident · Jonas is on call today"
        icon="incidents"
        actions={
          <Button kind="danger" icon="incident">
            Declare an incident
          </Button>
        }
      />
      <nav className="pv-subtabs pv-mb" aria-label="Incidents view">
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
      {view === 'active' ? <Active /> : null}
      {view === 'oncall' ? <OnCall /> : null}
      {view === 'post' ? <Postmortems /> : null}
      {view === 'rel' ? <Reliability /> : null}
    </div>
  );
}
