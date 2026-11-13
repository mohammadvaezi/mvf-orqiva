// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-338 | S15 | v0.1.0] T34.1c Meeting notes and actions into tasks; the team's client overview with health, revenue, activity and people ──
//    Why:  on the team's client page, the client at a glance (health, revenue, what happened, who works
//          for it) and the meetings with their notes and action items, each a task with one click; in
//          the portal, the notes the team shared and what came of the actions.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip, Stat } from '../preview/ui.js';
import { euroCents } from './shell.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

export type ClientHealth = 'on-track' | 'at-risk' | 'critical';
export const HEALTH_TONE = {
  'on-track': 'success',
  'at-risk': 'warning',
  critical: 'danger',
} as const;
export const HEALTH_TEXT: Record<ClientHealth, string> = {
  'on-track': 'on track',
  'at-risk': 'at risk',
  critical: 'critical',
};

interface Overview {
  health: ClientHealth;
  projects: { id: string; key: string; health: string; reasons: string[] }[];
  revenue: { paid12mCents: number; openCents: number; overdueCents: number } | null;
  activity: { at: string; text: string }[];
  people: { id: string; name: string; hours: number }[];
  agents: { name: string; runs: number }[];
}

export function ClientOverview(props: { base: string; clientId: string }): ReactNode {
  const [d, setD] = useState<Overview | null>(null);
  useEffect(() => {
    void api<Overview>('GET', props.base + '/clients/' + props.clientId + '/overview').then((r) => {
      if (r.ok) setD(r.data);
    });
  }, [props.base, props.clientId]);
  if (!d) return null;
  return (
    <Card
      title="At a glance"
      action={<Chip tone={HEALTH_TONE[d.health]}>{HEALTH_TEXT[d.health]}</Chip>}
    >
      <div className="pv-stats">
        {d.revenue ? (
          <>
            <Stat
              label="Paid in 12 months"
              value={euroCents(d.revenue.paid12mCents, 0)}
              icon="euro"
            />
            <Stat
              label="Open invoices"
              value={euroCents(d.revenue.openCents, 0)}
              sub={
                d.revenue.overdueCents
                  ? euroCents(d.revenue.overdueCents, 0) + ' overdue'
                  : 'none overdue'
              }
              tone={d.revenue.overdueCents ? 'warning' : undefined}
              icon="euro"
            />
          </>
        ) : null}
        <Stat
          label="People, 30 days"
          value={String(d.people.length)}
          sub={
            d.people
              .slice(0, 3)
              .map((p) => p.name + ' ' + String(p.hours).replace('.', ',') + ' h')
              .join(', ') || 'no hours booked'
          }
          icon="user"
        />
        <Stat
          label="Agents, 30 days"
          value={String(d.agents.reduce((n, x) => n + x.runs, 0))}
          sub={d.agents.map((x) => x.name).join(', ') || 'no runs'}
          icon="agents"
        />
      </div>
      {d.projects.some((p) => p.reasons.length) ? (
        <ul className="pv-glance-list">
          {d.projects
            .filter((p) => p.reasons.length)
            .map((p) => (
              <li key={p.id} className="pv-small">
                <span className="pv-mono">{p.key}</span> {p.reasons.join(', ')}
              </li>
            ))}
        </ul>
      ) : null}
      {d.activity.length ? (
        <>
          <p className="pv-small pv-strong pv-mt">Lately</p>
          <ul className="pv-glance-list">
            {d.activity.slice(0, 8).map((e, i) => (
              <li key={i} className="pv-small">
                <span className="pv-muted">{new Date(e.at).toLocaleDateString(fmtLocale())}</span>{' '}
                {e.text}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

// ── meetings ──
export interface MeetingAction {
  id: string;
  text: string;
  assignee: { id: string; name: string } | null;
  dueOn: string | null;
  item: { id: string; ref: string; state: string; done: boolean } | null;
}
export interface MeetingNotes {
  id: string;
  title: string;
  startsAt: string;
  attendees: string[];
  agenda: string;
  notes: string;
  notesShared: boolean;
  actions: MeetingAction[];
}

/** "- [ ] …" lines, as the server reads them, for a preview while typing. */
export const actionLines = (notes: string): number =>
  notes
    .split(/\r?\n/)
    .filter((l) => /^\s*(?:[-*]\s*\[ \]\s+|(?:action|todo|to do)\s*:\s*)\S/i.test(l)).length;

export function ClientMeetings(props: {
  base: string;
  clientId: string;
  projects: { id: string; key: string }[];
  go: (p: string) => void;
}): ReactNode {
  const [list, setList] = useState<MeetingNotes[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<MeetingNotes[]>(
      'GET',
      props.base + '/clients/' + props.clientId + '/meetings',
    );
    if (r.ok) setList(r.data);
  }, [props.base, props.clientId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!list?.length) return null;
  return (
    <Card flush title="Meetings and their notes">
      <ul className="pv-rows">
        {list.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              className="pv-row v2-row-btn"
              aria-expanded={open === m.id}
              onClick={() => {
                setOpen(open === m.id ? null : m.id);
              }}
            >
              <span className="pv-row-main">
                <span className="pv-row-title">{m.title}</span>
                <span className="pv-row-sub">
                  {new Date(m.startsAt).toLocaleString(fmtLocale(), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                  {m.notes ? ' · notes' + (m.notesShared ? ' shared' : ' for the team') : ''}
                  {m.actions.length
                    ? ' · ' +
                      String(m.actions.filter((x) => x.item?.done).length) +
                      ' of ' +
                      String(m.actions.length) +
                      ' actions done'
                    : ''}
                </span>
              </span>
            </button>
            {open === m.id ? (
              <MeetingEditor
                base={props.base}
                meeting={m}
                projects={props.projects}
                go={props.go}
                onChanged={() => void load()}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MeetingEditor(props: {
  base: string;
  meeting: MeetingNotes;
  projects: { id: string; key: string }[];
  go: (p: string) => void;
  onChanged: () => void;
}): ReactNode {
  const m = props.meeting;
  const M = props.base + '/meetings/' + m.id;
  const [notes, setNotes] = useState(m.notes);
  const [shared, setShared] = useState(m.notesShared);
  const [text, setText] = useState('');
  const [project, setProject] = useState(props.projects[0]?.id ?? '');
  const [error, setError] = useState('');
  const call = async (
    method: 'PUT' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ) => {
    const r = await api(method, M + path, body);
    if (!r.ok) setError(r.error.message);
    else {
      setError('');
      props.onChanged();
    }
    return r.ok;
  };
  return (
    <div className="pv-meeting">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <textarea
        className="v2-input"
        rows={6}
        aria-label="Notes"
        placeholder={'What was said and decided.\n- [ ] An action item becomes a line like this'}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
        }}
      />
      <span className="pv-page-actions">
        <label className="v2-check">
          <input
            type="checkbox"
            checked={shared}
            onChange={(e) => {
              setShared(e.target.checked);
            }}
          />
          The client sees the notes
        </label>
        <Button
          size="sm"
          kind="primary"
          onClick={() => void call('PUT', '/notes', { notes, shared })}
        >
          Save notes
        </Button>
        {actionLines(notes) ? (
          <span className="pv-small pv-muted">{actionLines(notes)} action items in the notes</span>
        ) : null}
      </span>
      {m.actions.length ? (
        <ul className="pv-glance-list">
          {m.actions.map((x) => (
            <li key={x.id} className="pv-small">
              {x.item ? (
                <>
                  <button
                    type="button"
                    className="pv-link-btn pv-mono"
                    onClick={() => {
                      props.go('/items/' + (x.item?.id ?? ''));
                    }}
                  >
                    {x.item.ref}
                  </button>{' '}
                  <Chip tone={x.item.done ? 'success' : 'neutral'}>{x.item.state}</Chip>{' '}
                </>
              ) : null}
              {x.text}
              {x.assignee ? <span className="pv-muted"> · {x.assignee.name}</span> : null}
              {!x.item && props.projects.length ? (
                <>
                  {' '}
                  <Button
                    size="sm"
                    kind="ghost"
                    onClick={() =>
                      void call('POST', '/actions/' + x.id + '/task', { projectId: project })
                    }
                  >
                    Make a task
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <span className="pv-page-actions">
        <input
          className="v2-input v2-input--sm"
          aria-label="Action item"
          placeholder="Add an action item"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        <Button
          size="sm"
          kind="ghost"
          disabled={!text.trim()}
          onClick={() =>
            void call('POST', '/actions', { text: text.trim() }).then((ok) => {
              if (ok) setText('');
            })
          }
        >
          Add
        </Button>
        {props.projects.length > 1 ? (
          <select
            className="v2-input v2-input--sm"
            aria-label="Tasks go to"
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
            }}
          >
            {props.projects.map((p) => (
              <option key={p.id} value={p.id}>
                Tasks in {p.key}
              </option>
            ))}
          </select>
        ) : null}
      </span>
    </div>
  );
}

/** The portal's view: notes the team shared, and how the actions stand. */
export function PortalMeetingNotes(props: { base: string; qs: string }): ReactNode {
  const [list, setList] = useState<MeetingNotes[]>([]);
  useEffect(() => {
    void api<MeetingNotes[]>('GET', props.base + '/portal/meeting-notes' + props.qs).then((r) => {
      if (r.ok) setList(r.data);
    });
  }, [props.base, props.qs]);
  if (!list.length) return null;
  return (
    <Card title="Notes from our meetings">
      {list.map((m) => (
        <div key={m.id} className="pv-meeting">
          <strong className="pv-small">
            {m.title} · {new Date(m.startsAt).toLocaleDateString(fmtLocale())}
          </strong>
          <p className="pv-small pv-pre">{m.notes}</p>
          {m.actions.length ? (
            <ul className="pv-glance-list">
              {m.actions.map((x) => (
                <li key={x.id} className="pv-small">
                  <Chip tone={x.item?.done ? 'success' : 'neutral'}>
                    {x.item ? x.item.state : 'open'}
                  </Chip>{' '}
                  {x.text}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </Card>
  );
}
