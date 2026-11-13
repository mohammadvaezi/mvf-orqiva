// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-349 | S15 | v0.1.0] T35.2b Slack and Teams bridges, personal calendar feed, CI pipeline runs ──
// ── [PCODE-348 | S15 | v0.1.0] T35.2a Integrations hub; email-in for replies to messages and ideas by email ──
//    Why:  Settings › Integrations: everything the workspace connects to, with its state and a link to where
//          it is set up; and email-in, set up here: the inbound domain, the webhook for the mail provider
//          (its key shown once), an address per project for ideas, and what arrived lately.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { BridgesPanel, CalendarFeedCard } from './bridgespanel.js'; // [PCODE-349 | S15 | v0.1.0]
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

interface Integration {
  key: string;
  name: string;
  group: string;
  state: 'connected' | 'off' | 'built-in';
  detail: string;
  where: string | null;
}

interface EmailIn {
  domain: string | null;
  since: string | null;
  webhook: string;
  ideas: { projectId: string; projectKey: string; projectName: string; address: string }[];
  recent: {
    at: string;
    sender: string;
    recipient: string;
    subject: string;
    outcome: string;
    detail: string;
  }[];
}

const STATE: Record<Integration['state'], { text: string; tone: 'success' | 'neutral' | 'info' }> =
  {
    connected: { text: 'connected', tone: 'success' },
    off: { text: 'not set up', tone: 'neutral' },
    'built-in': { text: 'built in', tone: 'info' },
  };

/** The integrations grouped in their order of first appearance. */
export function groupIntegrations(list: readonly Integration[]): [string, Integration[]][] {
  const out = new Map<string, Integration[]>();
  for (const i of list) out.set(i.group, [...(out.get(i.group) ?? []), i]);
  return [...out.entries()];
}

