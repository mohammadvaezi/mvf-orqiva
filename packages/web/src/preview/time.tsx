// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-158 | S15 | v0.1.0] D6 preview: Clients and portal, Incidents, Time, web and VS Code side by side ──
//    Why:  Time without typing it twice: the timer follows the active task (`orq start` in VS Code starts it,
//          `orq done` stops it), entries land on the weekly timesheet, which a lead approves and locks.
//          Rates turn hours into money per client; agent time and AI cost sit next to human hours on the
//          same task; absences feed capacity in Planning and Canvas.
import { useState, type ReactNode } from 'react';
import { euro, person } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Bar, Button, Card, Chip, PageHead, Stat } from './ui.js';

/** Hours as the rest of the page shows numbers: German format, two decimals. */
const hours = (n: number): string =>
  n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DAYS = ['Mon 29', 'Tue 30', 'Wed 1', 'Thu 2', 'Fri 3'];
const ROWS0 = [
  { task: 'NWL-188 Live re-routing', client: 'Nordwind', bill: true, h: [3, 4.5, 2, 1, 0] },
  { task: 'NWL-191 CSV export at scale', client: 'Nordwind', bill: true, h: [0, 0, 2.5, 3, 2.25] },
  { task: 'AUR-4 Idempotency keys', client: 'Aurum', bill: true, h: [2, 1.5, 0, 0, 1] },
  { task: 'Reviews and pairing', client: 'Internal', bill: false, h: [1.5, 1, 2, 2.5, 1] },
  { task: 'Sprint 14 rituals', client: 'Internal', bill: false, h: [1, 0, 0.5, 1, 1.5] },
];

function Mine(): ReactNode {
  const [rows, setRows] = useState(ROWS0);
  const [running, setRunning] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const day = (i: number): number => rows.reduce((s, r) => s + (r.h[i] ?? 0), 0);
  const total = rows.reduce((s, r) => s + r.h.reduce((a, b) => a + b, 0), 0);
  const billable = rows
    .filter((r) => r.bill)
    .reduce((s, r) => s + r.h.reduce((a, b) => a + b, 0), 0);
  return (
    <div className="pv-stack">
      <Card>
        <div className="pv-timer">
          <span className={'pv-timer-dot' + (running ? ' pv-timer-dot--on' : '')} />
          <div className="pv-row-main">
            <strong>NWL-191 Tour export to CSV above 5 000 rows</strong>
            <span className="pv-muted pv-small">
              Started by orq start in VS Code at 07:45 · billable to Nordwind · stops with orq done
            </span>
          </div>
          <span className="pv-timer-clock pv-num">{running ? '2:14:08' : '2:14 stopped'}</span>
          <Button
            icon={running ? 'pause' : 'play'}
            onClick={() => {
              setRunning((r) => !r);
            }}
          >
            {running ? 'Stop' : 'Resume'}
          </Button>
          <Button kind="ghost">Switch task</Button>
        </div>
        <p className="pv-muted pv-small">
          Idle for more than 15 minutes asks whether to keep the time. A forgotten timer stops at
          19:00 and asks the next morning.
        </p>
      </Card>
      <Card
        flush
        title="Week 40 · 29 Sep – 3 Oct"
        action={
          submitted ? (
            <Chip tone="info" icon="clock">
              Sent to Mara for approval
            </Chip>
          ) : (
            <Button
              size="sm"
              kind="primary"
              onClick={() => {
                setSubmitted(true);
              }}
            >
              Submit week
            </Button>
          )
        }
      >
        <div className="pv-grid-scroll">
          <table className="pv-table pv-sheet">
            <thead>
              <tr>
                <th>Task</th>
                <th>Client</th>
                {DAYS.map((d) => (
                  <th key={d} className="pv-num">
                    {d}
                  </th>
                ))}
                <th className="pv-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.task}>
                  <td>
                    {r.task}
                    {r.bill ? null : <span className="pv-muted pv-small"> · not billable</span>}
                  </td>
                  <td className="pv-muted">{r.client}</td>
                  {r.h.map((v, j) => (
                    <td key={j} className="pv-num">
                      <input
                        className="pv-cell-input pv-cell-input--num"
                        type="number"
                        min={0}
                        step={0.25}
                        value={v}
                        disabled={submitted}
                        aria-label={r.task + ' ' + (DAYS[j] ?? '')}
                        onChange={(e) => {
                          setRows((all) =>
                            all.map((x, k) =>
                              k === i
                                ? {
                                    ...x,
                                    h: x.h.map((y, m) => (m === j ? Number(e.target.value) : y)),
                                  }
                                : x,
                            ),
                          );
                        }}
                      />
                    </td>
                  ))}
                  <td className="pv-num pv-strong">{hours(r.h.reduce((a, b) => a + b, 0))}</td>
                </tr>
              ))}
              <tr className="pv-sheet-summary">
                <td>Day total</td>
                <td />
                {DAYS.map((d, i) => (
                  <td key={d} className={'pv-num' + (day(i) > 10 ? ' pv-text-danger' : '')}>
                    {hours(day(i))}
                  </td>
                ))}
                <td className="pv-num">{hours(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="pv-muted pv-small pv-pad">
          {hours(billable)} of {hours(total)} hours billable · Fri 3 Oct was your day off in the
          plan, so 5,75 h there are flagged for Mara.
        </p>
      </Card>
    </div>
  );
}

