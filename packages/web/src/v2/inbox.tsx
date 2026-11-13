// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
// ── [PCODE-249 | S15 | v0.1.0] T25.4 Alerts and reminders: budgets, anomalies, doc watchers, stale flags and ideas ──
// ── [PCODE-164 | S15 | v0.1.0] B1.3 The v2 shell live in the web app: Home per role, Inbox, Clients, portal mode, settings ──
//    Why:  the inbox of the approved design on the server's inbox: everything that needs this person,
//          filtered by kind, project and state; read, done, snooze, reopen and undo; keys j k e s z; an agent
//          run waiting for a decision is approved or rejected right here. Events refresh it.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { KIND } from '../preview/inbox.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Button, Chip, Kbd, PageHead } from '../preview/ui.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

export interface LiveInboxItem {
  id: string;
  kind: string;
  projectId: string | null;
  projectKey: string | null;
  objectType: string;
  objectId: string;
  title: string;
  detail: string;
  priority: string;
  state: string;
  snoozeUntil: string | null;
  dueAt: string | null;
  createdAt: string;
  readAt: string | null;
  url: string;
}

export interface InboxCounts {
  open: number;
  unread: number;
  snoozed: number;
  done: number;
  byKind: Record<string, number>;
}

/** 'all', 'snoozed', 'done' or one kind of entry */
type Filter = string;
type Action = 'read' | 'done' | 'snooze' | 'reopen';

// [PCODE-249 | S15 | v0.1.0] budget and spend alerts, watched pages, reminders
const MORE_KINDS: Record<string, { label: string; icon: PIconName }> = {
  // [PCODE-235 | S15 | v0.1.0] direct messages and replies in threads
  message: { label: 'Messages', icon: 'chat' },
  budget: { label: 'Budgets and spend', icon: 'euro' },
  watch: { label: 'Watched pages', icon: 'documents' },
  reminder: { label: 'Reminders', icon: 'clock' },
  security: { label: 'Security', icon: 'security' }, // [PCODE-322 | S15 | v0.1.0]
};
const kindOf = (k: string): { label: string; icon: PIconName } =>
  MORE_KINDS[k] ??
  (KIND as Record<string, { label: string; icon: PIconName }>)[k] ?? {
    label: k,
    icon: 'inbox',
  };

/** "4 min", "3 h", "2 d": how long ago. */
export function ago(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 60) return String(m) + ' min';
  if (m < 48 * 60) return String(Math.round(m / 60)) + ' h';
  return String(Math.round(m / 1440)) + ' d';
}

/** Tomorrow 08:00 local time: when a snoozed entry comes back. */
export const tomorrowMorning = (now = new Date()): string => {
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  t.setHours(8, 0, 0, 0);
  return t.toISOString();
};

