// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-323 | S15 | v0.1.0] T32.7b VEX statements and the security posture per version ──
//    Why:  the Security tab per version: each release's score and open vulnerabilities, how many a VEX
//          statement set aside and how many wait for one; a version's vulnerabilities with their
//          statement to set; and the version's OpenVEX document to download.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

interface Version {
  releaseId: string;
  version: string;
  component: string;
  state: string;
  releasedAt: string | null;
  hasSbom: boolean;
  vulnerabilities: number;
  open: { critical: number; high: number; medium: number; low: number };
  exploited: number;
  setAside: number;
  undecided: number;
  score: number | null;
}
interface Vuln {
  findingId: string;
  cve: string;
  package: string;
  version: string;
  severity: string;
  riskScore: number;
  kev: boolean;
  fixedVersion: string;
  vex: {
    status: string;
    justification: string | null;
    note: string;
    author: string | null;
    at: string;
  } | null;
}

export const STATUS_TEXT: Record<string, string> = {
  not_affected: 'Not affected',
  affected: 'Affected',
  fixed: 'Fixed',
  under_investigation: 'Under investigation',
};
export const JUSTIFICATION_TEXT: Record<string, string> = {
  component_not_present: 'The package is not in the product',
  vulnerable_code_not_present: 'The vulnerable code is not in the package version used',
  vulnerable_code_not_in_execute_path: 'The vulnerable code is never called',
  vulnerable_code_cannot_be_controlled_by_adversary: 'An attacker cannot reach the vulnerable code',
  inline_mitigations_already_exist: 'The product guards against it already',
};

/** A version's open vulnerabilities in words: "1 critical, 2 high". */
export function openText(o: Version['open']): string {
  const parts = (['critical', 'high', 'medium', 'low'] as const)
    .filter((k) => o[k])
    .map((k) => String(o[k]) + ' ' + k);
  return parts.join(', ') || 'none open';
}

