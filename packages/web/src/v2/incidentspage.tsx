// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-342 | S15 | v0.1.0] T34.2c AI postmortems and runbooks matched to incidents ──
// ── [PCODE-341 | S15 | v0.1.0] T34.2b Public status pages per client and environment; incident update templates ──
// ── [PCODE-340 | S15 | v0.1.0] T34.2a Automatic alerts from probes and failed deploys; Sentry and Alertmanager sources with signed webhooks ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-188 | S15 | v0.1.0] B7.4 Incidents and on-call live: alerts, incidents with timeline and roles, suspect deploys and rollback, status updates, rotations and escalation, postmortems, SLOs ──
//    Why:  the approved Incidents screens, live: the open incident with its timeline, roles, suspect
//          deploys and rollback, status updates for the team and the client; who is on call this week with
//          swaps and escalation; postmortems drafted from the timeline whose actions become tasks; and how
//          reliable the services are against their objectives.
import { AlertSources } from './alertsources.js'; // [PCODE-340 | S15 | v0.1.0]
import { TemplatePicker } from './statuspage.js'; // [PCODE-341 | S15 | v0.1.0]
import { IncidentRunbooks, Runbooks } from './runbooks.js'; // [PCODE-342 | S15 | v0.1.0]
import { durationText } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Bar, Button, Card, Chip, PageHead, Stat } from '../preview/ui.js';
import { Markdown } from './markdown.js';
import { LiveAvatar } from './shell.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Incident {
  id: string;
  ref: string;
  projectId: string | null;
  projectKey: string | null;
  clientName: string | null;
  environmentName: string | null;
  severity: string;
  severityText: string;
  title: string;
  state: string;
  commander: { id: string; name: string } | null;
  comms: { id: string; name: string } | null;
  declaredAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  openFor: string;
  postmortem: string;
  postmortemActions: { text: string; itemId?: string; itemRef?: string }[];
  postmortemShared: boolean;
  alerts: number;
}

interface ListData {
  incidents: Incident[];
  onCall: {
    schedule: string;
    primary: { id: string; name: string } | null;
    backup: { id: string; name: string } | null;
  } | null;
  alerts: {
    id: string;
    title: string;
    severity: string;
    count: number;
    source: string;
    lastAt: string;
  }[];
}

interface Detail {
  incident: Incident;
  timeline: {
    id: string;
    at: string;
    kind: string;
    text: string;
    author: { id: string; name: string } | null;
  }[];
  updates: {
    id: string;
    audience: string;
    body: string;
    nextUpdateAt: string | null;
    author: string | null;
    at: string;
  }[];
  suspects: {
    id: string;
    environment: string;
    ref: string;
    status: string;
    trigger: string;
    by: string | null;
    at: string;
    before: string;
    likelihood: 'cause' | 'likely' | 'unlikely';
  }[];
  onCall: { schedule: string; primary: string | null; backup: string | null } | null;
}

export const sevTone = (s: string): 'danger' | 'warning' | 'info' =>
  s === 'sev1' || s === 'sev2' ? 'danger' : s === 'sev3' ? 'warning' : 'info';

export const stateTone = (s: string): 'warning' | 'info' | 'success' =>
  s === 'resolved' || s === 'mitigated' ? 'success' : s === 'identified' ? 'info' : 'warning';

/** A time of day in the viewer's zone: 09:41. */
export const hm = (iso: string): string =>
  new Date(iso).toLocaleTimeString(fmtLocale(), { hour: '2-digit', minute: '2-digit' });

const VIEWS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'now', label: 'Incidents', icon: 'incident' },
  { key: 'oncall', label: 'On-call', icon: 'people' },
  { key: 'post', label: 'Postmortems', icon: 'documents' },
  { key: 'rel', label: 'Reliability', icon: 'insights' },
  { key: 'sources', label: 'Alert sources', icon: 'bell' }, // [PCODE-340 | S15 | v0.1.0]
  { key: 'runbooks', label: 'Runbooks', icon: 'documents' }, // [PCODE-342 | S15 | v0.1.0]
];