function Approvals(): ReactNode {
  const [ok, setOk] = useState<string[]>([]);
  return (
    <Card flush title="Weeks to approve · 4">
      <table className="pv-table">
        <tbody>
          {[
            ['lea', 40, 38.5, 31, ''],
            ['jonas', 40, 41, 35.5, 'over 40 h'],
            ['sara', 40, 36, 30, ''],
            ['tim', 40, 22, 19, '2 days absence'],
          ].map(([id, w, h, b, note]) => (
            <tr key={String(id)}>
              <td>
                <span className="pv-who">
                  <Avatar id={String(id)} size="xs" />
                  {person(String(id)).name}
                </span>
              </td>
              <td className="pv-muted">{'Week ' + String(w)}</td>
              <td className="pv-num">{h} h</td>
              <td className="pv-num">{b} h billable</td>
              <td className="pv-text-warning pv-small">{note}</td>
              <td>
                {ok.includes(String(id)) ? (
                  <Chip tone="success" icon="lock">
                    approved and locked
                  </Chip>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => {
                      setOk((o) => [...o, String(id)]);
                    }}
                  >
                    Approve
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

function Reports(): ReactNode {
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat label="Billable this month" value="412 h" sub="of 538 h · 77 %" icon="time" />
        <Stat label="To invoice" value={euro(48650)} sub="hours and agreed AI costs" icon="euro" />
        <Stat
          label="Agent time"
          value="96 h"
          sub={'of runs · ' + euro(1286) + ' AI cost'}
          icon="agents"
        />
        <Stat
          label="Estimates vs actual"
          value="+11 %"
          sub="tasks took longer than estimated"
          tone="warning"
          icon="planning"
        />
      </div>
      <Card flush title="By client · October so far">
        <table className="pv-table">
          <thead>
            <tr>
              <th>Client</th>
              <th className="pv-num">Hours</th>
              <th className="pv-num">Rate</th>
              <th className="pv-num">People</th>
              <th className="pv-num">AI cost</th>
              <th className="pv-num">Total</th>
              <th>Budget</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Nordwind', 184, 115, 650, 61400, 120000],
              ['Helio', 152, 110, 512, 88300, 95000],
              ['Aurum', 76, 125, 41, 14900, 210000],
            ].map(([c, h, r, ai, used, budget]) => (
              <tr key={String(c)}>
                <td className="pv-cell-strong">{c}</td>
                <td className="pv-num">{h}</td>
                <td className="pv-num">{euro(Number(r))}</td>
                <td className="pv-num">{euro(Number(h) * Number(r))}</td>
                <td className="pv-num">{euro(Number(ai))}</td>
                <td className="pv-num pv-strong">{euro(Number(h) * Number(r) + Number(ai))}</td>
                <td className="pv-cell-bar">
                  <Bar
                    value={Number(used)}
                    max={Number(budget)}
                    tone={Number(used) / Number(budget) > 0.9 ? 'danger' : 'primary'}
                  />
                  <span className="pv-small pv-muted">
                    {Math.round((Number(used) / Number(budget)) * 100)} % of budget
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pv-page-actions pv-pad">
          <Button size="sm">Export CSV</Button>
          <Button size="sm">Export DATEV</Button>
          <Button size="sm" kind="primary">
            Create invoices
          </Button>
        </div>
      </Card>
      <Card flush title="Absences">
        <ul className="pv-rows">
          {[
            ['tim', 'Mon 6 – Tue 7 Oct', 'holiday · capacity and on-call adjusted'],
            ['nico', 'Mon 20 – Fri 24 Oct', 'holiday · requested'],
            ['sara', 'Fri 17 Oct afternoon', 'appointment'],
          ].map(([id, d, s]) => (
            <li key={String(id)} className="pv-row pv-row--static">
              <Avatar id={String(id)} size="sm" />
              <span className="pv-row-main">
                <span className="pv-row-title">
                  {person(String(id)).name} · {d}
                </span>
                <span className="pv-row-sub">{s}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

const VIEWS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'mine', label: 'My time', icon: 'time' },
  { key: 'approve', label: 'Approvals', icon: 'approval' },
  { key: 'reports', label: 'Reports and billing', icon: 'euro' },
];

export function TimePage(): ReactNode {
  const [view, setView] = useState('mine');
  return (
    <div className="pv-page">
      <PageHead title="Time" sub="Week 40 · timer running on NWL-191" icon="time" />
      <nav className="pv-subtabs pv-mb" aria-label="Time view">
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
      {view === 'mine' ? <Mine /> : null}
      {view === 'approve' ? <Approvals /> : null}
      {view === 'reports' ? <Reports /> : null}
    </div>
  );
}
