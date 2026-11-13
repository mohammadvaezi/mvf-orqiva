// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-318 | S15 | v0.1.0] T32.4b Masking of personal data in test results and the test-data vault ──
//    Why:  the project's test data in the repository (open values shown, sensitive ones by name only),
//          and in the runner a step's {{data:name}} as a button that reveals the value for this tester.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { dataParts } from '@orqiva/shared';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

interface TestData {
  name: string;
  sensitive: boolean;
  value: string | null;
  note: string;
  updatedBy: string | null;
  revealedBy: string | null;
  revealedAt: string | null;
}

/** A name the vault takes: a small letter, then small letters, digits, _ . or -. */
export const dataName = (raw: string): string | null => {
  const n = raw.trim();
  return /^[a-z][a-z0-9_.-]{0,40}$/.test(n) ? n : null;
};

/** The project's test data. */
export function TestDataCard(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
}): ReactNode {
  const base = W(props.workspaceId, '/projects/' + props.projectId + '/test-data');
  const [list, setList] = useState<TestData[] | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [sensitive, setSensitive] = useState(true);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<TestData[]>('GET', base);
    if (r.ok) setList(r.data);
    else setError(r.error.message);
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);
  const add = async (): Promise<void> => {
    const n = dataName(name);
    if (!n) {
      setError('A name starts with a small letter: small letters, digits, _ . or -');
      return;
    }
    const r = await api('PUT', base + '/' + n, { value, sensitive });
    if (!r.ok) setError(r.error.message);
    else {
      setName('');
      setValue('');
      setError(null);
      void load();
    }
  };
  const reveal = async (n: string): Promise<void> => {
    const r = await api<{ value: string }>('POST', base + '/' + n + '/reveal');
    if (r.ok) setShown((x) => ({ ...x, [n]: r.data.value }));
    else setError(r.error.message);
  };
  const remove = async (n: string): Promise<void> => {
    const r = await api('DELETE', base + '/' + n);
    if (!r.ok) setError(r.error.message);
    else void load();
  };
  return (
    <Card title={'Test data' + (list ? ' · ' + String(list.length) : '')}>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="pv-small pv-muted">
        Write <span className="pv-mono">{'{{data:name}}'}</span> in a step. Open values are filled
        in when a run shows the steps; a sensitive one is revealed by the tester who needs it.
        Results never keep the values.
      </p>
      {list?.length ? (
        <table className="pv-table">
          <tbody>
            {list.map((d) => (
              <tr key={d.name}>
                <td className="pv-mono">{d.name}</td>
                <td>
                  {d.sensitive ? (
                    shown[d.name] !== undefined ? (
                      <span className="pv-mono">{shown[d.name]}</span>
                    ) : (
                      <Button size="sm" kind="ghost" onClick={() => void reveal(d.name)}>
                        Reveal
                      </Button>
                    )
                  ) : (
                    <span className="pv-mono">{d.value}</span>
                  )}
                </td>
                <td>
                  {d.sensitive ? <Chip tone="warning">sensitive</Chip> : <Chip>open</Chip>}
                  {d.revealedBy ? (
                    <span className="pv-small pv-muted"> last revealed by {d.revealedBy}</span>
                  ) : null}
                </td>
                <td>
                  {props.canEdit ? (
                    <button
                      type="button"
                      className="pv-link-btn"
                      onClick={() => void remove(d.name)}
                    >
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : list ? (
        <p className="pv-empty">
          No test data yet: accounts, test cards and sample values go here.
        </p>
      ) : null}
      {props.canEdit ? (
        <form
          className="v2-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && value) void add();
          }}
        >
          <input
            className="v2-input v2-input--sm"
            aria-label="Test data name"
            placeholder="admin.user"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <input
            className="v2-input v2-input--sm v2-grow"
            aria-label="Test data value"
            type={sensitive ? 'password' : 'text'}
            autoComplete="off"
            placeholder="The value"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
            }}
          />
          <label className="v2-switch">
            <input
              type="checkbox"
              checked={sensitive}
              onChange={(e) => {
                setSensitive(e.target.checked);
              }}
            />
            <span>Sensitive</span>
          </label>
          <button
            type="submit"
            className="pv-btn pv-btn--secondary pv-btn--sm"
            disabled={!name.trim() || !value}
          >
            Keep
          </button>
        </form>
      ) : null}
    </Card>
  );
}

/** A step's text with its test-data references as buttons that reveal the value. */
export function StepText(props: {
  workspaceId: string;
  projectId: string;
  text: string;
}): ReactNode {
  const [values, setValues] = useState<Record<string, string>>({});
  const parts = dataParts(props.text);
  const first = parts[0];
  if (parts.length === 1 && first && 'text' in first) return props.text;
  const reveal = async (n: string): Promise<void> => {
    const r = await api<{ value: string }>(
      'POST',
      W(props.workspaceId, '/projects/' + props.projectId + '/test-data/' + n + '/reveal'),
    );
    if (r.ok) setValues((x) => ({ ...x, [n]: r.data.value }));
  };
  return (
    <>
      {parts.map((p, i) =>
        'text' in p ? (
          <span key={i}>{p.text}</span>
        ) : values[p.ref] !== undefined ? (
          <span key={i} className="pv-mono v2-td-value">
            {values[p.ref]}
          </span>
        ) : (
          <button
            key={i}
            type="button"
            className="v2-td-ref"
            title="Reveal the test data"
            onClick={() => void reveal(p.ref)}
          >
            {p.ref}
          </button>
        ),
      )}
    </>
  );
}
