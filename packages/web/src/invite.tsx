// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-339 | S15 | v0.1.0] T34.1d Portal magic-link sign-in and passwordless invitations, MFA required per client ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-115 | S15 | v0.1.0] Add settings and user management: profile, password, tokens, members, invitations, project settings ──
//    Why:  the page an invitation link opens. It says who invited whom into which workspace, with which
//          role; a new person chooses a name and password and is signed in, an existing account joins
//          with one click once signed in. A used, withdrawn or expired link says so plainly.
import { useEffect, useState, type ReactNode } from 'react';
import { api, type Me } from './core/api.js';
import { Logo } from './core/icons.js';
import { ROLE_NAME } from './shell.js';

interface InvitationInfo {
  workspaceName: string;
  email: string;
  role: string;
  invitedBy: string | null;
  expiresAt: string;
  accountExists: boolean;
  forClient?: boolean; // [PCODE-339 | S15 | v0.1.0]
}

export const inviteToken = (path: string): string | null =>
  /^\/invite\/([A-Za-z0-9_-]{43})$/.exec(path)?.[1] ?? null;

export function InviteScreen(props: {
  token: string;
  me: Me | null;
  onJoined: () => Promise<void>;
  go: (p: string) => void;
}): ReactNode {
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [problem, setProblem] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<InvitationInfo>('GET', '/auth/invitations/' + props.token).then((r) => {
      if (r.ok) setInfo(r.data);
      else setProblem(r.error.message);
    });
  }, [props.token]);
  const accept = (body: Record<string, string>): void => {
    setBusy(true);
    void api('POST', '/auth/invitations/' + props.token + '/accept', body).then(async (r) => {
      setBusy(false);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      await props.onJoined();
      props.go('/');
    });
  };
  const signedInAsOther = props.me && info && props.me.user.email.toLowerCase() !== info.email;
  return (
    <main className="pe-auth">
      <div className="pe-card pe-invite">
        <div className="pe-brand pe-brand--logo">
          <Logo /> Orqiva
        </div>
        {problem ? (
          <>
            <h1>This link does not work</h1>
            <p className="pe-muted">{problem}. Ask the person who invited you for a new one.</p>
          </>
        ) : !info ? (
          <p className="pe-muted" role="status">
            Loading…
          </p>
        ) : (
          <>
            <h1>Join {info.workspaceName}</h1>
            <p className="pe-muted">
              {info.invitedBy ? info.invitedBy + ' invited ' : 'You are invited as '}
              <strong>{info.email}</strong>
              {info.invitedBy ? '' : ''} as <strong>{ROLE_NAME[info.role] ?? info.role}</strong>.
            </p>
            {signedInAsOther ? (
              <p className="pe-banner">
                You are signed in as {props.me?.user.email}. Sign out and open this link again to
                join as {info.email}.
              </p>
            ) : props.me ? (
              <button
                type="button"
                className="pe-btn pe-btn--primary pe-btn--block"
                disabled={busy}
                onClick={() => {
                  accept({});
                }}
              >
                Join {info.workspaceName}
              </button>
            ) : info.accountExists ? (
              <>
                <p>An account for {info.email} exists. Sign in, then open this link again.</p>
                <button
                  type="button"
                  className="pe-btn pe-btn--primary pe-btn--block"
                  onClick={() => {
                    props.go('/login');
                  }}
                >
                  Sign in
                </button>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!name.trim()) {
                    setError('Tell us your name.');
                    return;
                  }
                  // [PCODE-339 | S15 | v0.1.0] a client's contact may leave the password out
                  if (password.length < 10 && !(info.forClient && !password)) {
                    setError('The password needs at least 10 characters.');
                    return;
                  }
                  accept(password ? { name: name.trim(), password } : { name: name.trim() });
                }}
                noValidate
              >
                <div className="pe-field">
                  <label htmlFor="iv-name">Your name</label>
                  <input
                    id="iv-name"
                    className="pe-input"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                    }}
                  />
                </div>
                <div className="pe-field">
                  <label htmlFor="iv-password">
                    {info.forClient ? 'Choose a password (or leave it empty)' : 'Choose a password'}
                  </label>
                  <input
                    id="iv-password"
                    className="pe-input"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                    }}
                  />
                </div>
                <button
                  type="submit"
                  className="pe-btn pe-btn--primary pe-btn--block"
                  disabled={busy}
                >
                  Create account and join
                </button>
                {info.forClient ? (
                  <p className="pe-small pe-muted">
                    Without a password you sign in with a link we email you each time.
                  </p>
                ) : null}
              </form>
            )}
            {error ? (
              <div className="pe-field-error" role="alert">
                {error}
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
