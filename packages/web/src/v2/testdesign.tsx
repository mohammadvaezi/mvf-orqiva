// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-313 | S15 | v0.1.0] T32.1 Test repository: shared steps, parameters in the screen, structured BDD ──
//    Why:  the repository's new parts. Shared steps are listed and edited in one card and picked into a case;
//          a case's parameters are edited as names with their values (written <name> in a step, filled from
//          the run's configuration); a BDD case is written as Gherkin, checked by the server, which makes its
//          steps; a whole feature file comes in as one case per scenario.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface SharedSet {
  id: string;
  name: string;
  steps: { action: string; expected: string }[];
  version: number;
  usedBy: number;
}

export interface ParamRow {
  name: string;
  values: string;
}

/** Parameters as editable rows: a name and its values separated by commas. */
export const paramsToRows = (p: Readonly<Record<string, readonly string[]>>): ParamRow[] =>
  Object.entries(p).map(([name, values]) => ({ name, values: values.join(', ') }));

/** The rows back as parameters, or what is wrong with them. */
export function rowsToParams(
  rows: readonly ParamRow[],
): { ok: true; value: Record<string, string[]> } | { ok: false; error: string } {
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const name = r.name.trim();
    const values = [
      ...new Set(
        r.values
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ];
    if (!name && !values.length) continue;
    if (!/^[a-z][a-z0-9_]{0,30}$/i.test(name))
      return {
        ok: false,
        error: '“' + name + '” is not a parameter name: a letter, then letters, digits or _',
      };
    if (name in out) return { ok: false, error: 'The parameter ' + name + ' is there twice' };
    if (!values.length) return { ok: false, error: 'Give ' + name + ' at least one value' };
    out[name] = values;
  }
  return { ok: true, value: out };
}