export function IncidentsHub(props: {
  workspaceId: string;
  role: string;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const params = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search);
  const [view, setView] = useState(params?.get('view') ?? 'now');
  const [selected, setSelected] = useState<string | null>(params?.get('id') ?? null);
  const [data, setData] = useState<ListData | null>(null);
  const [declaring, setDeclaring] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<ListData>('GET', W(props.workspaceId, '/incidents'));
    if (r.ok) setData(r.data);
    else setError(r.error.message);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
    return props.hub.on(() => void load());
  }, [load, props.hub]);
  const open = data?.incidents.filter((i) => !i.resolvedAt) ?? [];
  const current = selected ?? open[0]?.id ?? data?.incidents[0]?.id ?? null;
  const team = props.role !== 'auditor';
  return (
    <div className="pv-page">
      <PageHead
        title="Incidents and on-call"
        sub={
          data
            ? String(open.length) +
              (open.length === 1 ? ' open incident' : ' open incidents') +
              (data.onCall?.primary
                ? ' · ' + data.onCall.primary.name + ' is on call'
                : ' · no on-call rotation yet')
            : 'Loading…'
        }
        icon="incidents"
        actions={
          team ? (
            <Button
              kind="danger"
              icon="incident"
              onClick={() => {
                setDeclaring(true);
                setView('now');
              }}
            >
              Declare an incident
            </Button>
          ) : null
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
            {v.key === 'now' && open[0]
              ? 'Now: ' + open[0].severityText + ' ' + (open[0].projectKey ?? '')
              : v.label}
          </button>
        ))}
      </nav>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {view === 'now' ? (
        <div className="pv-stack">
          {declaring ? (
            <Declare
              workspaceId={props.workspaceId}
              onDone={(id) => {
                setDeclaring(false);
                if (id) setSelected(id);
                void load();
              }}
            />
          ) : null}
          {data?.alerts.length ? (
            <Card flush title={'Alerts without an incident · ' + String(data.alerts.length)}>
              <ul className="pv-rows pv-rows--tight">
                {data.alerts.map((a) => (
                  <li key={a.id} className="pv-row pv-row--static">
                    <Chip tone={sevTone(a.severity)}>{a.severity.replace('sev', 'SEV-')}</Chip>
                    <span className="pv-row-main">
                      <span className="pv-row-title">{a.title}</span>
                      <span className="pv-row-sub">
                        {a.source} · {a.count === 1 ? 'once' : String(a.count) + ' times'} · last{' '}
                        {hm(a.lastAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {data && data.incidents.length > 1 ? (
            <div className="pv-attach">
              {data.incidents.slice(0, 8).map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className="pv-chip pv-chip--neutral"
                  aria-pressed={i.id === current}
                  onClick={() => {
                    setSelected(i.id);
                  }}
                >
                  {i.ref} {i.severityText} · {i.state}
                </button>
              ))}
            </div>
          ) : null}
          {current ? (
            <ActiveIncident
              key={current}
              workspaceId={props.workspaceId}
              id={current}
              team={team}
              hub={props.hub}
              onChanged={() => void load()}
            />
          ) : data ? (
            <Card>
              <div className="pv-empty">
                <PIcon name="check" size={28} />
                <strong>No incidents.</strong>
                <span>
                  Alerts from monitoring (POST /alerts with an access token) and declared incidents
                  show here.
                </span>
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}
      {view === 'oncall' ? <OnCall workspaceId={props.workspaceId} /> : null}
      {view === 'post' ? (
        <Postmortems
          workspaceId={props.workspaceId}
          incidents={data?.incidents ?? []}
          team={team}
          onChanged={() => void load()}
        />
      ) : null}
      {view === 'rel' ? <Reliability workspaceId={props.workspaceId} /> : null}
      {/* [PCODE-340 | S15 | v0.1.0] Sentry and Alertmanager */}
      {view === 'sources' ? <AlertSources workspaceId={props.workspaceId} /> : null}
      {/* [PCODE-342 | S15 | v0.1.0] */}
      {view === 'runbooks' ? (
        <Runbooks
          workspaceId={props.workspaceId}
          admin={props.role === 'admin' || props.role === 'owner'}
        />
      ) : null}
    </div>
  );
}

function Declare(props: { workspaceId: string; onDone: (id: string | null) => void }): ReactNode {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('sev2');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<{ id: string; key: string; name: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<{ id: string; key: string; name: string; archived: boolean }[]>(
      'GET',
      W(props.workspaceId, '/projects'),
    ).then((r) => {
      if (r.ok) setProjects(r.data.filter((p) => !p.archived));
    });
  }, [props.workspaceId]);
  const send = async (): Promise<void> => {
    const r = await api<Incident>('POST', W(props.workspaceId, '/incidents'), {
      title: title.trim(),
      severity,
      ...(projectId ? { projectId } : {}),
    });
    if (r.ok) props.onDone(r.data.id);
    else setError(r.error.message);
  };
  return (
    <Card title="Declare an incident">
      <div className="v2-inline">
        <select
          className="v2-input"
          aria-label="Severity"
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value);
          }}
        >
          <option value="sev1">SEV-1 · everyone affected</option>
          <option value="sev2">SEV-2 · a main function down</option>
          <option value="sev3">SEV-3 · degraded</option>
          <option value="sev4">SEV-4 · minor</option>
        </select>
        <select
          className="v2-input"
          aria-label="Project"
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
          }}
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} · {p.name}
            </option>
          ))}
        </select>
        <input
          className="v2-input v2-grow"
          placeholder="What is broken, for whom?"
          aria-label="Title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
        <Button kind="danger" disabled={!title.trim()} onClick={() => void send()}>
          Declare
        </Button>
        <Button
          kind="ghost"
          onClick={() => {
            props.onDone(null);
          }}
        >
          Cancel
        </Button>
      </div>
      <p className="pv-muted pv-small pv-mt">You lead it; whoever is on call is paged at once.</p>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

