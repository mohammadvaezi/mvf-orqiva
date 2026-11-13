// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
//    Why:  the settings page for notifications: turn them on for this device (or say why it cannot), the
//          four kinds each person chooses, the devices that get them with a way to remove one, and a test
//          message. Choices count for all of a person's devices.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';
import { Card } from './shell.js';
import {
  currentSubscription,
  deviceName,
  pushSupport,
  subscribeDevice,
  type PushSupport,
} from './pwa.js';

export type PushKind = 'approvals' | 'gates' | 'deploys' | 'mentions';
export type Prefs = Record<PushKind, boolean>;

export interface PushState {
  publicKey: string | null;
  devices: {
    id: string;
    device: string;
    endpoint: string;
    createdAt: string;
    lastOkAt: string | null;
  }[];
  preferences: Prefs;
}

export const KINDS: { key: PushKind; label: string; hint: string }[] = [
  {
    key: 'approvals',
    label: 'An agent waits for you',
    hint: 'A run you started needs your approval to go on.',
  },
  {
    key: 'gates',
    label: 'A gate is ready to sign',
    hint: 'Every criterion is met and you may sign it.',
  },
  {
    key: 'deploys',
    label: 'A deploy failed',
    hint: 'One you started, or any if you are an admin.',
  },
  { key: 'mentions', label: 'Someone mentions you', hint: 'An @ with your name in a comment.' },
];

const SUPPORT_TEXT: Record<Exclude<PushSupport, 'ok'>, string> = {
  unsupported: 'This browser cannot receive notifications.',
  denied:
    'Notifications are blocked for this site. Allow them in the browser’s site settings, then come back.',
  'needs-install':
    'On iPhone and iPad, add Orqiva to the home screen first (Share, then Add to Home Screen), and open it from there.',
};

export function NotificationsView(props: {
  state: PushState;
  support: PushSupport;
  thisDevice: string | null;
  busy: boolean;
  error: string;
  onEnable: () => void;
  onDisable: () => void;
  onPrefs: (p: Prefs) => void;
  onRemove: (id: string) => void;
  onTest: () => void;
  testResult: string;
}): ReactNode {
  const { state } = props;
  const here = state.devices.find((d) => d.endpoint === props.thisDevice);
  return (
    <div className="pe-stack">
      <Card
        title="This device"
        subtitle={
          here
            ? 'On: this device shows notifications, even when Orqiva is closed.'
            : 'Off: this device shows nothing when Orqiva is closed.'
        }
      >
        {!state.publicKey ? (
          <p className="pe-small pe-muted">
            The server cannot send notifications yet: its administrator sets ORQIVA_SECRET_KEY.
          </p>
        ) : props.support !== 'ok' ? (
          <p className="pe-small pe-muted" role="status">
            {SUPPORT_TEXT[props.support]}
          </p>
        ) : (
          <div className="pe-inline-form">
            {here ? (
              <>
                <button
                  type="button"
                  className="pe-btn pe-btn--secondary"
                  disabled={props.busy}
                  onClick={props.onTest}
                >
                  Send a test
                </button>
                <button
                  type="button"
                  className="pe-btn pe-btn--text"
                  disabled={props.busy}
                  onClick={props.onDisable}
                >
                  Turn off on this device
                </button>
              </>
            ) : (
              <button
                type="button"
                className="pe-btn pe-btn--primary"
                disabled={props.busy}
                onClick={props.onEnable}
              >
                Turn on notifications
              </button>
            )}
            {props.testResult ? (
              <span className="pe-small pe-muted" role="status">
                {props.testResult}
              </span>
            ) : null}
          </div>
        )}
        {props.error ? (
          <div className="pe-field-error" role="alert">
            {props.error}
          </div>
        ) : null}
      </Card>
      <Card title="What to tell you" subtitle="For all your devices.">
        <div className="pe-stack">
          {KINDS.map((k) => (
            <label key={k.key} className="pe-toggle">
              <input
                type="checkbox"
                checked={state.preferences[k.key]}
                onChange={(e) => {
                  props.onPrefs({ ...state.preferences, [k.key]: e.target.checked });
                }}
              />
              <span>
                <strong>{k.label}</strong>
                <span className="pe-small pe-muted"> {k.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>
      <Card
        title="Your devices"
        subtitle={state.devices.length ? undefined : 'No device gets notifications yet.'}
      >
        {state.devices.length ? (
          <ul className="pe-device-list">
            {state.devices.map((d) => (
              <li key={d.id} className="pe-device-row">
                <span>
                  <strong>{d.device || 'A browser'}</strong>
                  {d.endpoint === props.thisDevice ? (
                    <span className="pe-chip pe-device-here">This device</span>
                  ) : null}
                  <span className="pe-small pe-muted pe-device-when">
                    {'Added ' + new Date(d.createdAt).toLocaleDateString()}
                    {d.lastOkAt ? ' · last delivered ' + new Date(d.lastOkAt).toLocaleString() : ''}
                  </span>
                </span>
                <button
                  type="button"
                  className="pe-btn pe-btn--text"
                  aria-label={'Remove ' + (d.device || 'this browser')}
                  onClick={() => {
                    props.onRemove(d.id);
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}

export function NotificationsSection(): ReactNode {
  const [state, setState] = useState<PushState | null>(null);
  const [thisDevice, setThisDevice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState('');
  const load = useCallback(async () => {
    const r = await api<PushState>('GET', '/api/push');
    if (r.ok) setState(r.data);
    setThisDevice((await currentSubscription().catch(() => null))?.endpoint ?? null);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!state) return null;

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      await load();
    }
  };

  return (
    <NotificationsView
      state={state}
      support={pushSupport()}
      thisDevice={thisDevice}
      busy={busy}
      error={error}
      testResult={testResult}
      onEnable={() => {
        void run(async () => {
          if (!state.publicKey) return;
          const sub = await subscribeDevice(state.publicKey);
          const r = await api('POST', '/api/push/subscriptions', {
            ...sub,
            device: deviceName(navigator.userAgent),
          });
          if (!r.ok) throw new Error(r.error.message);
        });
      }}
      onDisable={() => {
        void run(async () => {
          const sub = await currentSubscription();
          if (!sub) return;
          await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint });
          await sub.unsubscribe();
        });
      }}
      onPrefs={(p) => {
        setState({ ...state, preferences: p });
        void api('PUT', '/api/push/preferences', p).then((r) => {
          if (!r.ok) setError(r.error.message);
        });
      }}
      onRemove={(id) => {
        void run(async () => {
          const r = await api('POST', '/api/push/unsubscribe', { id });
          if (!r.ok) throw new Error(r.error.message);
        });
      }}
      onTest={() => {
        void run(async () => {
          const r = await api<{ sent: number; devices: number }>('POST', '/api/push/test');
          if (!r.ok) throw new Error(r.error.message);
          setTestResult(
            'Sent to ' + String(r.data.sent) + ' of ' + String(r.data.devices) + ' devices.',
          );
        });
      }}
    />
  );
}
