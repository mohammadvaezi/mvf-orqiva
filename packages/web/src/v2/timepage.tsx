// ── [PCODE-431 | S15 | v0.1.0] T37 low: The Time page fits a phone ──
// ── [PCODE-429 | S15 | v0.1.0] T37 low: A very short timer says why it booked nothing ──
// ── [PCODE-423 | S15 | v0.1.0] T37 low: No command-line words in the web app ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-354 | S15 | v0.1.0] T35.4b Offline beyond tasks: comments, messages and time written offline; reads kept for offline ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-187 | S15 | v0.1.0] B7.3 Time live: timer from the active task, weekly timesheets with approval and lock, rates, absences, reports per client ──
//    Why:  the approved Time screens, live: the timer on the task one works on (IDE sessions land here by
//          themselves), the week to correct and submit, the weeks a manager approves or returns, absences
//          for the whole team, and the month per client with rates, AI cost and the budget, with a CSV.
// ── [PCODE-343 | S15 | v0.1.0] T34.3a Hour budgets with alerts, time reports by person, sprint and task, DATEV export ──
// ── [PCODE-344 | S15 | v0.1.0] T34.3b Timer idle detection, time reminders, correction reasons for locked weeks ──
import { awayMinutes, hoursText, parseHours } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Bar, Button, Card, Chip, PageHead, Stat } from '../preview/ui.js';
import { HourBudgets, TimeBreakdown } from './timereports.js'; // [PCODE-343 | S15 | v0.1.0]
import { euroCents } from './shell.js';
import { outboxFor, sendOrQueue } from '../sync/outbox.js'; // [PCODE-354 | S15 | v0.1.0]
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon 29" for a column head. */
export const dayHead = (d: string, i: number): string =>
  (WD[i] ?? '') + ' ' + String(Number(d.slice(8, 10)));

/** "29 Sep – 5 Oct" for a week. */
export function weekSpan(days: readonly string[]): string {
  const f = (d: string): string =>
    String(Number(d.slice(8, 10))) + ' ' + (MONTHS[Number(d.slice(5, 7)) - 1] ?? '');
  return days.length ? f(days[0] ?? '') + ' – ' + f(days[days.length - 1] ?? '') : '';
}

/** A running clock: 2:14:08. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number): string => String(n).padStart(2, '0');
  return String(Math.floor(s / 3600)) + ':' + two(Math.floor((s % 3600) / 60)) + ':' + two(s % 60);
}

const shift = (day: string, days: number): string => {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

interface Row {
  key: string;
  itemId: string | null;
  itemRef: string | null;
  title: string;
  projectId: string | null;
  projectKey: string | null;
  clientName: string | null;
  label: string;
  billable: boolean;
  minutes: number[];
  sources: string[];
}

interface WeekData {
  week: string;
  weekNo: number;
  days: string[];
  user: { id: string; name: string };
  approver: string | null;
  state: 'open' | 'submitted' | 'approved' | 'returned';
  note: string;
  decidedBy: string | null;
  timer: {
    id: string;
    itemId: string | null;
    itemRef: string | null;
    title: string;
    clientName: string | null;
    billable: boolean;
    startedAt: string;
    source: string;
    idleMinutes?: number; // [PCODE-344 | S15 | v0.1.0]
  } | null;
  // [PCODE-344 | S15 | v0.1.0]
  corrections?: {
    day: string;
    title: string;
    before: number;
    after: number;
    reason: string;
    at: string;
  }[];
  rows: Row[];
  perDay: number[];
  total: number;
  billable: number;
  capacityMinutes: number;
  absences: { id: string; startsOn: string; endsOn: string; kind: string; state: string }[];
  flags: { day: string; text: string }[];
}

interface MyItem {
  id: string;
  ref: string;
  title: string;
  projectKey: string;
}

const VIEWS: { key: string; label: string; icon: PIconName; team: boolean; report: boolean }[] = [
  { key: 'mine', label: 'My time', icon: 'time', team: true, report: false },
  { key: 'approve', label: 'Approvals', icon: 'approval', team: true, report: false },
  { key: 'absences', label: 'Absences', icon: 'clock', team: true, report: false },
  { key: 'reports', label: 'Reports and billing', icon: 'euro', team: false, report: true },
  // [PCODE-343 | S15 | v0.1.0]
  { key: 'breakdown', label: 'Breakdown', icon: 'insights', team: false, report: true },
  { key: 'budgets', label: 'Hour budgets', icon: 'clock', team: false, report: true },
];

export function TimeHub(props: { workspaceId: string; role: string }): ReactNode {
  const isTeam = !['guest', 'auditor', 'billing'].includes(props.role);
  const mayReport = ['admin', 'owner', 'billing', 'auditor'].includes(props.role);
  const views = VIEWS.filter((v) => (v.team && isTeam) || (v.report && mayReport));
  const first =
    (typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('view')) ??
    views[0]?.key ??
    'mine';
  const [view, setView] = useState(
    views.some((v) => v.key === first) ? first : (views[0]?.key ?? 'mine'),
  );
  return (
    <div className="pv-page">
      <PageHead
        title="Time"
        sub="Your hours, the team’s weeks and what goes on the invoice"
        icon="time"
      />
      <nav className="pv-subtabs pv-mb" aria-label="Time view">
        {views.map((v) => (
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
      {view === 'mine' && isTeam ? <Mine workspaceId={props.workspaceId} /> : null}
      {view === 'approve' && isTeam ? <Approvals workspaceId={props.workspaceId} /> : null}
      {view === 'absences' && isTeam ? <Absences workspaceId={props.workspaceId} /> : null}
      {view === 'reports' && mayReport ? (
        <Reports
          workspaceId={props.workspaceId}
          admin={props.role === 'admin' || props.role === 'owner'}
        />
      ) : null}
      {/* [PCODE-343 | S15 | v0.1.0] */}
      {view === 'breakdown' && mayReport ? (
        <TimeBreakdown
          workspaceId={props.workspaceId}
          mayExport={['admin', 'owner', 'billing'].includes(props.role)}
          admin={props.role === 'admin' || props.role === 'owner'}
        />
      ) : null}
      {view === 'budgets' && mayReport ? (
        <HourBudgets
          workspaceId={props.workspaceId}
          admin={props.role === 'admin' || props.role === 'owner'}
        />
      ) : null}
    </div>
  );
}

