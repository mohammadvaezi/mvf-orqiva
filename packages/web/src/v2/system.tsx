// ── [PCODE-353 | S15 | v0.1.0] T35.4a System health page with backup, restore and upgrade wizards ──
//    Why:  Settings › System for the owner: whether the server is well and what needs attention, and three
//          wizards for the work done on the server itself. Each wizard gives the command to copy and then
//          watches for the result: the new backup appearing, the server coming back, the new version.
import type { BackupFile, HealthReport } from '@orqiva/shared';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip, Stat } from '../preview/ui.js';

type Report = HealthReport & { problems: string[] };

/** 1,4 GB, 820 MB, 12 KB. */
export function bytesText(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return (
    (i === 0 ? String(v) : v.toFixed(v < 10 ? 1 : 0).replace('.', ',')) + ' ' + (units[i] ?? 'B')
  );
}

/** 3 days 4 h, 5 h 12 min, 8 min. */
export function sinceText(fromIso: string, now: number): string {
  const m = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 60_000));
  if (m < 60) return String(m) + ' min';
  if (m < 1440) return String(Math.floor(m / 60)) + ' h ' + String(m % 60) + ' min';
  return String(Math.floor(m / 1440)) + ' days ' + String(Math.floor((m % 1440) / 60)) + ' h';
}

/** The backup the wizard waited for: the newest one written after it started, once it is checked. */
export function newBackup(backups: readonly BackupFile[] | null, since: number): BackupFile | null {
  const b = backups?.[0];
  return b && Date.parse(b.at) >= since && b.checked ? b : null;
}

