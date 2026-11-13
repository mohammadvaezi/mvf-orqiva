// ── [PCODE-307 | S15 | v0.1.0] T31.7 Environment config diff: variables, secrets, settings, flags and versions side by side ──
//    Why:  under the environments: two of them side by side, key by key, with the drift in one sentence;
//          an admin marks keys meant to differ and keeps each environment's plain variables. A secret
//          shows only that it is set and whether both are equal.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Card, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

interface EnvVars {
  id: string;
  key: string;
  name: string;
  vars: { name: string; value: string; updatedAt: string }[];
}
export interface DiffRow {
  key: string;
  area: 'variable' | 'secret' | 'setting' | 'flag' | 'version';
  name: string;
  a: string | null;
  b: string | null;
  state: 'same' | 'different' | 'only_a' | 'only_b';
  expected: boolean;
}
interface Diff {
  a: { id: string; name: string };
  b: { id: string; name: string };
  rows: DiffRow[];
  drift: string;
}

export const AREA_LABEL: Record<DiffRow['area'], string> = {
  version: 'Version',
  variable: 'Variable',
  secret: 'Secret',
  setting: 'Setting',
  flag: 'Flag',
};

/** The state in words, naming the environment a key is missing from. */
export function stateText(r: Pick<DiffRow, 'state' | 'expected'>, a: string, b: string): string {
  const base =
    r.state === 'same'
      ? 'same'
      : r.state === 'different'
        ? 'different'
        : r.state === 'only_a'
          ? 'missing in ' + b
          : 'missing in ' + a;
  return r.expected && r.state !== 'same' ? base + ' (expected)' : base;
}

const STATE_TONE = {
  same: 'success',
  different: 'warning',
  only_a: 'danger',
  only_b: 'danger',
} as const;

