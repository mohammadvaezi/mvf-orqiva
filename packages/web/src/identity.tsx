// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-362 | S15 | v0.1.0] T35.7d SAML single logout ──
// ── [PCODE-358 | S15 | v0.1.0] T35.6 Accessibility to WCAG 2.2 AA ──
// ── [PCODE-213 | S15 | v0.1.0] T19.2 SCIM 2.0 provisioning (users, role groups, suspend on deactivate) and identity settings (SAML, SCIM tokens) ──
//    Why:  Settings, Single sign-on: an admin connects the company's identity provider (SAML) with what
//          the provider's admins need from us (entity ID, ACS URL, metadata), and makes the SCIM token the
//          provider uses to keep people in step with its directory. A token is shown once.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import { Card } from './shell.js';
import { fmtLocale } from './core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

interface Saml {
  spEntityId: string;
  acsUrl: string;
  metadataUrl: string;
  startUrl: string;
  sloUrl: string; // [PCODE-362 | S15 | v0.1.0]
  connection: {
    idpEntityId: string;
    ssoUrl: string;
    sloUrl: string | null;
    certificateSubject: string;
    domains: string[];
    defaultRole: string;
    enabled: boolean;
    updatedAt: string;
  } | null;
}
interface ScimTokens {
  baseUrl: string;
  tokens: {
    id: string;
    name: string;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
  }[];
}

export const ROLE_CHOICES = ['member', 'tester', 'designer', 'auditor', 'billing', 'guest'];

/** "a.com, b.com" → ['a.com', 'b.com'] */
export const domainsOf = (text: string): string[] =>
  text
    .split(/[\s,;]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);

const day = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(fmtLocale()) : '—';