// [PCODE-344 | S15 | v0.1.0] the last input while a timer runs; coming back after ten minutes or more asks about the gap
function useAway(active: boolean): { from: string; minutes: number } | null {
  const [away, setAway] = useState<{ from: string; minutes: number } | null>(null);
  useEffect(() => {
    if (!active) return;
    let last = Date.now();
    const seen = (): void => {
      const now = Date.now();
      const m = awayMinutes(last, now);
      if (m) setAway({ from: new Date(last).toISOString(), minutes: m });
      last = now;
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'focus'] as const;
    for (const e of events) window.addEventListener(e, seen, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, seen);
    };
  }, [active]);
  return active ? away : null;
}

// ── my time ──
function Mine(props: { workspaceId: string }): ReactNode {
  const [week, setWeek] = useState<string | null>(null);
  const [d, setD] = useState<WeekData | null>(null);
  const [items, setItems] = useState<MyItem[]>([]);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [pick, setPick] = useState('');
  const [extra, setExtra] = useState<Row[]>([]);
  const [label, setLabel] = useState('');
  // [PCODE-344 | S15 | v0.1.0]
  const [reason, setReason] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const [awayDone, setAwayDone] = useState('');
  const load = useCallback(async () => {
    const r = await api<WeekData>(
      'GET',
      W(props.workspaceId, '/time/week' + (week ? '?week=' + week : '')),
    );
    if (r.ok) {
      setD(r.data);
      setError('');
    } else setError(r.error.message);
  }, [props.workspaceId, week]);
  useEffect(() => {
    void load();
    void api<MyItem[]>('GET', W(props.workspaceId, '/my-work')).then((r) => {
      if (r.ok) setItems(r.data);
    });
  }, [load, props.workspaceId]);
  useEffect(() => {
    if (!d?.timer) return;
    const t = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, [d?.timer]);
  const gone = useAway(Boolean(d?.timer)); // [PCODE-344 | S15 | v0.1.0]
  const call = async (
    method: 'POST' | 'PUT',
    path: string,
    body: Record<string, unknown>,
  ): Promise<boolean> => {
    // [PCODE-354 | S15 | v0.1.0] hours booked offline wait and go out when the connection is back
    if (method === 'PUT' && path === '/time/cell') {
      const q = await sendOrQueue(
        outboxFor(props.workspaceId),
        method,
        W(props.workspaceId, path),
        body,
        'Hours on ' + String(body['day']),
      );
      if ('error' in q) setError(q.error);
      else if ('queued' in q) {
        setError('You are offline: the hours are kept and sent when the connection is back.');
        return true;
      }
      await load();
      return 'sent' in q;
    }
    const r = await api(method, W(props.workspaceId, path), body);
    if (!r.ok) setError(r.error.message);
    await load();
    return r.ok;
  };
  if (!d) return <p className="pv-muted">{error || 'Loading…'}</p>;
  const locked = d.state === 'submitted' || d.state === 'approved';
  const canCorrect = locked && correcting && reason.trim().length >= 3;
  const rows = [...d.rows, ...extra.filter((x) => !d.rows.some((r) => r.key === x.key))];
  const showWeekend = d.perDay[5] !== 0 || d.perDay[6] !== 0;
  const cols = showWeekend ? 7 : 5;
  const setCell = (r: Row, i: number, text: string): void => {
    const minutes = parseHours(text);
    if (minutes === null) {
      // [PCODE-420 | S15 | v0.1.0] the example in the workspace's format (both are read)
      setError('Hours are written like ' + hoursText(345, fmtLocale()) + ' or 1:30.');
      return;
    }
    if (minutes === (r.minutes[i] ?? 0)) return;
    void call('PUT', '/time/cell', {
      day: d.days[i],
      minutes,
      ...(r.itemId ? { itemId: r.itemId } : { label: r.label, projectId: r.projectId }),
      ...(canCorrect ? { reason: reason.trim() } : {}), // [PCODE-344 | S15 | v0.1.0]
    });
  };
  const away = (day: string): boolean =>
    d.absences.some((x) => x.state === 'approved' && day >= x.startsOn && day <= x.endsOn);
  return (
    <div className="pv-stack">
      <Card>
        {/* [PCODE-344 | S15 | v0.1.0] back after a while: take the time away off the timer */}
        {d.timer && gone && gone.from !== awayDone ? (
          <div className="pv-callout pv-callout--warn pv-mb">
            <PIcon name="clock" size={16} />
            <div className="pv-grow">You were away for {gone.minutes} min while the timer ran.</div>
            <Button
              size="sm"
              kind="primary"
              onClick={() =>
                void call('POST', '/time/timer/idle', { awayFrom: gone.from }).then(() => {
                  setAwayDone(gone.from);
                })
              }
            >
              Take it off the timer
            </Button>
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                setAwayDone(gone.from);
              }}
            >
              Keep it
            </Button>
          </div>
        ) : null}
        {d.timer ? (
          <div className="pv-timer">
            <span className="pv-timer-dot pv-timer-dot--on" />
            <div className="pv-row-main">
              <strong>
                {d.timer.itemRef ? d.timer.itemRef + ' ' : ''}
                {d.timer.title}
              </strong>
              <span className="pv-muted pv-small">
                Started{' '}
                {new Date(d.timer.startedAt).toLocaleTimeString(fmtLocale(), {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {d.timer.billable
                  ? ' · billable' + (d.timer.clientName ? ' to ' + d.timer.clientName : '')
                  : ' · not billable'}
                {' · stops at 19:00 if forgotten'}
              </span>
            </div>
            <span className="pv-timer-clock pv-num">
              {clock(now - Date.parse(d.timer.startedAt) - (d.timer.idleMinutes ?? 0) * 60_000)}
            </span>
            <Button
              icon="pause"
              onClick={() => {
                // [PCODE-429 | S15 | v0.1.0] a timer stopped within a minute books nothing, and says so
                void api<{ dropped?: boolean }>(
                  'POST',
                  W(props.workspaceId, '/time/timer/stop'),
                  {},
                ).then(async (r) => {
                  // the week first (it clears messages), then what happened
                  await load();
                  if (!r.ok) setError(r.error.message);
                  else if (r.data.dropped) setError('Stopped within a minute: nothing was booked.');
                });
              }}
            >
              Stop
            </Button>
          </div>
        ) : (
          <div className="pv-timer">
            <span className="pv-timer-dot" />
            <div className="pv-row-main">
              <select
                className="v2-input"
                aria-label="Task for the timer"
                value={pick}
                onChange={(e) => {
                  setPick(e.target.value);
                }}
              >
                <option value="">Choose one of your tasks…</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.ref} {it.title}
                  </option>
                ))}
              </select>
              <span className="pv-muted pv-small">
                {/* [PCODE-423 | S15 | v0.1.0] */}
                Starting a task in VS Code records its time by itself, and finishing it stops the
                clock.
              </span>
            </div>
            <Button
              icon="play"
              kind="primary"
              disabled={!pick}
              onClick={() => void call('POST', '/time/timer', { itemId: pick })}
            >
              Start
            </Button>
          </div>
        )}
      </Card>
      {/* [PCODE-431 | S15 | v0.1.0] the week's head wraps on a phone; Earlier and Later look like buttons */}
      <Card
        flush
        className="v2-week-card"
        title={'Week ' + String(d.weekNo) + ' · ' + weekSpan(d.days.slice(0, cols))}
        action={
          <span className="v2-inline">
            <Button
              size="sm"
              kind="secondary"
              onClick={() => {
                setWeek(shift(d.week, -7));
                setExtra([]);
              }}
            >
              Earlier
            </Button>
            <Button
              size="sm"
              kind="secondary"
              onClick={() => {
                setWeek(shift(d.week, 7));
                setExtra([]);
              }}
            >
              Later
            </Button>
            {d.state === 'approved' ? (
              <Chip tone="success" icon="lock">
                approved{d.decidedBy ? ' by ' + d.decidedBy : ''}
              </Chip>
            ) : d.state === 'submitted' ? (
              <Chip tone="info" icon="clock">
                sent to {d.approver ?? 'the admins'} for approval
              </Chip>
            ) : (
              <Button
                size="sm"
                kind="primary"
                disabled={!d.total}
                onClick={() => void call('POST', '/time/week/submit', { week: d.week })}
              >
                Submit week
              </Button>
            )}
          </span>
        }
      >
        {/* [PCODE-344 | S15 | v0.1.0] a locked week is corrected with a reason */}
        {locked ? (
          <div className="v2-inline pv-pad">
            {correcting ? (
              <>
                <input
                  className="v2-input v2-input--sm pv-grow"
                  aria-label="Reason for the correction"
                  placeholder="Why the hours change, e.g. forgot the client call on Tuesday"
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                  }}
                />
                <span className="pv-small pv-muted">
                  {canCorrect
                    ? d.state === 'approved'
                      ? 'Change the hours; the week goes back for approval.'
                      : 'Change the hours; your approver is told.'
                    : 'Give a reason first.'}
                </span>
                <Button
                  size="sm"
                  kind="ghost"
                  onClick={() => {
                    setCorrecting(false);
                    setReason('');
                  }}
                >
                  Done
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                kind="ghost"
                icon="lock"
                onClick={() => {
                  setCorrecting(true);
                }}
              >
                Correct with a reason
              </Button>
            )}
          </div>
        ) : null}
        {d.state === 'returned' ? (
          <div className="pv-callout pv-callout--warn">
            <PIcon name="incident" size={16} />
            <div>
              Returned by {d.decidedBy ?? 'your manager'}: {d.note}
            </div>
          </div>
        ) : null}
        <div className="pv-grid-scroll">
          <table className="pv-table pv-sheet">
            <thead>
              <tr>
                <th>Task</th>
                <th>Client</th>
                {d.days.slice(0, cols).map((day, i) => (
                  <th key={day} className={'pv-num' + (away(day) ? ' pv-muted' : '')}>
                    {dayHead(day, i)}
                    {away(day) ? ' · off' : ''}
                  </th>
                ))}
                <th className="pv-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    {r.itemRef ? <span className="pv-mono pv-muted">{r.itemRef} </span> : null}
                    {r.title}
                    {r.billable ? null : <span className="pv-muted pv-small"> · not billable</span>}
                    {r.sources.includes('ide') ? (
                      <span className="pv-muted pv-small"> · from the IDE</span>
                    ) : null}
                  </td>
                  <td className="pv-muted">{r.clientName ?? 'Internal'}</td>
                  {d.days.slice(0, cols).map((day, i) => (
                    <td key={day} className="pv-num">
                      <input
                        key={d.week + r.key + String(r.minutes[i] ?? 0)}
                        className="pv-cell-input pv-cell-input--num"
                        inputMode="decimal"
                        defaultValue={
                          (r.minutes[i] ?? 0) ? hoursText(r.minutes[i] ?? 0, fmtLocale()) : ''
                        }
                        disabled={locked && !canCorrect}
                        aria-label={r.title + ' ' + dayHead(day, i)}
                        onBlur={(e) => {
                          setCell(r, i, e.target.value);
                        }}
                      />
                    </td>
                  ))}
                  <td className="pv-num pv-strong">
                    {hoursText(
                      r.minutes.reduce((a, b) => a + b, 0),
                      fmtLocale(),
                    )}
                  </td>
                </tr>
              ))}
              <tr className="pv-sheet-summary">
                <td>Day total</td>
                <td />
                {d.days.slice(0, cols).map((day, i) => (
                  <td
                    key={day}
                    className={'pv-num' + ((d.perDay[i] ?? 0) > 600 ? ' pv-text-danger' : '')}
                  >
                    {hoursText(d.perDay[i] ?? 0, fmtLocale())}
                  </td>
                ))}
                <td className="pv-num">{hoursText(d.total, fmtLocale())}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {d.corrections?.length ? (
          <div className="pv-pad">
            <strong className="pv-small">Corrections</strong>
            <ul className="pv-corrections">
              {d.corrections.map((x) => (
                <li key={x.at} className="pv-small">
                  {x.day.slice(8, 10)}.{x.day.slice(5, 7)}. {x.title}:{' '}
                  {hoursText(x.before, fmtLocale())} → {hoursText(x.after, fmtLocale())} h ·{' '}
                  <span className="pv-muted">{x.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {!locked ? (
          <div className="v2-inline pv-pad v2-week-add">
            <select
              className="v2-input v2-input--sm"
              aria-label="Add a task"
              value=""
              onChange={(e) => {
                const it = items.find((x) => x.id === e.target.value);
                if (it)
                  setExtra((x) => [
                    ...x,
                    {
                      key: it.id,
                      itemId: it.id,
                      itemRef: it.ref,
                      title: it.title,
                      projectId: null,
                      projectKey: it.projectKey,
                      clientName: null,
                      label: '',
                      billable: true,
                      minutes: [0, 0, 0, 0, 0, 0, 0],
                      sources: [],
                    },
                  ]);
              }}
            >
              <option value="">Add a task…</option>
              {items
                .filter((it) => !rows.some((r) => r.itemId === it.id))
                .map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.ref} {it.title}
                  </option>
                ))}
            </select>
            <input
              className="v2-input v2-input--sm"
              placeholder="Other work, e.g. Reviews"
              aria-label="Work without a task"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
              }}
            />
            <Button
              size="sm"
              disabled={!label.trim()}
              onClick={() => {
                const l = label.trim();
                setExtra((x) => [
                  ...x,
                  {
                    key: '|' + l,
                    itemId: null,
                    itemRef: null,
                    title: l,
                    projectId: null,
                    projectKey: null,
                    clientName: null,
                    label: l,
                    billable: false,
                    minutes: [0, 0, 0, 0, 0, 0, 0],
                    sources: [],
                  },
                ]);
                setLabel('');
              }}
            >
              Add
            </Button>
          </div>
        ) : null}
        <p className="pv-muted pv-small pv-pad">
          {hoursText(d.billable, fmtLocale())} of {hoursText(d.total, fmtLocale())} hours billable ·
          capacity this week {hoursText(d.capacityMinutes, fmtLocale())} h
          {d.flags.length
            ? ' · ' + d.flags.map((f) => f.text + ' (' + f.day.slice(5) + ')').join(' · ')
            : ''}
        </p>
        {error ? (
          <p className="v2-error pv-pad" role="alert">
            {error}
          </p>
        ) : null}
      </Card>
    </div>
  );
}

