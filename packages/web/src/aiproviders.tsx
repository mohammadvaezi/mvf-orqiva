// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-334 | S15 | v0.1.0] T33.4c MCP servers per agent: registry, our own MCP client, tools in runs under the agent's rules ──
// ── [PCODE-332 | S15 | v0.1.0] T33.4a Nested traces with latency and commits, agent rate limits, provider limits and health ──
// ── [PCODE-242 | S15 | v0.1.0] T24.3 AI providers and file reading in the web app ──
//    Why:  Settings, AI providers: the workspace's connections (Anthropic, OpenAI, Azure OpenAI, Gemini,
//          Bedrock, Grok, demo) in one compact table with their keys' last characters, their models, what
//          each is used for and how its last call went; adding or changing one shows only the fields that
//          provider needs; a test asks the model one word. Below, which connection serves agents, takes
//          over when that one fails, reads documents and pictures, and writes transcripts; a connection
//          that cannot do a job is not offered for it.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import { Card } from './shell.js';
import { localTime } from './views.js';
import { McpServersSection } from './mcpservers.js'; // [PCODE-334 | S15 | v0.1.0]
import { fmtLocale } from './core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export interface Connection {
  id: string;
  provider: string;
  label: string;
  endpoint: string | null;
  region: string | null;
  auth: string | null;
  hasKey: boolean;
  hint: string;
  defaultModel: string;
  readingModel: string;
  audioModel: string;
  models: { agent: string; reading: string; audio: string };
  reads: { images: boolean; pdf: boolean; audio: boolean };
  uses: string[];
  agents: number;
  lastUsedAt: string | null;
  lastError: string;
  createdAt: string;
  // [PCODE-332 | S15 | v0.1.0] its limits and health
  requestsPerMinute?: number | null;
  tokensPerMinute?: number | null;
  health?: {
    status: 'ok' | 'degraded' | 'down' | 'unused';
    calls: number;
    failures: number;
    avgMs: number | null;
    maxMs: number | null;
  };
}

// [PCODE-332 | S15 | v0.1.0] "working · 42 calls, 1 failed · 1,2 s on average" and its limits
const HEALTH_TEXT = { ok: 'working', degraded: 'failing at times', down: 'down', unused: 'unused' };
export function healthLine(
  c: Pick<Connection, 'health' | 'requestsPerMinute' | 'tokensPerMinute'>,
): string {
  const h = c.health;
  const limits = [
    ...(c.requestsPerMinute ? [String(c.requestsPerMinute) + ' calls'] : []),
    ...(c.tokensPerMinute ? [c.tokensPerMinute.toLocaleString(fmtLocale()) + ' tokens'] : []),
  ];
  const parts = [
    ...(h ? [HEALTH_TEXT[h.status]] : []),
    ...(h?.calls
      ? [
          String(h.calls) +
            (h.calls === 1 ? ' call' : ' calls') +
            (h.failures ? ', ' + String(h.failures) + ' failed' : '') +
            ' in 2 days',
        ]
      : []),
    ...(h?.avgMs != null ? [(h.avgMs / 1000).toFixed(1).replace('.', ',') + ' s on average'] : []),
    ...(limits.length ? ['at most ' + limits.join(' and ') + ' a minute'] : []),
  ];
  return parts.join(' · ');
}
export interface ProviderInfo {
  provider: string;
  label: string;
  reads: { images: boolean; pdf: boolean; audio: boolean };
  suggested: { model: string; reading: string; audio: string };
  keyHelp: string;
}
export interface AiSettings {
  agentConnectionId: string | null;
  fallbackConnectionId: string | null;
  readingConnectionId: string | null;
  audioConnectionId: string | null;
}
interface Tools {
  tools: { name: string; description: string; needsApproval: boolean }[];
}

/** The fields a provider's form shows besides the name and the models. */
export function fieldsFor(
  provider: string,
  auth: string,
): ('key' | 'endpoint' | 'region' | 'auth' | 'accessKeys')[] {
  if (provider === 'demo') return [];
  if (provider === 'azure') return ['endpoint', 'key'];
  if (provider === 'bedrock')
    return auth === 'accessKeys' ? ['region', 'auth', 'accessKeys'] : ['region', 'auth', 'key'];
  return ['key'];
}

const USE_TEXT: Record<string, string> = {
  agents: 'agents',
  fallback: 'fallback',
  reading: 'reading files',
  audio: 'transcripts',
};

