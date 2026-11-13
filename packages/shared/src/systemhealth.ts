// ── [PCODE-353 | S15 | v0.1.0] T35.4a System health page with backup, restore and upgrade wizards ──
//    Why:  the owner of a self-hosted server sees on one page whether it is well: what is stuck or failing
//          and whether there is a recent backup that checks out. The rules for "needs attention" are here,
//          so the page and its tests agree on them.

export interface BackupFile {
  name: string;
  bytes: number;
  /** ISO time the file was written */
  at: string;
  /** a .sha256 file sits next to it: the dump read back when it was made */
  checked: boolean;
  /** the uploaded files were copied next to it */
  withFiles: boolean;
}

export interface HealthReport {
  version: string;
  startedAt: string;
  database: { bytes: number; migration: string };
  queues: {
    mailPending: number;
    mailStuck: number;
    mailFailed: number;
    webhooksFailing: number;
    bridgesFailing: number;
    runsQueued: number;
    runsWaiting: number;
    deploysQueued: number;
  };
  runners: { name: string; lastSeenAt: string | null }[];
  ai: { name: string; calls: number; failures: number }[];
  backups: BackupFile[] | null;
}

/** The backup dumps of a folder listing, newest first, from the names `orq backup` writes. */
export function backupsOf(
  files: readonly { name: string; bytes: number; at: string; dir?: boolean }[],
): BackupFile[] {
  const names = new Set(files.map((f) => f.name));
  return files
    .filter((f) => !f.dir && /^orqiva-\d{8}-\d{4}\.dump$/.test(f.name))
    .map((f) => ({
      name: f.name,
      bytes: f.bytes,
      at: f.at,
      checked: names.has(f.name + '.sha256'),
      withFiles: names.has(f.name.replace(/\.dump$/, '') + '-files'),
    }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** What needs the owner's attention, in plain sentences; empty when all is well. */
export function healthProblems(r: HealthReport, now: Date): string[] {
  const out: string[] = [];
  const q = r.queues;
  if (q.mailStuck)
    out.push(
      String(q.mailStuck) + ' mails wait longer than 15 minutes: check the mail server settings.',
    );
  if (q.mailFailed) out.push(String(q.mailFailed) + ' mails failed in the last day.');
  if (q.webhooksFailing) out.push(String(q.webhooksFailing) + ' outgoing webhooks are failing.');
  if (q.bridgesFailing) out.push(String(q.bridgesFailing) + ' Slack or Teams bridges are failing.');
  const offline = r.runners.filter(
    (x) => !x.lastSeenAt || now.getTime() - Date.parse(x.lastSeenAt) > 10 * 60_000,
  );
  if (offline.length)
    out.push(
      'Deploy runners not seen for 10 minutes: ' + offline.map((x) => x.name).join(', ') + '.',
    );
  for (const a of r.ai)
    if (a.calls >= 5 && a.failures / a.calls > 0.2)
      out.push(
        'The AI connection ' +
          a.name +
          ' failed ' +
          String(Math.round((a.failures / a.calls) * 100)) +
          ' % of its calls today.',
      );
  if (r.backups) {
    const newest = r.backups[0];
    if (!newest) out.push('There is no backup yet: run orq backup on the server.');
    else if (now.getTime() - Date.parse(newest.at) > 26 * 3600_000)
      out.push('The newest backup is older than a day: run orq backup, or schedule it.');
    else if (!newest.checked)
      out.push('The newest backup has no checksum: it may not have finished.');
  }
  return out;
}
