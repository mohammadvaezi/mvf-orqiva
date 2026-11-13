// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
// ── [PCODE-196 | S15 | v0.1.0] B8.4 VS Code: ideation interview, and presence per file and block (workspace switch, off by default) ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-115 | S15 | v0.1.0] Add settings and user management: profile, password, tokens, members, invitations, project settings ──
//    Why:  the settings sections: about me (profile, password, personal tokens) and, for admins, about the
//          workspace (name and presence, members with their roles, invitations). A secret (a token, an
//          invitation link) is shown once, with a copy button, and never again.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, type Me } from './core/api.js';
import { Icon } from './core/icons.js';
import { localTime } from './views.js';
import { Avatar, Card, EmptyState, ROLE_NAME } from './shell.js';

const W = (workspaceId: string, path: string): string => '/api/workspaces/' + workspaceId + path;

/** A one-line result under a form: saved, or what went wrong. */
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

export function CopyField(props: { label: string; value: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <div className="pe-copy">
      <label className="pe-small pe-muted">{props.label}</label>
      <div className="pe-copy-row">
        <input
          className="pe-input pe-mono"
          readOnly
          value={props.value}
          aria-label={props.label}
          onFocus={(e) => {
            e.currentTarget.select();
          }}
        />
        <button
          type="button"
          className="pe-btn pe-btn--secondary"
          onClick={() => {
            void navigator.clipboard.writeText(props.value).then(() => {
              setCopied(true);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function ProfileSection(props: { me: Me; onChanged: () => void }): ReactNode {
  const [name, setName] = useState(props.me.user.name);
  const [nameMsg, setNameMsg] = useState<{ ok?: string; error?: string }>({});
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok?: string; error?: string }>({});
  return (
    <>
      <Card title="Profile" subtitle="How others see you in this workspace.">
        <form
          className="pe-form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void api('PATCH', '/auth/me', { name: name.trim() }).then((r) => {
              if (r.ok) {
                setNameMsg({ ok: 'Saved.' });
                props.onChanged();
              } else setNameMsg({ error: r.error.message });
            });
          }}
        >
          <div className="pe-profile-head">
            <Avatar id={props.me.user.id} name={name || props.me.user.name} size="lg" />
            <div>
              <div className="pe-account-name">{props.me.user.name}</div>
              <div className="pe-small pe-muted">{props.me.user.email}</div>
            </div>
          </div>
          <div className="pe-field">
            <label htmlFor="pf-name">Name</label>
            <input
              id="pf-name"
              className="pe-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </div>
          <div className="pe-field">
            <label htmlFor="pf-email">Email</label>
            <input
              id="pf-email"
              className="pe-input"
              value={props.me.user.email}
              readOnly
              aria-describedby="pf-email-hint"
            />
            <span id="pf-email-hint" className="pe-small pe-muted">
              Your sign-in name; it cannot be changed here.
            </span>
          </div>
          <div className="pe-form-actions">
            <button
              type="submit"
              className="pe-btn pe-btn--primary"
              disabled={!name.trim() || name.trim() === props.me.user.name}
            >
              Save
            </button>
            <Outcome {...nameMsg} />
          </div>
        </form>
      </Card>
      <Card title="Password" subtitle="Changing it signs you out everywhere else.">
        <form
          className="pe-form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            if (next.length < 10) {
              setPwMsg({ error: 'The new password needs at least 10 characters.' });
              return;
            }
            if (next !== again) {
              setPwMsg({ error: 'The two new passwords are not the same.' });
              return;
            }
            void api<{ signedOut: number }>('POST', '/auth/password', { current, next }).then(
              (r) => {
                if (r.ok) {
                  setCurrent('');
                  setNext('');
                  setAgain('');
                  setPwMsg({
                    ok:
                      'Changed.' +
                      (r.data.signedOut
                        ? ' ' + String(r.data.signedOut) + ' other session(s) signed out.'
                        : ''),
                  });
                } else setPwMsg({ error: r.error.message });
              },
            );
          }}
        >
          <div className="pe-field">
            <label htmlFor="pw-current">Current password</label>
            <input
              id="pw-current"
              className="pe-input"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value);
              }}
            />
          </div>
          <div className="pe-field">
            <label htmlFor="pw-next">New password</label>
            <input
              id="pw-next"
              className="pe-input"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => {
                setNext(e.target.value);
              }}
            />
          </div>
          <div className="pe-field">
            <label htmlFor="pw-again">New password again</label>
            <input
              id="pw-again"
              className="pe-input"
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(e) => {
                setAgain(e.target.value);
              }}
            />
          </div>
          <div className="pe-form-actions">
            <button type="submit" className="pe-btn pe-btn--primary" disabled={!current || !next}>
              Change password
            </button>
            <Outcome {...pwMsg} />
          </div>
        </form>
      </Card>
    </>
  );
}

