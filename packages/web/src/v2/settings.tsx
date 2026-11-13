// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-421 | S15 | v0.1.0] T37 medium: Members can pick their own language ──
// ── [PCODE-356 | S15 | v0.1.0] T35.5a Translation layer for a German UI, language choice, text extraction ──
// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
// ── [PCODE-249 | S15 | v0.1.0] T25.4 Alerts and reminders: budgets, anomalies, doc watchers, stale flags and ideas ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-164 | S15 | v0.1.0] B1.3 The v2 shell live in the web app: Home per role, Inbox, Clients, portal mode, settings ──
//    Why:  two parts of Settings from the approved design on the server's rules: which event reaches this
//          person on which channel (one matrix, in-app always on), and the workspace's settings with the
//          scope each value comes from (yours, the project's, the team's, the workspace's or the default).
//          Admins set workspace values; everyone sets their own where a setting allows it.
import { SETTINGS } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { applyLanguage } from '../i18n/language.js'; // [PCODE-356 | S15 | v0.1.0]

/** Pages of the classic app use these parts; they carry the v2 look of their own. */
export function V2Part(props: { children: ReactNode }): ReactNode {
  return <div className="pv-app v2-part">{props.children}</div>;
}

const EVENT_LABELS: Record<string, [string, string]> = {
  approvals: ['Approvals', 'an agent run or a change waits for your decision'],
  gates: ['Gates and sign-offs', 'a lifecycle gate waits for you, or was signed'],
  deploys: ['Deploys', 'a deploy you started or own finished or failed'],
  mentions: ['Mentions', 'someone wrote @you'],
  requests: ['Client requests', 'a client asked for something in the portal'],
  incidents: ['Incidents', 'an incident opened or changed severity'],
  digest: ['Daily digest', 'one summary each morning'],
  // [PCODE-249 | S15 | v0.1.0]
  budgets: [
    'Budgets and spend',
    'a budget reached its warning or ran out, or a day cost far more than usual',
  ],
  watching: ['Watched pages', 'someone changed or commented on a page you watch'],
  reminders: ['Reminders', 'a flag nobody touched, or an idea that went quiet'],
  // [PCODE-322 | S15 | v0.1.0]
  security: ['Security', 'a CVE in a version that shipped, or one found exploited'],
};

const CHANNEL_LABELS: Record<string, string> = {
  in_app: 'In app',
  email: 'E-mail',
  push: 'Push',
  slack: 'Slack',
  teams: 'Teams',
  ide: 'VS Code',
};