export function IntegrationsSection(props: {
  workspaceId: string;
  go: (p: string) => void;
}): ReactNode {
  const [list, setList] = useState<Integration[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ integrations: Integration[] }>(
      'GET',
      W(props.workspaceId, '/integrations'),
    );
    if (r.ok) setList(r.data.integrations);
    else setError(r.error.message);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {list
        ? groupIntegrations(list).map(([group, items]) => (
            <Card key={group} title={group} flush>
              <ul className="pv-rows">
                {items.map((i) => (
                  <li key={i.key} className="pv-row pv-integration">
                    <span className="pv-row-main">
                      <span className="pv-row-title">{i.name}</span>
                      <span className="pv-row-sub">{i.detail}</span>
                    </span>
                    <Chip tone={STATE[i.state].tone}>{STATE[i.state].text}</Chip>
                    {i.where ? (
                      <a
                        className="pv-link pv-small"
                        href={i.where}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || !i.where || i.where.includes('#')) return;
                          e.preventDefault();
                          props.go(i.where);
                        }}
                      >
                        Set up
                      </a>
                    ) : (
                      <span className="pv-small pv-muted">
                        {i.state === 'built-in' ? '' : 'on the server'}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))
        : null}
      <EmailInPanel workspaceId={props.workspaceId} onChanged={() => void load()} />
      {/* [PCODE-349 | S15 | v0.1.0] */}
      <BridgesPanel workspaceId={props.workspaceId} onChanged={() => void load()} />
      <CalendarFeedCard workspaceId={props.workspaceId} />
    </div>
  );
}

function EmailInPanel(props: { workspaceId: string; onChanged: () => void }): ReactNode {
  const [d, setD] = useState<EmailIn | null>(null);
  const [domain, setDomain] = useState('');
  const [made, setMade] = useState<{ webhook: string } | null>(null);
  const [projects, setProjects] = useState<{ id: string; key: string; name: string }[]>([]);
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const [r, p] = await Promise.all([
      api<EmailIn>('GET', W(props.workspaceId, '/email-in')),
      api<{ id: string; key: string; name: string; archivedAt: string | null }[]>(
        'GET',
        W(props.workspaceId, '/projects'),
      ),
    ]);
    if (r.ok) {
      setD(r.data);
      setDomain((x) => x || (r.data.domain ?? ''));
    } else setError(r.error.message);
    if (p.ok) setProjects(p.data.filter((x) => !x.archivedAt));
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  const setUp = async (): Promise<void> => {
    const r = await api<{ webhook: string }>('PUT', W(props.workspaceId, '/email-in'), { domain });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError('');
    setMade(r.data);
    await load();
    props.onChanged();
  };
  const off = async (): Promise<void> => {
    await api('DELETE', W(props.workspaceId, '/email-in'));
    setMade(null);
    await load();
    props.onChanged();
  };
  const ideas = async (): Promise<void> => {
    const r = await api('POST', W(props.workspaceId, '/projects/' + pick + '/email-ideas'));
    if (!r.ok) setError(r.error.message);
    else setPick('');
    await load();
  };
  if (!d) return null;
  return (
    <Card title="Email in">
      <div id="email-in" className="pv-stack">
        <p className="pv-small pv-muted">
          People answer notices about messages from their mail, and members send ideas to a project
          by mail. Point a domain’s incoming mail at your mail provider (Postmark or any that posts
          JSON) and give it the webhook below.
        </p>
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="v2-inline">
          <input
            className="v2-input v2-input--sm"
            aria-label="Inbound mail domain"
            placeholder="in.example.com"
            value={domain}
            onChange={(e) => {
              setDomain(e.target.value.trim().toLowerCase());
            }}
          />
          <Button
            size="sm"
            kind="primary"
            disabled={!/\.[a-z]{2,}$/.test(domain)}
            onClick={() => void setUp()}
          >
            {d.domain ? 'Save and make a new key' : 'Set up email in'}
          </Button>
          {d.domain ? (
            <Button size="sm" kind="ghost" onClick={() => void off()}>
              Turn off
            </Button>
          ) : null}
        </div>
        {made ? (
          <div className="pv-callout pv-callout--warn">
            <div>
              <strong>The webhook with its key, shown only now.</strong>
              <code className="pv-code pv-break">{made.webhook}</code>
            </div>
          </div>
        ) : d.domain ? (
          <p className="pv-small">
            Webhook: <code className="pv-code">{d.webhook}?key=…</code> (make a new key to see it
            again)
          </p>
        ) : null}
        {d.domain ? (
          <>
            <strong className="pv-small">Ideas by mail</strong>
            {d.ideas.length ? (
              <ul className="pv-list pv-small">
                {d.ideas.map((x) => (
                  <li key={x.projectId}>
                    {x.projectKey} {x.projectName}: <code className="pv-code">{x.address}</code>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="v2-inline">
              <select
                className="v2-input v2-input--sm"
                aria-label="Project for an ideas address"
                value={pick}
                onChange={(e) => {
                  setPick(e.target.value);
                }}
              >
                <option value="">Project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.key} {p.name}
                  </option>
                ))}
              </select>
              <Button size="sm" disabled={!pick} onClick={() => void ideas()}>
                {d.ideas.some((x) => x.projectId === pick) ? 'New address' : 'Make an address'}
              </Button>
            </div>
            <strong className="pv-small">Received lately</strong>
            {d.recent.length ? (
              <table className="pv-table">
                <tbody>
                  {d.recent.map((r) => (
                    <tr key={r.at + r.sender}>
                      <td className="pv-small pv-muted">
                        {new Date(r.at).toLocaleString(fmtLocale())}
                      </td>
                      <td className="pv-small">{r.sender}</td>
                      <td className="pv-small">{r.subject}</td>
                      <td>
                        <Chip tone={r.outcome === 'refused' ? 'warning' : 'success'}>
                          {r.outcome}
                        </Chip>
                      </td>
                      <td className="pv-small pv-muted">{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="pv-small pv-muted">Nothing arrived yet.</p>
            )}
          </>
        ) : null}
      </div>
    </Card>
  );
}