export function IdentitySection(props: { workspaceId: string }): ReactNode {
  const W = '/api/workspaces/' + props.workspaceId;
  const [saml, setSaml] = useState<Saml | null>(null);
  const [scim, setScim] = useState<ScimTokens | null>(null);
  const [form, setForm] = useState({
    idpEntityId: '',
    ssoUrl: '',
    sloUrl: '',
    certificate: '',
    domains: '',
    defaultRole: 'member',
    enabled: true,
  });
  const [msg, setMsg] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState('');
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      api<Saml>('GET', W + '/saml'),
      api<ScimTokens>('GET', W + '/scim/tokens'),
    ]);
    if (a.ok) {
      setSaml(a.data);
      const c = a.data.connection;
      if (c)
        setForm((f) => ({
          ...f,
          idpEntityId: c.idpEntityId,
          ssoUrl: c.ssoUrl,
          sloUrl: c.sloUrl ?? '',
          domains: c.domains.join(', '),
          defaultRole: c.defaultRole,
          enabled: c.enabled,
        }));
    } else setMsg(a.error.message);
    if (b.ok) setScim(b.data);
  }, [W]);
  useEffect(() => {
    void load();
  }, [load]);
  const field =
    (k: keyof typeof form) =>
    (e: { target: { value: string } }): void => {
      setForm({ ...form, [k]: e.target.value });
    };
  if (!saml) return <p className="pe-muted">{msg || 'Loading…'}</p>;
  return (
    <div className="pe-stack">
      <Card
        title="SAML single sign-on"
        subtitle="People sign in through your company's identity provider."
      >
        <dl className="pe-dl">
          <dt>Entity ID (Audience)</dt>
          <dd className="pe-mono">{saml.spEntityId}</dd>
          <dt>ACS URL (reply URL)</dt>
          <dd className="pe-mono">{saml.acsUrl}</dd>
          <dt>Metadata</dt>
          <dd>
            <a href={saml.metadataUrl} target="_blank" rel="noreferrer">
              {saml.metadataUrl}
            </a>
          </dd>
          {/* [PCODE-362 | S15 | v0.1.0] */}
          <dt>Single logout URL (HTTP-Redirect)</dt>
          <dd className="pe-mono">{saml.sloUrl}</dd>
          <dt>Sign-in link for people</dt>
          <dd className="pe-mono">{saml.startUrl}</dd>
        </dl>
        <form
          className="pe-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void api<Saml>('PUT', W + '/saml', {
              idpEntityId: form.idpEntityId.trim(),
              ssoUrl: form.ssoUrl.trim(),
              sloUrl: form.sloUrl.trim() || null,
              ...(form.certificate.trim() ? { certificate: form.certificate.trim() } : {}),
              domains: domainsOf(form.domains),
              defaultRole: form.defaultRole,
              enabled: form.enabled,
            }).then((r) => {
              setMsg(r.ok ? 'Saved.' : r.error.message);
              if (r.ok) {
                setSaml(r.data);
                setForm({ ...form, certificate: '' });
              }
            });
          }}
        >
          <label className="pe-field">
            <span>Identity provider entity ID</span>
            <input
              className="pe-input"
              value={form.idpEntityId}
              onChange={field('idpEntityId')}
              placeholder="https://idp.example.com/saml"
            />
          </label>
          <label className="pe-field">
            <span>Sign-in URL (HTTP-Redirect, https)</span>
            <input
              className="pe-input"
              value={form.ssoUrl}
              onChange={field('ssoUrl')}
              placeholder="https://idp.example.com/sso"
            />
          </label>
          {/* [PCODE-362 | S15 | v0.1.0] */}
          <label className="pe-field">
            <span>Logout URL (HTTP-Redirect, https; optional)</span>
            <input
              className="pe-input"
              value={form.sloUrl}
              onChange={field('sloUrl')}
              placeholder="https://idp.example.com/slo"
            />
          </label>
          <label className="pe-field">
            <span>
              Signing certificate (PEM)
              {saml.connection
                ? ' · now: ' + saml.connection.certificateSubject + ' (leave empty to keep it)'
                : ''}
            </span>
            <textarea
              className="pe-input pe-mono"
              rows={4}
              value={form.certificate}
              onChange={field('certificate')}
            />
          </label>
          <label className="pe-field">
            <span>Email domains it vouches for (new people only from these)</span>
            <input
              className="pe-input"
              value={form.domains}
              onChange={field('domains')}
              placeholder="example.com, example.de"
            />
          </label>
          <label className="pe-field">
            <span>Role of new people</span>
            <select className="pe-select" value={form.defaultRole} onChange={field('defaultRole')}>
              {ROLE_CHOICES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="pe-check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={() => {
                setForm({ ...form, enabled: !form.enabled });
              }}
            />{' '}
            Single sign-on is on
          </label>
          <div>
            <button type="submit" className="pe-btn pe-btn--primary">
              {saml.connection ? 'Save' : 'Connect'}
            </button>{' '}
            <span className="pe-muted pe-small" role="status">
              {msg}
            </span>
          </div>
        </form>
      </Card>
      <Card
        title="SCIM provisioning"
        subtitle="Your identity provider adds, changes and removes people over SCIM 2.0."
      >
        <p className="pe-small">
          SCIM base URL: <span className="pe-mono">{scim?.baseUrl ?? '…'}</span>. Groups are the
          roles (admin, member, tester, designer, billing, auditor, guest); deactivating someone
          suspends them here.
        </p>
        {fresh ? (
          <p className="pe-callout" role="alert">
            Copy the token now, it is not shown again: <span className="pe-mono">{fresh}</span>
          </p>
        ) : null}
        <ul className="pe-list">
          {(scim?.tokens ?? []).map((t) => (
            <li key={t.id} className="pe-list-row">
              <span>
                <strong>{t.name}</strong>{' '}
                <span className="pe-muted pe-small">
                  made {day(t.createdAt)} · last used {day(t.lastUsedAt)}
                  {t.revokedAt ? ' · revoked ' + day(t.revokedAt) : ''}
                </span>
              </span>
              {!t.revokedAt ? (
                <button
                  type="button"
                  className="pe-btn pe-btn--text"
                  onClick={() => void api('DELETE', W + '/scim/tokens/' + t.id).then(() => load())}
                >
                  Revoke
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <form
          className="pe-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (!tokenName.trim()) return;
            void api<{ token: string }>('POST', W + '/scim/tokens', {
              name: tokenName.trim(),
            }).then((r) => {
              if (r.ok) {
                setFresh(r.data.token);
                setTokenName('');
              } else setMsg(r.error.message);
              void load();
            });
          }}
        >
          {/* [PCODE-358 | S15 | v0.1.0] a name for the field */}
          <input
            className="pe-input"
            aria-label="Token name"
            value={tokenName}
            maxLength={80}
            placeholder="Token name, e.g. Okta"
            onChange={(e) => {
              setTokenName(e.target.value);
            }}
          />{' '}
          <button type="submit" className="pe-btn" disabled={!tokenName.trim()}>
            Make a SCIM token
          </button>
        </form>
      </Card>
    </div>
  );
}
