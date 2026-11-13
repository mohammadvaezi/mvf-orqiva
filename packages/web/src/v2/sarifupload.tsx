// ── [PCODE-321 | S15 | v0.1.0] T32.6 Secrets in the Git history, SARIF upload in the web app, dependency facts on findings ──
//    Why:  results of any scanner that writes SARIF (CodeQL, Semgrep, Trivy, …) come in from the browser,
//          each tool in the file as a full scan of that tool: what it no longer reports is marked fixed.
import { useState, type ReactNode } from 'react';
import { api } from '../core/api.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

interface Scan {
  tool: string;
  found: number;
  newCount: number;
  fixedCount: number;
}

/** What the upload did, in words. */
export function scansText(scans: readonly Scan[]): string {
  return scans
    .map(
      (s) =>
        s.tool +
        ': ' +
        String(s.found) +
        ' found, ' +
        String(s.newCount) +
        ' new, ' +
        String(s.fixedCount) +
        ' fixed',
    )
    .join(' · ');
}

export function SarifUpload(props: {
  workspaceId: string;
  projectId: string;
  onDone: () => void;
}): ReactNode {
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (file: File): Promise<void> => {
    setBusy(true);
    let sarif: unknown;
    try {
      sarif = JSON.parse(await file.text());
    } catch {
      setSaid(file.name + ' is not JSON');
      setBusy(false);
      return;
    }
    const r = await api<Scan[]>(
      'POST',
      W(props.workspaceId, '/projects/' + props.projectId + '/scans'),
      { sarif, full: true },
    );
    setBusy(false);
    if (!r.ok) {
      setSaid(r.error.message);
      return;
    }
    setSaid(scansText(r.data));
    props.onDone();
  };
  return (
    <span className="v2-inline">
      {said ? (
        <span className="pv-small pv-muted" role="status">
          {said}
        </span>
      ) : null}
      <label className={'pv-btn pv-btn--secondary pv-btn--sm' + (busy ? ' pv-btn--busy' : '')}>
        {busy ? 'Uploading…' : 'Upload SARIF'}
        <input
          type="file"
          accept=".sarif,.json,application/json"
          className="v2-visually-hidden"
          aria-label="SARIF file"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void send(f);
          }}
        />
      </label>
    </span>
  );
}