function Command(props: { text: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <span className="v2-inline">
      <code className="pv-code pv-break">{props.text}</code>
      <Button
        size="sm"
        kind="ghost"
        onClick={() => {
          void navigator.clipboard
            .writeText(props.text)
            .then(() => {
              setCopied(true);
            })
            .catch(() => undefined);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </span>
  );
}

type Wizard = 'backup' | 'restore' | 'upgrade' | null;

export function SystemSection(props: { workspaceId: string }): ReactNode {
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [wizard, setWizard] = useState<Wizard>(null);
  const [since, setSince] = useState(0);
  const [restoreFrom, setRestoreFrom] = useState('');
  const [startVersion, setStartVersion] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);
  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const res = await api<Report>('GET', '/api/workspaces/' + props.workspaceId + '/system/health');
    busy.current = false;
    setNow(Date.now());
    if (res.ok) {
      setR(res.data);
      setError('');
    } else setError(res.error.message);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  // while a wizard waits for the server, the page looks again every five seconds
  useEffect(() => {
    if (!wizard) return;
    const t = setInterval(() => void load(), 5000);
    return () => {
      clearInterval(t);
    };
  }, [wizard, load]);
  if (!r) return <p className="pv-muted">{error || 'Loading…'}</p>;
  const done = newBackup(r.backups, since);
  const today = r.backups?.[0] && now - Date.parse(r.backups[0].at) < 24 * 3600_000;
  const open = (w: Wizard): void => {
    setWizard(w);
    setSince(Date.now());
    setStartVersion(r.version);
  };
  return (
    <div className="pv-app v2-part pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pv-stats">
        <Stat
          label="Version"
          icon="versions"
          value={r.version}
          sub={'running for ' + sinceText(r.startedAt, now)}
        />
        <Stat
          label="Database"
          icon="overview"
          value={bytesText(r.database.bytes)}
          sub={'migration ' + r.database.migration}
        />
        <Stat
          label="Mail out"
          icon="mention"
          value={r.queues.mailPending}
          sub={String(r.queues.mailFailed) + ' failed today'}
          {...(r.queues.mailStuck ? { tone: 'warning' as const } : {})}
        />
        <Stat
          label="Agent runs"
          icon="agents"
          value={r.queues.runsQueued}
          sub={String(r.queues.runsWaiting) + ' waiting for a person'}
        />
      </div>
      {r.problems.length ? (
        <div className="pv-callout pv-callout--warn" role="status">
          <div>
            <strong>Needs attention</strong>
            <ul className="pv-corrections">
              {r.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="pv-callout pv-callout--agent" role="status">
          <div>All is well: nothing is stuck or failing, and the newest backup is recent.</div>
        </div>
      )}
      <Card title="Queues and connections" flush>
        <table className="pv-table">
          <tbody>
            <tr>
              <td>Outgoing webhooks failing</td>
              <td className="pv-num">{r.queues.webhooksFailing}</td>
            </tr>
            <tr>
              <td>Slack and Teams bridges failing</td>
              <td className="pv-num">{r.queues.bridgesFailing}</td>
            </tr>
            <tr>
              <td>Deploys waiting for a runner</td>
              <td className="pv-num">{r.queues.deploysQueued}</td>
            </tr>
            {r.runners.map((x) => (
              <tr key={'runner-' + x.name}>
                <td>Runner {x.name}</td>
                <td className="pv-num">
                  {x.lastSeenAt ? 'seen ' + sinceText(x.lastSeenAt, now) + ' ago' : 'never seen'}
                </td>
              </tr>
            ))}
            {r.ai.map((x) => (
              <tr key={'ai-' + x.name}>
                <td>AI connection {x.name}</td>
                <td className="pv-num">
                  {x.calls} calls today, {x.failures} failed
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card
        title="Backups"
        action={
          <span className="pv-home-actions">
            <Button
              size="sm"
              kind="primary"
              onClick={() => {
                open('backup');
              }}
            >
              Back up now
            </Button>
            <Button
              size="sm"
              kind="ghost"
              disabled={!r.backups?.length}
              onClick={() => {
                open('restore');
              }}
            >
              Restore
            </Button>
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                open('upgrade');
              }}
            >
              Upgrade
            </Button>
          </span>
        }
      >
        {r.backups === null ? (
          <p className="pv-small pv-muted">
            This server does not see its backups folder. Run orq install again: it mounts the
            folder, and the backups show here.
          </p>
        ) : r.backups.length ? (
          <table className="pv-table">
            <tbody>
              {r.backups.slice(0, 10).map((b) => (
                <tr key={b.name}>
                  <td className="pv-mono">{b.name}</td>
                  <td className="pv-num">{bytesText(b.bytes)}</td>
                  <td className="pv-small pv-muted">{sinceText(b.at, now)} ago</td>
                  <td>
                    <Chip tone={b.checked ? 'success' : 'warning'}>
                      {b.checked ? 'checked' : 'no checksum'}
                    </Chip>
                  </td>
                  <td className="pv-small pv-muted">
                    {b.withFiles ? 'with files' : 'database only'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pv-small pv-muted">No backup yet.</p>
        )}
      </Card>
      {wizard === 'backup' ? (
        <Card title="Back up the server">
          <div className="pv-wizard">
            <div className="pv-step">
              <span className="pv-step-n">1</span>
              <div className="pv-step-body">
                On the server, in the folder Orqiva was installed into, run:
                <Command text="orq backup" />
                It dumps the database, checks that the dump reads back, writes its checksum and
                copies the uploaded files.
              </div>
            </div>
            <div className="pv-step">
              <span className="pv-step-n">2</span>
              <div className="pv-step-body">
                {done ? (
                  <div>
                    <Chip tone="success">done</Chip> {done.name}, {bytesText(done.bytes)}, checked.
                  </div>
                ) : (
                  <div className="pv-muted">Waiting for the new backup to appear here…</div>
                )}
              </div>
            </div>
            <div className="pv-step">
              <span className="pv-step-n">3</span>
              <div className="pv-step-body">
                Keep a copy somewhere else, too: the backups folder lives on the same disk as the
                server.
              </div>
            </div>
          </div>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setWizard(null);
            }}
          >
            Close
          </Button>
        </Card>
      ) : null}
      {wizard === 'restore' ? (
        <Card title="Restore a backup">
          <div className="pv-wizard">
            <div className="pv-step">
              <span className="pv-step-n">1</span>
              <div className="pv-step-body">
                Choose the backup:{' '}
                <select
                  className="v2-input v2-input--sm"
                  aria-label="Backup to restore"
                  value={restoreFrom}
                  onChange={(e) => {
                    setRestoreFrom(e.target.value);
                  }}
                >
                  <option value="">Backup…</option>
                  {(r.backups ?? []).map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name} ({sinceText(b.at, now)} ago)
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {restoreFrom ? (
              <>
                <div className="pv-step">
                  <span className="pv-step-n">2</span>
                  <div className="pv-step-body">
                    <strong>Everything written since that backup is replaced</strong>, in every
                    workspace of this server. Back up first if you may need it:{' '}
                    <Command text="orq backup" />
                  </div>
                </div>
                <div className="pv-step">
                  <span className="pv-step-n">3</span>
                  <div className="pv-step-body">
                    On the server, in the install folder, run:
                    <Command text={'orq restore backups/' + restoreFrom + ' --yes'} />
                    It stops the server, checks the checksum, restores the database and the files,
                    and starts it again.
                  </div>
                </div>
                <div className="pv-step">
                  <span className="pv-step-n">4</span>
                  <div className="pv-step-body">
                    {Date.now() - since > 15_000 &&
                    r.startedAt &&
                    Date.parse(r.startedAt) > since ? (
                      <div>
                        <Chip tone="success">back</Chip> The server started again{' '}
                        {sinceText(r.startedAt, now)} ago, on migration {r.database.migration}.
                      </div>
                    ) : (
                      <div className="pv-muted">This page waits for the server to come back.</div>
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setWizard(null);
            }}
          >
            Close
          </Button>
        </Card>
      ) : null}
      {wizard === 'upgrade' ? (
        <Card title="Upgrade Orqiva">
          <div className="pv-wizard">
            <div className="pv-step">
              <span className="pv-step-n">1</span>
              <div className="pv-step-body">
                {today ? (
                  <div>
                    <Chip tone="success">ready</Chip> There is a backup from the last day.
                  </div>
                ) : (
                  <div>
                    <Chip tone="warning">first</Chip> Back up before upgrading:{' '}
                    <Command text="orq backup" />
                  </div>
                )}
              </div>
            </div>
            <div className="pv-step">
              <span className="pv-step-n">2</span>
              <div className="pv-step-body">
                On the server, in the install folder, run:
                <Command text="orq install" />
                It loads the new version, keeps the database and the files, and moves the database
                forward.
              </div>
            </div>
            <div className="pv-step">
              <span className="pv-step-n">3</span>
              <div className="pv-step-body">
                {r.version !== startVersion ? (
                  <div>
                    <Chip tone="success">done</Chip> Orqiva {r.version} runs now (it was{' '}
                    {startVersion}).
                  </div>
                ) : Date.parse(r.startedAt) > since ? (
                  <div>
                    <Chip tone="info">restarted</Chip> The server restarted with version {r.version}
                    : there was no newer one.
                  </div>
                ) : (
                  <div className="pv-muted">
                    Version {r.version} runs; this page waits for the server to restart.
                  </div>
                )}
              </div>
            </div>
          </div>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setWizard(null);
            }}
          >
            Close
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
