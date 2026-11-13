// ── [PCODE-350 | S15 | v0.1.0] T35.3a Templates library for projects, PRDs, sprints and agents ──
//    Why:  Settings › Templates library: the built-in and the workspace's own templates by kind, each with
//          what it holds and a way to use it there and then (a new project, a sprint on a date, an agent,
//          the PRD default); admins keep a project as a template and remove their own.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

type Kind = 'project' | 'sprint' | 'agent' | 'prd';
interface Template {
  id: string;
  kind: Kind;
  name: string;
  description: string;
  builtIn: boolean;
  body: Record<string, unknown>;
}

const KIND_TITLE: Record<Kind, string> = {
  project: 'Projects',
  sprint: 'Sprints',
  agent: 'Agents',
  prd: 'PRDs',
};

/** What a template holds, in a few words. */
export function templateContents(t: Pick<Template, 'kind' | 'body'>): string {
  const b = t.body;
  const n = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
  if (t.kind === 'project')
    return [
      b['states'] ? String(n(b['states'])) + ' states' : 'the standard board',
      String(n(b['labels'])) + ' labels',
      String(n(b['epics'])) + ' epics',
    ].join(' · ');
  if (t.kind === 'sprint') return String(b['days']) + ' days · ' + String(n(b['tasks'])) + ' tasks';
  if (t.kind === 'agent') return 'instructions for ' + String(b['name']);
  return (
    String(n(b['sections'])) + ' sections for ' + String(b['ideaKind']).replace('_', ' ') + ' ideas'
  );
}