interface TokenRow {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function TokensSection(): ReactNode {
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState('');
  const [made, setMade] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<TokenRow[]>('GET', '/auth/tokens');
    if (r.ok) setTokens(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Card
      title="Personal tokens"
      subtitle="For pe, the VS Code extension and scripts. A token acts as you; keep it secret."
    >
      <form
        className="pe-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void api<{ token: string }>('POST', '/auth/tokens', { name: name.trim() }).then(
            async (r) => {
              if (!r.ok) {
                setError(r.error.message);
                return;
              }
              setError('');
              setName('');
              setMade(r.data.token);
              await load();
            },
          );
        }}
      >
        <input
          className="pe-input"
          aria-label="Token name"
          placeholder="What is it for? e.g. orq on my laptop"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <button type="submit" className="pe-btn pe-btn--primary" disabled={!name.trim()}>
          Create token
        </button>
      </form>
      <Outcome error={error} />
      {made ? (
        <div className="pe-notice-ok" role="status">
          <CopyField label="Your new token, shown only now" value={made} />
          <p className="pe-small pe-muted">
            Use it with <code>orq login --server {window.location.origin} --token …</code>
          </p>
        </div>
      ) : null}
      {!tokens ? (
        <p className="pe-muted" role="status">
          Loading…
        </p>
      ) : tokens.length === 0 ? (
        <EmptyState icon="key" title="No tokens yet" />
      ) : (
        <table className="pe-grid-table" aria-label="Tokens">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Created</th>
              <th scope="col">Last used</th>
              <th scope="col">
                <span className="pe-visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((tk) => (
              <tr key={tk.id}>
                <td>
                  <Icon name="key" size={16} /> {tk.name}
                </td>
                <td className="pe-muted">{localTime(tk.createdAt)}</td>
                <td className="pe-muted">{tk.lastUsedAt ? localTime(tk.lastUsedAt) : 'never'}</td>
                <td className="pe-cell-actions">
                  <button
                    type="button"
                    className="pe-btn pe-btn--text"
                    onClick={() => {
                      void api('DELETE', '/auth/tokens/' + tk.id).then(() => load());
                    }}
                  >
                    Revoke
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

interface WorkspaceInfo {
  id: string;
  name: string;
  memberCount: number;
  presenceEnabled: boolean;
  presenceFiles: boolean; // [PCODE-196 | S15 | v0.1.0]
}

export function WorkspaceSection(props: { workspaceId: string; onChanged: () => void }): ReactNode {
  const [ws, setWs] = useState<WorkspaceInfo | null>(null);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  useEffect(() => {
    void api<WorkspaceInfo>('GET', W(props.workspaceId, '')).then((r) => {
      if (r.ok) {
        setWs(r.data);
        setName(r.data.name);
      }
    });
  }, [props.workspaceId]);
  if (!ws)
    return (
      <Card title="Workspace">
        <p className="pe-muted" role="status">
          Loading…
        </p>
      </Card>
    );
  const save = (fields: Partial<WorkspaceInfo>): void => {
    void api<WorkspaceInfo>('PATCH', W(props.workspaceId, ''), fields).then((r) => {
      if (r.ok) {
        setWs(r.data);
        setMsg({ ok: 'Saved.' });
        props.onChanged();
      } else setMsg({ error: r.error.message });
    });
  };
  return (
    <Card
      title="Workspace"
      subtitle={String(ws.memberCount) + (ws.memberCount === 1 ? ' member' : ' members')}
    >
      <form
        className="pe-form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save({ name: name.trim() });
        }}
      >
        <div className="pe-field">
          <label htmlFor="ws-name">Name</label>
          <input
            id="ws-name"
            className="pe-input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
        <label className="pe-toggle">
          <input
            type="checkbox"
            checked={ws.presenceEnabled}
            onChange={(e) => {
              save({ presenceEnabled: e.target.checked });
            }}
          />
          <span>
            <strong>Show who is where</strong>
            <span className="pe-small pe-muted">
              {' '}
              Avatars on the tasks and pages people have open.
            </span>
          </span>
        </label>
        {/* [PCODE-196 | S15 | v0.1.0] files are a separate decision, off until an admin switches it on */}
        <label className="pe-toggle">
          <input
            type="checkbox"
            checked={ws.presenceFiles}
            disabled={!ws.presenceEnabled}
            onChange={(e) => {
              save({ presenceFiles: e.target.checked });
            }}
          />
          <span>
            <strong>Show the file people work in</strong>
            <span className="pe-small pe-muted">
              {' '}
              VS Code also says which file is open, so colleagues see who works on the same code.
              Off by default; guests never see files.
            </span>
          </span>
        </label>
        <div className="pe-form-actions">
          <button
            type="submit"
            className="pe-btn pe-btn--primary"
            disabled={!name.trim() || name.trim() === ws.name}
          >
            Save
          </button>
          <Outcome {...msg} />
        </div>
      </form>
    </Card>
  );
}

