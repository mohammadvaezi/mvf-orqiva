// ── [PCODE-342 | S15 | v0.1.0] T34.2c AI postmortems and runbooks matched to incidents ──
//    Why:  Incidents, Runbooks: what to do when a known problem comes back, with the words that match it to
//          an incident; and on an open incident, the runbooks its title and alerts match, ready to follow.
import { triggerWords } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { Markdown } from './markdown.js';

export interface Runbook {
  id: string;
  projectId: string | null;
  projectKey: string | null;
  title: string;
  pattern: string;
  body: string;
  updatedAt: string;
}

const EMPTY = { title: '', pattern: '', body: '', projectId: '' };

/** A runbook can be kept once it has a title, at least one trigger word and steps. */
export const canSave = (f: { title: string; pattern: string; body: string }): boolean =>
  Boolean(f.title.trim()) && triggerWords(f.pattern).length > 0 && Boolean(f.body.trim());

export function Runbooks(props: { workspaceId: string; admin: boolean }): ReactNode {
  const W = '/api/workspaces/' + props.workspaceId;
  const [list, setList] = useState<Runbook[]>([]);
  const [projects, setProjects] = useState<{ id: string; key: string }[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const [r, p] = await Promise.all([
      api<Runbook[]>('GET', W + '/runbooks'),
      api<{ id: string; key: string; archivedAt: string | null }[]>('GET', W + '/projects'),
    ]);
    if (r.ok) setList(r.data);
    else setError(r.error.message);
    if (p.ok) setProjects(p.data.filter((x) => !x.archivedAt));
  }, [W]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (): Promise<void> => {
    const body = {
      title: form.title.trim(),
      pattern: form.pattern.trim(),
      body: form.body,
      projectId: form.projectId || null,
    };
    const r = editing
      ? await api('PUT', W + '/runbooks/' + editing, body)
      : await api('POST', W + '/runbooks', body);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    setForm(EMPTY);
    setEditing(null);
    await load();
  };
  const remove = async (id: string): Promise<void> => {
    const r = await api('DELETE', W + '/runbooks/' + id);
    if (!r.ok) setError(r.error.message);
    await load();
  };
  return (
    <div className="pv-stack">
      <p className="pv-muted pv-small">
        A runbook says what to do when a known problem comes back. When an incident’s title or
        alerts contain one of its words, the incident shows it and its timeline names it.
      </p>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <Card title={'Runbooks · ' + String(list.length)}>
        {list.length ? (
          <ul className="pv-list">
            {list.map((r) => (
              <li key={r.id} className="pv-runbook">
                <div className="v2-inline">
                  <button
                    type="button"
                    className="pv-link"
                    aria-expanded={open === r.id}
                    onClick={() => {
                      setOpen(open === r.id ? null : r.id);
                    }}
                  >
                    {r.title}
                  </button>
                  <Chip>{r.projectKey ?? 'all projects'}</Chip>
                  {triggerWords(r.pattern).map((w) => (
                    <span key={w} className="pv-small pv-muted">
                      “{w}”
                    </span>
                  ))}
                  {props.admin ? (
                    <span className="pv-runbook-actions">
                      <Button
                        size="sm"
                        kind="ghost"
                        onClick={() => {
                          setEditing(r.id);
                          setForm({
                            title: r.title,
                            pattern: r.pattern,
                            body: r.body,
                            projectId: r.projectId ?? '',
                          });
                        }}
                      >
                        Change
                      </Button>
                      <Button size="sm" kind="ghost" onClick={() => void remove(r.id)}>
                        Remove
                      </Button>
                    </span>
                  ) : null}
                </div>
                {open === r.id ? <Markdown text={r.body} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="pv-muted pv-small">No runbooks yet.</p>
        )}
      </Card>
      {props.admin ? (
        <Card title={editing ? 'Change the runbook' : 'New runbook'}>
          <div className="pv-stack">
            <div className="v2-inline">
              <input
                className="v2-input"
                aria-label="Title"
                placeholder="Title, e.g. Disk full"
                value={form.title}
                onChange={(e) => {
                  setForm({ ...form, title: e.target.value });
                }}
              />
              <select
                className="v2-input"
                aria-label="Project"
                value={form.projectId}
                onChange={(e) => {
                  setForm({ ...form, projectId: e.target.value });
                }}
              >
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.key}
                  </option>
                ))}
              </select>
            </div>
            <input
              className="v2-input"
              aria-label="Trigger words"
              placeholder="Words that match it, separated by commas: disk full, no space left"
              value={form.pattern}
              onChange={(e) => {
                setForm({ ...form, pattern: e.target.value });
              }}
            />
            <textarea
              className="v2-input"
              aria-label="Steps"
              rows={6}
              placeholder={'The steps, in Markdown:\n1. Check …\n2. Then …'}
              value={form.body}
              onChange={(e) => {
                setForm({ ...form, body: e.target.value });
              }}
            />
            <div className="v2-inline">
              <Button kind="primary" disabled={!canSave(form)} onClick={() => void save()}>
                {editing ? 'Save' : 'Add the runbook'}
              </Button>
              {editing ? (
                <Button
                  kind="ghost"
                  onClick={() => {
                    setEditing(null);
                    setForm(EMPTY);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/** On an open incident: the runbooks its title and alerts match. */
export function IncidentRunbooks(props: {
  workspaceId: string;
  incidentId: string;
  alerts: number;
}): ReactNode {
  const [list, setList] = useState<Runbook[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    void api<Runbook[]>(
      'GET',
      '/api/workspaces/' + props.workspaceId + '/incidents/' + props.incidentId + '/runbooks',
    ).then((r) => {
      if (r.ok) {
        setList(r.data);
        setOpen(r.data[0]?.id ?? null);
      }
    });
  }, [props.workspaceId, props.incidentId, props.alerts]);
  if (!list.length) return null;
  return (
    <Card title={list.length === 1 ? 'Runbook' : 'Runbooks · ' + String(list.length)}>
      {list.map((r) => (
        <div key={r.id} className="pv-runbook">
          <button
            type="button"
            className="pv-link"
            aria-expanded={open === r.id}
            onClick={() => {
              setOpen(open === r.id ? null : r.id);
            }}
          >
            {r.title}
          </button>
          {open === r.id ? <Markdown text={r.body} /> : null}
        </div>
      ))}
    </Card>
  );
}