export function EnvConfig(props: {
  workspaceId: string;
  projectId: string;
  isAdmin: boolean;
}): ReactNode {
  const [envs, setEnvs] = useState<EnvVars[] | null>(null);
  const [pick, setPick] = useState<{ a: string; b: string } | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const base = W(props.workspaceId, '/projects/' + props.projectId);
  const loadEnvs = useCallback(() => {
    void api<EnvVars[]>('GET', base + '/env-config').then((r) => {
      if (!r.ok) return;
      setEnvs(r.data);
      const first = r.data[0];
      const last = r.data[r.data.length - 1];
      setPick(
        (p) => p ?? (first && last && first.id !== last.id ? { a: first.id, b: last.id } : null),
      );
    });
  }, [base]);
  useEffect(loadEnvs, [loadEnvs]);
  const loadDiff = useCallback(() => {
    if (!pick || pick.a === pick.b) {
      setDiff(null);
      return;
    }
    void api<Diff>('GET', base + '/env-diff?a=' + pick.a + '&b=' + pick.b).then((r) => {
      if (r.ok) {
        setDiff(r.data);
        setError(null);
      } else setError(r.error.message);
    });
  }, [base, pick]);
  useEffect(loadDiff, [loadDiff]);
  if (!envs || envs.length < 2) return null;
  const mark = async (row: DiffRow, expected: boolean): Promise<void> => {
    const r = await api('PUT', base + '/expected-diffs', {
      area: row.area,
      name: row.name,
      expected,
    });
    if (r.ok) loadDiff();
    else setError(r.error.message);
  };
  const rows = diff ? diff.rows.filter((r) => !onlyDiff || r.state !== 'same') : [];
  return (
    <Card title="Configuration across environments">
      <div className="v2-inline v2-ec-pick">
        <select
          className="v2-input v2-input--sm"
          aria-label="First environment"
          value={pick?.a ?? ''}
          onChange={(e) => {
            setPick({ a: e.target.value, b: pick?.b ?? '' });
          }}
        >
          {envs.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <span className="pv-muted">compared with</span>
        <select
          className="v2-input v2-input--sm"
          aria-label="Second environment"
          value={pick?.b ?? ''}
          onChange={(e) => {
            setPick({ a: pick?.a ?? '', b: e.target.value });
          }}
        >
          {envs.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <label className="pv-switch">
          <input
            type="checkbox"
            checked={onlyDiff}
            onChange={(e) => {
              setOnlyDiff(e.target.checked);
            }}
          />
          <span>Only differences</span>
        </label>
      </div>
      {diff ? (
        <>
          <p className="pv-small" role="status">
            {diff.drift}
          </p>
          {rows.length ? (
            <div className="v2-ec-scroll">
              <table className="v2-ec-table pv-small">
                <thead>
                  <tr>
                    <th scope="col">Key</th>
                    <th scope="col">{diff.a.name}</th>
                    <th scope="col">{diff.b.name}</th>
                    <th scope="col">State</th>
                    {props.isAdmin ? <th scope="col">Meant to differ</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className={r.expected ? 'v2-ec-expected' : undefined}>
                      <th scope="row">
                        <span className="pv-muted">{AREA_LABEL[r.area]}</span>{' '}
                        <span className="pv-mono">{r.name}</span>
                      </th>
                      <td className="pv-mono">{r.a ?? '—'}</td>
                      <td className="pv-mono">{r.b ?? '—'}</td>
                      <td>
                        <Chip tone={r.expected ? 'neutral' : STATE_TONE[r.state]}>
                          {stateText(r, diff.a.name, diff.b.name)}
                        </Chip>
                      </td>
                      {props.isAdmin ? (
                        <td>
                          {r.state !== 'same' || r.expected ? (
                            <input
                              type="checkbox"
                              aria-label={'Meant to differ: ' + r.name}
                              checked={r.expected}
                              onChange={(e) => void mark(r, e.target.checked)}
                            />
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="pv-small pv-muted">Everything is the same.</p>
          )}
        </>
      ) : (
        <p className="pv-small pv-muted">Pick two different environments.</p>
      )}
      {error ? (
        <p className="pv-text-danger pv-small" role="alert">
          {error}
        </p>
      ) : null}
      {props.isAdmin ? (
        <Variables
          workspaceId={props.workspaceId}
          envs={envs}
          changed={() => {
            loadEnvs();
            loadDiff();
          }}
        />
      ) : null}
    </Card>
  );
}

function Variables(props: {
  workspaceId: string;
  envs: EnvVars[];
  changed: () => void;
}): ReactNode {
  const [form, setForm] = useState({ env: props.envs[0]?.id ?? '', name: '', value: '' });
  const [error, setError] = useState<string | null>(null);
  const path = (env: string, name: string): string =>
    W(props.workspaceId, '/environments/' + env + '/vars/' + encodeURIComponent(name));
  const save = async (): Promise<void> => {
    const r = await api('PUT', path(form.env, form.name.trim()), { value: form.value });
    if (r.ok) {
      setForm({ ...form, name: '', value: '' });
      setError(null);
      props.changed();
    } else setError(r.error.message);
  };
  const remove = async (env: string, name: string): Promise<void> => {
    await api('DELETE', path(env, name));
    props.changed();
  };
  const count = props.envs.reduce((n, e) => n + e.vars.length, 0);
  return (
    <details className="v2-ec-vars">
      <summary className="pv-small">
        Variables ({count}) · plain settings anyone in the project may read; secrets stay sealed
      </summary>
      {props.envs.map((e) =>
        e.vars.length ? (
          <div key={e.id} className="pv-small">
            <strong>{e.name}</strong>
            <ul className="v2-ec-list">
              {e.vars.map((v) => (
                <li key={v.name}>
                  <span className="pv-mono">
                    {v.name}={v.value}
                  </span>{' '}
                  <button
                    type="button"
                    className="pv-link-btn"
                    onClick={() => void remove(e.id, v.name)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      <form
        className="v2-inline v2-ec-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <select
          className="v2-input v2-input--sm"
          aria-label="Environment"
          value={form.env}
          onChange={(e) => {
            setForm({ ...form, env: e.target.value });
          }}
        >
          {props.envs.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <input
          className="v2-input v2-input--sm v2-mono"
          aria-label="Variable name"
          placeholder="LOG_LEVEL"
          value={form.name}
          onChange={(e) => {
            setForm({ ...form, name: e.target.value.toUpperCase() });
          }}
        />
        <input
          className="v2-input v2-input--sm v2-mono"
          aria-label="Value"
          placeholder="info"
          value={form.value}
          onChange={(e) => {
            setForm({ ...form, value: e.target.value });
          }}
        />
        <button
          type="submit"
          className="pv-btn pv-btn--secondary pv-btn--sm"
          disabled={!form.name.trim()}
        >
          Set variable
        </button>
      </form>
      {error ? (
        <p className="pv-text-danger pv-small" role="alert">
          {error}
        </p>
      ) : null}
    </details>
  );
}