/** One line on how a connection's last call went. */
export function stateOf(c: Pick<Connection, 'lastError' | 'lastUsedAt' | 'provider'>): {
  tone: 'ok' | 'bad' | 'none';
  text: string;
} {
  if (c.lastError) return { tone: 'bad', text: c.lastError };
  if (c.lastUsedAt) return { tone: 'ok', text: 'used ' + localTime(c.lastUsedAt) };
  return { tone: 'none', text: c.provider === 'demo' ? 'no key needed' : 'not used yet' };
}

interface Draft {
  id: string | null;
  provider: string;
  label: string;
  key: string;
  endpoint: string;
  region: string;
  auth: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  defaultModel: string;
  readingModel: string;
  audioModel: string;
  rpm: string; // [PCODE-332 | S15 | v0.1.0]
  tpm: string;
}

const emptyDraft = (provider = 'openai'): Draft => ({
  id: null,
  provider,
  label: '',
  key: '',
  endpoint: '',
  region: '',
  auth: 'apiKey',
  accessKeyId: '',
  secretAccessKey: '',
  sessionToken: '',
  defaultModel: '',
  readingModel: '',
  audioModel: '',
  rpm: '',
  tpm: '',
});

export function AiProvidersSection(props: { workspaceId: string }): ReactNode {
  const ws = props.workspaceId;
  const [list, setList] = useState<{ connections: Connection[]; settings: AiSettings } | null>(
    null,
  );
  const [infos, setInfos] = useState<ProviderInfo[]>([]);
  const [tools, setTools] = useState<Tools['tools']>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tested, setTested] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const load = useCallback(async () => {
    const r = await api<{ connections: Connection[]; settings: AiSettings }>(
      'GET',
      W(ws, '/ai/connections'),
    );
    if (r.ok) setList(r.data);
    else setMsg({ error: r.error.message });
  }, [ws]);
  useEffect(() => {
    void load();
    void api<ProviderInfo[]>('GET', W(ws, '/ai/providers')).then((r) => {
      if (r.ok) setInfos(r.data);
    });
    void api<Tools>('GET', W(ws, '/agents/provider')).then((r) => {
      if (r.ok) setTools(r.data.tools);
    });
  }, [ws, load]);

  const info = (p: string): ProviderInfo | undefined => infos.find((i) => i.provider === p);
  const save = async (d: Draft): Promise<void> => {
    const fields = fieldsFor(d.provider, d.auth);
    const body: Record<string, unknown> = {
      ...(d.label.trim() ? { label: d.label.trim() } : {}),
      ...(fields.includes('key') && d.key.trim() ? { key: d.key.trim() } : {}),
      ...(fields.includes('endpoint') && d.endpoint.trim() ? { endpoint: d.endpoint.trim() } : {}),
      ...(fields.includes('region') && d.region.trim() ? { region: d.region.trim() } : {}),
      ...(fields.includes('auth') ? { auth: d.auth } : {}),
      ...(fields.includes('accessKeys') && d.accessKeyId.trim()
        ? {
            accessKeyId: d.accessKeyId.trim(),
            secretAccessKey: d.secretAccessKey.trim(),
            ...(d.sessionToken.trim() ? { sessionToken: d.sessionToken.trim() } : {}),
          }
        : {}),
      defaultModel: d.defaultModel.trim(),
      readingModel: d.readingModel.trim(),
      audioModel: d.audioModel.trim(),
      // [PCODE-332 | S15 | v0.1.0] an empty limit takes it away
      ...(d.id || d.rpm.trim() ? { requestsPerMinute: d.rpm.trim() ? Number(d.rpm) : null } : {}),
      ...(d.id || d.tpm.trim() ? { tokensPerMinute: d.tpm.trim() ? Number(d.tpm) : null } : {}),
    };
    if (!d.id && !body['defaultModel']) delete body['defaultModel'];
    const r = d.id
      ? await api('PATCH', W(ws, '/ai/connections/' + d.id), body)
      : await api('POST', W(ws, '/ai/connections'), { provider: d.provider, ...body });
    if (!r.ok) {
      setMsg({ error: r.error.message });
      return;
    }
    setDraft(null);
    setMsg({ ok: d.id ? 'Saved.' : 'Connection added.' });
    await load();
  };
  const test = async (c: Connection): Promise<void> => {
    setTested({ ...tested, [c.id]: 'Asking ' + (c.models.agent || 'the model') + '…' });
    const r = await api<{ ok: boolean; answer: string; ms: number; error: string; model: string }>(
      'POST',
      W(ws, '/ai/connections/' + c.id + '/test'),
      {},
    );
    setTested((t) => ({
      ...t,
      [c.id]: !r.ok
        ? r.error.message
        : r.data.ok
          ? r.data.model + ' answered in ' + String(r.data.ms) + ' ms: “' + r.data.answer + '”'
          : r.data.error,
    }));
    await load();
  };
  const remove = async (c: Connection): Promise<void> => {
    const r = await api('DELETE', W(ws, '/ai/connections/' + c.id));
    setMsg(r.ok ? { ok: c.label + ' removed.' } : { error: r.error.message });
    await load();
  };
  const choose = async (field: keyof AiSettings, id: string): Promise<void> => {
    const r = await api('PUT', W(ws, '/ai/settings'), { [field]: id || null });
    setMsg(r.ok ? { ok: 'Saved.' } : { error: r.error.message });
    await load();
  };

  if (!list) return <p className="pe-muted">{msg.error ?? 'Loading…'}</p>;
  const { connections, settings } = list;
  const picker = (
    field: keyof AiSettings,
    label: string,
    hint: string,
    can: (c: Connection) => boolean,
  ): ReactNode => {
    const options = connections.filter(can);
    return (
      <div className="pe-field">
        <label htmlFor={'ai-' + field}>{label}</label>
        <select
          id={'ai-' + field}
          className="pe-select"
          value={settings[field] ?? ''}
          onChange={(e) => void choose(field, e.target.value)}
        >
          <option value="">{field === 'agentConnectionId' ? 'None set' : 'None'}</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="pe-small pe-muted">{hint}</span>
      </div>
    );
  };

  return (
    <div className="pe-stack">
      <Card
        title="AI connections"
        subtitle="The model providers this workspace uses. Keys are sealed on the way in and never shown again; only their last characters are."
        actions={
          draft ? null : (
            <button
              type="button"
              className="pe-btn pe-btn--secondary"
              onClick={() => {
                setDraft(emptyDraft());
                setMsg({});
              }}
            >
              Add connection
            </button>
          )
        }
      >
        {connections.length ? (
          <table className="pe-grid-table ai-table" aria-label="AI connections">
            <thead>
              <tr>
                <th scope="col">Connection</th>
                <th scope="col">Key</th>
                <th scope="col">Models</th>
                <th scope="col">Used for</th>
                <th scope="col">Last call</th>
                <th scope="col">
                  <span className="pe-visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => {
                const st = stateOf(c);
                return (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.label}</strong>
                      <div className="pe-small pe-muted">
                        {/* the provider, when the name does not say it already */}
                        {[
                          (info(c.provider)?.label ?? c.provider) === c.label
                            ? ''
                            : (info(c.provider)?.label ?? c.provider),
                          c.endpoint?.replace(/^https:\/\//, '') ?? '',
                          c.region ?? '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td className="pe-mono">{c.hint ? '…' + c.hint : c.hasKey ? 'stored' : '—'}</td>
                    <td className="pe-small">
                      <span className="pe-mono">{c.models.agent || 'the agent’s own'}</span>
                      {c.reads.images || c.reads.pdf ? (
                        <div className="pe-muted">
                          reads with <span className="pe-mono">{c.models.reading || '—'}</span>
                        </div>
                      ) : null}
                      {c.reads.audio ? (
                        <div className="pe-muted">
                          hears with <span className="pe-mono">{c.models.audio || '—'}</span>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {c.uses.map((u) => (
                        <span key={u} className="pe-pill">
                          {USE_TEXT[u] ?? u}
                        </span>
                      ))}
                      {c.agents ? (
                        <span className="pe-pill">
                          {String(c.agents) + (c.agents === 1 ? ' agent' : ' agents')}
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={'pe-small ' + (st.tone === 'bad' ? 'pe-danger-text' : 'pe-muted')}
                    >
                      {st.text}
                      {/* [PCODE-332 | S15 | v0.1.0] health from real calls, and the limits */}
                      {healthLine(c) ? <div className="pe-muted">{healthLine(c)}</div> : null}
                      {tested[c.id] ? <div className="ai-tested">{tested[c.id]}</div> : null}
                    </td>
                    <td className="pe-cell-actions">
                      <button
                        type="button"
                        className="pe-btn pe-btn--text"
                        onClick={() => void test(c)}
                      >
                        Test
                      </button>
                      <button
                        type="button"
                        className="pe-btn pe-btn--text"
                        onClick={() => {
                          setDraft({
                            ...emptyDraft(c.provider),
                            id: c.id,
                            label: c.label,
                            endpoint: c.endpoint ?? '',
                            region: c.region ?? '',
                            auth: c.auth ?? 'apiKey',
                            defaultModel: c.defaultModel,
                            readingModel: c.readingModel,
                            audioModel: c.audioModel,
                            rpm: c.requestsPerMinute ? String(c.requestsPerMinute) : '',
                            tpm: c.tokensPerMinute ? String(c.tokensPerMinute) : '',
                          });
                          setMsg({});
                        }}
                      >
                        Change
                      </button>
                      <button
                        type="button"
                        className="pe-btn pe-btn--text pe-danger-text"
                        onClick={() => void remove(c)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="pe-muted">
            No connection yet. Agents, reading files and transcripts need one; the demo model works
            without a key.
          </p>
        )}
        {draft ? (
          <ConnectionForm
            draft={draft}
            infos={infos}
            onChange={setDraft}
            onCancel={() => {
              setDraft(null);
            }}
            onSave={() => void save(draft)}
          />
        ) : null}
        <Outcome {...msg} />
      </Card>

      <Card
        title="What each connection does"
        subtitle="Agents can also have their own connection and model on the Agents page."
      >
        <div className="pe-form-grid ai-picks">
          {picker(
            'agentConnectionId',
            'Agents',
            'The model agents think with, unless an agent has its own.',
            () => true,
          )}
          {picker(
            'fallbackConnectionId',
            'When it fails',
            'Takes over when the agents’ connection cannot answer.',
            (c) => c.id !== settings.agentConnectionId,
          )}
          {picker(
            'readingConnectionId',
            'Reading files',
            'Reads PDFs and pictures for ideation, documents, evidence and requests.',
            (c) => c.reads.images,
          )}
          {picker(
            'audioConnectionId',
            'Transcripts',
            'Writes out recordings: calls, stand-ups, voice notes.',
            (c) => c.reads.audio,
          )}
        </div>
      </Card>

      {/* [PCODE-334 | S15 | v0.1.0] outside tools through MCP */}
      <McpServersSection workspaceId={ws} />
      {tools.length ? (
        <Card title="Tools" subtitle="What agents may use. Some wait for a person's approval.">
          <ul className="pe-tool-list">
            {tools.map((t) => (
              <li key={t.name}>
                <span className="pe-mono">{t.name}</span>
                {t.needsApproval ? <span className="pe-pill">needs approval</span> : null}
                <div className="pe-small pe-muted">{t.description}</div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function Outcome(props: { ok?: string; error?: string }): ReactNode {
  if (props.error)
    return (
      <div className="pe-field-error" role="alert">
        {props.error}
      </div>
    );
  return props.ok ? (
    <div className="pe-ok" role="status">
      {props.ok}
    </div>
  ) : null;
}

function ConnectionForm(props: {
  draft: Draft;
  infos: ProviderInfo[];
  onChange: (d: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}): ReactNode {
  const d = props.draft;
  const info = props.infos.find((i) => i.provider === d.provider);
  const fields = fieldsFor(d.provider, d.auth);
  const set = (patch: Partial<Draft>): void => {
    props.onChange({ ...d, ...patch });
  };
  const text = (
    id: string,
    label: string,
    value: string,
    onValue: (v: string) => void,
    o: { secret?: boolean; placeholder?: string; mono?: boolean } = {},
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
        value={value}
        onChange={(e) => {
          onValue(e.target.value);
        }}
      />
    </div>
  );
  return (
    <form
      className="pe-form-grid ai-picks ai-form"
      aria-label={d.id ? 'Change the connection' : 'Add a connection'}
      onSubmit={(e) => {
        e.preventDefault();
        props.onSave();
      }}
    >
      {d.id ? null : (
        <div className="pe-field">
          <label htmlFor="ai-new-provider">Provider</label>
          <select
            id="ai-new-provider"
            className="pe-select"
            value={d.provider}
            onChange={(e) => {
              set({ provider: e.target.value });
            }}
          >
            {props.infos.map((i) => (
              <option key={i.provider} value={i.provider}>
                {i.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {text(
        'ai-label',
        'Name',
        d.label,
        (v) => {
          set({ label: v });
        },
        { placeholder: info?.label ?? '' },
      )}
      {fields.includes('endpoint')
        ? text(
            'ai-endpoint',
            'Endpoint',
            d.endpoint,
            (v) => {
              set({ endpoint: v });
            },
            { placeholder: 'https://name.openai.azure.com', mono: true },
          )
        : null}
      {fields.includes('region')
        ? text(
            'ai-region',
            'Region',
            d.region,
            (v) => {
              set({ region: v });
            },
            { placeholder: 'eu-central-1', mono: true },
          )
        : null}
      {fields.includes('auth') ? (
        <div className="pe-field">
          <label htmlFor="ai-auth">Sign in with</label>
          <select
            id="ai-auth"
            className="pe-select"
            value={d.auth}
            onChange={(e) => {
              set({ auth: e.target.value });
            }}
          >
            <option value="apiKey">A Bedrock API key</option>
            <option value="accessKeys">Access keys (signed requests)</option>
          </select>
        </div>
      ) : null}
      {fields.includes('key')
        ? text(
            'ai-key',
            'API key',
            d.key,
            (v) => {
              set({ key: v });
            },
            {
              secret: true,
              placeholder: d.id ? 'Leave empty to keep the stored key' : (info?.keyHelp ?? ''),
            },
          )
        : null}
      {fields.includes('accessKeys') ? (
        <>
          {text(
            'ai-akid',
            'Access key ID',
            d.accessKeyId,
            (v) => {
              set({ accessKeyId: v });
            },
            { mono: true, placeholder: d.id ? 'Leave empty to keep the stored keys' : 'AKIA…' },
          )}
          {text(
            'ai-secret',
            'Secret access key',
            d.secretAccessKey,
            (v) => {
              set({ secretAccessKey: v });
            },
            { secret: true },
          )}
          {text(
            'ai-session',
            'Session token (optional)',
            d.sessionToken,
            (v) => {
              set({ sessionToken: v });
            },
            { secret: true },
          )}
        </>
      ) : null}
      {/* [PCODE-332 | S15 | v0.1.0] the connection's own limits; calls wait for room */}
      {text(
        'ai-rpm',
        'Calls a minute at most',
        d.rpm,
        (v) => {
          set({ rpm: v.replace(/\D/g, '') });
        },
        { placeholder: 'no limit' },
      )}
      {text(
        'ai-tpm',
        'Tokens a minute at most',
        d.tpm,
        (v) => {
          set({ tpm: v.replace(/\D/g, '') });
        },
        { placeholder: 'no limit' },
      )}
      {d.provider !== 'demo' ? (
        <>
          {text(
            'ai-model',
            d.provider === 'azure' ? 'Deployment for agents' : 'Model for agents',
            d.defaultModel,
            (v) => {
              set({ defaultModel: v });
            },
            {
              mono: true,
              placeholder:
                info?.suggested.model || (d.provider === 'bedrock' ? 'anthropic.claude-…' : ''),
            },
          )}
          {info?.reads.images
            ? text(
                'ai-reading',
                d.provider === 'azure' ? 'Deployment for reading' : 'Model for reading files',
                d.readingModel,
                (v) => {
                  set({ readingModel: v });
                },
                { mono: true, placeholder: info.suggested.reading || 'the model for agents' },
              )
            : null}
          {info?.reads.audio
            ? text(
                'ai-audio',
                d.provider === 'azure' ? 'Deployment for transcripts' : 'Model for transcripts',
                d.audioModel,
                (v) => {
                  set({ audioModel: v });
                },
                { mono: true, placeholder: info.suggested.audio },
              )
            : null}
        </>
      ) : null}
      <div className="pe-form-actions">
        <button type="submit" className="pe-btn pe-btn--primary">
          {d.id ? 'Save' : 'Add'}
        </button>
        <button type="button" className="pe-btn pe-btn--text" onClick={props.onCancel}>
          Cancel
        </button>
        {info ? <span className="pe-small pe-muted">{info.keyHelp}</span> : null}
      </div>
    </form>
  );
}
