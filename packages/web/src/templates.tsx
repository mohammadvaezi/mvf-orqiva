// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-119 | S15 | v0.1.0] Add workspace lifecycle templates with an editor ──
//    Why:  the editor for a team's own lifecycle: phases in order, the stages inside them (with the agent
//          and the owning role), and a gate after a phase with its criteria and the role that signs. It
//          checks the definition with the same rules as the server while you type, and new parts get
//          keys from their names, so nobody has to think about keys.
import { lifecycleProblems, type GateDef, type LifecycleDef, type PhaseDef } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import { Icon } from './core/icons.js';
import { Card, EmptyState } from './shell.js';
import { localTime } from './views.js';

interface Template {
  id: string;
  name: string;
  definition: LifecycleDef;
  updatedAt: string;
  projects: number;
}

const W = (workspaceId: string, path: string): string => '/api/workspaces/' + workspaceId + path;

/** A key from a name, unique among `taken`: "Owner interview" → "owner-interview", then "-2". */
export function keyFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^(\d)/, 'x$1')
      .slice(0, 36) || 'part';
  let key = /^[a-z]/.test(base) ? base : 'p-' + base;
  for (let n = 2; used.has(key); n++) key = base.slice(0, 33) + '-' + String(n);
  return key;
}

const allKeys = (def: LifecycleDef): string[] =>
  def.phases.flatMap((p) => [
    p.key,
    ...p.stages.map((s) => s.key),
    ...(p.gate ? [p.gate.key] : []),
  ]);

function move<T>(list: T[], at: number, by: number): T[] {
  const to = at + by;
  if (to < 0 || to >= list.length) return list;
  const out = [...list];
  const [item] = out.splice(at, 1);
  if (item !== undefined) out.splice(to, 0, item);
  return out;
}

function IconButton(props: {
  label: string;
  icon: 'chevronUp' | 'chevronDown' | 'close';
  onClick: () => void;
  disabled?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      className="pe-icon-btn pe-icon-btn--sm"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={16} />
    </button>
  );
}

