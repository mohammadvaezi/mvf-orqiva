// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-224 | S15 | v0.1.0] T21.1 Phone sign-in by pairing code, device tokens, QR code in the web app ──
//    Why:  the phone signs in from here, so SSO, MFA and passwords stay in the browser. A pairing code is
//          shown as a QR code for the app's camera and as eight characters to type, with the time it runs
//          out. The phones signed in this way are listed below it and signed out with one click.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { pairingCodeText, pairingLink, qrEncode, qrPath } from '@orqiva/shared';
import { api } from './core/api.js';
import { Icon } from './core/icons.js';
import { Card, EmptyState } from './shell.js';
import { localTime } from './views.js';

interface Pairing {
  code: string;
  expiresAt: string;
  minutes: number;
}

interface PhoneToken {
  id: string;
  name: string;
  mine: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** The pairing link as a QR code, drawn crisp at any size. */
export function QrCode(props: { text: string; label: string }): ReactNode {
  const { size, d } = useMemo(() => {
    const m = qrEncode(props.text);
    return { size: m.length + 8, d: qrPath(m) };
  }, [props.text]);
  return (
    <svg
      className="pe-qr"
      viewBox={'0 0 ' + String(size) + ' ' + String(size)}
      role="img"
      aria-label={props.label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

const minutesLeft = (iso: string, now: number): number =>
  Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 60_000));

export function PhoneSection(props: { workspaceId: string }): ReactNode {
  const W = '/api/workspaces/' + props.workspaceId;
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [phones, setPhones] = useState<PhoneToken[] | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const load = useCallback(async () => {
    const r = await api<PhoneToken[]>('GET', W + '/access-tokens');
    if (r.ok)
      setPhones(r.data.filter((t) => t.mine && !t.revokedAt && t.name.startsWith('Phone: ')));
  }, [W]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 10_000);
    return () => {
      clearInterval(timer);
    };
  }, [pairing]);
  // once the code is used, the new phone shows up below
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => void load(), 5_000);
    return () => {
      clearInterval(timer);
    };
  }, [pairing, load]);

  const make = (): void => {
    void api<Pairing>('POST', W + '/devices/pairing').then((r) => {
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setError('');
      setNow(Date.now());
      setPairing(r.data);
    });
  };
  const left = pairing ? minutesLeft(pairing.expiresAt, now) : 0;
  const server = window.location.origin;
  // a phone cannot reach the computer's own loopback address
  const loopback = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(window.location.hostname);

  return (
    <div className="pe-stack">
      <Card
        title="Sign in on a phone"
        subtitle="The Orqiva app signs in with a code from here. It never asks for your password, so single sign-on and two-step sign-in work as they do here."
      >
        {pairing && left > 0 ? (
          <div className="pe-pairing">
            <QrCode text={pairingLink(server, pairing.code)} label="Pairing code as a QR code" />
            <div className="pe-pairing-text">
              <ol className="pe-steps">
                <li>Open the Orqiva app on the phone.</li>
                <li>
                  Scan this code, or type the server and the code:
                  <dl className="pe-pairing-fields">
                    <dt>Server</dt>
                    <dd className="pe-mono">{server}</dd>
                    <dt>Code</dt>
                    <dd className="pe-mono pe-pairing-code">{pairingCodeText(pairing.code)}</dd>
                  </dl>
                </li>
              </ol>
              {loopback ? (
                <p className="pe-small pe-field-error">
                  A phone cannot reach {window.location.hostname}. Open this page by the server’s
                  network address or name, and make the code there.
                </p>
              ) : null}
              <p className="pe-small pe-muted" role="status">
                Works once, for {left} more minute{left === 1 ? '' : 's'} (until{' '}
                {localTime(pairing.expiresAt)}).
              </p>
              <button type="button" className="pe-btn pe-btn--secondary" onClick={make}>
                New code
              </button>
            </div>
          </div>
        ) : (
          <div className="pe-inline-form">
            <button type="button" className="pe-btn pe-btn--primary" onClick={make}>
              <Icon name="phone" size={16} /> Show a pairing code
            </button>
            {pairing ? <span className="pe-small pe-muted">The last code ran out.</span> : null}
          </div>
        )}
        {error ? (
          <div className="pe-field-error" role="alert">
            {error}
          </div>
        ) : null}
      </Card>
      <Card
        title="Your phones"
        subtitle="Each phone has its own token. Signing a phone out here stops it at once."
      >
        {!phones ? (
          <p className="pe-muted" role="status">
            Loading…
          </p>
        ) : phones.length === 0 ? (
          <EmptyState icon="phone" title="No phone signed in" />
        ) : (
          <table className="pe-grid-table" aria-label="Phones">
            <thead>
              <tr>
                <th scope="col">Phone</th>
                <th scope="col">Signed in</th>
                <th scope="col">Last used</th>
                <th scope="col">Until</th>
                <th scope="col">
                  <span className="pe-visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {phones.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Icon name="phone" size={16} /> {p.name.slice('Phone: '.length)}
                  </td>
                  <td className="pe-muted">{localTime(p.createdAt)}</td>
                  <td className="pe-muted">{p.lastUsedAt ? localTime(p.lastUsedAt) : 'never'}</td>
                  <td className="pe-muted">{p.expiresAt ? localTime(p.expiresAt) : 'no end'}</td>
                  <td className="pe-cell-actions">
                    <button
                      type="button"
                      className="pe-btn pe-btn--text"
                      onClick={() => {
                        void api('POST', W + '/access-tokens/' + p.id + '/revoke').then(() =>
                          load(),
                        );
                      }}
                    >
                      Sign out
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
