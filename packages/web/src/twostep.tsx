// ── [PCODE-150 | S15 | v0.1.0] Add the cloud tenant and harden sign-in, rate limits and headers ──
//    Why:  turning the second sign-in factor on and off in the profile: the key to type (or the link to
//          open) in an authenticator app, a first code to prove it works, and the recovery codes, shown once.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import { CopyField } from './account.js';
import { Card } from './shell.js';

/** "JBSW Y3DP EHPK 3PXP" — the key in groups of four, as apps show it. */
export const grouped = (secret: string): string => secret.replace(/(.{4})/g, '$1 ').trim();

export function TwoStepCard(): ReactNode {
  const [status, setStatus] = useState<{ enabled: boolean; recoveryLeft: number } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ enabled: boolean; recoveryLeft: number }>('GET', '/auth/totp');
    if (r.ok) setStatus(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const fail = (m: string): void => {
    setError(m);
  };

  if (!status) return null;
  return (
    <Card
      title="Two-step sign-in"
      subtitle={
        status.enabled
          ? 'On: signing in asks for a code from your authenticator app. ' +
            String(status.recoveryLeft) +
            ' recovery codes left.'
          : 'Off: a password alone signs you in. Turn it on with any authenticator app.'
      }
    >
      {codes ? (
        <div className="pe-notice-ok" role="status">
          <p>
            <strong>Your recovery codes, shown only now.</strong> Each works once if you lose your
            phone; keep them somewhere safe.
          </p>
          <ul className="pe-recovery-codes">
            {codes.map((c) => (
              <li key={c} className="pe-mono">
                {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!status.enabled && !setup ? (
        <button
          type="button"
          className="pe-btn pe-btn--primary"
          onClick={() => {
            void api<{ secret: string; uri: string }>('POST', '/auth/totp/setup').then((r) => {
              if (r.ok) {
                setSetup(r.data);
                setError('');
              } else fail(r.error.message);
            });
          }}
        >
          Turn on two-step sign-in
        </button>
      ) : null}
      {setup && !status.enabled ? (
        <form
          className="pe-form-grid pe-form-grid--wide"
          onSubmit={(e) => {
            e.preventDefault();
            void api<{ recoveryCodes: string[] }>('POST', '/auth/totp/enable', {
              code: code.trim(),
            }).then(async (r) => {
              if (!r.ok) {
                fail(r.error.message);
                return;
              }
              setCodes(r.data.recoveryCodes);
              setSetup(null);
              setCode('');
              setError('');
              await load();
            });
          }}
        >
          <p className="pe-small">
            In your authenticator app, add an account by key and type this key, or open the link on
            this device:
          </p>
          <CopyField label="Key" value={grouped(setup.secret)} />
          <p className="pe-small">
            <a href={setup.uri}>Open in the authenticator app</a>
          </p>
          <div className="pe-field">
            <label htmlFor="totp-first">The code the app shows now</label>
            <input
              id="totp-first"
              className="pe-input pe-input--narrow"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
              }}
            />
          </div>
          <div className="pe-form-actions">
            <button
              type="submit"
              className="pe-btn pe-btn--primary"
              disabled={!/^\d{6}$/.test(code.trim())}
            >
              Turn on
            </button>
          </div>
        </form>
      ) : null}
      {status.enabled ? (
        <form
          className="pe-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void api('POST', '/auth/totp/disable', { password }).then(async (r) => {
              if (!r.ok) {
                fail(r.error.message);
                return;
              }
              setPassword('');
              setCodes(null);
              setError('');
              await load();
            });
          }}
        >
          <input
            className="pe-input"
            type="password"
            autoComplete="current-password"
            aria-label="Password"
            placeholder="Your password, to turn it off"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
          <button type="submit" className="pe-btn pe-btn--secondary" disabled={!password}>
            Turn off
          </button>
        </form>
      ) : null}
      {error ? (
        <div className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
    </Card>
  );
}
