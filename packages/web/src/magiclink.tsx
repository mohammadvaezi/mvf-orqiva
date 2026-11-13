// ── [PCODE-339 | S15 | v0.1.0] T34.1d Portal magic-link sign-in and passwordless invitations, MFA required per client ──
//    Why:  a client contact signs in with a link by email: one screen asks for it, the other opens it.
//          Opening may ask for the authenticator's code, or, where the client requires a second factor
//          the contact does not have yet, set it up with the secret and recovery codes before signing in.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LinkAskScreen(props: { onGoLogin: () => void }): ReactNode {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ask = async (): Promise<void> => {
    if (!EMAIL.test(email.trim())) {
      setError('Enter the email address the team invited.');
      return;
    }
    setBusy(true);
    const r = await api('POST', '/auth/link', { email: email.trim() });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setSent(true);
  };
  return (
    <main className="pe-auth">
      <div className="pe-card">
        <h1>Sign in with a link</h1>
        <p className="pe-muted">
          For our clients: we email you a link that signs you in once, within 15 minutes.
        </p>
        {sent ? (
          <div className="pe-notice-ok" role="status">
            If {email.trim()} belongs to a client contact, the link is on its way. Check your inbox
            and the spam folder.
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
            noValidate
          >
            {error ? (
              <div className="pe-banner" role="alert">
                {error}
              </div>
            ) : null}
            <div className="pe-field">
              <label htmlFor="ln-email">Email</label>
              <input
                id="ln-email"
                className="pe-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
              />
            </div>
            <button className="pe-btn pe-btn--primary pe-btn--block" type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Email me a link'}
            </button>
          </form>
        )}
        <p className="pe-switch pe-muted">
          <a
            href="/login"
            onClick={(e) => {
              e.preventDefault();
              props.onGoLogin();
            }}
          >
            Sign in with a password instead
          </a>
        </p>
      </div>
    </main>
  );
}

type Step =
  | { kind: 'opening' }
  | { kind: 'code' }
  | { kind: 'enrol'; token: string; secret: string; uri: string }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'gone'; message: string };

/** The secret in groups of four, easier to type into an app. */
export const grouped = (secret: string): string => secret.replace(/(.{4})(?=.)/g, '$1 ');

export function LinkSignInScreen(props: {
  token: string;
  onSignedIn: () => Promise<void>;
}): ReactNode {
  const [step, setStep] = useState<Step>({ kind: 'opening' });
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const open = async (withCode?: string): Promise<void> => {
    const second = withCode
      ? withCode.includes('-')
        ? { recoveryCode: withCode }
        : { code: withCode }
      : {};
    const r = await api<{
      user: unknown;
      enrol: { token: string; secret: string; uri: string } | null;
    }>('POST', '/auth/link/consume', { token: props.token, ...second });
    if (!r.ok) {
      if (r.error.status === 401) {
        setStep({ kind: 'code' });
        if (withCode) setError(r.error.message);
      } else setStep({ kind: 'gone', message: r.error.message });
      return;
    }
    if (r.data.enrol) setStep({ kind: 'enrol', ...r.data.enrol });
    else await props.onSignedIn();
  };
  useEffect(() => {
    void open();
  }, []);
  const enrol = async (token: string): Promise<void> => {
    const r = await api<{ recoveryCodes: string[] }>('POST', '/auth/link/enrol', {
      token,
      code: code.trim(),
    });
    if (!r.ok) setError(r.error.message);
    else {
      setError('');
      setStep({ kind: 'codes', codes: r.data.recoveryCodes });
    }
  };
  return (
    <main className="pe-auth">
      <div className="pe-card">
        <h1>Signing in</h1>
        {step.kind === 'opening' ? <p className="pe-muted">Opening your link…</p> : null}
        {step.kind === 'gone' ? (
          <>
            <div className="pe-banner" role="alert">
              {step.message}
            </div>
            <p className="pe-switch">
              <a href="/sign-in/email">Ask for a new link</a>
            </p>
          </>
        ) : null}
        {step.kind === 'code' || step.kind === 'enrol' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (step.kind === 'enrol') void enrol(step.token);
              else void open(code.trim());
            }}
            noValidate
          >
            {step.kind === 'enrol' ? (
              <>
                <p>
                  Your client asks for a second factor. Add this account to your authenticator app
                  (Google Authenticator, Microsoft Authenticator, 1Password …) with the key below,
                  then enter the code it shows.
                </p>
                <p className="pe-mono pe-secret">{grouped(step.secret)}</p>
                <p className="pe-small pe-muted">
                  <a href={step.uri}>Open in an authenticator app on this device</a>
                </p>
              </>
            ) : (
              <p>Enter the code from your authenticator app, or one of your recovery codes.</p>
            )}
            {error ? (
              <div className="pe-field-error" role="alert">
                {error}
              </div>
            ) : null}
            <div className="pe-field">
              <label htmlFor="ln-code">Code</label>
              <input
                id="ln-code"
                className="pe-input pe-mono"
                inputMode={step.kind === 'enrol' ? 'numeric' : 'text'}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                }}
              />
            </div>
            <button
              className="pe-btn pe-btn--primary pe-btn--block"
              type="submit"
              disabled={!code.trim()}
            >
              {step.kind === 'enrol' ? 'Turn it on and sign in' : 'Sign in'}
            </button>
          </form>
        ) : null}
        {step.kind === 'codes' ? (
          <>
            <p>
              Keep these recovery codes somewhere safe. Each opens your account once if your phone
              is not at hand. They are shown only now.
            </p>
            <ul className="pe-codes pe-mono">
              {step.codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <button
              className="pe-btn pe-btn--primary pe-btn--block"
              type="button"
              onClick={() => void props.onSignedIn()}
            >
              I kept them, continue
            </button>
          </>
        ) : null}
      </div>
    </main>
  );
}