interface Member {
  userId: string;
  email: string;
  name: string;
  role: string;
  joinedAt: string;
}
interface Invitation {
  id: string;
  email: string;
  role: string;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
}

export function MembersSection(props: { workspaceId: string; me: Me; role: string }): ReactNode {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [link, setLink] = useState<string | null>(null);
  // [PCODE-237 | S15 | v0.1.0]
  const [mailedTo, setMailedTo] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<{ name: string; url: string } | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const load = useCallback(async () => {
    const [m, i] = await Promise.all([
      api<Member[]>('GET', W(props.workspaceId, '/members')),
      api<Invitation[]>('GET', W(props.workspaceId, '/invitations')),
    ]);
    if (m.ok) setMembers(m.data);
    if (i.ok) setInvites(i.data);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  const isOwner = props.role === 'owner';
  const act = async (method: 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<void> => {
    const r = await api(method, W(props.workspaceId, path), body);
    setMsg(r.ok ? { ok: 'Saved.' } : { error: r.error.message });
    await load();
  };
  return (
    <>
      <Card
        title="Invite people"
        subtitle="They get a link to join with the role you choose. The link works once, for 7 days."
      >
        <form
          className="pe-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void api<{ token: string; mailed: boolean }>(
              'POST',
              W(props.workspaceId, '/invitations'),
              {
                email: email.trim(),
                role: inviteRole,
              },
            ).then(async (r) => {
              if (!r.ok) {
                setMsg({ error: r.error.message });
                return;
              }
              setMsg({});
              // [PCODE-237 | S15 | v0.1.0] with a mail server the invitation went out by mail too
              setMailedTo(r.data.mailed ? email.trim() : null);
              setEmail('');
              setLink(window.location.origin + '/invite/' + r.data.token);
              await load();
            });
          }}
        >
          <input
            className="pe-input"
            type="email"
            aria-label="Email address"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
          <select
            className="pe-select"
            aria-label="Role"
            value={inviteRole}
            onChange={(e) => {
              setInviteRole(e.target.value);
            }}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="guest">Guest (invited projects only)</option>
          </select>
          <button
            type="submit"
            className="pe-btn pe-btn--primary"
            disabled={!/^\S+@\S+\.\S+$/.test(email.trim())}
          >
            <Icon name="mail" size={18} /> Invite
          </button>
        </form>
        {link ? (
          <div className="pe-notice-ok" role="status">
            {mailedTo ? <p className="pe-small">We mailed the invitation to {mailedTo}.</p> : null}
            <CopyField
              label={
                mailedTo
                  ? 'The same link, if you want to send it yourself; it is shown only now'
                  : 'Send this link to the person you invited; it is shown only now'
              }
              value={link}
            />
          </div>
        ) : null}
        {resetFor ? (
          <div className="pe-notice-ok" role="status">
            <CopyField
              label={
                'A link for ' +
                resetFor.name +
                ' to choose a new password: hand it over yourself; it works once, for 24 hours'
              }
              value={resetFor.url}
            />
          </div>
        ) : null}
        {invites.length ? (
          <table className="pe-grid-table" aria-label="Open invitations">
            <thead>
              <tr>
                <th scope="col">Invited</th>
                <th scope="col">Role</th>
                <th scope="col">By</th>
                <th scope="col">Expires</th>
                <th scope="col">
                  <span className="pe-visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>
                    <span className="pe-chip">{ROLE_NAME[i.role] ?? i.role}</span>
                  </td>
                  <td className="pe-muted">{i.invitedBy ?? '—'}</td>
                  <td className="pe-muted">{localTime(i.expiresAt)}</td>
                  <td className="pe-cell-actions">
                    <button
                      type="button"
                      className="pe-btn pe-btn--text"
                      onClick={() => void act('DELETE', '/invitations/' + i.id)}
                    >
                      Withdraw
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
      <Card title="Members" subtitle={members ? String(members.length) + ' people' : undefined}>
        <Outcome {...msg} />
        {!members ? (
          <p className="pe-muted" role="status">
            Loading…
          </p>
        ) : (
          <table className="pe-grid-table" aria-label="Members">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                <th scope="col">Joined</th>
                <th scope="col">
                  <span className="pe-visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const self = m.userId === props.me.user.id;
                const locked = m.role === 'owner' && !isOwner;
                return (
                  <tr key={m.userId}>
                    <td>
                      <span className="pe-person">
                        <Avatar id={m.userId} name={m.name} size="sm" />
                        <span>
                          <strong>{m.name}</strong>
                          {self ? <span className="pe-muted"> (you)</span> : null}
                          <span className="pe-small pe-muted pe-block">{m.email}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <select
                        className="pe-select"
                        aria-label={'Role of ' + m.name}
                        value={m.role}
                        disabled={locked || self}
                        onChange={(e) =>
                          void act('PATCH', '/members/' + m.userId, { role: e.target.value })
                        }
                      >
                        {isOwner || m.role === 'owner' ? (
                          <option value="owner">Owner</option>
                        ) : null}
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                        <option value="guest">Guest</option>
                      </select>
                    </td>
                    <td className="pe-muted">{localTime(m.joinedAt)}</td>
                    <td className="pe-cell-actions">
                      {/* [PCODE-237 | S15 | v0.1.0] a link to a new password, handed over in person */}
                      {!self && !locked ? (
                        <button
                          type="button"
                          className="pe-btn pe-btn--text"
                          onClick={() => {
                            void api<{ url: string; expiresAt: string }>(
                              'POST',
                              W(props.workspaceId, '/members/' + m.userId + '/reset-link'),
                            ).then((r) => {
                              if (!r.ok) {
                                setMsg({ error: r.error.message });
                                return;
                              }
                              setMsg({});
                              setResetFor({
                                name: m.name,
                                url: r.data.url.startsWith('http')
                                  ? r.data.url
                                  : window.location.origin + r.data.url,
                              });
                            });
                          }}
                        >
                          Reset link
                        </button>
                      ) : null}
                      {!self && !locked ? (
                        <button
                          type="button"
                          className="pe-btn pe-btn--text pe-danger-text"
                          onClick={() => void act('DELETE', '/members/' + m.userId)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

// ── [PCODE-237 | S15 | v0.1.0] mail: whether this server sends it, a test mail, the last mails ──
interface MailState {
  configured: boolean;
  from: string | null;
  server: string | null;
  security: string | null;
  recent: {
    to: string;
    subject: string;
    kind: string;
    status: string;
    attempts: number;
    error: string;
    createdAt: string;
  }[];
}

export function MailSection(props: { workspaceId: string }): ReactNode {
  const [state, setState] = useState<MailState | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const load = useCallback(async () => {
    const r = await api<MailState>('GET', W(props.workspaceId, '/mail'));
    if (r.ok) setState(r.data);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Card
      title="Mail"
      subtitle="Password resets, invitations, notifications by email and the daily digest go out through the mail server of this Orqiva server."
    >
      {!state ? (
        <p className="pe-muted" role="status">
          Loading…
        </p>
      ) : !state.configured ? (
        <p className="pe-muted">
          This server sends no mail yet. Whoever runs it sets ORQIVA_SMTP_HOST, ORQIVA_MAIL_FROM
          and, if the mail server needs it, ORQIVA_SMTP_USER and ORQIVA_SMTP_PASSWORD. Until then,
          invitations and password resets work with links you hand over.
        </p>
      ) : (
        <>
          <p className="pe-small">
            From <strong>{state.from}</strong> through {state.server} ({state.security}).
          </p>
          <div className="pe-inline-form">
            <button
              type="button"
              className="pe-btn pe-btn--secondary"
              onClick={() => {
                void api<{ to: string }>('POST', W(props.workspaceId, '/mail/test')).then(
                  async (r) => {
                    setMsg(
                      r.ok
                        ? { ok: 'A test mail is on its way to ' + r.data.to + '.' }
                        : { error: r.error.message },
                    );
                    await load();
                  },
                );
              }}
            >
              <Icon name="mail" size={16} /> Send me a test mail
            </button>
          </div>
          <Outcome {...msg} />
          {state.recent.length ? (
            <table className="pe-grid-table" aria-label="Last mails">
              <thead>
                <tr>
                  <th scope="col">To</th>
                  <th scope="col">Subject</th>
                  <th scope="col">State</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {state.recent.map((m, i) => (
                  <tr key={String(i) + m.createdAt}>
                    <td>{m.to}</td>
                    <td>{m.subject}</td>
                    <td className={m.status === 'failed' ? 'pe-danger-text' : 'pe-muted'}>
                      {m.status === 'sent'
                        ? 'sent'
                        : m.status === 'failed'
                          ? 'failed: ' + m.error
                          : m.attempts
                            ? 'trying again (' + m.error + ')'
                            : 'waiting'}
                    </td>
                    <td className="pe-muted">{localTime(m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      )}
    </Card>
  );
}
