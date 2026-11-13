// ── [PCODE-268 | S15 | v0.1.0] Planning fixes from the UX check: sprint dates in the screen, link hint, bulk bar under the top bar ──
// ── [PCODE-254 | S15 | v0.1.0] T26.3 Flow and backlog: links, WIP limits, warnings, definition of done, triage, templates, recurring tasks ──
//    Why:  the flow rules on screen: a task's links and its definitions in the drawer, the sprint's warnings
//          for the board, the triage waiting above the backlog, and the project's templates with the ones
//          that repeat.
import { LINK_KINDS, REPEATS, type LinkKind } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

interface Link {
  id: string;
  kind: string;
  outgoing: boolean;
  text: string;
  item: { id: string; ref: string; title: string; state: string; open: boolean };
}

/** The drawer's links: what the task relates to, duplicates, blocks, or is blocked by. */
export function LinksPanel(props: {
  workspaceId: string;
  itemId: string;
  canEdit: boolean;
  onChanged: () => void;
  example?: string; // [PCODE-268 | S15 | v0.1.0] a task of the same project, as the hint
}): ReactNode {
  const [links, setLinks] = useState<Link[]>([]);
  const [kind, setKind] = useState<LinkKind | 'duplicate-of'>('relates');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Link[]>('GET', W(props.workspaceId, '/items/' + props.itemId + '/links'));
    if (r.ok) setLinks(r.data);
  }, [props.workspaceId, props.itemId]);
  useEffect(() => {
    void load();
  }, [load]);
  const add = async (): Promise<void> => {
    setError(null);
    const r =
      kind === 'duplicate-of'
        ? await api<Link[]>(
            'POST',
            W(props.workspaceId, '/items/' + props.itemId + '/duplicate-of'),
            { of: to.trim() },
          )
        : await api<Link[]>('POST', W(props.workspaceId, '/items/' + props.itemId + '/links'), {
            to: to.trim(),
            kind,
          });
    if (!r.ok) setError(r.error.message);
    else {
      setLinks(r.data);
      setTo('');
      if (kind === 'duplicate-of') props.onChanged();
    }
  };
  const remove = async (id: string): Promise<void> => {
    const r = await api('DELETE', W(props.workspaceId, '/item-links/' + id));
    if (!r.ok) setError(r.error.message);
    void load();
  };
  return (
    <div className="fl-block">
      <strong className="pv-small">Links</strong>
      {links.length ? (
        <ul className="fl-links">
          {links.map((l) => (
            <li key={l.id}>
              <span className="pv-muted">{l.text}</span>{' '}
              <span className={'pv-mono' + (l.item.open ? '' : ' fl-done')}>{l.item.ref}</span>{' '}
              {l.item.title} <span className="pv-muted pv-small">· {l.item.state}</span>
              {props.canEdit ? (
                <button
                  type="button"
                  className="pv-mini-btn"
                  aria-label={'Remove the link to ' + l.item.ref}
                  onClick={() => void remove(l.id)}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pv-muted pv-small">No links.</p>
      )}
      {props.canEdit ? (
        <div className="v2-inline">
          <select
            className="v2-input v2-input--sm"
            aria-label="Kind of link"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as LinkKind | 'duplicate-of');
            }}
          >
            {LINK_KINDS.map((k) => (
              <option key={k} value={k}>
                {k === 'relates' ? 'relates to' : k}
              </option>
            ))}
            <option value="duplicate-of">close as duplicate of</option>
          </select>
          <input
            className="v2-input v2-input--sm v2-mono"
            aria-label="Task"
            placeholder={props.example ?? 'KEY-12'}
            size={8}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
            }}
          />
          <Button size="sm" kind="ghost" disabled={!to.trim()} onClick={() => void add()}>
            Link
          </Button>
        </div>
      ) : null}
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The drawer's definitions of ready and done, ticked off on the task. */
export function ChecksPanel(props: {
  workspaceId: string;
  projectId: string;
  itemId: string;
  checks: { ready: string[]; done: string[] } | undefined;
  canEdit: boolean;
}): ReactNode {
  const [defs, setDefs] = useState<{ ready: string[]; done: string[] }>({ ready: [], done: [] });
  const [ticked, setTicked] = useState(props.checks ?? { ready: [], done: [] });
  useEffect(() => {
    setTicked(props.checks ?? { ready: [], done: [] });
  }, [props.itemId, props.checks]);
  useEffect(() => {
    void api<{ key: string; value: unknown }[]>(
      'GET',
      W(props.workspaceId, '/settings?projectId=' + props.projectId),
    ).then((r) => {
      if (!r.ok) return;
      const list = (k: string): string[] => {
        const v = r.data.find((s) => s.key === k)?.value;
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
      };
      setDefs({
        ready: list('planning.definition_of_ready'),
        done: list('planning.definition_of_done'),
      });
    });
  }, [props.workspaceId, props.projectId]);
  const tick = async (list: 'ready' | 'done', entry: string, on: boolean): Promise<void> => {
    const next = on ? [...ticked[list], entry] : ticked[list].filter((x) => x !== entry);
    setTicked({ ...ticked, [list]: next });
    await api('PUT', W(props.workspaceId, '/items/' + props.itemId + '/checks'), {
      list,
      ticked: next,
    });
  };
  const block = (list: 'ready' | 'done', title: string): ReactNode =>
    defs[list].length ? (
      <div className="fl-block">
        <strong className="pv-small">
          {title}{' '}
          <span className="pv-muted">
            {String(defs[list].filter((e) => ticked[list].includes(e)).length)} of{' '}
            {String(defs[list].length)}
          </span>
        </strong>
        {defs[list].map((e) => (
          <label key={e} className="v2-switch">
            <input
              type="checkbox"
              disabled={!props.canEdit}
              checked={ticked[list].includes(e)}
              onChange={(ev) => void tick(list, e, ev.target.checked)}
            />
            <span>{e}</span>
          </label>
        ))}
      </div>
    ) : null;
  return (
    <>
      {block('ready', 'Definition of ready')}
      {block('done', 'Definition of done')}
    </>
  );
}

export interface Warning {
  kind: string;
  itemId: string | null;
  ref: string | null;
  stateId: string | null;
  text: string;
}

/** The sprint's warnings, read again whenever `key` changes (the board's tasks). */
export function useWarnings(
  workspaceId: string,
  projectId: string,
  sprintId: string | null,
  key: unknown,
): Warning[] {
  const [list, setList] = useState<Warning[]>([]);
  useEffect(() => {
    if (!sprintId) {
      setList([]);
      return;
    }
    const t = setTimeout(() => {
      void api<Warning[]>(
        'GET',
        W(workspaceId, '/projects/' + projectId + '/warnings?sprintId=' + sprintId),
      ).then((r) => {
        if (r.ok) setList(r.data);
      });
    }, 300);
    return () => {
      clearTimeout(t);
    };
  }, [workspaceId, projectId, sprintId, key]);
  return list;
}

interface TriageRow {
  id: string;
  ref: string;
  title: string;
  kind: string;
  createdAt: string;
  source: string;
}

/** Above the backlog: what agents and outside tools filed, waiting for a person. */
export function TriageCard(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onChanged: () => void;
}): ReactNode {
  const [rows, setRows] = useState<TriageRow[]>([]);
  const [why, setWhy] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const r = await api<TriageRow[]>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/triage'),
    );
    if (r.ok) setRows(r.data);
  }, [props.workspaceId, props.projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!rows.length) return null;
  const decide = async (id: string, action: 'accept' | 'decline'): Promise<void> => {
    await api('POST', W(props.workspaceId, '/items/' + id + '/triage'), {
      action,
      ...(why[id] ? { reason: why[id] } : {}),
    });
    await load();
    props.onChanged();
  };
  return (
    <Card flush title={'Triage · ' + String(rows.length) + ' waiting'}>
      <ul className="pv-rows">
        {rows.map((r) => (
          <li key={r.id} className="pv-row pv-row--static">
            <span className="pv-row-main">
              <span className="pv-row-title">
                <button
                  type="button"
                  className="pv-link-btn pv-mono"
                  onClick={() => {
                    props.onOpen(r.id);
                  }}
                >
                  {r.ref}
                </button>{' '}
                {r.title} <Chip>{r.kind}</Chip>
              </span>
              <span className="pv-row-sub">from {r.source}</span>
            </span>
            {props.canEdit ? (
              <span className="v2-inline">
                <input
                  className="v2-input v2-input--sm"
                  aria-label={'Why decline ' + r.ref}
                  placeholder="why not (optional)"
                  value={why[r.id] ?? ''}
                  onChange={(e) => {
                    setWhy({ ...why, [r.id]: e.target.value });
                  }}
                />
                <Button size="sm" kind="primary" onClick={() => void decide(r.id, 'accept')}>
                  Take it
                </Button>
                <Button size="sm" kind="ghost" onClick={() => void decide(r.id, 'decline')}>
                  Decline
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

interface Template {
  id: string;
  name: string;
  title: string;
  kind: string;
  estimate: number | null;
  repeat: string;
  repeatOn: number | null;
  nextOn: string | null;
}
const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const repeatText = (t: Template): string =>
  t.repeat === 'daily'
    ? 'every day'
    : t.repeat === 'weekly'
      ? 'every ' + (DAY[t.repeatOn ?? 1] ?? '')
      : t.repeat === 'monthly'
        ? 'on day ' + String(t.repeatOn ?? 1) + ' of each month'
        : '';

/** The project's templates: make a task from one, add one, repeat one. */
export function TemplatesCard(props: {
  workspaceId: string;
  projectId: string;
  sprintId: string | null;
  canEdit: boolean;
  onMade: () => void;
}): ReactNode {
  const [list, setList] = useState<Template[]>([]);
  const [form, setForm] = useState<{
    name: string;
    title: string;
    kind: string;
    repeat: string;
    on: string;
  } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Template[]>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/templates'),
    );
    if (r.ok) setList(r.data);
  }, [props.workspaceId, props.projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  const use = async (t: Template, intoSprint: boolean): Promise<void> => {
    const r = await api<{ ref: string }>(
      'POST',
      W(props.workspaceId, '/templates/' + t.id + '/use'),
      {
        ...(intoSprint && props.sprintId ? { sprintId: props.sprintId } : {}),
      },
    );
    setMsg(r.ok ? r.data.ref + ' made from ' + t.name : r.error.message);
    if (r.ok) props.onMade();
  };
  const save = async (): Promise<void> => {
    if (!form) return;
    const r = await api(
      'POST',
      W(props.workspaceId, '/projects/' + props.projectId + '/templates'),
      {
        name: form.name.trim(),
        title: form.title.trim(),
        kind: form.kind,
        repeat: form.repeat,
        ...(form.repeat === 'weekly' || form.repeat === 'monthly'
          ? { repeatOn: Number(form.on) || 1 }
          : {}),
      },
    );
    if (!r.ok) setMsg(r.error.message);
    else {
      setForm(null);
      setMsg(null);
      void load();
    }
  };
  const remove = async (t: Template): Promise<void> => {
    await api('DELETE', W(props.workspaceId, '/templates/' + t.id));
    void load();
  };
  return (
    <Card
      flush
      title="Templates"
      action={
        props.canEdit && !form ? (
          <Button
            size="sm"
            icon="plus"
            onClick={() => {
              setForm({ name: '', title: '', kind: 'task', repeat: 'none', on: '1' });
            }}
          >
            Template
          </Button>
        ) : null
      }
    >
      {list.length ? (
        <ul className="pv-rows">
          {list.map((t) => (
            <li key={t.id} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">{t.name}</span>
                <span className="pv-row-sub">
                  {t.title} · {t.kind}
                  {t.repeat !== 'none' ? ' · ' + repeatText(t) + ', next ' + String(t.nextOn) : ''}
                </span>
              </span>
              {props.canEdit ? (
                <span className="v2-inline">
                  <Button size="sm" kind="ghost" onClick={() => void use(t, false)}>
                    To the backlog
                  </Button>
                  {props.sprintId ? (
                    <Button size="sm" kind="ghost" onClick={() => void use(t, true)}>
                      To the sprint
                    </Button>
                  ) : null}
                  <button
                    type="button"
                    className="pv-mini-btn"
                    aria-label={'Remove template ' + t.name}
                    onClick={() => void remove(t)}
                  >
                    ×
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pv-muted pv-small v2-pad">
          A template makes the same kind of task the same way; it can repeat daily, weekly or
          monthly.
        </p>
      )}
      {form ? (
        <div className="v2-inline v2-pad">
          <input
            className="v2-input v2-input--sm"
            aria-label="Template name"
            placeholder="Name"
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
            }}
          />
          <input
            className="v2-input v2-input--sm"
            aria-label="Task title"
            placeholder="Title of the task"
            value={form.title}
            onChange={(e) => {
              setForm({ ...form, title: e.target.value });
            }}
          />
          <select
            className="v2-input v2-input--sm"
            aria-label="Repeat"
            value={form.repeat}
            onChange={(e) => {
              setForm({ ...form, repeat: e.target.value });
            }}
          >
            {REPEATS.map((r) => (
              <option key={r} value={r}>
                {r === 'none' ? 'does not repeat' : r}
              </option>
            ))}
          </select>
          {form.repeat === 'weekly' ? (
            <select
              className="v2-input v2-input--sm"
              aria-label="Weekday"
              value={form.on}
              onChange={(e) => {
                setForm({ ...form, on: e.target.value });
              }}
            >
              {DAY.slice(1).map((d, i) => (
                <option key={d} value={String(i + 1)}>
                  {d}
                </option>
              ))}
            </select>
          ) : form.repeat === 'monthly' ? (
            <input
              className="v2-input v2-input--sm"
              aria-label="Day of the month"
              size={3}
              value={form.on}
              onChange={(e) => {
                setForm({ ...form, on: e.target.value });
              }}
            />
          ) : null}
          <Button
            size="sm"
            kind="primary"
            disabled={!form.name.trim() || !form.title.trim()}
            onClick={() => void save()}
          >
            Add
          </Button>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setForm(null);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
      {msg ? <p className="pv-small v2-pad">{msg}</p> : null}
    </Card>
  );
}
