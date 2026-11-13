// ── [PCODE-352 | S15 | v0.1.0] T35.3c Policies for approvals, budgets and data, with a dry run ──
//    Why:  Settings › Policies: the workspace's rules, for all projects or chosen ones, a draft until an
//          admin turns them on; and before that, a dry run that names what the rule would have stopped or
//          changed in the last 30 days.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + '/workspace-policies' + p;

interface Policy {
  id: string;
  rule: string;
  kind: string;
  text: string;
  projectIds: string[];
  state: 'draft' | 'on';
}
interface Rule {
  rule: string;
  kind: string;
  title: string;
}
interface Dry {
  count: number;
  examples: string[];
  text: string;
}

const KIND: Record<string, string> = { approval: 'Approval', budget: 'Budget', data: 'Data' };

/** The projects a policy is for, in words. */
export function policyScope(
  ids: readonly string[],
  projects: readonly { id: string; key: string }[],
): string {
  if (!ids.length) return 'all projects';
  return ids.map((id) => projects.find((p) => p.id === id)?.key ?? 'a removed project').join(', ');
}

export function PoliciesSection(props: { workspaceId: string }): ReactNode {
  const [list, setList] = useState<Policy[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [projects, setProjects] = useState<{ id: string; key: string; name: string }[]>([]);
  const [form, setForm] = useState({
    rule: 'sprint_requires_criteria',
    maxTokens: '200000',
    projectId: '',
  });
  const [dry, setDry] = useState<Dry | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const [r, p] = await Promise.all([
      api<{ policies: Policy[]; rules: Rule[] }>('GET', W(props.workspaceId, '')),
      api<{ id: string; key: string; name: string; archivedAt: string | null }[]>(
        'GET',
        '/api/workspaces/' + props.workspaceId + '/projects',
      ),
    ]);
    if (r.ok) {
      setList(r.data.policies);
      setRules(r.data.rules);
    } else setError(r.error.message);
    if (p.ok) setProjects(p.data.filter((x) => !x.archivedAt));
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  const body = (): Record<string, unknown> => ({
    rule: form.rule,
    params: form.rule === 'run_token_cap' ? { maxTokens: Number(form.maxTokens) } : {},
    projectIds: form.projectId ? [form.projectId] : [],
  });
  const tryIt = async (): Promise<void> => {
    const r = await api<Dry>('POST', W(props.workspaceId, '/dry-run'), body());
    if (r.ok) {
      setDry(r.data);
      setError('');
    } else setError(r.error.message);
  };
  const add = async (state: 'draft' | 'on'): Promise<void> => {
    const r = await api('POST', W(props.workspaceId, ''), { ...body(), state });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    setDry(null);
    await load();
  };
  const turn = async (p: Policy): Promise<void> => {
    const r = await api('PATCH', W(props.workspaceId, '/' + p.id), {
      state: p.state === 'on' ? 'draft' : 'on',
    });
    if (!r.ok) setError(r.error.message);
    await load();
  };
  const remove = async (id: string): Promise<void> => {
    await api('DELETE', W(props.workspaceId, '/' + id));
    await load();
  };
  return (
    <div className="pv-app v2-part pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <Card title={'Policies · ' + String(list.length)} flush>
        {list.length ? (
          <ul className="pv-list pv-library">
            {list.map((p) => (
              <li key={p.id} className="pv-library-row">
                <div className="pv-integration">
                  <span className="pv-row-main">
                    <span className="pv-row-title">{p.text}</span>
                    <span className="pv-row-sub">
                      {KIND[p.kind] ?? p.kind} · {policyScope(p.projectIds, projects)}
                    </span>
                  </span>
                  <Chip tone={p.state === 'on' ? 'success' : 'neutral'}>
                    {p.state === 'on' ? 'on' : 'draft'}
                  </Chip>
                  <span className="pv-home-actions">
                    <Button size="sm" kind="ghost" onClick={() => void turn(p)}>
                      {p.state === 'on' ? 'Back to draft' : 'Turn on'}
                    </Button>
                    <Button size="sm" kind="ghost" onClick={() => void remove(p.id)}>
                      Remove
                    </Button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pv-muted v2-pad">No policies yet. The server keeps every one that is on.</p>
        )}
      </Card>
      <Card title="New policy">
        <div className="pv-stack">
          <div className="v2-inline">
            <select
              className="v2-input v2-input--sm"
              aria-label="Rule"
              value={form.rule}
              onChange={(e) => {
                setForm({ ...form, rule: e.target.value });
                setDry(null);
              }}
            >
              {rules.map((r) => (
                <option key={r.rule} value={r.rule}>
                  {KIND[r.kind] ?? r.kind}: {r.title}
                </option>
              ))}
            </select>
            {form.rule === 'run_token_cap' ? (
              <input
                className="v2-input v2-input--sm"
                aria-label="Tokens per run"
                inputMode="numeric"
                value={form.maxTokens}
                onChange={(e) => {
                  setForm({ ...form, maxTokens: e.target.value.replace(/\D/g, '') });
                  setDry(null);
                }}
              />
            ) : null}
            <select
              className="v2-input v2-input--sm"
              aria-label="Projects"
              value={form.projectId}
              onChange={(e) => {
                setForm({ ...form, projectId: e.target.value });
                setDry(null);
              }}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  Only {p.key} {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="v2-inline">
            <Button size="sm" onClick={() => void tryIt()}>
              Dry run
            </Button>
            <Button size="sm" kind="ghost" onClick={() => void add('draft')}>
              Add as a draft
            </Button>
            <Button size="sm" kind="primary" disabled={!dry} onClick={() => void add('on')}>
              Add and turn on
            </Button>
            {!dry ? (
              <span className="pv-small pv-muted">Dry run it first to turn it on.</span>
            ) : null}
          </div>
          {dry ? (
            <div className="pv-callout pv-callout--agent">
              <div>
                <strong>Dry run:</strong> {dry.text}
                {dry.examples.length ? (
                  <ul className="pv-corrections">
                    {dry.examples.map((x) => (
                      <li key={x} className="pv-small">
                        {x}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