export function InboxV2(props: {
  workspaceId: string;
  role: string;
  portal: boolean;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const base = '/api/workspaces/' + props.workspaceId + '/inbox';
  const [filter, setFilter] = useState<Filter>('all');
  const [projectId, setProjectId] = useState('all');
  const [items, setItems] = useState<LiveInboxItem[] | null>(null);
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState<{ id: string; key: string }[]>([]);

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    q.set('state', filter === 'snoozed' || filter === 'done' ? filter : 'open');
    if (filter !== 'all' && filter !== 'snoozed' && filter !== 'done') q.set('kind', filter);
    if (projectId !== 'all') q.set('projectId', projectId);
    const r = await api<{ items: LiveInboxItem[]; counts: InboxCounts }>(
      'GET',
      base + '?' + q.toString(),
    );
    if (r.ok) {
      setItems(r.data.items);
      setCounts(r.data.counts);
      setProjects((before) => {
        const all = new Map(before.map((p) => [p.id, p.key]));
        for (const i of r.data.items)
          if (i.projectId && i.projectKey) all.set(i.projectId, i.projectKey);
        return [...all]
          .map(([id, key]) => ({ id, key }))
          .sort((a, b) => a.key.localeCompare(b.key));
      });
    } else setError(r.error.message);
  }, [base, filter, projectId]);

  useEffect(() => {
    void load();
    return props.hub.on(() => void load());
  }, [load, props.hub]);

  const list = items ?? [];
  const current = list.find((i) => i.id === selected) ?? list[0] ?? null;

  const act = useCallback(
    async (item: LiveInboxItem, action: Action, remember = true) => {
      const r = await api(
        'POST',
        base + '/' + item.id,
        action === 'snooze' ? { action, until: tomorrowMorning() } : { action },
      );
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      if (remember && action !== 'read')
        setUndo({
          id: item.id,
          label:
            action === 'done'
              ? 'Marked done'
              : action === 'snooze'
                ? 'Snoozed until tomorrow 08:00'
                : 'Opened again',
        });
      await load();
    },
    [base, load],
  );

  // reading an entry marks it read
  useEffect(() => {
    if (current && !current.readAt && current.state === 'open') void act(current, 'read', false);
  }, [current?.id]);

  const doUndo = useCallback(async () => {
    if (!undo) return;
    await api('POST', base + '/' + undo.id, { action: 'reopen' });
    setUndo(null);
    await load();
  }, [undo, base, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const at = current ? list.indexOf(current) : -1;
      if (e.key === 'j' && list[at + 1]) setSelected(list[at + 1]?.id ?? null);
      else if (e.key === 'k' && at > 0) setSelected(list[at - 1]?.id ?? null);
      else if (e.key === 'e' && current)
        void act(current, current.state === 'done' ? 'reopen' : 'done');
      else if (e.key === 's' && current && current.state === 'open') void act(current, 'snooze');
      else if (e.key === 'z') void doUndo();
      else if (e.key === 'Enter' && current) props.go(current.url);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });

  const byKind = counts?.byKind ?? {};
  const filterButton = (
    f: Filter,
    label: string,
    icon: PIconName,
    n: number | undefined,
  ): ReactNode => (
    <button
      key={f}
      type="button"
      className="pv-filter"
      aria-pressed={filter === f}
      onClick={() => {
        setFilter(f);
        setSelected(null);
      }}
    >
      <PIcon name={icon} size={16} />
      <span>{label}</span>
      <span className="pv-filter-count">{n ?? 0}</span>
    </button>
  );

  return (
    <div className="pv-page pv-page--full">
      <PageHead
        title={props.portal ? 'Waiting for you' : 'Inbox'}
        sub={
          counts ? String(counts.open) + ' open · ' + String(counts.unread) + ' unread' : 'Loading…'
        }
        icon="inbox"
        actions={
          <>
            <span className="pv-hint">
              <Kbd>j</Kbd>
              <Kbd>k</Kbd> move <Kbd>e</Kbd> done <Kbd>s</Kbd> snooze <Kbd>z</Kbd> undo
            </span>
            <Button
              kind="ghost"
              icon="check"
              onClick={() => {
                void api('POST', base + '/read-all', {}).then(() => load());
              }}
            >
              Mark all read
            </Button>
          </>
        }
      />
      {error ? (
        <p className="v2-error" role="alert">
          {error}{' '}
          <button
            type="button"
            className="pv-link"
            onClick={() => {
              setError('');
            }}
          >
            Dismiss
          </button>
        </p>
      ) : null}
      {undo ? (
        <div className="v2-undo" role="status">
          {undo.label}.{' '}
          <button type="button" className="pv-link" onClick={() => void doUndo()}>
            Undo <Kbd>z</Kbd>
          </button>
        </div>
      ) : null}
      <div className="pv-inbox">
        <aside className="pv-inbox-filters" aria-label="Filters">
          {filterButton('all', 'All', 'inbox', counts?.open)}
          {[...Object.keys(KIND), ...Object.keys(MORE_KINDS)]
            .filter((k) => byKind[k] || filter === k)
            .map((k) => filterButton(k, kindOf(k).label, kindOf(k).icon, byKind[k]))}
          <div className="pv-filter-sep" />
          {filterButton('snoozed', 'Snoozed', 'snooze', counts?.snoozed)}
          {filterButton('done', 'Done', 'check', counts?.done)}
          <div className="pv-filter-sep" />
          <label className="pv-filter-select">
            <span>Project</span>
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setSelected(null);
              }}
            >
              <option value="all">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key}
                </option>
              ))}
            </select>
          </label>
        </aside>
        <ul className="pv-inbox-list" aria-label="Items">
          {list.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                className={'pv-inbox-item' + (i.readAt ? '' : ' pv-inbox-item--unread')}
                aria-current={current?.id === i.id ? 'true' : undefined}
                onClick={() => {
                  setSelected(i.id);
                }}
              >
                <span className={'pv-kind pv-kind--' + i.kind}>
                  <PIcon name={kindOf(i.kind).icon} size={15} />
                </span>
                <span className="pv-inbox-main">
                  <span className="pv-inbox-top">
                    <span className="pv-mono pv-inbox-project">{i.projectKey ?? ''}</span>
                    <span className="pv-inbox-from">{kindOf(i.kind).label.replace(/s$/, '')}</span>
                    <span className="pv-inbox-age">{ago(i.createdAt)}</span>
                  </span>
                  <span className="pv-inbox-title">{i.title}</span>
                </span>
                {i.priority === 'urgent' ? <span className="pv-urgent" title="Urgent" /> : null}
              </button>
            </li>
          ))}
          {items && !list.length ? (
            <li className="pv-empty">
              <PIcon name="check" size={28} />
              <strong>Nothing here.</strong>
              <span>Everything that needs you lands in this inbox, here and in VS Code.</span>
            </li>
          ) : null}
        </ul>
        <article className="pv-reader" aria-label="Item">
          {current ? (
            <Reader
              key={current.id}
              item={current}
              workspaceId={props.workspaceId}
              canDecide={
                !props.portal &&
                props.role !== 'guest' &&
                props.role !== 'auditor' &&
                props.role !== 'billing'
              }
              go={props.go}
              onAct={(a) => void act(current, a)}
              onDecided={() => void load()}
              onError={setError}
            />
          ) : (
            <div className="pv-empty">
              <span>{items ? 'Select an item.' : 'Loading…'}</span>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

function Reader(props: {
  item: LiveInboxItem;
  workspaceId: string;
  canDecide: boolean;
  go: (p: string) => void;
  onAct: (a: Action) => void;
  onDecided: () => void;
  onError: (m: string) => void;
}): ReactNode {
  const i = props.item;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean): Promise<void> => {
    setBusy(true);
    const r = await api(
      'POST',
      '/api/workspaces/' + props.workspaceId + '/agent-runs/' + i.objectId + '/decision',
      note.trim() ? { approve, note: note.trim() } : { approve },
    );
    setBusy(false);
    if (!r.ok) props.onError(r.error.message);
    else props.onDecided();
  };
  const decidable =
    props.canDecide && i.state === 'open' && i.kind === 'approval' && i.objectType === 'agent_run';
  return (
    <>
      <div className="pv-reader-head">
        <Chip icon={kindOf(i.kind).icon}>{kindOf(i.kind).label.replace(/s$/, '')}</Chip>
        {i.projectKey ? <Chip mono>{i.projectKey}</Chip> : null}
        {i.priority === 'urgent' || i.priority === 'high' ? (
          <Chip tone={i.priority === 'urgent' ? 'danger' : 'warning'}>
            {i.priority === 'urgent' ? 'Urgent' : 'High'}
          </Chip>
        ) : null}
        {i.dueAt ? (
          <Chip tone="warning">
            Due{' '}
            {new Date(i.dueAt).toLocaleString(fmtLocale(), {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </Chip>
        ) : null}
        {i.state === 'snoozed' && i.snoozeUntil ? (
          <Chip icon="snooze">
            Until{' '}
            {new Date(i.snoozeUntil).toLocaleString(fmtLocale(), {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </Chip>
        ) : null}
        {i.state === 'done' ? (
          <Chip tone="success" icon="check">
            Done
          </Chip>
        ) : null}
      </div>
      <h2 className="pv-reader-title">{i.title}</h2>
      <div className="pv-reader-from">
        <span className="pv-muted">{ago(i.createdAt)} ago</span>
      </div>
      {i.detail ? <p className="pv-reader-text">{i.detail}</p> : null}
      {decidable ? (
        <div className="pv-reader-box">
          <div className="pv-reader-box-title">Your decision</div>
          <label className="v2-field">
            <span className="pv-small pv-muted">Note for the agent (optional)</span>
            <textarea
              className="v2-input"
              rows={2}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </label>
        </div>
      ) : null}
      <div className="pv-reader-actions">
        {decidable ? (
          <>
            <Button kind="primary" icon="check" disabled={busy} onClick={() => void decide(true)}>
              Approve
            </Button>
            <Button kind="danger" icon="x" disabled={busy} onClick={() => void decide(false)}>
              Reject
            </Button>
          </>
        ) : null}
        <Button
          kind={decidable ? 'secondary' : 'primary'}
          icon="external"
          onClick={() => {
            props.go(i.url);
          }}
        >
          Open
        </Button>
        {i.state === 'open' ? (
          <>
            <Button
              icon="check"
              onClick={() => {
                props.onAct('done');
              }}
            >
              Done
            </Button>
            <Button
              kind="ghost"
              icon="snooze"
              onClick={() => {
                props.onAct('snooze');
              }}
            >
              Snooze
            </Button>
          </>
        ) : (
          <Button
            icon="inbox"
            onClick={() => {
              props.onAct('reopen');
            }}
          >
            Back to the inbox
          </Button>
        )}
      </div>
    </>
  );
}