export function NotificationRules(props: { workspaceId: string }): ReactNode {
  const base = '/api/workspaces/' + props.workspaceId + '/notification-rules';
  const [data, setData] = useState<{
    channels: string[];
    rules: { eventKind: string; channels: string[] }[];
  } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ channels: string[]; rules: { eventKind: string; channels: string[] }[] }>(
      'GET',
      base,
    );
    if (r.ok) setData(r.data);
    else setError(r.error.message);
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);
  const toggle = async (eventKind: string, channel: string, on: boolean): Promise<void> => {
    const rule = data?.rules.find((x) => x.eventKind === eventKind);
    if (!rule) return;
    const channels = on ? [...rule.channels, channel] : rule.channels.filter((c) => c !== channel);
    setData((d) =>
      d
        ? { ...d, rules: d.rules.map((x) => (x.eventKind === eventKind ? { ...x, channels } : x)) }
        : d,
    );
    const r = await api('PUT', base + '/' + eventKind, { channels });
    if (!r.ok) {
      setError(r.error.message);
      await load();
    }
  };
  return (
    <V2Part>
      <Card title="What reaches you, and where" flush>
        {error ? (
          <p className="v2-error v2-pad" role="alert">
            {error}
          </p>
        ) : null}
        {!data ? (
          <p className="pv-muted v2-pad" role="status">
            Loading…
          </p>
        ) : (
          <div className="v2-scroll">
            <table className="pv-table v2-matrix">
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  {data.channels.map((c) => (
                    <th key={c} scope="col">
                      {CHANNEL_LABELS[c] ?? c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rules.map((r) => (
                  <tr key={r.eventKind}>
                    <th scope="row">
                      <span className="v2-matrix-label">
                        {EVENT_LABELS[r.eventKind]?.[0] ?? r.eventKind}
                      </span>
                      <span className="pv-small pv-muted">
                        {EVENT_LABELS[r.eventKind]?.[1] ?? ''}
                      </span>
                    </th>
                    {data.channels.map((c) => (
                      <td key={c}>
                        <input
                          type="checkbox"
                          aria-label={
                            (EVENT_LABELS[r.eventKind]?.[0] ?? r.eventKind) +
                            ' by ' +
                            (CHANNEL_LABELS[c] ?? c)
                          }
                          checked={r.channels.includes(c)}
                          onChange={(e) => void toggle(r.eventKind, c, e.target.checked)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="pv-small pv-muted v2-pad">
          Quiet hours from your profile hold push back; everything still lands in the inbox. Slack
          and Teams arrive when their connections are set up.
        </p>
      </Card>
    </V2Part>
  );
}

interface Effective {
  key: string;
  label: string;
  kind: string;
  value: unknown;
  source: string;
  scopes: string[];
}

/** [PCODE-351 | S15 | v0.1.0] The scopes a person may set a setting at, here: their own, and the shared ones in view. */
export function editableScopes(
  allowed: readonly string[],
  ctx: { admin: boolean; teamId: string; projectId: string },
): string[] {
  return allowed.filter(
    (x) =>
      x === 'user' ||
      (x === 'workspace' && ctx.admin) ||
      (x === 'team' && Boolean(ctx.teamId)) ||
      (x === 'project' && Boolean(ctx.projectId)),
  );
}

const SOURCE_LABEL: Record<string, string> = {
  user: 'Yours',
  project: 'Project',
  team: 'Team',
  workspace: 'Workspace',
  default: 'Default',
};

export const showValue = (v: unknown): string =>
  Array.isArray(v)
    ? v.join(', ')
    : v !== null && typeof v === 'object'
      ? Object.values(v as Record<string, unknown>).join(' – ')
      : typeof v === 'boolean'
        ? v
          ? 'Yes'
          : 'No'
        : String(v);

export function InheritedSettings(props: { workspaceId: string; role: string }): ReactNode {
  const base = '/api/workspaces/' + props.workspaceId + '/settings';
  const admin = props.role === 'admin' || props.role === 'owner';
  const [list, setList] = useState<Effective[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  // [PCODE-351 | S15 | v0.1.0] the team and the project whose values are shown, and set
  const [teamId, setTeamId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; key: string; name: string }[]>([]);
  const scopeId = (scope: string): string | undefined =>
    scope === 'team' ? teamId : scope === 'project' ? projectId : undefined;
  useEffect(() => {
    const ws = '/api/workspaces/' + props.workspaceId;
    void Promise.all([
      api<{ id: string; name: string }[]>('GET', ws + '/teams'),
      api<{ id: string; key: string; name: string; archivedAt: string | null }[]>(
        'GET',
        ws + '/projects',
      ),
    ]).then(([t, p]) => {
      if (t.ok && Array.isArray(t.data)) setTeams(t.data);
      if (p.ok) setProjects(p.data.filter((x) => !x.archivedAt));
    });
  }, [props.workspaceId]);
  const load = useCallback(async () => {
    const q = [teamId ? 'teamId=' + teamId : '', projectId ? 'projectId=' + projectId : '']
      .filter(Boolean)
      .join('&');
    const r = await api<Effective[]>('GET', base + (q ? '?' + q : ''));
    if (r.ok) setList(r.data);
    else setError(r.error.message);
  }, [base, teamId, projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (key: string, scope: string, value: unknown): Promise<void> => {
    const id = scopeId(scope);
    const r = await api('PUT', base + '/' + key, { scope, value, ...(id ? { scopeId: id } : {}) });
    if (!r.ok) setError(r.error.message);
    else {
      setError('');
      setEditing(null);
      // [PCODE-356 | S15 | v0.1.0] one's own language shows at once
      if (key === 'locale.language' && scope === 'user' && (value === 'de' || value === 'en'))
        void applyLanguage(value);
      await load();
    }
  };
  const reset = async (key: string, scope: string): Promise<void> => {
    const id = scopeId(scope);
    const r = await api(
      'DELETE',
      base + '/' + key + '?scope=' + scope + (id ? '&scopeId=' + id : ''),
    );
    if (!r.ok) setError(r.error.message);
    await load();
  };
  return (
    <V2Part>
      <Card title="Settings and where they come from" flush>
        {/* [PCODE-351 | S15 | v0.1.0] the values of a team and a project */}
        <div className="v2-inline v2-pad">
          <span className="pv-small pv-muted">Show the values for</span>
          <select
            className="v2-input v2-input--sm"
            aria-label="Team"
            value={teamId}
            onChange={(e) => {
              setTeamId(e.target.value);
              setEditing(null);
            }}
          >
            <option value="">no team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                Team {t.name}
              </option>
            ))}
          </select>
          <select
            className="v2-input v2-input--sm"
            aria-label="Project"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setEditing(null);
            }}
          >
            <option value="">no project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} {p.name}
              </option>
            ))}
          </select>
        </div>
        {error ? (
          <p className="v2-error v2-pad" role="alert">
            {error}
          </p>
        ) : null}
        {!list ? (
          <p className="pv-muted v2-pad" role="status">
            Loading…
          </p>
        ) : (
          <ul className="pv-rows">
            {list.map((s) => {
              const scopes = editableScopes(s.scopes, { admin, teamId, projectId }); // [PCODE-351 | S15 | v0.1.0]
              return (
                <li key={s.key} className="pv-row v2-setting">
                  <span className="pv-row-main">
                    <span className="pv-row-title">{s.label}</span>
                    {editing === s.key ? (
                      <SettingEditor
                        setting={s}
                        scopes={scopes}
                        onSave={(scope, v) => void save(s.key, scope, v)}
                        onCancel={() => {
                          setEditing(null);
                        }}
                      />
                    ) : (
                      <span className="pv-row-sub">{showValue(s.value)}</span>
                    )}
                  </span>
                  <Chip
                    tone={
                      s.source === 'default' ? 'neutral' : s.source === 'user' ? 'primary' : 'info'
                    }
                  >
                    {SOURCE_LABEL[s.source] ?? s.source}
                  </Chip>
                  {editing !== s.key && scopes.length ? (
                    <Button
                      size="sm"
                      kind="ghost"
                      onClick={() => {
                        setEditing(s.key);
                      }}
                    >
                      Change
                    </Button>
                  ) : null}
                  {s.source === 'user' ||
                  (admin && s.source === 'workspace') ||
                  (s.source === 'team' && teamId) ||
                  (s.source === 'project' && projectId) ? (
                    <Button
                      size="sm"
                      kind="ghost"
                      title="Use the inherited value again"
                      onClick={() => void reset(s.key, s.source)}
                    >
                      Reset
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="pv-small pv-muted v2-pad">
          The most specific value wins: yours, then the project's, the team's, the workspace's, then
          the default.
        </p>
      </Card>
    </V2Part>
  );
}

function SettingEditor(props: {
  setting: Effective;
  scopes: string[];
  onSave: (scope: string, value: unknown) => void;
  onCancel: () => void;
}): ReactNode {
  const s = props.setting;
  const [scope, setScope] = useState(props.scopes[0] ?? 'user');
  const [value, setValue] = useState<unknown>(s.value);
  const [text, setText] = useState(JSON.stringify(s.value));
  const options = SETTINGS.find((d) => d.key === s.key)?.options;
  let input: ReactNode;
  if (s.kind === 'boolean')
    input = (
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => {
          setValue(e.target.checked);
        }}
        aria-label={s.label}
      />
    );
  else if (s.kind === 'number')
    input = (
      <input
        className="v2-input"
        type="number"
        value={String(value)}
        onChange={(e) => {
          setValue(Number(e.target.value));
        }}
        aria-label={s.label}
      />
    );
  else if (s.kind === 'string' && options)
    input = (
      <select
        className="v2-input"
        value={String(value)}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        aria-label={s.label}
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  else if (s.kind === 'string')
    input = (
      <input
        className="v2-input"
        value={String(value)}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        aria-label={s.label}
      />
    );
  else if (s.kind === 'strings' && options) {
    const set = new Set(Array.isArray(value) ? (value as string[]) : []);
    input = (
      <span className="v2-switches">
        {options.map((o) => (
          <label key={o} className="v2-switch">
            <input
              type="checkbox"
              checked={set.has(o)}
              onChange={(e) => {
                const next = new Set(set);
                if (e.target.checked) next.add(o);
                else next.delete(o);
                setValue(options.filter((x) => next.has(x)));
              }}
            />
            <span>{o}</span>
          </label>
        ))}
      </span>
    );
  } else
    input = (
      <textarea
        className="v2-input v2-mono"
        rows={2}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        aria-label={s.label}
      />
    );
  const json = s.kind === 'object' || (s.kind === 'strings' && !options);
  let parsed: unknown = value;
  let bad = false;
  if (json)
    try {
      parsed = JSON.parse(text);
    } catch {
      bad = true;
    }
  return (
    <span className="v2-editor">
      {input}
      {props.scopes.length > 1 ? (
        <select
          className="v2-input"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
          }}
          aria-label="For whom"
        >
          {props.scopes.map((x) => (
            <option key={x} value={x}>
              {/* [PCODE-351 | S15 | v0.1.0] */}
              {x === 'user'
                ? 'Only for me'
                : x === 'team'
                  ? 'For the team'
                  : x === 'project'
                    ? 'For the project'
                    : 'For the workspace'}
            </option>
          ))}
        </select>
      ) : (
        <span className="pv-small pv-muted">
          {scope === 'user' ? 'only for you' : 'for the workspace'}
        </span>
      )}
      <Button
        size="sm"
        kind="primary"
        disabled={bad}
        onClick={() => {
          props.onSave(scope, parsed);
        }}
      >
        Save
      </Button>
      <Button size="sm" kind="ghost" onClick={props.onCancel}>
        Cancel
      </Button>
    </span>
  );
}

// [PCODE-421 | S15 | v0.1.0] every person picks their own language, in their profile
/** The person's own language, for everyone (the workspace's lives in Settings › General). */
export function LanguageCard(props: { workspaceId: string }): ReactNode {
  const base = '/api/workspaces/' + props.workspaceId + '/settings';
  const [value, setValue] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    void api<{ key: string; value: unknown; source: string }[]>('GET', base).then((r) => {
      if (!r.ok) return;
      const s = r.data.find((x) => x.key === 'locale.language');
      setValue(s?.source === 'user' ? String(s.value) : '');
    });
  }, [base]);
  if (value === null) return null;
  return (
    <Card title="Language">
      <p className="pv-muted pv-small">The language Orqiva speaks to you.</p>
      <label className="v2-field">
        <span className="pv-muted pv-small">Your language</span>
        <select
          className="v2-input"
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);
            setMsg('');
            const done = (ok: boolean, error = ''): void => {
              setMsg(ok ? 'Saved.' : error);
            };
            if (next)
              void api('PUT', base + '/locale.language', { scope: 'user', value: next }).then(
                (r) => {
                  done(r.ok, r.ok ? '' : r.error.message);
                  if (r.ok && (next === 'de' || next === 'en')) void applyLanguage(next);
                },
              );
            else
              void api('DELETE', base + '/locale.language?scope=user').then(async (r) => {
                done(r.ok, r.ok ? '' : r.error.message);
                // the workspace's language applies again
                const all = await api<{ key: string; value: unknown }[]>('GET', base);
                const ws = all.ok ? all.data.find((x) => x.key === 'locale.language')?.value : null;
                if (ws === 'de' || ws === 'en') void applyLanguage(ws);
              });
          }}
        >
          <option value="">As the workspace</option>
          <option value="en">English</option>
          <option value="de">Deutsch</option>
        </select>
      </label>
      {msg ? (
        <p className="pv-small" role="status">
          {msg}
        </p>
      ) : null}
    </Card>
  );
}