export function TemplateEditor(props: {
  name: string;
  definition: LifecycleDef;
  onSave: (name: string, def: LifecycleDef) => Promise<string | null>;
  onCancel: () => void;
}): ReactNode {
  const [name, setName] = useState(props.name);
  const [def, setDef] = useState<LifecycleDef>(props.definition);
  const [error, setError] = useState('');
  const problems = lifecycleProblems(def);
  const setPhase = (i: number, p: PhaseDef): void => {
    setDef({ phases: def.phases.map((x, j) => (j === i ? p : x)) });
  };
  return (
    <Card
      title={'Edit ' + (name || 'template')}
      subtitle="Projects already running keep the lifecycle they started with."
    >
      <div className="pe-form-grid">
        <div className="pe-field">
          <label htmlFor="tpl-name">Template name</label>
          <input
            id="tpl-name"
            className="pe-input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
      </div>
      <ol className="pe-tpl-phases">
        {def.phases.map((p, i) => (
          <li key={p.key} className="pe-tpl-phase">
            <div className="pe-tpl-row">
              <span className="pe-tpl-index">{i + 1}</span>
              <input
                className="pe-input"
                aria-label={'Name of phase ' + String(i + 1)}
                value={p.name}
                onChange={(e) => {
                  setPhase(i, { ...p, name: e.target.value });
                }}
              />
              <IconButton
                label="Move phase up"
                icon="chevronUp"
                disabled={i === 0}
                onClick={() => {
                  setDef({ phases: move(def.phases, i, -1) });
                }}
              />
              <IconButton
                label="Move phase down"
                icon="chevronDown"
                disabled={i === def.phases.length - 1}
                onClick={() => {
                  setDef({ phases: move(def.phases, i, 1) });
                }}
              />
              <IconButton
                label="Remove phase"
                icon="close"
                disabled={def.phases.length === 1}
                onClick={() => {
                  setDef({ phases: def.phases.filter((_, j) => j !== i) });
                }}
              />
            </div>
            <table className="pe-grid-table pe-tpl-stages" aria-label={'Stages of ' + p.name}>
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Agent</th>
                  <th scope="col">Owner</th>
                  <th scope="col">
                    <span className="pe-visually-hidden">Order</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.stages.map((st, k) => {
                  const setStage = (field: 'name' | 'agent' | 'owner', v: string): void => {
                    setPhase(i, {
                      ...p,
                      stages: p.stages.map((x, m) => (m === k ? { ...x, [field]: v } : x)),
                    });
                  };
                  return (
                    <tr key={st.key}>
                      <td>
                        <input
                          className="pe-input"
                          aria-label="Stage name"
                          value={st.name}
                          onChange={(e) => {
                            setStage('name', e.target.value);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="pe-input"
                          aria-label="Agent"
                          value={st.agent}
                          onChange={(e) => {
                            setStage('agent', e.target.value);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="pe-input"
                          aria-label="Owner"
                          value={st.owner}
                          onChange={(e) => {
                            setStage('owner', e.target.value);
                          }}
                        />
                      </td>
                      <td className="pe-cell-actions">
                        <IconButton
                          label="Move stage up"
                          icon="chevronUp"
                          disabled={k === 0}
                          onClick={() => {
                            setPhase(i, { ...p, stages: move(p.stages, k, -1) });
                          }}
                        />
                        <IconButton
                          label="Move stage down"
                          icon="chevronDown"
                          disabled={k === p.stages.length - 1}
                          onClick={() => {
                            setPhase(i, { ...p, stages: move(p.stages, k, 1) });
                          }}
                        />
                        <IconButton
                          label="Remove stage"
                          icon="close"
                          onClick={() => {
                            setPhase(i, { ...p, stages: p.stages.filter((_, m) => m !== k) });
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button
              type="button"
              className="pe-btn pe-btn--text pe-btn--small"
              onClick={() => {
                setPhase(i, {
                  ...p,
                  stages: [
                    ...p.stages,
                    {
                      key: keyFor('New stage', allKeys(def)),
                      name: 'New stage',
                      agent: 'none',
                      owner: 'Team',
                    },
                  ],
                });
              }}
            >
              <Icon name="plus" size={16} /> Add stage
            </button>
            <label className="pe-toggle pe-tpl-gate-toggle">
              <input
                type="checkbox"
                checked={Boolean(p.gate)}
                onChange={(e) => {
                  if (e.target.checked) {
                    const gate: GateDef = {
                      key: keyFor('Gate ' + p.name, allKeys(def)),
                      name: 'Gate after ' + p.name,
                      signer: 'admin',
                      criteria: [],
                    };
                    setPhase(i, { ...p, gate });
                  } else {
                    const rest: PhaseDef = { key: p.key, name: p.name, stages: p.stages };
                    setPhase(i, rest);
                  }
                }}
              />
              <span>
                <strong>A gate after this phase</strong>
                <span className="pe-small pe-muted">
                  {' '}
                  The next phase opens only when it is signed.
                </span>
              </span>
            </label>
            {p.gate ? (
              <GateEditor
                gate={p.gate}
                taken={allKeys(def)}
                onChange={(gate) => {
                  setPhase(i, { ...p, gate });
                }}
              />
            ) : null}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="pe-btn pe-btn--secondary"
        onClick={() => {
          const key = keyFor('New phase', allKeys(def));
          setDef({
            phases: [
              ...def.phases,
              {
                key,
                name: 'New phase',
                stages: [
                  {
                    key: keyFor('First stage', [...allKeys(def), key]),
                    name: 'First stage',
                    agent: 'none',
                    owner: 'Team',
                  },
                ],
              },
            ],
          });
        }}
      >
        <Icon name="plus" size={18} /> Add phase
      </button>
      {problems.length ? (
        <div className="pe-gate-missing" role="status">
          <strong>Before it can be saved</strong>
          <ul>
            {problems.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? (
        <div className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="pe-form-actions pe-tpl-actions">
        <button
          type="button"
          className="pe-btn pe-btn--primary"
          disabled={problems.length > 0 || !name.trim()}
          onClick={() => {
            void props.onSave(name.trim(), def).then((err) => {
              setError(err ?? '');
            });
          }}
        >
          Save template
        </button>
        <button type="button" className="pe-btn pe-btn--text" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Card>
  );
}

function GateEditor(props: {
  gate: GateDef;
  taken: string[];
  onChange: (g: GateDef) => void;
}): ReactNode {
  const g = props.gate;
  return (
    <div className="pe-tpl-gate">
      <div className="pe-tpl-row">
        <input
          className="pe-input"
          aria-label="Gate name"
          value={g.name}
          onChange={(e) => {
            props.onChange({ ...g, name: e.target.value });
          }}
        />
        <select
          className="pe-select"
          aria-label="Who signs"
          value={g.signer}
          onChange={(e) => {
            props.onChange({
              ...g,
              signer:
                e.target.value === 'owner'
                  ? 'owner'
                  : e.target.value === 'member'
                    ? 'member'
                    : 'admin',
            });
          }}
        >
          <option value="owner">Signed by an owner</option>
          <option value="admin">Signed by an admin</option>
          <option value="member">Signed by any member</option>
        </select>
      </div>
      <ul className="pe-tpl-criteria">
        {g.criteria.map((c, i) => (
          <li key={c.key} className="pe-tpl-row">
            <input
              className="pe-input"
              aria-label={'Criterion ' + String(i + 1)}
              value={c.text}
              onChange={(e) => {
                props.onChange({
                  ...g,
                  criteria: g.criteria.map((x, j) =>
                    j === i ? { ...x, text: e.target.value } : x,
                  ),
                });
              }}
            />
            <IconButton
              label="Remove criterion"
              icon="close"
              onClick={() => {
                props.onChange({ ...g, criteria: g.criteria.filter((_, j) => j !== i) });
              }}
            />
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="pe-btn pe-btn--text pe-btn--small"
        onClick={() => {
          props.onChange({
            ...g,
            criteria: [
              ...g.criteria,
              {
                key: keyFor('Criterion', [...props.taken, ...g.criteria.map((x) => x.key)]),
                text: '',
              },
            ],
          });
        }}
      >
        <Icon name="plus" size={16} /> Add criterion
      </button>
    </div>
  );
}

export function TemplatesSection(props: { workspaceId: string }): ReactNode {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [editing, setEditing] = useState<Template | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ templates: Template[] }>(
      'GET',
      W(props.workspaceId, '/lifecycle/templates'),
    );
    if (r.ok) setTemplates(r.data.templates);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (editing)
    return (
      <TemplateEditor
        key={editing.id}
        name={editing.name}
        definition={editing.definition}
        onCancel={() => {
          setEditing(null);
        }}
        onSave={async (name, definition) => {
          const r = await api('PATCH', W(props.workspaceId, '/lifecycle/templates/' + editing.id), {
            name,
            definition,
          });
          if (!r.ok) return r.error.message;
          setEditing(null);
          await load();
          return null;
        }}
      />
    );
  return (
    <Card
      title="Lifecycle templates"
      subtitle="Your own phases, stages and gates. A project picks one when its lifecycle starts."
      actions={
        <button
          type="button"
          className="pe-btn pe-btn--primary"
          onClick={() => {
            const taken = new Set((templates ?? []).map((t) => t.name));
            let name = 'Our lifecycle';
            for (let n = 2; taken.has(name); n++) name = 'Our lifecycle ' + String(n);
            void api<Template>('POST', W(props.workspaceId, '/lifecycle/templates'), { name }).then(
              async (r) => {
                if (!r.ok) {
                  setError(r.error.message);
                  return;
                }
                await load();
                setEditing(r.data);
              },
            );
          }}
        >
          <Icon name="plus" size={18} /> New from the default
        </button>
      }
    >
      {error ? (
        <div className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
      {!templates ? (
        <p className="pe-muted" role="status">
          Loading…
        </p>
      ) : templates.length === 0 ? (
        <EmptyState icon="flow" title="Only the Orqiva default so far">
          Start from the default and shape it to how your team works.
        </EmptyState>
      ) : (
        <table className="pe-grid-table" aria-label="Templates">
          <thead>
            <tr>
              <th scope="col">Template</th>
              <th scope="col">Phases and stages</th>
              <th scope="col">Used by</th>
              <th scope="col">Changed</th>
              <th scope="col">
                <span className="pe-visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.name}</strong>
                </td>
                <td className="pe-muted">
                  {t.definition.phases.length} phases ·{' '}
                  {t.definition.phases.reduce((n, p) => n + p.stages.length, 0)} stages ·{' '}
                  {t.definition.phases.filter((p) => p.gate).length} gates
                </td>
                <td className="pe-muted">
                  {t.projects === 1 ? '1 project' : String(t.projects) + ' projects'}
                </td>
                <td className="pe-muted">{localTime(t.updatedAt)}</td>
                <td className="pe-cell-actions">
                  <button
                    type="button"
                    className="pe-btn pe-btn--text"
                    onClick={() => {
                      setEditing(t);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="pe-btn pe-btn--text pe-danger-text"
                    onClick={() => {
                      void api('DELETE', W(props.workspaceId, '/lifecycle/templates/' + t.id)).then(
                        () => load(),
                      );
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