/** The parameters of a case: names with their values, used as <name> in its steps. */
export function ParametersEditor(props: {
  rows: ParamRow[];
  onChange: (rows: ParamRow[]) => void;
  disabled: boolean;
}): ReactNode {
  const set = (i: number, k: keyof ParamRow, v: string): void => {
    props.onChange(props.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  };
  return (
    <section aria-label="Parameters" className="v2-td-params">
      <h3 className="v2-h3">Parameters</h3>
      <p className="pv-small pv-muted">
        Write <span className="pv-mono">&lt;name&gt;</span> in a step; a run fills it from its
        configuration.
      </p>
      {props.rows.map((r, i) => (
        <div key={i} className="v2-inline">
          <input
            className="v2-input v2-input--sm v2-td-pname"
            aria-label={'Name of parameter ' + String(i + 1)}
            placeholder="browser"
            value={r.name}
            disabled={props.disabled}
            onChange={(e) => {
              set(i, 'name', e.target.value);
            }}
          />
          <input
            className="v2-input v2-input--sm v2-grow"
            aria-label={'Values of parameter ' + String(i + 1)}
            placeholder="chromium, webkit"
            value={r.values}
            disabled={props.disabled}
            onChange={(e) => {
              set(i, 'values', e.target.value);
            }}
          />
          {props.disabled ? null : (
            <button
              type="button"
              className="pv-link-btn"
              aria-label={'Remove parameter ' + String(i + 1)}
              onClick={() => {
                props.onChange(props.rows.filter((_, j) => j !== i));
              }}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      {props.disabled ? null : (
        <Button
          size="sm"
          kind="ghost"
          icon="plus"
          onClick={() => {
            props.onChange([...props.rows, { name: '', values: '' }]);
          }}
        >
          Parameter
        </Button>
      )}
    </section>
  );
}

/** A BDD case's Gherkin; the server checks it and makes the steps. */
export function GherkinEditor(props: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}): ReactNode {
  return (
    <section aria-label="Gherkin">
      <textarea
        className="v2-input pv-mono v2-td-gherkin"
        rows={10}
        aria-label="Gherkin"
        spellCheck={false}
        placeholder={
          'Feature: Cart\n  Scenario: Items stay between visits\n    Given I am signed in\n    When I add a book to the cart\n    Then the cart shows 1 item'
        }
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => {
          props.onChange(e.target.value);
        }}
      />
      <p className="pv-small pv-muted">
        One scenario. Given and When are the actions, Then is what to expect. A Scenario Outline’s
        Examples become the parameters.
      </p>
    </section>
  );
}

/** The project's shared steps: written once, used by many cases. */
export function SharedStepsCard(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
}): ReactNode {
  const [sets, setSets] = useState<SharedSet[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const base = W(props.workspaceId, '/projects/' + props.projectId + '/test-shared-steps');
  const load = useCallback(async () => {
    const r = await api<SharedSet[]>('GET', base);
    if (r.ok) setSets(r.data);
    else setError(r.error.message);
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);
  const edit = (s: SharedSet | null): void => {
    setOpen(s?.id ?? 'new');
    setName(s?.name ?? '');
    setText(stepsToText(s?.steps ?? []));
    setError(null);
  };
  const save = async (): Promise<void> => {
    const steps = textToSteps(text);
    if (!name.trim() || !steps.length) {
      setError('Give the shared steps a name and at least one step');
      return;
    }
    const r =
      open === 'new'
        ? await api('POST', base, { name: name.trim(), steps })
        : await api('PATCH', W(props.workspaceId, '/test-shared-steps/' + (open ?? '')), {
            name: name.trim(),
            steps,
          });
    if (!r.ok) setError(r.error.message);
    else {
      setOpen(null);
      void load();
    }
  };
  const remove = async (id: string): Promise<void> => {
    const r = await api('DELETE', W(props.workspaceId, '/test-shared-steps/' + id));
    if (!r.ok) setError(r.error.message);
    else {
      setOpen(null);
      void load();
    }
  };
  return (
    <Card
      title={'Shared steps' + (sets ? ' · ' + String(sets.length) : '')}
      action={
        props.canEdit && open === null ? (
          <Button
            size="sm"
            kind="ghost"
            icon="plus"
            onClick={() => {
              edit(null);
            }}
          >
            Shared steps
          </Button>
        ) : null
      }
    >
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {open !== null ? (
        <div className="pv-stack">
          <input
            className="v2-input"
            aria-label="Name of the shared steps"
            placeholder="Sign in"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <textarea
            className="v2-input"
            rows={5}
            aria-label="Steps, one per line"
            placeholder={'Open <url>\nSign in as Ada -> The board shows'}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          <p className="pv-small pv-muted">
            One step per line; write <span className="pv-mono">-&gt;</span> before what to expect.
          </p>
          <div className="pv-page-actions">
            {open !== 'new' ? (
              <Button size="sm" kind="ghost" onClick={() => void remove(open)}>
                Remove
              </Button>
            ) : null}
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                setOpen(null);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" kind="primary" onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      ) : null}
      {sets?.length ? (
        <ul className="v2-td-sets">
          {sets.map((s) => (
            <li key={s.id}>
              {props.canEdit ? (
                <button
                  type="button"
                  className="pv-link-btn"
                  onClick={() => {
                    edit(s);
                  }}
                >
                  {s.name}
                </button>
              ) : (
                <strong>{s.name}</strong>
              )}{' '}
              <span className="pv-small pv-muted">
                {String(s.steps.length)} step{s.steps.length === 1 ? '' : 's'} · v{s.version}
              </span>{' '}
              <Chip tone={s.usedBy ? 'info' : 'neutral'}>
                {s.usedBy
                  ? 'in ' + String(s.usedBy) + ' case' + (s.usedBy === 1 ? '' : 's')
                  : 'unused'}
              </Chip>
            </li>
          ))}
        </ul>
      ) : sets && open === null ? (
        <p className="pv-empty">
          No shared steps. Write the steps many cases repeat (signing in, opening the cart) once.
        </p>
      ) : null}
    </Card>
  );
}

/** Steps as lines: "action -> expected". */
export const stepsToText = (steps: readonly { action: string; expected: string }[]): string =>
  steps.map((s) => s.action + (s.expected ? ' -> ' + s.expected : '')).join('\n');

export const textToSteps = (text: string): { action: string; expected: string }[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const at = l.indexOf('->');
      return at < 0
        ? { action: l, expected: '' }
        : { action: l.slice(0, at).trim(), expected: l.slice(at + 2).trim() };
    })
    .filter((s) => s.action);

/** A Gherkin feature file in, one BDD case per scenario. */
export function FeatureImport(props: {
  workspaceId: string;
  projectId: string;
  onDone: () => void;
}): ReactNode {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const read = async (file: File): Promise<void> => {
    setText(await file.text());
  };
  const send = async (): Promise<void> => {
    setError(null);
    setDone(null);
    const r = await api<{ created: { title: string }[] }>(
      'POST',
      W(props.workspaceId, '/projects/' + props.projectId + '/test-cases/gherkin'),
      { text },
    );
    if (!r.ok) {
      setError(
        r.error.message +
          (r.error.details.length
            ? ': ' +
              r.error.details
                .map(
                  (d) =>
                    (d.path.includes(':') ? 'line ' + (d.path.split(':')[1] ?? '') + ' ' : '') +
                    d.message,
                )
                .join('; ')
            : ''),
      );
      return;
    }
    setDone(
      String(r.data.created.length) +
        ' case' +
        (r.data.created.length === 1 ? '' : 's') +
        ' made: ' +
        r.data.created.map((c) => c.title).join(', '),
    );
    setText('');
    props.onDone();
  };
  return (
    <Card title="Import a feature file">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? <p role="status">{done}</p> : null}
      <textarea
        className="v2-input pv-mono v2-td-gherkin"
        rows={6}
        aria-label="Feature file"
        spellCheck={false}
        placeholder="Paste a .feature file, or pick one below"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <div className="pv-page-actions">
        <input
          type="file"
          accept=".feature,text/plain"
          aria-label="Feature file to read"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
          }}
        />
        <Button size="sm" kind="primary" disabled={!text.trim()} onClick={() => void send()}>
          Make the cases
        </Button>
      </div>
    </Card>
  );
}
