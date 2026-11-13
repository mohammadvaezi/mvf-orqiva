// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-271 | S15 | v0.1.0] Project tabs fixes from the deep UX check: handover double page, service accounts, lifecycle name, extraction duplicates, AI cases picker, webhook events, overdue sprint, tab overflow ──
// ── [PCODE-206 | S15 | v0.1.0] T17.4 Release management in the web app: trains, environments with promote and rollback, notes approval, backport, go/no-go notes, changelog ──
//    Why:  the release screens of the approved design on the T17 server. Environments in a row with what
//          runs on each, Promote (waiting for the approver where one is named) and Roll back; trains that
//          carry the releases of several projects, with go/no-go, ship and rollback; and per release the
//          notes approval, the backport of fixes to an older line, the go/no-go meeting and the changelog.
import { lineOf, trainStateText } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { PIcon } from '../preview/picons.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { Markdown } from './markdown.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
const dmy = (iso: string | null): string =>
  iso
    ? new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleDateString(fmtLocale())
    : '—';
const noLinks = { page: () => null, go: () => undefined };

// ── environments ──

export interface PipelineEnv {
  id: string;
  key: string;
  name: string;
  approver: { id: string; name: string } | null;
  running: { ref: string; at: string | null; by: string | null; trigger: string } | null;
  latest: { id: string; ref: string; status: string } | null;
  waiting: {
    id: string;
    ref: string;
    status: string;
    requestedBy: string | null;
    approver: string | null;
    from: string | null;
  } | null;
  ahead: { versions: string[]; tasks: number; fixes: number };
}

/** "11 tasks and 3 fixes are on Staging but not in Production (1.4.0, 1.4.1)." */
export function aheadText(from: PipelineEnv, to: PipelineEnv | undefined): string | null {
  if (!to || !from.ahead.versions.length) return null;
  const { tasks, fixes } = from.ahead;
  const parts = [
    tasks ? String(tasks) + (tasks === 1 ? ' task' : ' tasks') : '',
    fixes ? String(fixes) + (fixes === 1 ? ' fix' : ' fixes') : '',
  ].filter(Boolean);
  const what = parts.length ? parts.join(' and ') : 'Nothing new';
  const verb = tasks + fixes === 1 ? ' is' : ' are';
  return (
    what +
    verb +
    ' on ' +
    from.name +
    ' but not in ' +
    to.name +
    ' (' +
    from.ahead.versions.join(', ') +
    ').'
  );
}

