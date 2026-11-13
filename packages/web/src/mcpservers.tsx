// ── [PCODE-334 | S15 | v0.1.0] T33.4c MCP servers per agent: registry, our own MCP client, tools in runs under the agent's rules ──
//    Why:  Settings, AI providers: the outside MCP servers agents may use, in one table with the key's last
//          characters, the kind of action of their tools, which tools are open to agents and which agents
//          use them; a test lists a server's tools. Agents pick their servers in their own settings.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import { Card } from './shell.js';
import { localTime } from './views.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface McpServer {
  id: string;
  name: string;
  label: string;
  url: string;
  headerName: string;
  hasSecret: boolean;
  hint: string;
  actionClass: 'read' | 'comment' | 'write' | 'external';
  allowedTools: string[];
  toolCount: number | null;
  lastOkAt: string | null;
  lastError: string;
  agents: string[];
}

export const KIND_TEXT: Record<McpServer['actionClass'], string> = {
  read: 'only reads',
  comment: 'comments',
  write: 'writes',
  external: 'acts outside',
};

/** "12 tools, 3 open to agents" or how the last test went. */
export function serverState(
  m: Pick<McpServer, 'toolCount' | 'allowedTools' | 'lastError' | 'lastOkAt'>,
): string {
  if (m.lastError) return m.lastError;
  if (m.toolCount === null) return 'not tested yet';
  const open = m.allowedTools.length ? Math.min(m.allowedTools.length, m.toolCount) : m.toolCount;
  return (
    String(m.toolCount) +
    (m.toolCount === 1 ? ' tool' : ' tools') +
    (m.allowedTools.length ? ', ' + String(open) + ' open to agents' : ', all open to agents') +
    (m.lastOkAt ? ' · tested ' + localTime(m.lastOkAt) : '')
  );
}

interface Draft {
  id: string | null;
  name: string;
  label: string;
  url: string;
  headerName: string;
  secret: string;
  actionClass: McpServer['actionClass'];
  allowed: string;
}
const empty: Draft = {
  id: null,
  name: '',
  label: '',
  url: 'https://',
  headerName: 'Authorization',
  secret: '',
  actionClass: 'read',
  allowed: '',
};

