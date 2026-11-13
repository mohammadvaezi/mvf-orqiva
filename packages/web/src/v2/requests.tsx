// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-337 | S15 | v0.1.0] T34.1b Request votes and duplicate merge, NPS survey, embeddable feedback widget ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
//    Why:  one page for both sides of a request. A client contact files a bug, change, feature or question
//          with files, follows the steps and the promised response time, writes in the thread, signs or
//          declines a quote, and rates the result. The team sees every client's requests, answers, keeps
//          internal notes (marked, never shown to the client), quotes a change's impact, picks the project
//          and turns the request into a task.
import { REQUEST_STEPS, mayApproveChange, mayFileRequest } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { PIcon } from '../preview/picons.js';
import { Button, Card, Chip, PageHead } from '../preview/ui.js';
import { uploadFile } from './files.js';
import { RequestVotes } from './clientvoice.js'; // [PCODE-337 | S15 | v0.1.0]
import { LiveAvatar, euroCents } from './shell.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

type Kind = 'bug' | 'change' | 'feature' | 'question';

export interface LiveRequest {
  id: string;
  ref: string;
  kind: Kind;
  title: string;
  state: string;
  stateText: string;
  step: number;
  clientId: string;
  clientName: string;
  projectId: string | null;
  projectKey: string | null;
  itemId: string | null;
  itemRef: string | null;
  requestedBy: { id: string; name: string } | null;
  late: boolean;
  responseText: string;
  impact: { points: number; priceCents: number; days: number } | null;
  approval: { decision: string; signedName: string; at: string } | null;
  rating: number | null;
  messages: number;
  lastNote: string | null;
  createdAt: string;
  closedAt: string | null;
  // [PCODE-337 | S15 | v0.1.0]
  votes?: number;
  voterIds?: string[];
  mergedInto?: { id: string; ref: string } | null;
  pageUrl?: string;
  source?: string;
}

interface Message {
  id: string;
  author: { id: string; name: string; client: boolean } | null;
  body: string;
  internal: boolean;
  files: { id: string; name: string; mime: string; size: number }[];
  createdAt: string;
}

interface ClientInfo {
  id: string;
  name: string;
  projects: { id: string; key: string; name: string }[];
}

const KINDS: [Kind, string][] = [
  ['bug', 'Bug'],
  ['change', 'Change'],
  ['feature', 'Feature'],
  ['question', 'Question'],
];

export const kindTone = (k: string): 'danger' | 'warning' | 'info' =>
  k === 'bug' ? 'danger' : k === 'change' ? 'warning' : 'info';

