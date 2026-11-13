// ── [PCODE-326 | S15 | v0.1.0] T32.9 T32 exit check, docs and sprint close ──
// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
//    Why:  whether the findings' CVEs are scored by the public feeds, when they were last read, how many
//          are known to be exploited, and for an admin a button that reads them now.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

interface Feeds {
  on: boolean;
  lastAt: string | null;
  cves: number;
  known: number;
  exploited: number;
}

/** The feeds' state in one sentence. */
export function feedsText(f: Feeds): string {
  if (!f.on)
    return 'Off. An admin switches them on in the workspace settings: EPSS is sent the CVE ids of your findings.';
  return (
    String(f.known) +
    ' of ' +
    String(f.cves) +
    ' CVE' +
    (f.cves === 1 ? '' : 's') +
    ' scored' +
    (f.exploited ? ', ' + String(f.exploited) + ' known to be exploited' : '') +
    (f.lastAt ? '; read ' + f.lastAt.slice(0, 10) : '; not read yet') +
    '.'
  );
}

export function FeedsCard(props: { workspaceId: string; isAdmin: boolean }): ReactNode {
  const [f, setF] = useState<Feeds | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await api<Feeds>('GET', W(props.workspaceId, '/security/feeds'));
    if (r.ok) setF(r.data);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!f) return null;
  const refresh = async (): Promise<void> => {
    setBusy(true);
    const r = await api<{ kev: number; epss: number; findings: number }>(
      'POST',
      W(props.workspaceId, '/security/feeds/refresh'),
    );
    setBusy(false);
    setSaid(
      r.ok
        ? String(r.data.epss) +
            ' scored, ' +
            String(r.data.kev) +
            ' known exploited, ' +
            String(r.data.findings) +
            ' findings changed.'
        : r.error.message,
    );
    void load();
  };
  return (
    <Card
      title="Vulnerability feeds"
      action={
        props.isAdmin && f.on ? (
          <Button size="sm" kind="ghost" disabled={busy} onClick={() => void refresh()}>
            {busy ? 'Reading…' : 'Read them now'}
          </Button>
        ) : null
      }
    >
      <p className="pv-small">
        <Chip tone={f.on ? 'success' : 'neutral'}>{f.on ? 'on' : 'off'}</Chip> {feedsText(f)}
      </p>
      <p className="pv-small pv-muted">
        EPSS (FIRST) says how likely a CVE is to be exploited soon; CISA’s catalog lists the ones
        already exploited. Both raise a finding’s risk; a CVE in a shipped version alerts the
        project’s leads and the admins.
      </p>
      {said ? (
        <p className="pv-small" role="status">
          {said}
        </p>
      ) : null}
    </Card>
  );
}