export function McpServersSection(props: { workspaceId: string }): ReactNode {
  const ws = props.workspaceId;
  const [list, setList] = useState<McpServer[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tested, setTested] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const load = useCallback(async () => {
    const r = await api<McpServer[]>('GET', W(ws, '/mcp-servers'));
    if (r.ok) setList(r.data);
  }, [ws]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (d: Draft): Promise<void> => {
    const body = {
      label: d.label.trim() || d.name.trim(),
      url: d.url.trim(),
      headerName: d.headerName.trim() || 'Authorization',
      ...(d.secret.trim() ? { secret: d.secret.trim() } : {}),
      actionClass: d.actionClass,
      allowedTools: d.allowed
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    };
    const r = d.id
      ? await api('PATCH', W(ws, '/mcp-servers/' + d.id), body)
      : await api('POST', W(ws, '/mcp-servers'), { name: d.name.trim(), ...body });
    if (!r.ok) {
      setMsg({ error: r.error.message });
      return;
    }
    setDraft(null);
    setMsg({
      ok: d.id ? 'Saved.' : 'MCP server added. Test it, then give it to agents in their settings.',
    });
    await load();
  };
  const test = async (m: McpServer): Promise<void> => {
    setTested({ ...tested, [m.id]: 'Listing its tools…' });
    const r = await api<{
      ok: boolean;
      tools: { name: string; allowed: boolean }[];
      ms: number;
      error: string;
    }>('POST', W(ws, '/mcp-servers/' + m.id + '/test'));
    setTested({
      ...tested,
      [m.id]: !r.ok
        ? r.error.message
        : r.data.ok
          ? r.data.tools.map((t) => t.name + (t.allowed ? '' : ' (closed)')).join(', ') ||
            'no tools'
          : r.data.error,
    });
    await load();
  };
  const remove = async (m: McpServer): Promise<void> => {
    const r = await api('DELETE', W(ws, '/mcp-servers/' + m.id));
    setMsg(r.ok ? { ok: m.label + ' removed.' } : { error: r.error.message });
    await load();
  };
  if (!list) return null;
  const field = (
    id: string,
    label: string,
    value: string,
    on: (v: string) => void,
    o: { placeholder?: string; mono?: boolean; secret?: boolean; disabled?: boolean } = {},
  ): ReactNode => (
    <div className="pe-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={'pe-input' + (o.mono ? ' pe-mono' : '')}
        type={o.secret ? 'password' : 'text'}
        autoComplete="off"
        spellCheck={false}
        placeholder={o.placeholder}
        disabled={o.disabled}
        value={value}
        onChange={(e) => {
          on(e.target.value);
        }}
      />
    </div>
  );
  return (
    <Card
      title="MCP servers"
      subtitle="Outside tools agents may use. Their kind of action decides, with each agent's rules, whether a call runs, asks first or is refused."
      actions={
        draft ? null : (
          <button
            type="button"
            className="pe-btn pe-btn--secondary"
            onClick={() => {
              setDraft(empty);
              setMsg({});
            }}
          >
            Add MCP server
          </button>
        )
      }
    >
      {msg.error ? (
        <div className="pe-field-error" role="alert">
          {msg.error}
        </div>
      ) : msg.ok ? (
        <div className="pe-ok" role="status">
          {msg.ok}
        </div>
      ) : null}
      {draft ? (
        <form
          className="pe-form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void save(draft);
          }}
        >
          {field(
            'mcp-name',
            'Name (in tool names)',
            draft.name,
            (v) => {
              setDraft({ ...draft, name: v.toLowerCase().replace(/[^a-z0-9-]/g, '') });
            },
            { mono: true, placeholder: 'tickets', disabled: draft.id !== null },
          )}
          {field(
            'mcp-label',
            'Label',
            draft.label,
            (v) => {
              setDraft({ ...draft, label: v });
            },
            { placeholder: 'Ticket system' },
          )}
          {field(
            'mcp-url',
            'Address',
            draft.url,
            (v) => {
              setDraft({ ...draft, url: v });
            },
            { mono: true },
          )}
          {field(
            'mcp-header',
            'Header for the key',
            draft.headerName,
            (v) => {
              setDraft({ ...draft, headerName: v });
            },
            { mono: true },
          )}
          {field(
            'mcp-secret',
            draft.id ? 'New key (empty keeps it)' : 'Key',
            draft.secret,
            (v) => {
              setDraft({ ...draft, secret: v });
            },
            { secret: true },
          )}
          <div className="pe-field">
            <label htmlFor="mcp-kind">Its tools</label>
            <select
              id="mcp-kind"
              className="pe-input"
              value={draft.actionClass}
              onChange={(e) => {
                setDraft({ ...draft, actionClass: e.target.value as McpServer['actionClass'] });
              }}
            >
              {(Object.keys(KIND_TEXT) as McpServer['actionClass'][]).map((k) => (
                <option key={k} value={k}>
                  {KIND_TEXT[k]}
                </option>
              ))}
            </select>
          </div>
          {field(
            'mcp-allowed',
            'Tools open to agents (comma between; empty: all)',
            draft.allowed,
            (v) => {
              setDraft({ ...draft, allowed: v });
            },
            { mono: true },
          )}
          <div className="pe-form-actions">
            <button
              type="submit"
              className="pe-btn pe-btn--primary"
              disabled={!draft.name.trim() || !draft.url.trim()}
            >
              {draft.id ? 'Save' : 'Add'}
            </button>
            <button
              type="button"
              className="pe-btn pe-btn--text"
              onClick={() => {
                setDraft(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {list.length ? (
        <table className="pe-grid-table ai-table" aria-label="MCP servers">
          <thead>
            <tr>
              <th scope="col">Server</th>
              <th scope="col">Key</th>
              <th scope="col">Its tools</th>
              <th scope="col">Used by</th>
              <th scope="col">Last test</th>
              <th scope="col">
                <span className="pe-visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id}>
                <td>
                  <strong>{m.label}</strong>
                  <div className="pe-small pe-muted pe-mono mcp-url">
                    {m.name} · {m.url.replace(/^https?:\/\//, '')}
                  </div>
                </td>
                <td className="pe-mono">{m.hint ? '…' + m.hint : m.hasSecret ? 'stored' : '—'}</td>
                <td className="pe-small">{KIND_TEXT[m.actionClass]}</td>
                <td>
                  {m.agents.length
                    ? m.agents.map((a) => (
                        <span key={a} className="pe-pill">
                          {a}
                        </span>
                      ))
                    : '—'}
                </td>
                <td className={'pe-small ' + (m.lastError ? 'pe-danger-text' : 'pe-muted')}>
                  {serverState(m)}
                  {tested[m.id] && tested[m.id] !== serverState(m) ? (
                    <div className="ai-tested">{tested[m.id]}</div>
                  ) : null}
                </td>
                <td className="pe-cell-actions">
                  <button
                    type="button"
                    className="pe-btn pe-btn--text"
                    onClick={() => void test(m)}
                  >
                    Test
                  </button>
                  <button
                    type="button"
                    className="pe-btn pe-btn--text"
                    onClick={() => {
                      setDraft({
                        id: m.id,
                        name: m.name,
                        label: m.label,
                        url: m.url,
                        headerName: m.headerName,
                        secret: '',
                        actionClass: m.actionClass,
                        allowed: m.allowedTools.join(', '),
                      });
                      setMsg({});
                    }}
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    className="pe-btn pe-btn--text"
                    onClick={() => void remove(m)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : draft ? null : (
        <p className="pe-muted">No MCP servers yet.</p>
      )}
    </Card>
  );
}