function Statement(props: {
  workspaceId: string;
  releaseId: string;
  v: Vuln;
  canEdit: boolean;
  onSaved: () => void;
}): ReactNode {
  const { v } = props;
  const [status, setStatus] = useState(v.vex?.status ?? '');
  const [why, setWhy] = useState(v.vex?.justification ?? 'vulnerable_code_not_in_execute_path');
  const [note, setNote] = useState(v.vex?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    const r = await api('PUT', W(props.workspaceId, '/releases/' + props.releaseId + '/vex'), {
      cve: v.cve,
      package: v.package,
      status,
      ...(status === 'not_affected' ? { justification: why } : {}),
      note,
    });
    if (!r.ok) setError(r.error.message);
    else {
      setError(null);
      props.onSaved();
    }
  };
  return (
    <tr>
      <td>
        <span className="pv-mono">{v.cve}</span>{' '}
        {v.kev ? <Chip tone="danger">exploited</Chip> : null}
        <div className="pv-small pv-muted">
          {v.package} {v.version}
          {v.fixedVersion ? ' · fixed in ' + v.fixedVersion : ''} · {v.severity}, risk {v.riskScore}
        </div>
      </td>
      <td>
        {props.canEdit ? (
          <div className="pv-stack">
            <select
              className="v2-input v2-input--sm"
              aria-label={'Status of ' + v.cve}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
              }}
            >
              <option value="">No statement yet</option>
              {Object.entries(STATUS_TEXT).map(([k, t]) => (
                <option key={k} value={k}>
                  {t}
                </option>
              ))}
            </select>
            {status === 'not_affected' ? (
              <select
                className="v2-input v2-input--sm"
                aria-label={'Why ' + v.cve + ' does not affect it'}
                value={why}
                onChange={(e) => {
                  setWhy(e.target.value);
                }}
              >
                {Object.entries(JUSTIFICATION_TEXT).map(([k, t]) => (
                  <option key={k} value={k}>
                    {t}
                  </option>
                ))}
              </select>
            ) : null}
            {status ? (
              <input
                className="v2-input v2-input--sm"
                aria-label={'Note on ' + v.cve}
                placeholder={status === 'affected' ? 'What to do' : 'Why, in a sentence'}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
            ) : null}
            {error ? (
              <span className="v2-error" role="alert">
                {error}
              </span>
            ) : null}
          </div>
        ) : v.vex ? (
          (STATUS_TEXT[v.vex.status] ?? v.vex.status)
        ) : (
          'No statement yet'
        )}
      </td>
      <td>
        {v.vex ? (
          <span className="pv-small pv-muted">
            {v.vex.author ?? 'someone'}, {v.vex.at.slice(0, 10)}
          </span>
        ) : null}
      </td>
      <td>
        {props.canEdit && status ? (
          <Button size="sm" kind="secondary" onClick={() => void save()}>
            Save
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

export function SecurityVersions(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
}): ReactNode {
  const [list, setList] = useState<Version[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [vulns, setVulns] = useState<Vuln[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Version[]>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/security/versions'),
    );
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setList(r.data);
    setOpen((o) => o ?? r.data.find((v) => v.vulnerabilities)?.releaseId ?? null);
  }, [props.workspaceId, props.projectId]);
  const loadVulns = useCallback(async () => {
    if (!open) return;
    const r = await api<Vuln[]>(
      'GET',
      W(props.workspaceId, '/releases/' + open + '/vulnerabilities'),
    );
    if (r.ok) setVulns(r.data);
  }, [props.workspaceId, open]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setVulns(null);
    void loadVulns();
  }, [loadVulns]);
  if (!list) return <p className="pv-muted">{error ?? 'Loading the versions…'}</p>;
  const chosen = list.find((v) => v.releaseId === open);
  return (
    <div className="pv-stack">
      <Card flush title="Posture per version">
        {list.length ? (
          <table className="pv-table">
            <thead>
              <tr>
                <th>Version</th>
                <th className="pv-num">Score</th>
                <th>Open</th>
                <th className="pv-num">Exploited</th>
                <th className="pv-num">Set aside by VEX</th>
                <th className="pv-num">Waiting for a statement</th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.releaseId} aria-selected={v.releaseId === open}>
                  <td>
                    <button
                      type="button"
                      className="pv-link-btn"
                      onClick={() => {
                        setOpen(v.releaseId);
                      }}
                    >
                      {v.component ? v.component + ' ' : ''}
                      {v.version}
                    </button>{' '}
                    <Chip tone={v.state === 'released' ? 'success' : 'neutral'}>{v.state}</Chip>
                  </td>
                  <td className="pv-num">
                    {v.score === null ? (
                      <span className="pv-small pv-muted">no SBOM</span>
                    ) : (
                      <Chip tone={v.score >= 80 ? 'success' : v.score >= 50 ? 'warning' : 'danger'}>
                        {String(v.score)}
                      </Chip>
                    )}
                  </td>
                  <td>{v.hasSbom ? openText(v.open) : '—'}</td>
                  <td className="pv-num">{v.exploited || '—'}</td>
                  <td className="pv-num">{v.setAside || '—'}</td>
                  <td className="pv-num">{v.undecided || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pv-empty">No releases yet.</p>
        )}
        <p className="pv-small pv-muted v2-tq-note">
          A version’s vulnerabilities are the open findings on package versions its SBOM lists.
          Upload an SBOM for a release under SBOM.
        </p>
      </Card>
      {chosen ? (
        <Card
          flush
          title={'Vulnerabilities of ' + chosen.version}
          action={
            <a
              className="pv-btn pv-btn--ghost pv-btn--sm"
              href={W(props.workspaceId, '/releases/' + chosen.releaseId + '/vex')}
              download
            >
              Download OpenVEX
            </a>
          }
        >
          {vulns === null ? (
            <p className="pv-muted" role="status">
              Loading…
            </p>
          ) : vulns.length ? (
            <table className="pv-table">
              <tbody>
                {vulns.map((v) => (
                  <Statement
                    key={v.cve + v.package + (v.vex?.at ?? '')}
                    workspaceId={props.workspaceId}
                    releaseId={chosen.releaseId}
                    v={v}
                    canEdit={props.canEdit}
                    onSaved={() => {
                      void loadVulns();
                      void load();
                    }}
                  />
                ))}
              </tbody>
            </table>
          ) : (
            <p className="pv-empty">
              {chosen.hasSbom
                ? 'No known vulnerability in this version.'
                : 'This version has no SBOM.'}
            </p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
