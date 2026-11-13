// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-134 | S15 | v0.1.0] Show environments, secrets and live deploys in the web app ──
//    Why:  the infrastructure stage for people: where the project runs, which secrets it has (by name),
//          which runners can deploy it, a Deploy button, and each deploy step by step as the runner works.
import { ENVIRONMENT_KINDS, KIND_INFO, SECRET_NAME, type EnvironmentKind } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import type { EventHub } from './core/hub.js';
import { Icon } from './core/icons.js';
import { CopyField } from './account.js';
import { Card, EmptyState, follow } from './shell.js';
import { localTime } from './views.js';

export interface Environment {
  id: string;
  projectId: string;
  key: string;
  name: string;
  kind: EnvironmentKind;
  settings: Record<string, string>;
  healthUrl: string;
  deployOnGate: string | null;
  secrets: { name: string; updatedAt: string; updatedBy: string | null }[];
}

export interface Deploy {
  id: string;
  projectId: string;
  environmentId: string;
  environment: string;
  status: string;
  ref: string;
  trigger: string;
  requestedBy: string | null;
  runner: string | null;
  error: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DeployStep {
  seq: number;
  name: string;
  command: string;
  status: string;
  output: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
}

interface Runner {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
}

const W = (workspaceId: string, path: string): string => '/api/workspaces/' + workspaceId + path;
const ACTIVE = ['queued', 'running'];

const DEPLOY_TEXT: Record<string, string> = {
  queued: 'Waiting for a runner',
  running: 'Deploying',
  succeeded: 'Deployed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function DeployStatus(props: { status: string }): ReactNode {
  return (
    <span className={'pe-run-status pe-run-status--' + props.status}>
      {DEPLOY_TEXT[props.status] ?? props.status}
    </span>
  );
}

/** "deploy@staging.example:/srv/app" — the target in one line, from the plain settings. */
export function targetText(env: Pick<Environment, 'kind' | 'settings'>): string {
  const s = env.settings;
  switch (env.kind) {
    case 'compose':
      return (s['dir'] ?? '') + '/' + (s['file'] || 'compose.yaml');
    case 'ssh':
      return (s['user'] ? s['user'] + '@' : '') + (s['host'] ?? '') + ':' + (s['dir'] ?? '');
    case 'kubernetes':
      return (s['namespace'] ? s['namespace'] + ' · ' : '') + (s['manifest'] ?? '');
    case 'coolify':
      return s['url'] ?? '';
    default:
      return (s['dir'] ?? '') + (s['workspace'] ? ' · ' + s['workspace'] : '');
  }
}

/** The deploy command for a new runner, with its token. */
export const runnerCommand = (origin: string, token: string): string =>
  'orq runner --server ' + origin + ' --token ' + token;

export function EnvironmentsView(props: {
  workspaceId: string;
  projectId: string;
  canAdmin: boolean;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, projectId } = props;
  const [envs, setEnvs] = useState<Environment[] | null>(null);
  const [deploys, setDeploys] = useState<Deploy[]>([]);
  const [runners, setRunners] = useState<Runner[]>([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    const [e, d, r] = await Promise.all([
      api<Environment[]>('GET', W(workspaceId, '/projects/' + projectId + '/environments')),
      api<Deploy[]>('GET', W(workspaceId, '/projects/' + projectId + '/deploys')),
      api<Runner[]>('GET', W(workspaceId, '/runners')),
    ]);
    if (e.ok) setEnvs(e.data);
    else setError(e.error.message);
    if (d.ok) setDeploys(d.data);
    if (r.ok) setRunners(r.data);
  }, [workspaceId, projectId]);
  useEffect(() => {
    void load();
    return props.hub.on((ev) => {
      const t = ev.data.object.type;
      if (
        ev.type === 'orqiva.workspace.resync' ||
        ((t === 'deploy' || t === 'environment') && ev.data.verb !== 'progressed')
      )
        void load();
    });
  }, [load, props.hub]);

  const deploy = async (env: Environment): Promise<void> => {
    const r = await api<Deploy>('POST', W(workspaceId, '/environments/' + env.id + '/deploys'), {});
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    props.go('/deploys/' + r.data.id);
  };

  if (!envs) return <p className="pe-muted">{error || 'Loading…'}</p>;
  return (
    <div className="pe-stack">
      {error ? (
        <div className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
      <Card
        title="Environments"
        subtitle="Where this project runs. Deploys are done by a runner on a machine you choose."
        actions={
          props.canAdmin && !adding ? (
            <button
              type="button"
              className="pe-btn pe-btn--secondary"
              onClick={() => {
                setAdding(true);
              }}
            >
              <Icon name="plus" size={18} /> Add environment
            </button>
          ) : null
        }
      >
        {adding ? (
          <NewEnvironment
            onCancel={() => {
              setAdding(false);
            }}
            onSave={async (body) => {
              const r = await api(
                'POST',
                W(workspaceId, '/projects/' + projectId + '/environments'),
                body,
              );
              if (!r.ok) return r.error.details[0]?.message ?? r.error.message;
              setAdding(false);
              await load();
              return null;
            }}
          />
        ) : null}
        {envs.length === 0 && !adding ? (
          <EmptyState icon="server" title="No environments yet">
            Add staging first; it can deploy by itself when G1 is signed.
          </EmptyState>
        ) : (
          <ul className="pe-env-list">
            {envs.map((env) => {
              const last = deploys.find((d) => d.environmentId === env.id);
              const busy = last ? ACTIVE.includes(last.status) : false;
              return (
                <li key={env.id} className="pe-env">
                  <div className="pe-env-head">
                    <span className="pe-env-icon" aria-hidden="true">
                      <Icon name="server" size={20} />
                    </span>
                    <div className="pe-env-titles">
                      <h3 className="pe-env-name">{env.name}</h3>
                      <div className="pe-small pe-muted">
                        {KIND_INFO[env.kind].label} ·{' '}
                        <span className="pe-mono">{targetText(env)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="pe-btn pe-btn--primary"
                      disabled={busy}
                      onClick={() => {
                        void deploy(env);
                      }}
                    >
                      {busy ? 'Deploying…' : 'Deploy'}
                    </button>
                  </div>
                  <dl className="pe-defs">
                    <dt>Health</dt>
                    <dd>{env.healthUrl || 'no health check'}</dd>
                    <dt>Deploys by itself</dt>
                    <dd>
                      {env.deployOnGate
                        ? 'when ' + env.deployOnGate.toUpperCase() + ' is signed'
                        : 'no'}
                    </dd>
                    <dt>Last deploy</dt>
                    <dd>
                      {last ? (
                        <>
                          <a
                            href={'/deploys/' + last.id}
                            onClick={follow('/deploys/' + last.id, props.go)}
                          >
                            <DeployStatus status={last.status} />
                          </a>{' '}
                          {localTime(last.createdAt)}
                        </>
                      ) : (
                        'never'
                      )}
                    </dd>
                  </dl>
                  <Secrets
                    env={env}
                    canAdmin={props.canAdmin}
                    onSet={async (name, value) => {
                      const r = await api(
                        'PUT',
                        W(workspaceId, '/environments/' + env.id + '/secrets/' + name),
                        {
                          value,
                        },
                      );
                      if (!r.ok) return r.error.message;
                      await load();
                      return null;
                    }}
                    onRemove={async (name) => {
                      const r = await api(
                        'DELETE',
                        W(workspaceId, '/environments/' + env.id + '/secrets/' + name),
                      );
                      if (!r.ok) return r.error.message;
                      await load();
                      return null;
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Deploys" subtitle="Newest first; open one to follow it step by step.">
        {deploys.length === 0 ? (
          <p className="pe-muted">No deploys yet.</p>
        ) : (
          <table className="pe-grid-table" aria-label="Deploys">
            <thead>
              <tr>
                <th scope="col">Environment</th>
                <th scope="col">Status</th>
                <th scope="col">Started by</th>
                <th scope="col">Runner</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {deploys.map((d) => (
                <tr key={d.id}>
                  <td>
                    <a href={'/deploys/' + d.id} onClick={follow('/deploys/' + d.id, props.go)}>
                      {d.environment}
                    </a>
                  </td>
                  <td>
                    <DeployStatus status={d.status} />
                  </td>
                  <td className="pe-muted">
                    {d.trigger.startsWith('gate:')
                      ? d.trigger.slice(5).toUpperCase() + ' signed'
                      : (d.requestedBy ?? '—')}
                  </td>
                  <td className="pe-muted">{d.runner ?? '—'}</td>
                  <td className="pe-muted">{localTime(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Runners
        workspaceId={workspaceId}
        runners={runners}
        canAdmin={props.canAdmin}
        onChanged={() => void load()}
      />
    </div>
  );
}

function Secrets(props: {
  env: Environment;
  canAdmin: boolean;
  onSet: (name: string, value: string) => Promise<string | null>;
  onRemove: (name: string) => Promise<string | null>;
}): ReactNode {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const nameOk = SECRET_NAME.test(name);
  return (
    <div className="pe-secrets">
      <div className="pe-small pe-muted">Secrets (stored encrypted; values are never shown)</div>
      {props.env.secrets.length ? (
        <ul className="pe-secret-list">
          {props.env.secrets.map((k) => (
            <li key={k.name}>
              <Icon name="key" size={14} /> <span className="pe-mono">{k.name}</span>
              <span className="pe-small pe-muted">
                {k.updatedBy ? k.updatedBy + ', ' : ''}
                {localTime(k.updatedAt)}
              </span>
              {props.canAdmin ? (
                <button
                  type="button"
                  className="pe-btn pe-btn--text"
                  onClick={() => {
                    void props.onRemove(k.name).then((e) => {
                      setError(e ?? '');
                    });
                  }}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pe-small pe-muted">None.</p>
      )}
      {props.canAdmin ? (
        <form
          className="pe-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void props.onSet(name, value).then((err) => {
              setError(err ?? '');
              if (!err) {
                setName('');
                setValue('');
              }
            });
          }}
        >
          <input
            className="pe-input pe-mono"
            aria-label={'Secret name for ' + props.env.name}
            placeholder="NAME"
            value={name}
            onChange={(e) => {
              setName(e.target.value.toUpperCase());
            }}
          />
          <input
            className="pe-input"
            type="password"
            autoComplete="off"
            aria-label={'Secret value for ' + props.env.name}
            placeholder="value"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
            }}
          />
          <button type="submit" className="pe-btn pe-btn--secondary" disabled={!nameOk || !value}>
            {props.env.secrets.some((k) => k.name === name) ? 'Replace' : 'Add'}
          </button>
        </form>
      ) : null}
      {error ? (
        <div className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function NewEnvironment(props: {
  onSave: (body: Record<string, unknown>) => Promise<string | null>;
  onCancel: () => void;
}): ReactNode {
  const [key, setKey] = useState('staging');
  const [name, setName] = useState('Staging');
  const [kind, setKind] = useState<EnvironmentKind>('compose');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [healthUrl, setHealthUrl] = useState('');
  const [onGate, setOnGate] = useState('g1');
  const [error, setError] = useState('');
  const info = KIND_INFO[kind];
  return (
    <form
      className="pe-form-grid pe-form-grid--wide pe-env-form"
      onSubmit={(e) => {
        e.preventDefault();
        const clean = Object.fromEntries(Object.entries(settings).filter(([, v]) => v.trim()));
        void props
          .onSave({ key, name, kind, settings: clean, healthUrl, deployOnGate: onGate || null })
          .then((err) => {
            setError(err ?? '');
          });
      }}
    >
      <div className="pe-field">
        <label htmlFor="env-name">Name</label>
        <input
          id="env-name"
          className="pe-input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setKey(
              e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 30),
            );
          }}
        />
      </div>
      <div className="pe-field">
        <label htmlFor="env-kind">Deploy with</label>
        <select
          id="env-kind"
          className="pe-select"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as EnvironmentKind);
            setSettings({});
          }}
        >
          {ENVIRONMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_INFO[k].label}
            </option>
          ))}
        </select>
      </div>
      {info.settings.map((d) => (
        <div key={kind + d.key} className="pe-field">
          <label htmlFor={'env-' + d.key}>
            {d.label}
            {d.required ? '' : ' (optional)'}
          </label>
          <input
            id={'env-' + d.key}
            className="pe-input"
            placeholder={d.hint}
            value={settings[d.key] ?? ''}
            onChange={(e) => {
              setSettings({ ...settings, [d.key]: e.target.value });
            }}
          />
        </div>
      ))}
      <div className="pe-field">
        <label htmlFor="env-health">Health URL (optional)</label>
        <input
          id="env-health"
          className="pe-input"
          placeholder="https://staging.example.com/health"
          value={healthUrl}
          onChange={(e) => {
            setHealthUrl(e.target.value);
          }}
        />
      </div>
      <div className="pe-field">
        <label htmlFor="env-gate">Deploy by itself</label>
        <select
          id="env-gate"
          className="pe-select"
          value={onGate}
          onChange={(e) => {
            setOnGate(e.target.value);
          }}
        >
          <option value="">No, only with the Deploy button</option>
          <option value="g1">When G1 (go / no-go) is signed</option>
          <option value="g2">When G2 (environment ready) is signed</option>
          <option value="g3">When G3 (quality gate) is signed</option>
        </select>
      </div>
      {error ? (
        <div className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="pe-form-actions">
        <button type="submit" className="pe-btn pe-btn--primary" disabled={!key}>
          Add environment
        </button>
        <button type="button" className="pe-btn pe-btn--secondary" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Runners(props: {
  workspaceId: string;
  runners: Runner[];
  canAdmin: boolean;
  onChanged: () => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  return (
    <Card
      title="Runners"
      subtitle="Programs that deploy for this workspace, on machines you run. A runner uses your own Docker, SSH, kubectl or OpenTofu."
    >
      {props.runners.length ? (
        <ul className="pe-secret-list">
          {props.runners.map((r) => (
            <li key={r.id}>
              <Icon name="server" size={14} /> {r.name}
              <span className="pe-small pe-muted">
                {r.lastSeenAt ? 'last seen ' + localTime(r.lastSeenAt) : 'not connected yet'}
              </span>
              {props.canAdmin ? (
                <button
                  type="button"
                  className="pe-btn pe-btn--text"
                  onClick={() => {
                    void api('DELETE', W(props.workspaceId, '/runners/' + r.id)).then(() => {
                      props.onChanged();
                    });
                  }}
                >
                  Revoke
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pe-muted">No runner yet: deploys wait until one connects.</p>
      )}
      {props.canAdmin ? (
        <form
          className="pe-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void api<{ token: string }>('POST', W(props.workspaceId, '/runners'), {
              name: name.trim(),
            }).then((r) => {
              if (!r.ok) {
                setError(r.error.message);
                return;
              }
              setError('');
              setName('');
              setToken(r.data.token);
              props.onChanged();
            });
          }}
        >
          <input
            className="pe-input"
            aria-label="Runner name"
            placeholder="Where it runs, e.g. build server"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <button type="submit" className="pe-btn pe-btn--secondary" disabled={!name.trim()}>
            Add runner
          </button>
        </form>
      ) : null}
      {token ? (
        <div className="pe-notice-ok" role="status">
          <CopyField
            label="Start it on that machine (the token is shown only now)"
            value={runnerCommand(window.location.origin, token)}
          />
        </div>
      ) : null}
      {error ? (
        <div className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
    </Card>
  );
}

// ── one deploy, live ──

export function DeployPage(props: {
  workspaceId: string;
  deployId: string;
  hub: EventHub;
  go: (p: string) => void;
}): ReactNode {
  const { workspaceId, deployId } = props;
  const [data, setData] = useState<{ deploy: Deploy; steps: DeployStep[] } | null | 'missing'>(
    null,
  );
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ deploy: Deploy; steps: DeployStep[] }>(
      'GET',
      W(workspaceId, '/deploys/' + deployId),
    );
    setData(r.ok ? r.data : 'missing');
  }, [workspaceId, deployId]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (e.type === 'orqiva.workspace.resync' || e.data.object.id === deployId) void load();
    });
  }, [load, props.hub, deployId]);
  if (data === 'missing')
    return (
      <div className="pe-page">
        <EmptyState icon="server" title="This deploy does not exist or you cannot see it" />
      </div>
    );
  if (!data) return <div className="pe-page pe-muted">Loading…</div>;
  const { deploy, steps } = data;
  const active = ACTIVE.includes(deploy.status);
  return (
    <div className="pe-page">
      <header className="pe-page-header">
        <div className="pe-page-header-row">
          <div className="pe-page-titles">
            <div className="pe-eyebrow">
              <a
                href={'/projects/' + deploy.projectId + '/environments'}
                onClick={follow('/projects/' + deploy.projectId + '/environments', props.go)}
              >
                Environments
              </a>
            </div>
            <h1 className="pe-page-title">Deploy to {deploy.environment}</h1>
            <p className="pe-page-subtitle">
              {deploy.trigger.startsWith('gate:')
                ? 'Started when ' + deploy.trigger.slice(5).toUpperCase() + ' was signed'
                : 'Started by ' + (deploy.requestedBy ?? 'someone')}
              {deploy.ref ? ' · ' + deploy.ref : ''} · {localTime(deploy.createdAt)}
              {deploy.runner ? ' · runner ' + deploy.runner : ''}
            </p>
          </div>
          <div className="pe-page-actions">
            <DeployStatus status={deploy.status} />
            {active ? (
              <button
                type="button"
                className="pe-btn pe-btn--secondary"
                onClick={() => {
                  void api('POST', W(workspaceId, '/deploys/' + deployId + '/cancel')).then((r) => {
                    if (!r.ok) setError(r.error.message);
                    void load();
                  });
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      </header>
      <div className="pe-stack">
        {error ? (
          <div className="pe-field-error" role="alert">
            {error}
          </div>
        ) : null}
        {deploy.status === 'failed' && deploy.error ? (
          <div className="pe-notice" role="alert">
            {deploy.error}
          </div>
        ) : null}
        <Card
          title="Steps"
          subtitle={
            active
              ? 'Live: each step appears as the runner takes it.'
              : 'Everything the runner did.'
          }
        >
          {steps.length === 0 ? (
            <p className="pe-muted">
              {deploy.status === 'queued' ? 'Waiting for a runner to take it…' : 'No steps.'}
            </p>
          ) : (
            <ol className="pe-run-steps" aria-label="Steps">
              {steps.map((st) => (
                <li key={st.seq} className={'pe-run-step pe-deploy-step--' + st.status}>
                  <span className="pe-run-step-icon" aria-hidden="true">
                    <Icon
                      name={st.status === 'ok' ? 'task' : st.status === 'failed' ? 'close' : 'dot'}
                      size={16}
                    />
                  </span>
                  <div className="pe-run-step-body">
                    <div className="pe-run-step-title">
                      {st.name}{' '}
                      <span className="pe-small pe-muted">
                        {st.status === 'running' ? 'running…' : st.status}
                        {st.exitCode !== null ? ' · exit ' + String(st.exitCode) : ''}
                      </span>
                    </div>
                    {st.command ? (
                      <div className="pe-mono pe-small pe-muted">{st.command}</div>
                    ) : null}
                    {st.output ? <pre className="pe-run-pre">{st.output}</pre> : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
