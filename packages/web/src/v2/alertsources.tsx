// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-340 | S15 | v0.1.0] T34.2a Automatic alerts from probes and failed deploys; Sentry and Alertmanager sources with signed webhooks ──
//    Why:  Incidents, Alert sources: the outside monitoring that sends alerts here, its webhook address and,
//          once, its secret with the lines to put into Alertmanager's configuration or Sentry's integration.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';

interface Source {
  id: string;
  kind: 'sentry' | 'alertmanager';
  name: string;
  projectId: string | null;
  url: string;
  received: number;
  lastAt: string | null;
  lastError: string;
}

/** The receiver to add to Alertmanager's configuration. */
export const alertmanagerSnippet = (url: string, secret: string): string =>
  [
    'receivers:',
    '  - name: orqiva',
    '    webhook_configs:',
    '      - url: ' + url,
    '        send_resolved: true',
    '        http_config:',
    '          authorization:',
    '            credentials: ' + secret,
  ].join('\n');

export function AlertSources(props: { workspaceId: string }): ReactNode {
  const W = '/api/workspaces/' + props.workspaceId;
  const [list, setList] = useState<Source[]>([]);
  const [projects, setProjects] = useState<{ id: string; key: string }[]>([]);
  const [kind, setKind] = useState<'alertmanager' | 'sentry'>('alertmanager');
  const [name, setName] = useState('');
  const [project, setProject] = useState('');
  const [secret, setSecret] = useState('');
  const [made, setMade] = useState<{ source: Source; secret: string } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const [s, p] = await Promise.all([
      api<Source[]>('GET', W + '/alert-sources'),
      api<{ id: string; key: string; archivedAt: string | null }[]>('GET', W + '/projects'),
    ]);
    if (s.ok) setList(s.data);
    else setError(s.error.message);
    if (p.ok) setProjects(p.data.filter((x) => !x.archivedAt));
  }, [W]);
  useEffect(() => {
    void load();
  }, [load]);
  const add = async (): Promise<void> => {
    const r = await api<{ source: Source; secret: string }>('POST', W + '/alert-sources', {
      kind,
      name: name.trim(),
      ...(project ? { projectId: project } : {}),
      ...(kind === 'sentry' && secret.trim() ? { secret: secret.trim() } : {}),
    });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    setMade(r.data);
    setName('');
    setSecret('');
    await load();
  };
  return (
    <div className="pv-stack">
      <p className="pv-muted pv-small">
        Status probes and deploys raise their own alerts. Here, outside monitoring sends its alerts
        too: a critical or error alert opens an incident, others are kept, and a resolved alert
        clears it.
      </p>
      {made ? (
        <Card title={'Connect ' + made.source.name}>
          <p className="pv-small">The secret is shown only now.</p>
          {made.source.kind === 'alertmanager' ? (
            <pre className="pv-snippet">{alertmanagerSnippet(made.source.url, made.secret)}</pre>
          ) : (
            <p className="pv-small">
              In Sentry, give the internal integration this webhook address:{' '}
              <code className="pv-mono">{made.source.url}</code>. Its client secret signs each
              alert.
            </p>
          )}
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setMade(null);
            }}
          >
            Done
          </Button>
        </Card>
      ) : null}
      <Card flush title="Alert sources">
        {error ? (
          <p className="v2-error pv-pad" role="alert">
            {error}
          </p>
        ) : null}
        {list.length ? (
          <table className="pv-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Project</th>
                <th>Address</th>
                <th className="pv-num">Alerts</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>{' '}
                    <Chip tone="neutral">{s.kind === 'sentry' ? 'Sentry' : 'Alertmanager'}</Chip>
                  </td>
                  <td className="pv-mono">
                    {projects.find((p) => p.id === s.projectId)?.key ?? 'any'}
                  </td>
                  <td className="pv-mono pv-small pv-cell-wrap">{s.url}</td>
                  <td className="pv-num">
                    {s.received}
                    {s.lastError ? (
                      <div className="pv-small pv-text-warning">{s.lastError}</div>
                    ) : null}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      kind="ghost"
                      onClick={() => {
                        void api('DELETE', W + '/alert-sources/' + s.id).then(() => load());
                      }}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pv-empty">No outside source yet.</p>
        )}
        <form
          className="pv-page-actions pv-pad"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void add();
          }}
        >
          <select
            className="v2-input v2-input--sm"
            aria-label="Kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value === 'sentry' ? 'sentry' : 'alertmanager');
            }}
          >
            <option value="alertmanager">Prometheus Alertmanager</option>
            <option value="sentry">Sentry</option>
          </select>
          <input
            className="v2-input v2-input--sm"
            aria-label="Name"
            placeholder="Name"
            maxLength={80}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <select
            className="v2-input v2-input--sm"
            aria-label="Project"
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
            }}
          >
            <option value="">Any project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key}
              </option>
            ))}
          </select>
          {kind === 'sentry' ? (
            <input
              className="v2-input v2-input--sm"
              type="password"
              aria-label="Client secret"
              placeholder="Sentry’s client secret"
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
              }}
            />
          ) : null}
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!name.trim() || (kind === 'sentry' && secret.trim().length < 16)}
          >
            Add a source
          </button>
        </form>
      </Card>
    </div>
  );
}