export function Pipeline(props: {
  workspaceId: string;
  projectId: string;
  hub: EventHub;
  canEdit: boolean;
  isAdmin: boolean;
  meId: string;
  go: (p: string) => void;
}): ReactNode {
  const [envs, setEnvs] = useState<PipelineEnv[] | null>(null);
  const [error, setError] = useState('');
  const [rolling, setRolling] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    const r = await api<PipelineEnv[]>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/pipeline'),
    );
    if (r.ok) setEnvs(r.data);
    else setError(r.error.message);
  }, [props.workspaceId, props.projectId]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (e.projectid === props.projectId) void load();
    });
  }, [load, props.hub, props.projectId]);
  const call = async (method: 'POST' | 'PUT', path: string, body?: unknown): Promise<void> => {
    const r = await api(method, W(props.workspaceId, path), body);
    setError(r.ok ? '' : r.error.message);
    await load();
  };
  if (!envs) return <p className="pv-muted">{error || 'Loading environments…'}</p>;
  if (!envs.length)
    return (
      <Card>
        <div className="pv-empty">
          <PIcon name="releases" size={28} />
          <strong>No environments yet.</strong>
          <span>
            Add Staging and Production under Environments; then versions move here from one to the
            next.
          </span>
          <Button
            size="sm"
            onClick={() => {
              props.go('/projects/' + props.projectId + '/environments');
            }}
          >
            Set up environments
          </Button>
        </div>
      </Card>
    );
  return (
    <div className="pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pv-env-row">
        {envs.map((e, i) => {
          const next = envs[i + 1];
          const health =
            e.latest?.status === 'failed' ? 'failing' : e.running ? 'healthy' : 'empty';
          const waiting = e.waiting;
          const mayDecide = waiting && (e.approver?.id === props.meId || props.isAdmin);
          return (
            <div key={e.id} className="pv-env-wrap">
              <Card
                className={
                  'pv-env' +
                  (health === 'failing'
                    ? ' pv-env--degraded'
                    : health === 'healthy'
                      ? ' pv-env--healthy'
                      : '')
                }
              >
                <div className="pv-env-head">
                  <strong>{e.name}</strong>
                  <Chip
                    tone={
                      health === 'healthy' ? 'success' : health === 'failing' ? 'danger' : 'neutral'
                    }
                  >
                    {health === 'failing'
                      ? 'last deploy failed'
                      : health === 'healthy'
                        ? 'running'
                        : 'nothing yet'}
                  </Chip>
                </div>
                <div className="pv-mono pv-env-version">{e.running?.ref ?? '—'}</div>
                <div className="pv-muted pv-small">
                  {e.running
                    ? dmy(e.running.at) +
                      (e.running.by ? ' · ' + e.running.by : '') +
                      (e.running.trigger !== 'manual' ? ' (' + e.running.trigger + ')' : '')
                    : 'never deployed'}
                </div>
                <div className="pv-muted pv-small">
                  {e.approver
                    ? e.approver.name + ' approves promotions here'
                    : 'Promotions here deploy at once'}
                </div>
                {waiting ? (
                  <div className="pv-stack pv-mt">
                    <Chip tone="warning" icon="approval">
                      {'Promotion of ' +
                        waiting.ref +
                        ' requested · ' +
                        (waiting.approver ?? 'an admin') +
                        ' approves'}
                    </Chip>
                    {mayDecide ? (
                      <div className="v2-inline">
                        <input
                          className="v2-input v2-input--sm v2-grow"
                          aria-label="Note"
                          placeholder="Note (needed to decline)"
                          value={note}
                          onChange={(ev) => {
                            setNote(ev.target.value);
                          }}
                        />
                        <Button
                          size="sm"
                          kind="primary"
                          onClick={() =>
                            void call('POST', '/promotions/' + waiting.id + '/decision', {
                              approve: true,
                              ...(note.trim() ? { note: note.trim() } : {}),
                            })
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          disabled={!note.trim()}
                          onClick={() =>
                            void call('POST', '/promotions/' + waiting.id + '/decision', {
                              approve: false,
                              note: note.trim(),
                            })
                          }
                        >
                          Decline
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {props.canEdit ? (
                  <div className="pv-page-actions pv-mt">
                    {next && e.running && !next.waiting && next.running?.ref !== e.running.ref ? (
                      <Button
                        size="sm"
                        icon="arrowRight"
                        onClick={() => void call('POST', '/environments/' + next.id + '/promote')}
                      >
                        {'Promote ' + e.running.ref + ' to ' + next.name}
                      </Button>
                    ) : null}
                    {e.latest ? (
                      <Button
                        size="sm"
                        kind="ghost"
                        onClick={() => {
                          setRolling(rolling === e.id ? null : e.id);
                          setReason('');
                        }}
                      >
                        Roll back
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {rolling === e.id ? (
                  <form
                    className="v2-inline pv-mt"
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      if (reason.trim())
                        void call('POST', '/environments/' + e.id + '/rollback', {
                          reason: reason.trim(),
                        }).then(() => {
                          setRolling(null);
                        });
                    }}
                  >
                    <input
                      className="v2-input v2-input--sm v2-grow"
                      aria-label="Why roll back"
                      placeholder="Why roll back"
                      value={reason}
                      onChange={(ev) => {
                        setReason(ev.target.value);
                      }}
                    />
                    <button
                      type="submit"
                      className="pv-btn pv-btn--danger pv-btn--sm"
                      disabled={!reason.trim()}
                    >
                      Roll back
                    </button>
                  </form>
                ) : null}
              </Card>
              {next ? (
                <span className="pv-env-arrow">
                  <PIcon name="arrowRight" />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {envs.slice(0, -1).some((e, i) => aheadText(e, envs[i + 1])) ? (
        <Card title="Between the environments">
          <ul className="pv-changes">
            {envs.slice(0, -1).map((e, i) => {
              const t = aheadText(e, envs[i + 1]);
              return t ? <li key={e.id}>{t}</li> : null;
            })}
          </ul>
        </Card>
      ) : null}
      {props.isAdmin ? (
        <ApproverSettings
          envs={envs}
          workspaceId={props.workspaceId}
          onSet={(id, userId) => void call('PUT', '/environments/' + id + '/approver', { userId })}
        />
      ) : null}
      <p className="pv-muted pv-small">
        Who approves promotions into an environment is set per environment by an admin.{' '}
        <button
          type="button"
          className="pv-link-btn"
          onClick={() => {
            props.go('/projects/' + props.projectId + '/environments');
          }}
        >
          Environment settings
        </button>
      </p>
    </div>
  );
}

function ApproverSettings(props: {
  workspaceId: string;
  envs: PipelineEnv[];
  onSet: (envId: string, userId: string | null) => void;
}): ReactNode {
  const [people, setPeople] = useState<{ userId: string; name: string; role: string }[]>([]);
  useEffect(() => {
    // [PCODE-271 | S15 | v0.1.0] a person approves a promotion, not a machine account
    void api<{ userId: string; name: string; role: string; service?: boolean }[]>(
      'GET',
      W(props.workspaceId, '/members'),
    ).then((r) => {
      if (r.ok)
        setPeople(
          r.data.filter(
            (m) => !m.service && m.role !== 'guest' && m.role !== 'auditor' && m.role !== 'billing',
          ),
        );
    });
  }, [props.workspaceId]);
  return (
    <Card title="Who approves promotions" flush>
      <ul className="pv-rows">
        {props.envs.map((e) => (
          <li key={e.id} className="pv-row pv-row--static">
            <span className="pv-row-main">
              <span className="pv-row-title">{e.name}</span>
            </span>
            <select
              className="v2-input v2-input--sm"
              aria-label={'Approver for ' + e.name}
              value={e.approver?.id ?? ''}
              onChange={(ev) => {
                props.onSet(e.id, ev.target.value || null);
              }}
            >
              <option value="">Nobody: deploys at once</option>
              {people.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── trains ──

export interface TrainView {
  id: string;
  name: string;
  state: string;
  freezeAt: string | null;
  targetDate: string | null;
  note: string;
  shippedBy: string | null;
  shippedAt: string | null;
  rollbackReason: string;
  releases: {
    releaseId: string;
    projectId: string;
    projectKey: string;
    projectName: string;
    version: string;
    state: string;
    environmentId: string | null;
    environmentName: string | null;
    items: number;
    done: number;
    deploy: { id: string; status: string; ref: string } | null;
  }[];
}

export const TRAIN_TONE: Record<string, 'neutral' | 'warning' | 'info' | 'success' | 'danger'> = {
  planned: 'neutral',
  frozen: 'warning',
  shipping: 'info',
  shipped: 'success',
  partial: 'danger',
  rolling_back: 'warning',
  rolled_back: 'danger',
};

/** One line under a train: its releases and dates. */
export const trainLine = (t: TrainView): string =>
  (t.releases.map((r) => r.projectKey + ' ' + r.version).join(' · ') || 'no release yet') +
  (t.targetDate ? ' · ships ' + dmy(t.targetDate) : '') +
  (t.freezeAt ? ' · freeze ' + dmy(t.freezeAt) : '');

export function TrainList(props: {
  trains: TrainView[];
  open: string | null;
  onOpen: (id: string | null) => void;
}): ReactNode {
  return (
    <ul className="pv-rows">
      {props.trains.map((t) => (
        <li key={t.id} className="pv-row pv-row--static">
          <span className="pv-row-main">
            <button
              type="button"
              className="pv-link-btn v2-left"
              onClick={() => {
                props.onOpen(props.open === t.id ? null : t.id);
              }}
            >
              {'Train “' + t.name + '”'}
            </button>
            <span className="pv-row-sub">{trainLine(t)}</span>
          </span>
          <Chip tone={TRAIN_TONE[t.state] ?? 'neutral'}>{trainStateText(t.state)}</Chip>
        </li>
      ))}
      {!props.trains.length ? (
        <li className="pv-row pv-muted">
          No train yet. A train ships the releases of several projects at once.
        </li>
      ) : null}
    </ul>
  );
}

export function Trains(props: {
  workspaceId: string;
  hub: EventHub;
  canEdit: boolean;
  isAdmin: boolean;
  go: (p: string) => void;
}): ReactNode {
  const [trains, setTrains] = useState<TrainView[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<TrainView[]>('GET', W(props.workspaceId, '/trains'));
    if (r.ok) setTrains(r.data);
    else setError(r.error.message);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
    return props.hub.on(() => void load());
  }, [load, props.hub]);
  const current = trains?.find((t) => t.id === open) ?? null;
  return (
    <div className="pv-stack pv-mt">
      <Card
        title="Release trains"
        flush
        action={
          <span className="pv-muted pv-small">
            The releases of several projects that ship and roll back together
          </span>
        }
      >
        <TrainList trains={trains ?? []} open={open} onOpen={setOpen} />
        {props.canEdit ? (
          <form
            className="pv-ask pv-pad"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              void api<TrainView>('POST', W(props.workspaceId, '/trains'), {
                name: name.trim(),
                ...(date ? { targetDate: date } : {}),
              }).then((r) => {
                setError(r.ok ? '' : r.error.message);
                if (r.ok) {
                  setName('');
                  setOpen(r.data.id);
                }
                void load();
              });
            }}
          >
            <input
              value={name}
              maxLength={60}
              placeholder="New train, e.g. October"
              aria-label="Train name"
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
            <input
              type="date"
              value={date}
              aria-label="Ships on"
              onChange={(e) => {
                setDate(e.target.value);
              }}
            />
            <button
              type="submit"
              className="pv-btn pv-btn--secondary pv-btn--sm"
              disabled={!name.trim()}
            >
              Plan train
            </button>
          </form>
        ) : null}
        {error ? (
          <p className="v2-error pv-pad" role="alert">
            {error}
          </p>
        ) : null}
      </Card>
      {current ? (
        <TrainDetail
          workspaceId={props.workspaceId}
          train={current}
          canEdit={props.canEdit}
          go={props.go}
          onChange={() => void load()}
        />
      ) : null}
    </div>
  );
}

const DEPLOY_TONE: Record<string, 'neutral' | 'info' | 'success' | 'danger'> = {
  queued: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

interface TrainCheck {
  ready: boolean;
  releases: { project: string; version: string; ready: boolean; missing: string[] }[];
}

export function TrainTable(props: {
  train: TrainView;
  check: TrainCheck | null;
  go: (p: string) => void;
}): ReactNode {
  return (
    <div className="v2-table-wrap">
      <table className="pv-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Version</th>
            <th>Ships to</th>
            <th>Tasks</th>
            <th>Go / no-go</th>
            <th>Deploy</th>
          </tr>
        </thead>
        <tbody>
          {props.train.releases.map((r) => {
            const c = props.check?.releases.find((x) => x.project === r.projectKey);
            return (
              <tr key={r.releaseId}>
                <td>
                  <button
                    type="button"
                    className="pv-link-btn"
                    onClick={() => {
                      props.go('/projects/' + r.projectId + '/versions');
                    }}
                  >
                    {r.projectKey}
                  </button>{' '}
                  <span className="pv-muted pv-small">{r.projectName}</span>
                </td>
                <td className="pv-mono">{r.version}</td>
                <td>{r.environmentName ?? <span className="pv-muted">not set</span>}</td>
                <td className="pv-num">{String(r.done) + '/' + String(r.items)}</td>
                <td>
                  {c ? (
                    c.ready ? (
                      <Chip tone="success">go</Chip>
                    ) : (
                      <span className="pv-small">{c.missing.join('; ')}</span>
                    )
                  ) : (
                    <span className="pv-muted">—</span>
                  )}
                </td>
                <td>
                  {r.deploy ? (
                    <Chip tone={DEPLOY_TONE[r.deploy.status] ?? 'neutral'}>
                      {r.deploy.ref + ' ' + r.deploy.status}
                    </Chip>
                  ) : (
                    <span className="pv-muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {!props.train.releases.length ? (
            <tr>
              <td colSpan={6} className="pv-muted">
                No release on this train yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function TrainDetail(props: {
  workspaceId: string;
  train: TrainView;
  canEdit: boolean;
  go: (p: string) => void;
  onChange: () => void;
}): ReactNode {
  const t = props.train;
  const T = (p: string): string => W(props.workspaceId, '/trains/' + t.id + p);
  const [check, setCheck] = useState<TrainCheck | null>(null);
  const [candidates, setCandidates] = useState<{ id: string; label: string; projectId: string }[]>(
    [],
  );
  const [envs, setEnvs] = useState<Record<string, { id: string; name: string }[]>>({});
  const [pick, setPick] = useState('');
  const [env, setEnv] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [log, setLog] = useState<string | null>(null);
  const open = t.state === 'planned' || t.state === 'frozen';
  useEffect(() => {
    if (!open || !props.canEdit) return;
    void api<TrainCheck>('GET', T('/check')).then((r) => {
      if (r.ok) setCheck(r.data);
    });
    void api<{ projectId: string; key: string; next: { id: string; version: string } | null }[]>(
      'GET',
      W(props.workspaceId, '/release-overview'),
    ).then((r) => {
      if (!r.ok) return;
      setCandidates(
        r.data.flatMap((p) =>
          p.next && !t.releases.some((x) => x.releaseId === p.next?.id)
            ? [{ id: p.next.id, label: p.key + ' ' + p.next.version, projectId: p.projectId }]
            : [],
        ),
      );
    });
  }, [t, open, props.canEdit]);
  const pickedProject = candidates.find((x) => x.id === pick)?.projectId ?? '';
  useEffect(() => {
    if (!pickedProject || envs[pickedProject]) return;
    void api<{ id: string; name: string }[]>(
      'GET',
      W(props.workspaceId, '/projects/' + pickedProject + '/environments'),
    ).then((r) => {
      if (r.ok) setEnvs({ ...envs, [pickedProject]: r.data });
    });
  }, [pickedProject]);
  const act = async (method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<void> => {
    const r = await api(method, T(path), body);
    setError(r.ok ? '' : r.error.message);
    props.onChange();
  };
  return (
    <Card
      title={
        <>
          {'Train “' + t.name + '”'}{' '}
          <Chip tone={TRAIN_TONE[t.state] ?? 'neutral'}>{trainStateText(t.state)}</Chip>
        </>
      }
      action={
        <span className="pv-muted pv-small">
          {[
            t.targetDate ? 'ships ' + dmy(t.targetDate) : '',
            t.freezeAt ? 'freeze ' + dmy(t.freezeAt) : '',
            t.shippedAt
              ? 'shipped ' + dmy(t.shippedAt) + (t.shippedBy ? ' by ' + t.shippedBy : '')
              : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      }
    >
      <div className="pv-stack">
        <TrainTable train={t} check={check} go={props.go} />
        {t.rollbackReason ? (
          <div className="pv-callout pv-callout--warn">Rolled back: {t.rollbackReason}</div>
        ) : null}
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
        {props.canEdit && open ? (
          <div className="v2-inline">
            <select
              className="v2-input v2-input--sm"
              aria-label="Release to add"
              value={pick}
              onChange={(e) => {
                setPick(e.target.value);
                setEnv('');
              }}
            >
              <option value="">Add a project’s next release…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {pick ? (
              <select
                className="v2-input v2-input--sm"
                aria-label="Ships to"
                value={env}
                onChange={(e) => {
                  setEnv(e.target.value);
                }}
              >
                <option value="">Ships to…</option>
                {(envs[pickedProject] ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            ) : null}
            <Button
              size="sm"
              disabled={!pick}
              onClick={() =>
                void act('POST', '/releases', {
                  releaseId: pick,
                  ...(env ? { environmentId: env } : {}),
                }).then(() => {
                  setPick('');
                  setEnv('');
                })
              }
            >
              Add to the train
            </Button>
          </div>
        ) : null}
        {props.canEdit ? (
          <div className="pv-page-actions">
            {t.state === 'planned' ? (
              <Button kind="ghost" icon="snooze" onClick={() => void act('POST', '/freeze')}>
                Freeze the train
              </Button>
            ) : null}
            {open ? (
              <Button
                kind="primary"
                icon="releases"
                disabled={!check?.ready}
                title={
                  check?.ready
                    ? 'Ship every release and deploy it'
                    : 'A release still needs something'
                }
                onClick={() => void act('POST', '/ship')}
              >
                {'Ship the train (' + String(t.releases.length) + ')'}
              </Button>
            ) : null}
            {['shipping', 'shipped', 'partial'].includes(t.state) ? (
              <form
                className="v2-inline"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reason.trim()) void act('POST', '/rollback', { reason: reason.trim() });
                }}
              >
                <input
                  className="v2-input v2-input--sm"
                  aria-label="Why roll the train back"
                  placeholder="Why roll the train back"
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                  }}
                />
                <button
                  type="submit"
                  className="pv-btn pv-btn--danger pv-btn--sm"
                  disabled={!reason.trim()}
                >
                  Roll the train back
                </button>
              </form>
            ) : null}
            <Button
              kind="ghost"
              onClick={() =>
                void api<{ markdown: string }>('GET', T('/changelog')).then((r) => {
                  if (r.ok) setLog(log ? null : r.data.markdown);
                })
              }
            >
              {log ? 'Hide changelog' : 'Changelog'}
            </Button>
          </div>
        ) : null}
        {log ? <Markdown text={log} links={noLinks} /> : null}
      </div>
    </Card>
  );
}

// ── release extras ──

/** The older lines a fix can go back to: lines of shipped versions other than this one's, newest first. */
export function backportLines(version: string, shipped: readonly string[]): string[] {
  const here = lineOf(version);
  const lines = new Set(shipped.map(lineOf).filter((l): l is string => l !== null && l !== here));
  return [...lines].sort((a, b) => {
    const [am = 0, an = 0] = a.split('.').map(Number);
    const [bm = 0, bn = 0] = b.split('.').map(Number);
    return bm - am || bn - an;
  });
}

interface Meeting {
  decision: string;
  notes: string;
  attendees: string[];
  by: string;
  at: string;
}

export function ReleaseExtras(props: {
  workspaceId: string;
  releaseId: string;
  version: string;
  notesWritten: boolean;
  notesApprovedBy: string | null;
  notesApprovedAt: string | null;
  notesByAgent: boolean;
  projectId: string;
  fixes: { id: string; ref: string; title: string }[];
  canEdit: boolean;
  onChange: () => void;
}): ReactNode {
  const R = (p: string): string => W(props.workspaceId, '/releases/' + props.releaseId + p);
  const [shipped, setShipped] = useState<string[]>([]);
  useEffect(() => {
    void api<{ releases: { version: string; state: string }[] }>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/releases'),
    ).then((r) => {
      if (r.ok)
        setShipped(r.data.releases.filter((x) => x.state === 'released').map((x) => x.version));
    });
  }, [props.workspaceId, props.projectId]);
  const lines = backportLines(props.version, shipped);
  const [line, setLine] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [editing, setEditing] = useState(false);
  const [decision, setDecision] = useState<'go' | 'no_go'>('go');
  const [notes, setNotes] = useState('');
  const [who, setWho] = useState('');
  const [log, setLog] = useState<string | null>(null);
  useEffect(() => {
    void api<{ meeting: Meeting | null }>('GET', R('/go-no-go')).then((r) => {
      if (r.ok) setMeeting(r.data.meeting);
    });
  }, [props.releaseId]);
  const target = line || lines[0] || '';
  return (
    <div className="pv-split pv-split--even">
      <Card title="Release notes approval">
        <div className="pv-stack">
          {props.notesApprovedBy ? (
            <Chip tone="success" icon="signoff">
              {'Approved by ' + props.notesApprovedBy + ' · ' + dmy(props.notesApprovedAt)}
            </Chip>
          ) : props.notesWritten ? (
            <Chip tone="warning">written, not approved yet</Chip>
          ) : (
            <Chip>not written yet</Chip>
          )}
          {props.notesByAgent ? (
            <Chip tone="agent" icon="agents">
              written by the Release agent
            </Chip>
          ) : null}
          <p className="pv-muted pv-small">
            The client reads the notes in the portal once the release ships. A change to them asks
            for approval again.
          </p>
          <div className="v2-inline">
            {props.canEdit && props.notesWritten && !props.notesApprovedBy ? (
              <Button
                size="sm"
                kind="primary"
                icon="signoff"
                onClick={() =>
                  void api('POST', R('/notes/approve')).then((r) => {
                    setMsg(r.ok ? '' : r.error.message);
                    props.onChange();
                  })
                }
              >
                Approve the notes
              </Button>
            ) : null}
            <Button
              size="sm"
              kind="ghost"
              onClick={() =>
                void api<{ markdown: string }>('GET', R('/changelog')).then((r) => {
                  if (r.ok) setLog(log ? null : r.data.markdown);
                })
              }
            >
              {log ? 'Hide changelog' : 'Changelog entry'}
            </Button>
          </div>
          {log ? <pre className="v2-mono pv-small v2-break">{log}</pre> : null}
        </div>
      </Card>
      <Card title="Go / no-go meeting">
        <div className="pv-stack">
          {meeting && !editing ? (
            <>
              <Chip tone={meeting.decision === 'go' ? 'success' : 'danger'}>
                {meeting.decision === 'go' ? 'Go' : 'No-go'}
              </Chip>
              <span className="pv-muted pv-small">
                {meeting.by +
                  ' · ' +
                  dmy(meeting.at) +
                  (meeting.attendees.length ? ' · with ' + meeting.attendees.join(', ') : '')}
              </span>
              <Markdown text={meeting.notes} links={noLinks} />
            </>
          ) : null}
          {!meeting && !editing ? <p className="pv-muted pv-small">No meeting notes yet.</p> : null}
          {editing ? (
            <form
              className="pv-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void api<Meeting>('PUT', R('/go-no-go'), {
                  decision,
                  notes,
                  attendees: who
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                }).then((r) => {
                  if (r.ok) {
                    setMeeting(r.data);
                    setEditing(false);
                  } else setMsg(r.error.message);
                });
              }}
            >
              <select
                className="v2-input"
                aria-label="Decision"
                value={decision}
                onChange={(e) => {
                  setDecision(e.target.value === 'no_go' ? 'no_go' : 'go');
                }}
              >
                <option value="go">Go</option>
                <option value="no_go">No-go</option>
              </select>
              <input
                className="v2-input"
                aria-label="Who was there"
                placeholder="Who was there (comma separated)"
                value={who}
                onChange={(e) => {
                  setWho(e.target.value);
                }}
              />
              <textarea
                className="v2-input"
                rows={4}
                aria-label="Notes"
                placeholder="What was decided and why"
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                }}
              />
              <div className="v2-inline">
                <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm">
                  Save
                </button>
                <Button
                  size="sm"
                  kind="ghost"
                  onClick={() => {
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : props.canEdit ? (
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                setEditing(true);
                setDecision(meeting?.decision === 'no_go' ? 'no_go' : 'go');
                setNotes(meeting?.notes ?? '');
                setWho(meeting?.attendees.join(', ') ?? '');
              }}
            >
              {meeting ? 'Edit the meeting notes' : 'Go / no-go meeting notes'}
            </Button>
          ) : null}
        </div>
      </Card>
      {props.fixes.length && lines.length ? (
        <Card title="Backport fixes">
          <div className="pv-stack">
            <p className="pv-small pv-muted">
              Take fixes of {props.version} back to an older line: they go into its next patch
              release.
            </p>
            <ul className="pv-rows">
              {props.fixes.map((f) => (
                <li key={f.id} className="pv-row pv-row--static">
                  <label className="pv-row-main v2-check">
                    <input
                      type="checkbox"
                      checked={chosen.includes(f.id)}
                      disabled={!props.canEdit}
                      onChange={() => {
                        setChosen(
                          chosen.includes(f.id)
                            ? chosen.filter((x) => x !== f.id)
                            : [...chosen, f.id],
                        );
                      }}
                    />
                    <span>
                      <span className="pv-row-title">{f.title}</span>
                      <span className="pv-row-sub pv-mono">{f.ref}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {props.canEdit ? (
              <div className="v2-inline">
                <select
                  className="v2-input v2-input--sm"
                  aria-label="Line"
                  value={target}
                  onChange={(e) => {
                    setLine(e.target.value);
                  }}
                >
                  {lines.map((l) => (
                    <option key={l} value={l}>
                      {l + '.x'}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={!chosen.length || !target}
                  onClick={() =>
                    void api<{ version: string; created: boolean }>('POST', R('/backport'), {
                      line: target,
                      itemIds: chosen,
                    }).then((r) => {
                      setMsg(
                        r.ok
                          ? (r.data.created
                              ? 'Backported into the new hotfix '
                              : 'Backported into the hotfix ') + r.data.version
                          : r.error.message,
                      );
                      if (r.ok) setChosen([]);
                      props.onChange();
                    })
                  }
                >
                  {'Backport to ' + (target || '…') + '.x'}
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
      {msg ? (
        <p className="pv-small" role="status">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