// ── approvals ──
interface SheetRow {
  userId: string;
  name: string;
  week: string;
  weekNo: number;
  state: string;
  minutes: number;
  billable: number;
  notes: string[];
}

function Approvals(props: { workspaceId: string }): ReactNode {
  const [rows, setRows] = useState<SheetRow[] | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ weeks: SheetRow[] }>('GET', W(props.workspaceId, '/time/approvals'));
    if (r.ok) setRows(r.data.weeks);
    else setError(r.error.message);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  const decide = async (r: SheetRow, decision: 'approved' | 'returned'): Promise<void> => {
    const res = await api('POST', W(props.workspaceId, '/time/approvals/decision'), {
      userId: r.userId,
      week: r.week,
      decision,
      ...(decision === 'returned' ? { note: note.trim() } : {}),
    });
    if (!res.ok) setError(res.error.message);
    else {
      setReturning(null);
      setNote('');
    }
    await load();
  };
  if (!rows) return <p className="pv-muted">{error || 'Loading…'}</p>;
  const waiting = rows.filter((r) => r.state === 'submitted').length;
  return (
    <Card flush title={'Weeks to approve · ' + String(waiting)}>
      {rows.length ? (
        <table className="pv-table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId + r.week}>
                <td className="pv-cell-strong">{r.name}</td>
                <td className="pv-muted">Week {r.weekNo}</td>
                <td className="pv-num">{hoursText(r.minutes, fmtLocale())} h</td>
                <td className="pv-num">{hoursText(r.billable, fmtLocale())} h billable</td>
                <td className="pv-text-warning pv-small">{r.notes.join(' · ')}</td>
                <td>
                  {r.state === 'approved' ? (
                    <Chip tone="success" icon="lock">
                      approved and locked
                    </Chip>
                  ) : r.state === 'returned' ? (
                    <Chip tone="warning">returned</Chip>
                  ) : returning === r.userId + r.week ? (
                    <span className="v2-inline">
                      <input
                        className="v2-input v2-input--sm"
                        placeholder="What to correct"
                        aria-label="What to correct"
                        value={note}
                        onChange={(e) => {
                          setNote(e.target.value);
                        }}
                      />
                      <Button
                        size="sm"
                        disabled={!note.trim()}
                        onClick={() => void decide(r, 'returned')}
                      >
                        Return
                      </Button>
                    </span>
                  ) : (
                    <span className="v2-inline">
                      <Button size="sm" kind="primary" onClick={() => void decide(r, 'approved')}>
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        kind="ghost"
                        onClick={() => {
                          setReturning(r.userId + r.week);
                          setNote('');
                        }}
                      >
                        Return
                      </Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="pv-muted pv-small pv-pad">
          Nothing to approve. Weeks of the people you manage show here when they submit them.
        </p>
      )}
      {error ? (
        <p className="v2-error pv-pad" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

// ── absences ──
interface Absence {
  id: string;
  userId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  halfDay: boolean;
  kind: string;
  note: string;
  state: string;
  mine: boolean;
  mayDecide: boolean;
}

const KIND_TEXT: Record<string, string> = {
  holiday: 'holiday',
  sick: 'sick',
  appointment: 'appointment',
  other: 'away',
  away: 'away',
};

export const spanText = (a: { startsOn: string; endsOn: string; halfDay: boolean }): string => {
  const f = (d: string): string => {
    const x = new Date(d + 'T00:00:00Z');
    return (
      (WD[(x.getUTCDay() + 6) % 7] ?? '') +
      ' ' +
      String(x.getUTCDate()) +
      ' ' +
      (MONTHS[x.getUTCMonth()] ?? '')
    );
  };
  return a.startsOn === a.endsOn
    ? f(a.startsOn) + (a.halfDay ? ' · half a day' : '')
    : f(a.startsOn) + ' – ' + f(a.endsOn);
};

function Absences(props: { workspaceId: string }): ReactNode {
  const [list, setList] = useState<Absence[] | null>(null);
  const [form, setForm] = useState({ startsOn: '', endsOn: '', kind: 'holiday', halfDay: false });
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ absences: Absence[] }>('GET', W(props.workspaceId, '/time/absences'));
    if (r.ok) setList(r.data.absences);
    else setError(r.error.message);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (
    method: 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<void> => {
    const r = await api(method, W(props.workspaceId, path), body);
    if (!r.ok) setError(r.error.message);
    else setError('');
    await load();
  };
  return (
    <div className="pv-split pv-split--even">
      <Card flush title="Who is away">
        {list && !list.length ? (
          <p className="pv-muted pv-small pv-pad">Nobody is away from today on.</p>
        ) : null}
        <ul className="pv-rows">
          {(list ?? []).map((a) => (
            <li key={a.id} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">
                  {a.name} · {spanText(a)}
                </span>
                <span className="pv-row-sub">
                  {KIND_TEXT[a.kind] ?? a.kind}
                  {a.state === 'requested' ? ' · requested' : ''}
                  {a.note ? ' · ' + a.note : ''}
                </span>
              </span>
              {a.mayDecide ? (
                <span className="v2-inline">
                  <Button
                    size="sm"
                    kind="primary"
                    onClick={() =>
                      void act('POST', '/time/absences/' + a.id + '/decision', {
                        decision: 'approved',
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    kind="ghost"
                    onClick={() =>
                      void act('POST', '/time/absences/' + a.id + '/decision', {
                        decision: 'declined',
                      })
                    }
                  >
                    Decline
                  </Button>
                </span>
              ) : a.mine ? (
                <Button
                  size="sm"
                  kind="ghost"
                  onClick={() => void act('DELETE', '/time/absences/' + a.id)}
                >
                  Withdraw
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Ask for time off">
        <div className="pv-stack">
          <div className="v2-inline">
            <label className="v2-field">
              <span>From</span>
              <input
                type="date"
                className="v2-input"
                value={form.startsOn}
                onChange={(e) => {
                  setForm({
                    ...form,
                    startsOn: e.target.value,
                    endsOn: form.endsOn || e.target.value,
                  });
                }}
              />
            </label>
            <label className="v2-field">
              <span>To</span>
              <input
                type="date"
                className="v2-input"
                value={form.endsOn}
                onChange={(e) => {
                  setForm({ ...form, endsOn: e.target.value });
                }}
              />
            </label>
          </div>
          <label className="v2-field">
            <span>Kind</span>
            <select
              className="v2-input"
              value={form.kind}
              onChange={(e) => {
                setForm({ ...form, kind: e.target.value });
              }}
            >
              <option value="holiday">Holiday</option>
              <option value="sick">Sick (no approval needed)</option>
              <option value="appointment">Appointment</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="v2-switch">
            <input
              type="checkbox"
              checked={form.halfDay}
              onChange={(e) => {
                setForm({ ...form, halfDay: e.target.checked, endsOn: form.startsOn });
              }}
            />
            <span>Half a day</span>
          </label>
          <div className="pv-page-actions">
            <Button
              kind="primary"
              disabled={!form.startsOn || !form.endsOn}
              onClick={() =>
                void act('POST', '/time/absences', form).then(() => {
                  setForm({ startsOn: '', endsOn: '', kind: 'holiday', halfDay: false });
                })
              }
            >
              Send
            </Button>
            <span className="pv-muted pv-small">
              Approved time off reduces your capacity in Planning, Canvas and Insights.
            </span>
          </div>
          {error ? (
            <p className="v2-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

// ── reports ──
interface Report {
  month: string;
  minutes: number;
  billableMinutes: number;
  toInvoiceCents: number;
  unapprovedMinutes: number;
  agentMinutes: number;
  agentCents: number;
  unpriced: number;
  clients: {
    clientId: string | null;
    name: string;
    minutes: number;
    billableMinutes: number;
    rateCents: number | null;
    peopleCents: number;
    aiCents: number;
    totalCents: number;
    budgetCents: number | null;
    usedCents: number;
  }[];
}

interface Rate {
  id: string;
  scopeType: string;
  scopeLabel: string;
  kind: string;
  centsPerHour: number;
  validFrom: string;
}

function Reports(props: { workspaceId: string; admin: boolean }): ReactNode {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [r, setR] = useState<Report | null>(null);
  const [rates, setRates] = useState<Rate[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    scopeType: 'workspace',
    scopeKey: '',
    kind: 'billable',
    euro: '',
  });
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      api<Report>('GET', W(props.workspaceId, '/time/report?month=' + month)),
      api<Rate[]>('GET', W(props.workspaceId, '/time/rates')),
      api<{ id: string; name: string }[]>('GET', W(props.workspaceId, '/clients')),
    ]);
    if (a.ok) setR(a.data);
    else setError(a.error.message);
    if (b.ok) setRates(b.data);
    if (c.ok) setClients(c.data);
  }, [props.workspaceId, month]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!r) return <p className="pv-muted">{error || 'Loading…'}</p>;
  const pct = r.minutes ? Math.round((r.billableMinutes / r.minutes) * 100) : 0;
  const addRate = async (): Promise<void> => {
    const euro = Number(form.euro.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(euro) || euro < 0) {
      setError('The rate is a number of euro per hour.');
      return;
    }
    const res = await api('POST', W(props.workspaceId, '/time/rates'), {
      scopeType: form.scopeType,
      ...(form.scopeType === 'workspace' ? {} : { scopeKey: form.scopeKey }),
      kind: form.kind,
      centsPerHour: Math.round(euro * 100),
    });
    if (!res.ok) setError(res.error.message);
    else setForm({ ...form, euro: '' });
    await load();
  };
  return (
    <div className="pv-stack">
      <div className="v2-inline">
        <input
          type="month"
          className="v2-input v2-input--sm"
          aria-label="Month"
          value={month}
          onChange={(e) => {
            if (e.target.value) setMonth(e.target.value);
          }}
        />
        <a
          className="pv-btn pv-btn--secondary pv-btn--sm"
          href={W(props.workspaceId, '/time/report.csv?month=' + month)}
        >
          <PIcon name="documents" size={14} /> Export CSV
        </a>
      </div>
      <div className="pv-stats">
        <Stat
          label="Billable"
          value={hoursText(r.billableMinutes, fmtLocale()) + ' h'}
          sub={'of ' + hoursText(r.minutes, fmtLocale()) + ' h · ' + String(pct) + ' %'}
          icon="time"
        />
        <Stat
          label="To invoice"
          value={euroCents(r.toInvoiceCents, 0)}
          sub="hours at rates and AI costs"
          icon="euro"
        />
        <Stat
          label="Agent time"
          value={hoursText(r.agentMinutes, fmtLocale()) + ' h'}
          sub={'of runs · ' + euroCents(r.agentCents) + ' AI cost'}
          icon="agents"
        />
        <Stat
          label="Not yet approved"
          value={hoursText(r.unapprovedMinutes, fmtLocale()) + ' h'}
          sub={
            r.unpriced
              ? String(r.unpriced) + ' billable entries without a rate'
              : 'priced at today’s rates'
          }
          tone={r.unpriced ? 'warning' : undefined}
          icon="approval"
        />
      </div>
      <Card
        flush
        title={
          'By client · ' + (MONTHS[Number(month.slice(5, 7)) - 1] ?? '') + ' ' + month.slice(0, 4)
        }
      >
        <div className="pv-grid-scroll">
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
              {r.clients.map((c) => (
                <tr key={c.clientId ?? 'internal'}>
                  <td className="pv-cell-strong">{c.name}</td>
                  <td className="pv-num">{hoursText(c.minutes, fmtLocale())}</td>
                  <td className="pv-num">
                    {c.rateCents === null ? '—' : euroCents(c.rateCents, 0)}
                  </td>
                  <td className="pv-num">{euroCents(c.peopleCents, 0)}</td>
                  <td className="pv-num">{euroCents(c.aiCents, 0)}</td>
                  <td className="pv-num pv-strong">{euroCents(c.totalCents, 0)}</td>
                  <td className="pv-cell-bar">
                    {c.budgetCents ? (
                      <>
                        <Bar
                          value={Math.min(c.usedCents, c.budgetCents)}
                          max={c.budgetCents}
                          tone={c.usedCents / c.budgetCents > 0.9 ? 'danger' : 'primary'}
                        />
                        <span className="pv-small pv-muted">
                          {Math.round((c.usedCents / c.budgetCents) * 100)} % of{' '}
                          {euroCents(c.budgetCents, 0)}
                        </span>
                      </>
                    ) : (
                      <span className="pv-muted pv-small">no budget</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!r.clients.length ? (
          <p className="pv-muted pv-small pv-pad">No time booked this month.</p>
        ) : null}
      </Card>
      <Card flush title="Rates per hour">
        <table className="pv-table">
          <tbody>
            {rates.map((x) => (
              <tr key={x.id}>
                <td className="pv-cell-strong">{x.scopeLabel}</td>
                <td className="pv-muted">{x.scopeType}</td>
                <td>
                  <Chip tone={x.kind === 'billable' ? 'primary' : 'neutral'}>{x.kind}</Chip>
                </td>
                <td className="pv-num">{euroCents(x.centsPerHour)}</td>
                <td className="pv-muted pv-small">from {x.validFrom}</td>
                <td>
                  {props.admin ? (
                    <Button
                      size="sm"
                      kind="ghost"
                      onClick={() =>
                        void api('DELETE', W(props.workspaceId, '/time/rates/' + x.id)).then(() =>
                          load(),
                        )
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rates.length ? (
          <p className="pv-muted pv-small pv-pad">No rates yet: billable hours are not priced.</p>
        ) : null}
        {props.admin ? (
          <div className="v2-inline pv-pad">
            <select
              className="v2-input v2-input--sm"
              aria-label="For"
              value={form.scopeType}
              onChange={(e) => {
                setForm({ ...form, scopeType: e.target.value, scopeKey: '' });
              }}
            >
              <option value="workspace">Everyone</option>
              <option value="client">A client</option>
              <option value="role">A role</option>
            </select>
            {form.scopeType === 'client' ? (
              <select
                className="v2-input v2-input--sm"
                aria-label="Client"
                value={form.scopeKey}
                onChange={(e) => {
                  setForm({ ...form, scopeKey: e.target.value });
                }}
              >
                <option value="">Choose…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : form.scopeType === 'role' ? (
              <select
                className="v2-input v2-input--sm"
                aria-label="Role"
                value={form.scopeKey}
                onChange={(e) => {
                  setForm({ ...form, scopeKey: e.target.value });
                }}
              >
                <option value="">Choose…</option>
                {['member', 'designer', 'tester', 'admin', 'owner'].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              className="v2-input v2-input--sm"
              aria-label="Kind"
              value={form.kind}
              onChange={(e) => {
                setForm({ ...form, kind: e.target.value });
              }}
            >
              <option value="billable">billable</option>
              <option value="cost">cost</option>
            </select>
            <input
              className="v2-input v2-input--sm"
              inputMode="decimal"
              placeholder="€ per hour"
              aria-label="Euro per hour"
              value={form.euro}
              onChange={(e) => {
                setForm({ ...form, euro: e.target.value });
              }}
            />
            <Button
              size="sm"
              disabled={!form.euro || (form.scopeType !== 'workspace' && !form.scopeKey)}
              onClick={() => void addRate()}
            >
              Add rate
            </Button>
          </div>
        ) : null}
        {error ? (
          <p className="v2-error pv-pad" role="alert">
            {error}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