/** Short time for a thread: today's time, else day and month. */
export function whenText(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(fmtLocale(), { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(fmtLocale(), { day: '2-digit', month: '2-digit' }) +
        ' ' +
        d.toLocaleTimeString(fmtLocale(), { hour: '2-digit', minute: '2-digit' });
}

/** The impact a client signs, as chips: points, price, schedule. */
export function impactChips(i: { points: number; priceCents: number; days: number }): string[] {
  return [
    String(i.points) + (i.points === 1 ? ' point' : ' points'),
    euroCents(i.priceCents, 0),
    i.days === 0
      ? 'no schedule change'
      : 'release ' +
        (i.days > 0 ? '+' : '') +
        String(i.days) +
        (Math.abs(i.days) === 1 ? ' day' : ' days'),
  ];
}

export function RequestsPage(props: {
  workspaceId: string;
  role: string;
  client: { id: string; name: string; portalRoles: string[] } | null;
  hub: EventHub;
  id: string | null;
  go: (p: string) => void;
}): ReactNode {
  const W = '/api/workspaces/' + props.workspaceId;
  const portal = props.client !== null;
  const team = !portal && props.role !== 'guest';
  const canFile = portal ? mayFileRequest(props.client?.portalRoles ?? []) : team;
  const [list, setList] = useState<LiveRequest[] | null>(null);
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [open, setOpen] = useState(true);
  const [clientFilter, setClientFilter] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : (new URLSearchParams(window.location.search).get('client') ?? ''),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (open) q.set('open', '1');
    if (clientFilter) q.set('clientId', clientFilter);
    const [r, c] = await Promise.all([
      api<LiveRequest[]>('GET', W + '/client-requests?' + q.toString()),
      api<ClientInfo[]>('GET', W + '/clients'),
    ]);
    if (r.ok) setList(r.data);
    else setError(r.error.message);
    if (c.ok) setClients(c.data);
  }, [W, open, clientFilter]);
  useEffect(() => {
    void load();
    return props.hub.on(() => void load());
  }, [load, props.hub]);

  const selected = props.id ?? list?.[0]?.id ?? null;
  const late = list?.filter((r) => r.late && !r.closedAt).length ?? 0;
  return (
    <div className="pv-page">
      <PageHead
        title="Requests"
        sub={
          list
            ? String(list.length) +
              (open ? ' open' : ' in all') +
              (late ? ' · ' + String(late) + ' past response time' : '') +
              (portal ? ' · your team answers here' : ' · from all clients')
            : 'Loading…'
        }
        icon="request"
        actions={
          canFile ? (
            <Button
              kind="primary"
              icon="plus"
              onClick={() => {
                setCreating(true);
              }}
            >
              New request
            </Button>
          ) : null
        }
      />
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pv-portal-split">
        <div className="pv-stack">
          <div className="v2-inline">
            <div className="pv-segmented" role="radiogroup" aria-label="Which requests">
              {(
                [
                  [true, 'Open'],
                  [false, 'All'],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={open === v}
                  className="pv-seg"
                  onClick={() => {
                    setOpen(v);
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
            {team && clients.length > 1 ? (
              <select
                className="v2-input v2-input--sm"
                aria-label="Client"
                value={clientFilter}
                onChange={(e) => {
                  setClientFilter(e.target.value);
                }}
              >
                <option value="">All clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {creating ? (
            <NewRequest
              base={W}
              workspaceId={props.workspaceId}
              clients={clients}
              portal={portal}
              presetClient={clientFilter}
              onDone={(id) => {
                setCreating(false);
                void load();
                if (id) props.go('/requests/' + id);
              }}
            />
          ) : null}
          {list && !list.length ? (
            <Card>
              <div className="pv-empty">
                <PIcon name="request" size={28} />
                <strong>{open ? 'No open requests.' : 'No requests yet.'}</strong>
                <span>
                  {portal
                    ? 'A bug, a change, a question: file it here and see when your team answers.'
                    : 'Requests come from the clients’ portals, or you file one for a client.'}
                </span>
              </div>
            </Card>
          ) : null}
          <ul className="pv-req-list">
            {(list ?? []).map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  className="pv-req"
                  aria-current={x.id === selected ? 'true' : undefined}
                  onClick={() => {
                    props.go('/requests/' + x.id);
                  }}
                >
                  <span className="pv-idea-top">
                    <span className="pv-mono pv-muted">{x.ref}</span>
                    <Chip tone={kindTone(x.kind)}>{KINDS.find((k) => k[0] === x.kind)?.[1]}</Chip>
                  </span>
                  <span className="pv-idea-title">{x.title}</span>
                  <span className="pv-idea-meta">
                    {team ? (
                      <>
                        <span>{x.clientName}</span>
                        <span>·</span>
                      </>
                    ) : null}
                    <span>{x.stateText}</span>
                    <span>·</span>
                    <span className={x.late && !x.closedAt ? 'pv-text-danger' : ''}>
                      {x.responseText}
                    </span>
                    {/* [PCODE-337 | S15 | v0.1.0] how many it matters to */}
                    {x.votes ? (
                      <>
                        <span>·</span>
                        <span>
                          {x.votes} {x.votes === 1 ? 'vote' : 'votes'}
                        </span>
                      </>
                    ) : null}
                    {x.source === 'widget' ? (
                      <>
                        <span>·</span>
                        <span>from the widget</span>
                      </>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {selected ? (
          <RequestDetail
            key={selected}
            base={W}
            workspaceId={props.workspaceId}
            id={selected}
            team={team}
            portalRoles={props.client?.portalRoles ?? null}
            clients={clients}
            hub={props.hub}
            go={props.go}
            onChanged={() => void load()}
          />
        ) : null}
      </div>
    </div>
  );
}

function NewRequest(props: {
  base: string;
  workspaceId: string;
  clients: ClientInfo[];
  portal: boolean;
  presetClient: string;
  onDone: (id: string | null) => void;
}): ReactNode {
  const [kind, setKind] = useState<Kind>('bug');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [clientId, setClientId] = useState(props.presetClient || props.clients[0]?.id || '');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const client = props.portal ? props.clients[0] : props.clients.find((c) => c.id === clientId);
  const [projectId, setProjectId] = useState('');
  const project = projectId || client?.projects[0]?.id || '';

  const send = async (): Promise<void> => {
    if (!title.trim()) {
      setError('Say in one sentence what happened or what you need.');
      return;
    }
    setBusy(true);
    setError('');
    const fileIds: string[] = [];
    for (const f of files) {
      if (!project) {
        setError('Files need a project; ask your team to assign one.');
        setBusy(false);
        return;
      }
      const up = await uploadFile(props.workspaceId, project, f);
      if (!up.ok) {
        setError(up.error.message);
        setBusy(false);
        return;
      }
      fileIds.push(up.data.id);
    }
    const r = await api<LiveRequest>('POST', props.base + '/client-requests', {
      kind,
      title: title.trim(),
      ...(body.trim() ? { body: body.trim() } : {}),
      ...(props.portal ? {} : { clientId }),
      ...(project ? { projectId: project } : {}),
      ...(fileIds.length ? { fileIds } : {}),
    });
    setBusy(false);
    if (r.ok) props.onDone(r.data.id);
    else setError(r.error.message);
  };

  return (
    <Card title="New request">
      <div className="v2-form">
        <div className="pv-segmented pv-segmented--full" role="radiogroup" aria-label="Type">
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
        {!props.portal ? (
          <label className="v2-field">
            <span>For client</span>
            <select
              className="v2-input"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setProjectId('');
              }}
            >
              {props.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {client && client.projects.length > 1 ? (
          <label className="v2-field">
            <span>Project</span>
            <select
              className="v2-input"
              value={project}
              onChange={(e) => {
                setProjectId(e.target.value);
              }}
            >
              {client.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="v2-field">
          <span>What happened or what do you need?</span>
          <input
            className="v2-input"
            value={title}
            maxLength={255}
            placeholder="One sentence"
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
        </label>
        <label className="v2-field">
          <span>Details (optional)</span>
          <textarea
            className="v2-input"
            rows={3}
            value={body}
            placeholder={
              kind === 'bug'
                ? 'Steps, what you expected, what you saw, which device'
                : 'Why it matters and by when'
            }
            onChange={(e) => {
              setBody(e.target.value);
            }}
          />
        </label>
        <label className="v2-field">
          <span>Screenshots, recordings, voice notes or files</span>
          <input
            type="file"
            multiple
            className="v2-input"
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []));
            }}
          />
        </label>
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="pv-page-actions">
          <Button kind="primary" disabled={busy} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send'}
          </Button>
          <Button
            kind="ghost"
            onClick={() => {
              props.onDone(null);
            }}
          >
            Cancel
          </Button>
          <span className="pv-muted pv-small">
            {props.portal
              ? 'Your team sees it at once.'
              : 'Filed for the client, as from the team.'}
          </span>
        </div>
      </div>
    </Card>
  );
}

function RequestDetail(props: {
  base: string;
  workspaceId: string;
  id: string;
  team: boolean;
  portalRoles: string[] | null;
  clients: ClientInfo[];
  hub: EventHub;
  go: (p: string) => void;
  onChanged: () => void;
}): ReactNode {
  const R = props.base + '/client-requests/' + props.id;
  const [d, setD] = useState<{ request: LiveRequest; messages: Message[] } | null>(null);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [quote, setQuote] = useState<{ points: string; euro: string; days: string } | null>(null);
  const [signing, setSigning] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ request: LiveRequest; messages: Message[] }>('GET', R);
    if (r.ok) setD(r.data);
    else setError(r.error.message);
  }, [R]);
  useEffect(() => {
    void load();
    return props.hub.on(() => void load());
  }, [load, props.hub]);

  const act = async (
    method: 'POST' | 'PATCH',
    path: string,
    body: Record<string, unknown>,
  ): Promise<boolean> => {
    setBusy(true);
    const r = await api(method, R + path, body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return false;
    }
    setError('');
    await load();
    props.onChanged();
    return true;
  };

  if (!d)
    return (
      <Card>
        <p className="pv-muted">{error || 'Loading…'}</p>
      </Card>
    );
  const r = d.request;
  const client = props.clients.find((c) => c.id === r.clientId);
  const canWrite = props.team || mayFileRequest(props.portalRoles ?? []);
  const canSign = !props.team && mayApproveChange(props.portalRoles ?? []);
  const quotable =
    props.team &&
    (r.kind === 'change' || r.kind === 'feature') &&
    ['new', 'understood', 'quoted'].includes(r.state);

  const send = async (): Promise<void> => {
    if (!reply.trim()) return;
    const fileIds: string[] = [];
    for (const f of files) {
      if (!r.projectId) {
        setError('Files need a project: choose one first.');
        return;
      }
      const up = await uploadFile(props.workspaceId, r.projectId, f);
      if (!up.ok) {
        setError(up.error.message);
        return;
      }
      fileIds.push(up.data.id);
    }
    if (
      await act('POST', '/messages', {
        body: reply.trim(),
        ...(internal ? { internal: true } : {}),
        ...(fileIds.length ? { fileIds } : {}),
      })
    ) {
      setReply('');
      setFiles([]);
      setInternal(false);
    }
  };

  return (
    <Card
      title={
        <>
          <span className="pv-mono pv-muted">{r.ref}</span> {r.title}
        </>
      }
      action={
        <Chip tone={r.closedAt ? 'neutral' : r.late ? 'danger' : 'success'}>{r.responseText}</Chip>
      }
    >
      {/* [PCODE-337 | S15 | v0.1.0] votes, a merge, the page a widget sent it from */}
      <RequestVotes
        base={props.base}
        request={r}
        team={props.team}
        go={props.go}
        onChanged={() => {
          void load();
          props.onChanged();
        }}
      />
      <ol className="pv-req-steps">
        {REQUEST_STEPS.map((s, i) => (
          <li key={s} className={i <= r.step ? 'pv-req-step pv-req-step--done' : 'pv-req-step'}>
            {s}
          </li>
        ))}
      </ol>
      {props.team ? (
        <div className="pv-kv pv-mt">
          <span>Client</span>
          <span>{r.clientName}</span>
          <span>Project</span>
          <span>
            <select
              className="v2-input v2-input--sm"
              aria-label="Project"
              value={r.projectId ?? ''}
              disabled={busy || Boolean(r.itemId)}
              onChange={(e) => void act('PATCH', '', { projectId: e.target.value || null })}
            >
              <option value="">No project yet</option>
              {(client?.projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key} · {p.name}
                </option>
              ))}
            </select>
          </span>
          <span>Task</span>
          <span>
            {r.itemId ? (
              <button
                type="button"
                className="pv-link-btn pv-mono"
                onClick={() => {
                  props.go('/items/' + (r.itemId ?? ''));
                }}
              >
                {r.itemRef}
              </button>
            ) : (
              <Button
                size="sm"
                icon="plus"
                disabled={busy || r.state === 'quoted' || Boolean(r.closedAt)}
                {...(r.state === 'quoted' ? { title: 'The quote waits for the client' } : {})}
                onClick={() => void act('POST', '/task', {})}
              >
                Make a task
              </Button>
            )}
          </span>
          <span>State</span>
          <span>
            <select
              className="v2-input v2-input--sm"
              aria-label="State"
              value={r.state}
              disabled={busy}
              onChange={(e) => void act('PATCH', '', { state: e.target.value })}
            >
              {[
                ['new', 'Received'],
                ['understood', 'Understood'],
                ...(r.impact ? [['quoted', 'Quoted']] : []),
                ['planned', 'Planned'],
                ['in_progress', 'In progress'],
                ['done', 'Done'],
                ['declined', 'Declined'],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </span>
          {r.requestedBy ? (
            <>
              <span>Filed by</span>
              <span>{r.requestedBy.name}</span>
            </>
          ) : null}
        </div>
      ) : null}
      {r.impact || quotable ? (
        <div className="pv-approval pv-mt">
          <div className="pv-row-main">
            <span className="pv-muted pv-small">
              {r.impact ? 'Quote' : 'No quote yet'}
              {r.approval
                ? r.approval.decision === 'approved'
                  ? ' · approved and signed by ' + r.approval.signedName
                  : ' · declined'
                : r.state === 'quoted'
                  ? ' · waiting for the client’s approval'
                  : ''}
            </span>
            {r.impact ? (
              <div className="pv-attach">
                {impactChips(r.impact).map((x) => (
                  <Chip key={x} tone="info">
                    {x}
                  </Chip>
                ))}
              </div>
            ) : null}
          </div>
          {quotable && !quote ? (
            <Button
              size="sm"
              onClick={() => {
                setQuote({
                  points: String(r.impact?.points ?? ''),
                  euro: r.impact ? String(r.impact.priceCents / 100) : '',
                  days: String(r.impact?.days ?? 0),
                });
              }}
            >
              {r.impact ? 'Change quote' : 'Quote the impact'}
            </Button>
          ) : null}
          {canSign && r.state === 'quoted' && !signing ? (
            <div className="pv-page-actions">
              <Button
                disabled={busy}
                onClick={() => void act('POST', '/decision', { decision: 'declined' })}
              >
                Decline
              </Button>
              <Button
                kind="primary"
                icon="signoff"
                onClick={() => {
                  setSigning(true);
                }}
              >
                Approve
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {quote ? (
        <div className="v2-inline pv-mt">
          <label className="v2-field">
            <span>Points</span>
            <input
              className="v2-input v2-input--sm"
              inputMode="decimal"
              value={quote.points}
              onChange={(e) => {
                setQuote({ ...quote, points: e.target.value });
              }}
            />
          </label>
          <label className="v2-field">
            <span>Price in €</span>
            <input
              className="v2-input v2-input--sm"
              inputMode="decimal"
              value={quote.euro}
              onChange={(e) => {
                setQuote({ ...quote, euro: e.target.value });
              }}
            />
          </label>
          <label className="v2-field">
            <span>Release moves by days</span>
            <input
              className="v2-input v2-input--sm"
              inputMode="numeric"
              value={quote.days}
              onChange={(e) => {
                setQuote({ ...quote, days: e.target.value });
              }}
            />
          </label>
          <Button
            kind="primary"
            size="sm"
            disabled={busy}
            onClick={() => {
              const points = Number(quote.points.replace(',', '.'));
              const euro = Number(quote.euro.replace(/\./g, '').replace(',', '.'));
              const days = Math.round(Number(quote.days));
              if (![points, euro, days].every(Number.isFinite)) {
                setError('Points, price and days are numbers.');
                return;
              }
              void act('PATCH', '', {
                impact: { points, priceCents: Math.round(euro * 100), days },
              }).then((ok) => {
                if (ok) setQuote(null);
              });
            }}
          >
            Send the quote
          </Button>
          <Button
            kind="ghost"
            size="sm"
            onClick={() => {
              setQuote(null);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
      {signing ? (
        <div className="pv-sign">
          <p className="pv-small">
            Signing approves <strong>{r.title}</strong> with the impact shown above. Your name, the
            time and a fingerprint of this quote are recorded.
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
              disabled={busy || name.trim().length < 3}
              onClick={() =>
                void act('POST', '/decision', {
                  decision: 'approved',
                  signedName: name.trim(),
                }).then((ok) => {
                  if (ok) setSigning(false);
                })
              }
            >
              Sign
            </Button>
          </div>
        </div>
      ) : null}
      <div className="pv-chat pv-chat--flat pv-mt">
        {d.messages.map((m) => (
          <div key={m.id} className={'pv-msg' + (m.author?.client ? '' : ' pv-msg--agent')}>
            <LiveAvatar id={m.author?.id ?? m.id} name={m.author?.name ?? '?'} size="sm" />
            <div className="pv-msg-body">
              <div className="pv-msg-head">
                <strong>{m.author?.name ?? 'Former member'}</strong>
                <span className="pv-muted pv-small">{whenText(m.createdAt)}</span>
              </div>
              {m.internal ? (
                <span className="pv-internal">
                  <PIcon name="lock" size={12} /> Internal: {m.body}
                </span>
              ) : (
                <p>{m.body}</p>
              )}
              {m.files.length ? (
                <div className="pv-attach">
                  {m.files.map((f) => (
                    <a
                      key={f.id}
                      className="pv-chip pv-chip--neutral"
                      href={props.base + '/files/' + f.id + '/content'}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <PIcon name="documents" size={12} />
                      {f.name}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {r.state === 'done' && !props.team && canWrite ? (
        <div className="pv-mt">
          <p className="pv-small">How did this go?</p>
          <div className="pv-stars" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={r.rating === n}
                aria-label={String(n) + (n === 1 ? ' star' : ' stars')}
                className={'pv-star' + (n <= (r.rating ?? 0) ? ' pv-star--on' : '')}
                onClick={() => void act('POST', '/rating', { rating: n })}
              >
                ★
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {props.team && r.rating ? (
        <p className="pv-small pv-muted pv-mt">Rated {r.rating} of 5 by the client.</p>
      ) : null}
      {canWrite ? (
        <div className="pv-composer pv-composer--flat">
          <textarea
            value={reply}
            placeholder={
              props.team
                ? internal
                  ? 'Internal note: the client never sees it…'
                  : 'Answer the client…'
                : 'Reply to your team…'
            }
            aria-label="Reply"
            onChange={(e) => {
              setReply(e.target.value);
            }}
          />
          <div className="pv-composer-row">
            <label className="pv-btn pv-btn--ghost pv-btn--sm">
              <PIcon name="documents" size={14} />
              {files.length
                ? String(files.length) + (files.length === 1 ? ' file' : ' files')
                : 'Attach'}
              <input
                type="file"
                multiple
                className="v2-file-hidden"
                onChange={(e) => {
                  setFiles(Array.from(e.target.files ?? []));
                }}
              />
            </label>
            {props.team ? (
              <label className="v2-switch">
                <input
                  type="checkbox"
                  checked={internal}
                  onChange={(e) => {
                    setInternal(e.target.checked);
                  }}
                />
                <span>Internal note</span>
              </label>
            ) : null}
            <span className="pv-spacer" />
            <Button
              kind="primary"
              size="sm"
              disabled={busy || !reply.trim()}
              onClick={() => void send()}
            >
              Send
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