export function TemplateLibrarySection(props: {
  workspaceId: string;
  admin: boolean;
  go: (p: string) => void;
}): ReactNode {
  const [list, setList] = useState<Template[]>([]);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [projects, setProjects] = useState<{ id: string; key: string; name: string }[]>([]);
  const [using, setUsing] = useState<string | null>(null);
  const [form, setForm] = useState({ key: '', name: '', projectId: '', startDate: '' });
  const [keepFrom, setKeepFrom] = useState({ projectId: '', name: '' });
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const [l, p] = await Promise.all([
      api<{ templates: Template[]; prdDefaults: Record<string, string> }>(
        'GET',
        W(props.workspaceId, '/template-library'),
      ),
      api<{ id: string; key: string; name: string; archivedAt: string | null }[]>(
        'GET',
        W(props.workspaceId, '/projects'),
      ),
    ]);
    if (l.ok) {
      setList(l.data.templates);
      setDefaults(l.data.prdDefaults);
    } else setError(l.error.message);
    if (p.ok) setProjects(p.data.filter((x) => !x.archivedAt));
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  const use = async (t: Template): Promise<void> => {
    const r = await api<{ projectId?: string; agentId?: string }>(
      'POST',
      W(props.workspaceId, '/template-library/' + t.id + '/use'),
      t.kind === 'project'
        ? { key: form.key, name: form.name }
        : t.kind === 'sprint'
          ? { projectId: form.projectId, startDate: form.startDate }
          : t.kind === 'agent'
            ? { key: form.key }
            : {},
    );
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    setUsing(null);
    setForm({ key: '', name: '', projectId: '', startDate: '' });
    if (t.kind === 'project' && r.data.projectId) props.go('/projects/' + r.data.projectId);
    else
      setNote(
        t.kind === 'sprint'
          ? 'The sprint is planned.'
          : t.kind === 'agent'
            ? 'The agent is made; switch it on under Agents.'
            : 'PRDs of this kind follow the template now.',
      );
    await load();
  };
  const remove = async (id: string): Promise<void> => {
    await api('DELETE', W(props.workspaceId, '/template-library/' + id));
    await load();
  };
  const keep = async (): Promise<void> => {
    const r = await api('POST', W(props.workspaceId, '/template-library/from-project'), keepFrom);
    if (!r.ok) setError(r.error.message);
    else {
      setError('');
      setKeepFrom({ projectId: '', name: '' });
      setNote('The project is kept as a template.');
    }
    await load();
  };
  const field = (k: 'key' | 'name' | 'startDate', label: string, type = 'text'): ReactNode => (
    <input
      className="v2-input v2-input--sm"
      type={type}
      aria-label={label}
      placeholder={label}
      value={form[k]}
      onChange={(e) => {
        setForm({ ...form, [k]: k === 'key' ? e.target.value.trim() : e.target.value });
      }}
    />
  );
  return (
    <div className="pv-app v2-part pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {note ? <p className="pv-small">{note}</p> : null}
      {(Object.keys(KIND_TITLE) as Kind[]).map((kind) => (
        <Card key={kind} title={KIND_TITLE[kind]} flush>
          <ul className="pv-list pv-library">
            {list
              .filter((t) => t.kind === kind)
              .map((t) => (
                <li key={t.id} className="pv-library-row">
                  <div className="pv-integration">
                    <span className="pv-row-main">
                      <span className="pv-row-title">{t.name}</span>
                      <span className="pv-row-sub">
                        {t.description ? t.description + ' · ' : ''}
                        {templateContents(t)}
                      </span>
                    </span>
                    <span className="pv-home-actions">
                      {t.builtIn ? <Chip>built in</Chip> : <Chip tone="info">ours</Chip>}
                      {kind === 'prd' && Object.values(defaults).includes(t.id) ? (
                        <Chip tone="success">default</Chip>
                      ) : null}
                      {(kind === 'agent' || kind === 'prd') && !props.admin ? null : (
                        <Button
                          size="sm"
                          kind="ghost"
                          onClick={() => {
                            setUsing(using === t.id ? null : t.id);
                          }}
                        >
                          {kind === 'prd' ? 'Make default' : 'Use'}
                        </Button>
                      )}
                      {!t.builtIn && props.admin ? (
                        <Button size="sm" kind="ghost" onClick={() => void remove(t.id)}>
                          Remove
                        </Button>
                      ) : null}
                    </span>
                  </div>
                  {using === t.id ? (
                    <div className="v2-inline pv-pad">
                      {kind === 'project' ? (
                        <>
                          {field('key', 'Key, e.g. APP')}
                          {field('name', 'Project name')}
                        </>
                      ) : null}
                      {kind === 'sprint' ? (
                        <>
                          <select
                            className="v2-input v2-input--sm"
                            aria-label="Project"
                            value={form.projectId}
                            onChange={(e) => {
                              setForm({ ...form, projectId: e.target.value });
                            }}
                          >
                            <option value="">Project…</option>
                            {projects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.key} {p.name}
                              </option>
                            ))}
                          </select>
                          {field('startDate', 'Start date', 'date')}
                        </>
                      ) : null}
                      {kind === 'agent' ? field('key', 'Key, e.g. release-notes') : null}
                      <Button size="sm" kind="primary" onClick={() => void use(t)}>
                        {kind === 'project'
                          ? 'Make the project'
                          : kind === 'sprint'
                            ? 'Plan the sprint'
                            : kind === 'agent'
                              ? 'Make the agent'
                              : 'Make it the default'}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
          </ul>
        </Card>
      ))}
      {props.admin ? (
        <Card title="Keep a project as a template">
          <div className="v2-inline">
            <select
              className="v2-input v2-input--sm"
              aria-label="Project to keep"
              value={keepFrom.projectId}
              onChange={(e) => {
                setKeepFrom({ ...keepFrom, projectId: e.target.value });
              }}
            >
              <option value="">Project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key} {p.name}
                </option>
              ))}
            </select>
            <input
              className="v2-input v2-input--sm"
              aria-label="Template name"
              placeholder="Template name"
              value={keepFrom.name}
              onChange={(e) => {
                setKeepFrom({ ...keepFrom, name: e.target.value });
              }}
            />
            <Button
              size="sm"
              disabled={!keepFrom.projectId || !keepFrom.name.trim()}
              onClick={() => void keep()}
            >
              Keep its board, labels, epics and settings
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
