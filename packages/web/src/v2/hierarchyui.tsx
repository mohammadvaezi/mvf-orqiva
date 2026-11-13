// ── [PCODE-257 | S15 | v0.1.0] T26.6 Hierarchy: initiatives, custom item types, custom fields ──
//    Why:  the levels and the team's own shape of work on screen: the initiatives with their epics' progress,
//          a task's type and fields in the drawer, and where a project names its types and fields.
import { FIELD_TYPES, fieldProblem, fieldText, type FieldDef } from '@orqiva/shared';
import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Bar, Button, Card, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
const KINDS = ['initiative', 'epic', 'story', 'task', 'bug', 'spike', 'milestone'];

/** The project's type names by id, for cards and rows deep in a page. */
export const TypeNames = createContext<ReadonlyMap<string, string>>(new Map());

export interface ItemType {
  id: string;
  name: string;
  baseKind: string;
  color: string;
  count: number;
}
type Field = FieldDef & { id: string };

/** The project's types and fields, for the drawer and the settings. */
export function useShape(
  workspaceId: string,
  projectId: string,
): {
  types: ItemType[];
  fields: Field[];
  reload: () => void;
} {
  const [types, setTypes] = useState<ItemType[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const reload = useCallback(() => {
    const P = W(workspaceId, '/projects/' + projectId);
    void api<ItemType[]>('GET', P + '/item-types').then((r) => {
      if (r.ok) setTypes(r.data);
    });
    void api<Field[]>('GET', P + '/custom-fields').then((r) => {
      if (r.ok) setFields(r.data);
    });
  }, [workspaceId, projectId]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { types, fields, reload };
}

/** In the drawer: the task's type and the project's fields. */
export function ShapePanel(props: {
  workspaceId: string;
  projectId: string;
  typeId: string | null | undefined;
  custom: Record<string, unknown> | undefined;
  people: { id: string; name: string }[];
  canEdit: boolean;
  onChange: (f: { typeId?: string | null; custom?: Record<string, unknown> }) => void;
}): ReactNode {
  const { types, fields } = useShape(props.workspaceId, props.projectId);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  if (!types.length && !fields.length) return null;
  const custom = props.custom ?? {};
  const save = (f: Field, raw: string): void => {
    const value = raw === '' ? null : f.type === 'number' ? Number(raw.replace(',', '.')) : raw;
    const p = fieldProblem(f, value);
    setProblem(p);
    if (p) return;
    props.onChange({ custom: { [f.key]: value } });
  };
  const shown = (f: Field): string => {
    const v = draft[f.key] ?? custom[f.key];
    return fieldText(f, v);
  };
  return (
    <div className="pv-props hu-shape">
      {types.length ? (
        <label>
          <span>Type</span>
          <select
            value={props.typeId ?? ''}
            disabled={!props.canEdit}
            onChange={(e) => {
              props.onChange({ typeId: e.target.value || null });
            }}
          >
            <option value="">—</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.baseKind})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {fields.map((f) => (
        <label key={f.key}>
          <span>{f.label}</span>
          {f.type === 'choice' || f.type === 'person' ? (
            <select
              value={shown(f)}
              disabled={!props.canEdit}
              onChange={(e) => {
                save(f, e.target.value);
              }}
            >
              <option value="">—</option>
              {(f.type === 'choice'
                ? f.options.map((o) => ({ value: o, text: o }))
                : props.people.map((p) => ({ value: p.id, text: p.name }))
              ).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.text}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
              disabled={!props.canEdit}
              value={shown(f)}
              onChange={(e) => {
                setDraft({ ...draft, [f.key]: e.target.value });
              }}
              onBlur={(e) => {
                if (e.target.value !== fieldText(f, custom[f.key])) save(f, e.target.value);
                setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== f.key)));
              }}
            />
          )}
        </label>
      ))}
      {problem ? (
        <p className="v2-error" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

interface Initiative {
  id: string;
  ref: string;
  title: string;
  state: string;
  done: number;
  total: number;
  donePoints: number;
  totalPoints: number;
  epics: { id: string; ref: string; title: string; done: number; total: number }[];
}

/** Above the backlog: the initiatives and how far the work under them is. */
export function InitiativesCard(props: {
  workspaceId: string;
  projectId: string;
  onOpen: (id: string) => void;
  version: unknown;
}): ReactNode {
  const [list, setList] = useState<Initiative[]>([]);
  useEffect(() => {
    void api<Initiative[]>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/initiatives'),
    ).then((r) => {
      if (r.ok) setList(r.data);
    });
  }, [props.workspaceId, props.projectId, props.version]);
  if (!list.length) return null;
  return (
    <Card flush title="Initiatives">
      <ul className="pv-rows">
        {list.map((i) => (
          <li key={i.id} className="pv-row pv-row--static hu-init">
            <span className="pv-row-main">
              <span className="pv-row-title">
                <button
                  type="button"
                  className="pv-link-btn pv-mono"
                  onClick={() => {
                    props.onOpen(i.id);
                  }}
                >
                  {i.ref}
                </button>{' '}
                {i.title} <Chip>{i.state}</Chip>
              </span>
              <span className="pv-row-sub">
                {i.epics
                  .map((e) => e.title + ' ' + String(e.done) + '/' + String(e.total))
                  .join(' · ') || 'no epics yet'}
              </span>
            </span>
            <span className="hu-progress">
              <Bar value={i.done} max={Math.max(1, i.total)} tone="primary" />
              <span className="pv-muted pv-small pv-num">
                {i.done}/{i.total} tasks · {i.donePoints}/{i.totalPoints} pt
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Project settings: the project's own types and fields. */
export function ShapeSettings(props: { workspaceId: string; projectId: string }): ReactNode {
  const { types, fields, reload } = useShape(props.workspaceId, props.projectId);
  const [type, setType] = useState({ name: '', base: 'bug' });
  const [field, setField] = useState({ key: '', label: '', type: 'text', options: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const P = W(props.workspaceId, '/projects/' + props.projectId);
  const call = async (method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<void> => {
    const r = await api(method, P + path, body);
    setMsg(r.ok ? null : r.error.message);
    reload();
  };
  return (
    <div className="pv-app v2-part hu-settings">
      <Card title="Types of task">
        <p className="pv-muted pv-small">Your own kinds of task, each on a base kind.</p>
        <ul className="pv-rows">
          {types.map((t) => (
            <li key={t.id} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">
                  <i className="hu-dot" style={{ background: t.color }} /> {t.name}
                </span>
                <span className="pv-row-sub">
                  on {t.baseKind} · {t.count} tasks
                </span>
              </span>
              <button
                type="button"
                className="pv-mini-btn"
                aria-label={'Remove type ' + t.name}
                onClick={() => void call('DELETE', '/item-types/' + t.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="v2-inline">
          <input
            className="v2-input v2-input--sm"
            aria-label="Type name"
            placeholder="e.g. Incident"
            value={type.name}
            onChange={(e) => {
              setType({ ...type, name: e.target.value });
            }}
          />
          <select
            className="v2-input v2-input--sm"
            aria-label="Base kind"
            value={type.base}
            onChange={(e) => {
              setType({ ...type, base: e.target.value });
            }}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                on {k}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!type.name.trim()}
            onClick={() =>
              void call('POST', '/item-types', {
                name: type.name.trim(),
                baseKind: type.base,
              }).then(() => {
                setType({ name: '', base: type.base });
              })
            }
          >
            Add type
          </Button>
        </div>
      </Card>
      <Card title="Fields">
        <p className="pv-muted pv-small">Your own fields on every task of the project.</p>
        <ul className="pv-rows">
          {fields.map((f) => (
            <li key={f.id} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">{f.label}</span>
                <span className="pv-row-sub pv-mono">
                  {f.key} · {f.type}
                  {f.options.length ? ' · ' + f.options.join(', ') : ''}
                </span>
              </span>
              <button
                type="button"
                className="pv-mini-btn"
                aria-label={'Remove field ' + f.label}
                onClick={() => void call('DELETE', '/custom-fields/' + f.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="v2-inline">
          <input
            className="v2-input v2-input--sm"
            aria-label="Field label"
            placeholder="Label, e.g. Customer"
            value={field.label}
            onChange={(e) => {
              const label = e.target.value;
              setField({
                ...field,
                label,
                key: label
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '_')
                  .replace(/^_+|_+$/g, '')
                  .replace(/^(\d)/, 'f_$1')
                  .slice(0, 40),
              });
            }}
          />
          <select
            className="v2-input v2-input--sm"
            aria-label="Field type"
            value={field.type}
            onChange={(e) => {
              setField({ ...field, type: e.target.value });
            }}
          >
            {FIELD_TYPES.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          {field.type === 'choice' ? (
            <input
              className="v2-input v2-input--sm"
              aria-label="Choices"
              placeholder="gold, silver, bronze"
              value={field.options}
              onChange={(e) => {
                setField({ ...field, options: e.target.value });
              }}
            />
          ) : null}
          <Button
            size="sm"
            disabled={!field.key}
            onClick={() =>
              void call('POST', '/custom-fields', {
                key: field.key,
                label: field.label.trim(),
                type: field.type,
                ...(field.type === 'choice'
                  ? {
                      options: field.options
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean),
                    }
                  : {}),
              }).then(() => {
                setField({ key: '', label: '', type: 'text', options: '' });
              })
            }
          >
            Add field
          </Button>
        </div>
        {msg ? (
          <p className="v2-error" role="alert">
            {msg}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