function ActiveIncident(props: {
  workspaceId: string;
  id: string;
  team: boolean;
  hub: EventHub;
  onChanged: () => void;
}): ReactNode {
  const I = W(props.workspaceId, '/incidents/' + props.id);
  const [d, setD] = useState<Detail | null>(null);
  const [members, setMembers] = useState<{ userId: string; name: string }[]>([]);
  const [note, setNote] = useState('');
  const [upd, setUpd] = useState({ body: '', audience: 'client', next: '30' });
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<Detail>('GET', I);
    if (r.ok) setD(r.data);
    else setError(r.error.message);
  }, [I]);
  useEffect(() => {
    void load();
    void api<{ userId: string; name: string; role: string; service?: boolean }[]>(
      'GET',
      W(props.workspaceId, '/members'),
    ).then((r) => {
      if (r.ok) setMembers(r.data.filter((m) => m.role !== 'guest' && !m.service));
    });
    return props.hub.on(() => void load());
  }, [load, props.hub, props.workspaceId]);
  const act = async (
    method: 'POST' | 'PATCH',
    path: string,
    body: Record<string, unknown>,
  ): Promise<boolean> => {
    const r = await api(method, I + path, body);
    if (!r.ok) setError(r.error.message);
    else setError('');
    await load();
    props.onChanged();
    return r.ok;
  };
  if (!d) return <p className="pv-muted">{error || 'Loading…'}</p>;
  const inc = d.incident;
  const live = !inc.resolvedAt;
  return (
    <div className="pv-split">
      <div className="pv-stack">
        <Card>
          <div className="pv-inc-head">
            <Chip tone={sevTone(inc.severity)}>{inc.severityText}</Chip>
            <strong className="pv-inc-title">
              <span className="pv-mono pv-muted">{inc.ref}</span> {inc.title}
            </strong>
            <Chip tone={stateTone(inc.state)}>{inc.state}</Chip>
            <span className="pv-spacer" />
            <span className="pv-muted pv-small pv-num">
              {live ? 'open ' : 'took '}
              {inc.openFor}
            </span>
          </div>
          <div className="pv-inc-roles">
            <span className="pv-who pv-small">
              {inc.commander ? (
                <LiveAvatar id={inc.commander.id} name={inc.commander.name} size="xs" />
              ) : null}
              Commander: {inc.commander?.name ?? 'nobody yet'}
            </span>
            <span className="pv-who pv-small">
              {inc.comms ? <LiveAvatar id={inc.comms.id} name={inc.comms.name} size="xs" /> : null}
              Communication: {inc.comms?.name ?? 'nobody yet'}
            </span>
            <span className="pv-muted pv-small">
              {inc.projectKey ?? 'no project'}
              {inc.environmentName ? ' · ' + inc.environmentName : ''}
              {inc.alerts
                ? ' · ' + String(inc.alerts) + (inc.alerts === 1 ? ' alert' : ' alerts')
                : ''}
              {d.onCall?.primary ? ' · on call: ' + d.onCall.primary : ''}
            </span>
          </div>
          {props.team && live ? (
            <div className="v2-inline pv-mt">
              {!inc.acknowledgedAt ? (
                <Button kind="primary" onClick={() => void act('POST', '/ack', {})}>
                  Acknowledge
                </Button>
              ) : (
                <span className="pv-muted pv-small">
                  Acknowledged by {inc.acknowledgedBy ?? 'someone'} at {hm(inc.acknowledgedAt)}
                </span>
              )}
              <select
                className="v2-input v2-input--sm"
                aria-label="State"
                value={inc.state}
                onChange={(e) => void act('PATCH', '', { state: e.target.value })}
              >
                {['investigating', 'identified', 'mitigated', 'resolved'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                className="v2-input v2-input--sm"
                aria-label="Commander"
                value={inc.commander?.id ?? ''}
                onChange={(e) => void act('PATCH', '', { commanderId: e.target.value || null })}
              >
                <option value="">Commander…</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
              <select
                className="v2-input v2-input--sm"
                aria-label="Communication"
                value={inc.comms?.id ?? ''}
                onChange={(e) => void act('PATCH', '', { commsId: e.target.value || null })}
              >
                <option value="">Communication…</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </Card>
        {/* [PCODE-342 | S15 | v0.1.0] the runbooks its words match */}
        <IncidentRunbooks
          workspaceId={props.workspaceId}
          incidentId={props.id}
          alerts={d.incident.alerts}
        />
        <Card title="Timeline">
          <ol className="pv-inc-timeline">
            {d.timeline.map((l) => (
              <li key={l.id}>
                <span className="pv-num pv-muted pv-small">{hm(l.at)}</span>
                {l.author ? (
                  <LiveAvatar id={l.author.id} name={l.author.name} size="xs" />
                ) : (
                  <span className="pv-kind pv-kind--incident pv-kind--sm">
                    <PIcon name="incident" size={12} />
                  </span>
                )}
                <span>{l.text}</span>
              </li>
            ))}
          </ol>
          {props.team ? (
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
                disabled={!note.trim()}
                onClick={() =>
                  void act('POST', '/notes', { text: note.trim() }).then((ok) => {
                    if (ok) setNote('');
                  })
                }
              >
                Add
              </Button>
            </div>
          ) : null}
        </Card>
      </div>
      <div className="pv-stack">
        <Card title="Suspect changes">
          {d.suspects.length ? (
            <ul className="pv-rows pv-rows--tight">
              {d.suspects.map((s) => (
                <li key={s.id} className="pv-row pv-row--static">
                  <span className="pv-row-main">
                    <span className="pv-row-title">
                      Deploy {s.ref || 'without a version'} to {s.environment} · {hm(s.at)}
                    </span>
                    <span className="pv-row-sub">
                      {s.before} before · {s.status}
                      {s.by ? ' · by ' + s.by : ''}
                      {s.trigger === 'rollback' ? ' · a rollback' : ''}
                    </span>
                  </span>
                  <Chip tone={s.likelihood === 'unlikely' ? 'neutral' : 'danger'}>
                    {s.likelihood}
                  </Chip>
                  {props.team && live && s.likelihood !== 'unlikely' && s.trigger !== 'rollback' ? (
                    <Button
                      size="sm"
                      kind="danger"
                      onClick={() => void act('POST', '/rollback', { deployId: s.id })}
                    >
                      Roll back
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="pv-muted pv-small">No deploys of this project in the 24 hours before.</p>
          )}
        </Card>
        <Card
          title={
            inc.clientName
              ? 'Status updates · ' + inc.clientName + ' sees client updates'
              : 'Status updates'
          }
        >
          {d.updates.length ? (
            <ul className="pv-rows pv-rows--tight">
              {d.updates.map((u) => (
                <li key={u.id} className="pv-row pv-row--static pv-row--top">
                  <Chip tone={u.audience === 'client' ? 'primary' : 'neutral'}>{u.audience}</Chip>
                  <span className="pv-row-main">
                    <span className="pv-strong">{u.body}</span>
                    <span className="pv-row-sub">
                      {hm(u.at)}
                      {u.author ? ' · ' + u.author : ''}
                      {u.nextUpdateAt ? ' · next update by ' + hm(u.nextUpdateAt) : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pv-muted pv-small">No updates yet.</p>
          )}
          {props.team && live ? (
            <div className="pv-stack pv-mt">
              <textarea
                className="v2-input"
                rows={2}
                aria-label="Update"
                placeholder="What is affected, what you do, when the next update comes"
                value={upd.body}
                onChange={(e) => {
                  setUpd({ ...upd, body: e.target.value });
                }}
              />
              <div className="v2-inline">
                {/* [PCODE-341 | S15 | v0.1.0] the words from a template, filled from the incident */}
                <TemplatePicker
                  workspaceId={props.workspaceId}
                  incident={inc}
                  next={upd.next}
                  onPick={(body, audience) => {
                    setUpd({ ...upd, body, audience });
                  }}
                />
                <select
                  className="v2-input v2-input--sm"
                  aria-label="For"
                  value={inc.clientName ? upd.audience : 'team'}
                  onChange={(e) => {
                    setUpd({ ...upd, audience: e.target.value });
                  }}
                >
                  {inc.clientName ? <option value="client">for {inc.clientName}</option> : null}
                  <option value="team">for the team</option>
                </select>
                <select
                  className="v2-input v2-input--sm"
                  aria-label="Next update"
                  value={upd.next}
                  onChange={(e) => {
                    setUpd({ ...upd, next: e.target.value });
                  }}
                >
                  <option value="">no next update time</option>
                  <option value="15">next update in 15 min</option>
                  <option value="30">next update in 30 min</option>
                  <option value="60">next update in 1 h</option>
                </select>
                <Button
                  size="sm"
                  disabled={!upd.body.trim()}
                  onClick={() =>
                    void act('POST', '/updates', {
                      body: upd.body.trim(),
                      audience: inc.clientName ? upd.audience : 'team',
                      ...(upd.next ? { nextUpdateMinutes: Number(upd.next) } : {}),
                    }).then((ok) => {
                      if (ok) setUpd({ ...upd, body: '' });
                    })
                  }
                >
                  Post an update
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
      </div>
    </div>
  );
}

// ── on-call ──
interface Schedule {
  id: string;
  name: string;
  members: { id: string; name: string }[];
  rotationDays: number;
  handoffTime: string;
  escalation: { afterMinutes: number; target: string; userName: string | null }[];
  now: {
    primary: { id: string; name: string } | null;
    backup: { id: string; name: string } | null;
  };
  days: {
    day: string;
    primary: { id: string; name: string } | null;
    backup: { id: string; name: string } | null;
    swapped: boolean;
  }[];
  shifts: { id: string; name: string; startsAt: string; endsAt: string; reason: string }[];
}

export const stepText = (s: {
  afterMinutes: number;
  target: string;
  userName: string | null;
}): string =>
  'After ' +
  durationText(s.afterMinutes) +
  ' without acknowledgement: ' +
  (s.target === 'backup'
    ? 'the backup'
    : s.target === 'primary'
      ? 'the primary again'
      : s.target === 'admins'
        ? 'the admins'
        : (s.userName ?? 'a person')) +
  '.';

function OnCall(props: { workspaceId: string }): ReactNode {
  const [d, setD] = useState<{ schedules: Schedule[]; mayEdit: boolean } | null>(null);
  const [members, setMembers] = useState<
    { userId: string; name: string; role: string; service?: boolean }[]
  >([]);
  const [form, setForm] = useState<{ name: string; ids: string[]; days: string; handoff: string }>({
    name: '',
    ids: [],
    days: '7',
    handoff: '09:00',
  });
  const [swap, setSwap] = useState<{ scheduleId: string; from: string; to: string } | null>(null);
  const [error, setError] = useState('');
  const [me, setMe] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ schedules: Schedule[]; mayEdit: boolean }>(
      'GET',
      W(props.workspaceId, '/oncall'),
    );
    if (r.ok) setD(r.data);
    else setError(r.error.message);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
    void api<{ userId: string; name: string; role: string; service?: boolean }[]>(
      'GET',
      W(props.workspaceId, '/members'),
    ).then((r) => {
      if (r.ok)
        setMembers(
          r.data.filter((m) => !['guest', 'auditor', 'billing'].includes(m.role) && !m.service),
        );
    });
    void api<{ user: { id: string } }>('GET', '/auth/me').then((r) => {
      if (r.ok) setMe(r.data.user.id);
    });
  }, [load, props.workspaceId]);
  if (!d) return <p className="pv-muted">{error || 'Loading…'}</p>;
  const create = async (): Promise<void> => {
    const r = await api('POST', W(props.workspaceId, '/oncall'), {
      name: form.name.trim(),
      memberIds: form.ids,
      rotationDays: Number(form.days),
      handoffTime: form.handoff,
    });
    if (!r.ok) setError(r.error.message);
    else setForm({ name: '', ids: [], days: '7', handoff: '09:00' });
    await load();
  };
  return (
    <div className="pv-stack">
      {d.schedules.map((sch) => (
        <div key={sch.id} className="pv-stack">
          <Card
            flush
            title={'Next 7 days · rotation “' + sch.name + '”'}
            action={
              <Button
                size="sm"
                onClick={() => {
                  setSwap({ scheduleId: sch.id, from: '', to: '' });
                }}
              >
                Take over a shift
              </Button>
            }
          >
            <div className="pv-grid-scroll">
              <div className="pv-rota">
                <div className="pv-rota-label">Day</div>
                {sch.days.map((x) => (
                  <div key={x.day} className="pv-rota-head">
                    {WD[(new Date(x.day + 'T00:00:00Z').getUTCDay() + 6) % 7]}{' '}
                    {Number(x.day.slice(8, 10))}
                  </div>
                ))}
                <div className="pv-rota-label">Primary</div>
                {sch.days.map((x) => (
                  <div key={x.day} className="pv-rota-cell">
                    {x.primary ? (
                      <LiveAvatar id={x.primary.id} name={x.primary.name} size="xs" />
                    ) : null}{' '}
                    {x.primary?.name.split(' ')[0] ?? '—'}
                    {x.swapped ? ' ⇄' : ''}
                  </div>
                ))}
                <div className="pv-rota-label">Backup</div>
                {sch.days.map((x) => (
                  <div key={x.day} className="pv-rota-cell pv-rota-cell--backup">
                    {x.backup ? (
                      <LiveAvatar id={x.backup.id} name={x.backup.name} size="xs" />
                    ) : null}{' '}
                    {x.backup?.name.split(' ')[0] ?? '—'}
                  </div>
                ))}
              </div>
            </div>
            <p className="pv-muted pv-small pv-pad">
              Hands over at {sch.handoffTime} ·{' '}
              {sch.rotationDays === 1 ? 'daily' : 'every ' + String(sch.rotationDays) + ' days'} ·{' '}
              {sch.members.map((m) => m.name).join(', ')} · approved time off from Time is skipped
            </p>
            {swap?.scheduleId === sch.id ? (
              <div className="v2-inline pv-pad">
                <label className="v2-field">
                  <span>From</span>
                  <input
                    type="datetime-local"
                    className="v2-input v2-input--sm"
                    value={swap.from}
                    onChange={(e) => {
                      setSwap({ ...swap, from: e.target.value });
                    }}
                  />
                </label>
                <label className="v2-field">
                  <span>To</span>
                  <input
                    type="datetime-local"
                    className="v2-input v2-input--sm"
                    value={swap.to}
                    onChange={(e) => {
                      setSwap({ ...swap, to: e.target.value });
                    }}
                  />
                </label>
                <Button
                  size="sm"
                  kind="primary"
                  disabled={!swap.from || !swap.to || !me}
                  onClick={() =>
                    void api('POST', W(props.workspaceId, '/oncall/' + sch.id + '/shifts'), {
                      userId: me,
                      startsAt: new Date(swap.from).toISOString(),
                      endsAt: new Date(swap.to).toISOString(),
                    }).then(async (r) => {
                      if (!r.ok) setError(r.error.message);
                      else setSwap(null);
                      await load();
                    })
                  }
                >
                  I take it
                </Button>
              </div>
            ) : null}
          </Card>
          <div className="pv-split pv-split--even">
            <Card title="Escalation">
              <ol className="pv-numbered">
                <li>The primary gets a push notice at once.</li>
                {sch.escalation.map((st, i) => (
                  <li key={i}>{stepText(st)}</li>
                ))}
              </ol>
            </Card>
            <Card flush title="Swaps">
              {sch.shifts.length ? (
                <ul className="pv-rows pv-rows--tight">
                  {sch.shifts.map((x) => (
                    <li key={x.id} className="pv-row pv-row--static">
                      <span className="pv-row-main">
                        <span className="pv-row-title">{x.name} takes over</span>
                        <span className="pv-row-sub">
                          {new Date(x.startsAt).toLocaleString(fmtLocale(), {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}{' '}
                          –{' '}
                          {new Date(x.endsAt).toLocaleString(fmtLocale(), {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                          {x.reason ? ' · ' + x.reason : ''}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        kind="ghost"
                        onClick={() =>
                          void api('DELETE', W(props.workspaceId, '/oncall/shifts/' + x.id)).then(
                            () => load(),
                          )
                        }
                      >
                        Undo
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="pv-muted pv-small pv-pad">No swaps coming up.</p>
              )}
            </Card>
          </div>
        </div>
      ))}
      {!d.schedules.length ? (
        <Card>
          <div className="pv-empty">
            <PIcon name="people" size={28} />
            <strong>No on-call rotation yet.</strong>
            <span>Until there is one, incidents page the admins.</span>
          </div>
        </Card>
      ) : null}
      {d.mayEdit ? (
        <Card title="New rotation">
          <div className="pv-stack">
            <div className="v2-inline">
              <input
                className="v2-input"
                placeholder="Name, e.g. Product engineering"
                aria-label="Name"
                value={form.name}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value });
                }}
              />
              <select
                className="v2-input"
                aria-label="Turns"
                value={form.days}
                onChange={(e) => {
                  setForm({ ...form, days: e.target.value });
                }}
              >
                <option value="1">daily turns</option>
                <option value="7">weekly turns</option>
              </select>
              <input
                type="time"
                className="v2-input"
                aria-label="Handover time"
                value={form.handoff}
                onChange={(e) => {
                  setForm({ ...form, handoff: e.target.value });
                }}
              />
            </div>
            <div className="pv-attach">
              {members.map((m) => (
                <label key={m.userId} className="v2-switch">
                  <input
                    type="checkbox"
                    checked={form.ids.includes(m.userId)}
                    onChange={(e) => {
                      setForm({
                        ...form,
                        ids: e.target.checked
                          ? [...form.ids, m.userId]
                          : form.ids.filter((x) => x !== m.userId),
                      });
                    }}
                  />
                  <span>{m.name}</span>
                </label>
              ))}
            </div>
            <div className="pv-page-actions">
              <Button
                kind="primary"
                disabled={!form.name.trim() || !form.ids.length}
                onClick={() => void create()}
              >
                Create rotation
              </Button>
              <span className="pv-muted pv-small">
                People take turns in the order you tick them.
              </span>
            </div>
          </div>
        </Card>
      ) : null}
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ── postmortems ──
function Postmortems(props: {
  workspaceId: string;
  incidents: Incident[];
  team: boolean;
  onChanged: () => void;
}): ReactNode {
  const done = props.incidents.filter((i) => i.resolvedAt);
  const [sel, setSel] = useState<string | null>(done[0]?.id ?? null);
  const inc = done.find((i) => i.id === sel) ?? done[0];
  const [text, setText] = useState(inc?.postmortem ?? '');
  const [actions, setActions] = useState(
    (inc?.postmortemActions ?? []).map((a) => a.text).join('\n'),
  );
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setText(inc?.postmortem ?? '');
    setActions((inc?.postmortemActions ?? []).map((a) => a.text).join('\n'));
    setEditing(false);
  }, [inc?.id, inc?.postmortem, inc?.postmortemActions]);
  if (!inc)
    return (
      <Card>
        <div className="pv-empty">
          <PIcon name="documents" size={28} />
          <strong>No resolved incidents in the last 30 days.</strong>
          <span>After an incident, its postmortem is drafted from the timeline here.</span>
        </div>
      </Card>
    );
  const P = W(props.workspaceId, '/incidents/' + inc.id + '/postmortem');
  const save = async (extra: Record<string, unknown>): Promise<void> => {
    const r = await api('PUT', P, {
      text,
      actions: actions
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
      ...extra,
    });
    if (!r.ok) setError(r.error.message);
    else {
      setError('');
      setEditing(false);
    }
    props.onChanged();
  };
  return (
    <div className="pv-stack">
      {done.length > 1 ? (
        <div className="pv-attach">
          {done.map((i) => (
            <button
              key={i.id}
              type="button"
              className="pv-chip pv-chip--neutral"
              aria-pressed={i.id === inc.id}
              onClick={() => {
                setSel(i.id);
              }}
            >
              {i.ref} {i.title}
            </button>
          ))}
        </div>
      ) : null}
      <Card
        title={
          'Postmortem · ' +
          inc.severityText +
          ' ' +
          inc.title +
          (inc.projectKey ? ' (' + inc.projectKey + ')' : '')
        }
        action={
          inc.postmortemShared ? (
            <Chip tone="primary">shared with {inc.clientName ?? 'the client'}</Chip>
          ) : null
        }
      >
        {editing || !inc.postmortem ? (
          <div className="pv-stack">
            <textarea
              className="v2-input"
              rows={14}
              aria-label="Postmortem"
              placeholder="Draft it from the timeline, then say why it happened."
              value={text}
              onChange={(e) => {
                setText(e.target.value);
              }}
            />
            <label className="v2-field">
              <span>What we change (one action per line; each becomes a task)</span>
              <textarea
                className="v2-input"
                rows={3}
                value={actions}
                onChange={(e) => {
                  setActions(e.target.value);
                }}
              />
            </label>
          </div>
        ) : (
          <article className="pv-doc">
            <Markdown text={inc.postmortem} />
          </article>
        )}
        {inc.postmortemActions.length && !editing ? (
          <ul className="pv-rows pv-rows--tight pv-mt">
            {inc.postmortemActions.map((a) => (
              <li key={a.text} className="pv-row pv-row--static">
                <span className="pv-row-main">
                  <span className="pv-row-title">{a.text}</span>
                </span>
                {a.itemRef ? (
                  <Chip tone="success" icon="check">
                    {a.itemRef}
                  </Chip>
                ) : (
                  <Chip>not a task yet</Chip>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {props.team ? (
          <div className="pv-page-actions pv-mt">
            {editing || !inc.postmortem ? (
              <>
                <Button kind="primary" onClick={() => void save({})}>
                  Save
                </Button>
                <Button onClick={() => void save({ draft: true })}>Draft from the timeline</Button>
                {/* [PCODE-342 | S15 | v0.1.0] */}
                <Button icon="sparkle" onClick={() => void save({ ai: true })}>
                  Draft with the DevOps agent
                </Button>
              </>
            ) : (
              <>
                <Button
                  kind="primary"
                  disabled={!inc.postmortemActions.some((a) => !a.itemId)}
                  onClick={() =>
                    void api(
                      'POST',
                      W(props.workspaceId, '/incidents/' + inc.id + '/postmortem/tasks'),
                      {},
                    ).then((r) => {
                      if (!r.ok) setError(r.error.message);
                      props.onChanged();
                    })
                  }
                >
                  Turn actions into tasks
                </Button>
                <Button
                  onClick={() => {
                    setEditing(true);
                  }}
                >
                  Edit
                </Button>
                {inc.clientName ? (
                  <Button kind="ghost" onClick={() => void save({ shared: !inc.postmortemShared })}>
                    {inc.postmortemShared ? 'Stop sharing' : 'Share with ' + inc.clientName}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
      </Card>
    </div>
  );
}

// ── reliability ──
interface Rel {
  ackText: string | null;
  restoreText: string | null;
  total: number;
  bySeverity: { severity: string; text: string; count: number }[];
  causedByDeploy: number;
  slos: {
    id: string;
    projectKey: string;
    name: string;
    indicator: string;
    objectivePct: number;
    windowDays: number;
    actualPct: number;
    budgetLeft: number;
    burn: number;
  }[];
  mayEdit: boolean;
}

function Reliability(props: { workspaceId: string }): ReactNode {
  const [d, setD] = useState<Rel | null>(null);
  const [projects, setProjects] = useState<{ id: string; key: string; archived: boolean }[]>([]);
  const [form, setForm] = useState({
    projectId: '',
    name: '',
    indicator: 'availability',
    objective: '99.5',
  });
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<Rel>('GET', W(props.workspaceId, '/reliability'));
    if (r.ok) setD(r.data);
    else setError(r.error.message);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
    void api<{ id: string; key: string; archived: boolean }[]>(
      'GET',
      W(props.workspaceId, '/projects'),
    ).then((r) => {
      if (r.ok) setProjects(r.data.filter((p) => !p.archived));
    });
  }, [load, props.workspaceId]);
  if (!d) return <p className="pv-muted">{error || 'Loading…'}</p>;
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat
          label="Time to acknowledge"
          value={d.ackText ?? '—'}
          sub="median, 30 days"
          icon="clock"
        />
        <Stat
          label="Time to restore"
          value={d.restoreText ?? '—'}
          sub="median, 30 days"
          icon="time"
        />
        <Stat
          label="Incidents"
          value={String(d.total)}
          sub={d.bySeverity.map((x) => String(x.count) + ' ' + x.text).join(' · ')}
          icon="incident"
        />
        <Stat
          label="Caused by a deploy"
          value={String(d.causedByDeploy) + ' of ' + String(d.total)}
          sub="marked as the cause or rolled back"
          icon="releases"
        />
      </div>
      <Card flush title="Service level objectives">
        {d.slos.length ? (
          <table className="pv-table">
            <thead>
              <tr>
                <th>Objective</th>
                <th>Error budget left</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.slos.map((o) => (
                <tr key={o.id}>
                  <td className="pv-cell-grow">
                    <strong>{o.projectKey}</strong> {o.name}
                    <span className="pv-muted pv-block pv-small">
                      {o.indicator === 'availability' ? 'available' : 'deploys succeed'}{' '}
                      {String(o.objectivePct).replace('.', ',')} % over {o.windowDays} days · now{' '}
                      {String(o.actualPct).replace('.', ',')} %
                    </span>
                  </td>
                  <td className="pv-cell-bar">
                    <Bar
                      value={o.budgetLeft}
                      max={100}
                      tone={o.budgetLeft < 30 ? 'danger' : 'success'}
                    />
                    <span className="pv-small pv-muted">
                      {String(o.budgetLeft).replace('.', ',')} %
                    </span>
                  </td>
                  <td className="pv-text-danger pv-small">
                    {o.burn > 1
                      ? 'burns fast: ' + String(o.burn).replace('.', ',') + '× normal today'
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pv-muted pv-small pv-pad">No objectives yet.</p>
        )}
        {d.mayEdit ? (
          <div className="v2-inline pv-pad">
            <select
              className="v2-input v2-input--sm"
              aria-label="Project"
              value={form.projectId}
              onChange={(e) => {
                setForm({ ...form, projectId: e.target.value });
              }}
            >
              <option value="">Project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key}
                </option>
              ))}
            </select>
            <input
              className="v2-input v2-input--sm"
              placeholder="e.g. Booking available"
              aria-label="Name"
              value={form.name}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value });
              }}
            />
            <select
              className="v2-input v2-input--sm"
              aria-label="Measured by"
              value={form.indicator}
              onChange={(e) => {
                setForm({ ...form, indicator: e.target.value });
              }}
            >
              <option value="availability">availability (SEV-1/2 time)</option>
              <option value="deploys">deploys succeed</option>
            </select>
            <input
              className="v2-input v2-input--sm"
              inputMode="decimal"
              aria-label="Objective in percent"
              value={form.objective}
              onChange={(e) => {
                setForm({ ...form, objective: e.target.value });
              }}
            />
            <Button
              size="sm"
              disabled={!form.projectId || !form.name.trim()}
              onClick={() =>
                void api('POST', W(props.workspaceId, '/slos'), {
                  projectId: form.projectId,
                  name: form.name.trim(),
                  indicator: form.indicator,
                  objectivePct: Number(form.objective.replace(',', '.')),
                }).then(async (r) => {
                  if (!r.ok) setError(r.error.message);
                  else setForm({ ...form, name: '' });
                  await load();
                })
              }
            >
              Add objective
            </Button>
          </div>
        ) : null}
      </Card>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="pv-muted pv-small">
        Pages go to the inbox and phones (push); calls and SMS are not connected yet.
      </p>
    </div>
  );
}
