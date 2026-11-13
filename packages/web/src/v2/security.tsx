// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-324 | S15 | v0.1.0] T32.8a Fix pull requests for findings: dependency upgrades and AI fixes ──
// ── [PCODE-323 | S15 | v0.1.0] T32.7b VEX statements and the security posture per version ──
// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
// ── [PCODE-321 | S15 | v0.1.0] T32.6 Secrets in the Git history, SARIF upload in the web app, dependency facts on findings ──
// ── [PCODE-316 | S15 | v0.1.0] T32.3b Named run sign-off with a frozen snapshot, and a release gate on tests ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-179 | S15 | v0.1.0] B4.5 Security and Code map live in the web app: posture, findings by risk, SBOM, policies, campaigns, treemap, hotspots, APIs, hygiene ──
//    Why:  the Security tab of the approved design on the server's posture. One score and its trend, the
//          open findings and what blocks the next release; findings ordered by one risk score with the
//          signals that make it, each with its task, workflow and decision (accepted only until a date, by
//          an admin); the SBOM of every release answers "which shipped versions contain this package";
//          policies are the gates, campaigns clear one problem across every project.
import { SecurityVersions } from './securityversions.js'; // [PCODE-323 | S15 | v0.1.0]
import { FeedsCard } from './feedscard.js'; // [PCODE-322 | S15 | v0.1.0]
import { SarifUpload } from './sarifupload.js'; // [PCODE-321 | S15 | v0.1.0]
import { isEventOf } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Bar, Button, Card, Chip, Ring, Stat } from '../preview/ui.js';
import { ago } from './inbox.js';
import { dateText } from './versions.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
type Tone = 'success' | 'danger' | 'warning' | 'neutral' | 'info' | 'primary';

export interface Finding {
  id: string;
  tool: string;
  rule: string;
  severity: string;
  title: string;
  message: string;
  file: string;
  line: number | null;
  status: string;
  reason: string;
  decidedBy: string | null;
  itemId: string | null;
  itemRef: string | null;
  firstSeenAt: string;
  triage: string;
  riskScore: number;
  workflow: string;
  cve: string;
  package: string;
  kev: boolean;
  reachable: boolean | null;
  exposed: boolean | null;
  slaDueAt: string | null;
  acceptedUntil: string | null;
  fixPrUrl?: string; // [PCODE-324 | S15 | v0.1.0]
}
interface Risk {
  riskScore: number;
  cvss: number | null;
  epss: number | null;
  kev: boolean;
  reachable: boolean | null;
  exposed: boolean | null;
  packageVersion: string;
  fixedVersion: string;
  slaDueAt: string | null;
  slaBreached: boolean;
  introducedBy: { id: string; ref: string; title: string } | null;
}
interface Posture {
  score: number;
  open: { critical: number; high: number; medium: number; low: number; info: number };
  slaBreaches: number;
  accepted: number;
  medianDaysToFix: number | null;
  trend: { at: string; tool: string; found: number; newCount: number; fixedCount: number }[];
  top: { id: string; title: string; severity: string; riskScore: number }[];
}
interface PolicyCheck {
  passes: boolean;
  results: { policy: string; violations: string[] }[];
}

export const SEV_TONE: Record<string, Tone> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
  info: 'neutral',
};
export const riskBand = (n: number): 'high' | 'mid' | 'low' =>
  n >= 80 ? 'high' : n >= 40 ? 'mid' : 'low';

/** What a finding's state reads as: the decision when there is one, else where the fix stands. */
export function findingState(f: Pick<Finding, 'status' | 'workflow' | 'acceptedUntil'>): {
  text: string;
  tone: Tone;
} {
  if (f.status === 'accepted')
    return { text: 'accepted until ' + dateText(f.acceptedUntil), tone: 'neutral' };
  if (f.status === 'false_positive') return { text: 'false positive', tone: 'neutral' };
  if (f.status === 'fixed')
    return { text: f.workflow === 'verified' ? 'verified' : 'fixed', tone: 'success' };
  return {
    text: f.workflow,
    tone: f.workflow === 'fixing' ? 'primary' : f.workflow === 'confirmed' ? 'warning' : 'warning',
  };
}

/** The posture trend as an SVG path over the scans: findings found per scan, inverted so up is better. */
export function trendPath(found: readonly number[], w: number, h: number): string {
  if (found.length < 2) return '';
  const max = Math.max(1, ...found);
  return found
    .map(
      (v, i) =>
        (i ? 'L' : 'M') +
        (10 + (i / (found.length - 1)) * (w - 20)).toFixed(1) +
        ' ' +
        (10 + (v / max) * (h - 20)).toFixed(1),
    )
    .join(' ');
}

type View = 'overview' | 'findings' | 'sbom' | 'policies' | 'versions';

export function SecurityPage(props: {
  workspaceId: string;
  projectId: string;
  hub: EventHub;
  canEdit: boolean;
  isAdmin: boolean;
  go: (p: string) => void;
}): ReactNode {
  const [view, setView] = useState<View>('overview');
  const views: { key: View; label: string; icon: PIconName }[] = [
    { key: 'overview', label: 'Overview', icon: 'security' },
    { key: 'findings', label: 'Findings', icon: 'incident' },
    { key: 'versions', label: 'Versions', icon: 'versions' }, // [PCODE-323 | S15 | v0.1.0]
    { key: 'sbom', label: 'SBOM', icon: 'documents' },
    { key: 'policies', label: 'Policies and campaigns', icon: 'flag' },
  ];
  const base = {
    workspaceId: props.workspaceId,
    projectId: props.projectId,
    canEdit: props.canEdit,
    isAdmin: props.isAdmin,
  };
  return (
    <div className="pv-stack">
      <nav className="pv-subtabs" aria-label="Security view">
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            className="pv-subtab"
            aria-pressed={view === v.key}
            onClick={() => {
              setView(v.key);
            }}
          >
            <PIcon name={v.icon} size={14} />
            {v.label}
          </button>
        ))}
      </nav>
      {view === 'overview' ? <Overview {...base} hub={props.hub} /> : null}
      {view === 'findings' ? <Findings {...base} go={props.go} /> : null}
      {view === 'versions' ? <SecurityVersions {...base} /> : null}
      {view === 'sbom' ? <Sbom {...base} /> : null}
      {view === 'policies' ? <Policies {...base} /> : null}
    </div>
  );
}

// ── overview ──

function Overview(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
  isAdmin: boolean; // [PCODE-322 | S15 | v0.1.0]
  hub: EventHub;
}): ReactNode {
  const P = W(props.workspaceId, '/projects/' + props.projectId);
  const [p, setP] = useState<Posture | null>(null);
  const [gate, setGate] = useState<PolicyCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Posture>('GET', P + '/security/posture');
    if (r.ok) setP(r.data);
    else setError(r.error.message);
    if (props.canEdit) {
      const g = await api<PolicyCheck>('POST', P + '/policies/check', { appliesTo: 'release' });
      if (g.ok) setGate(g.data);
    }
  }, [P, props.canEdit]);
  useEffect(() => {
    void load();
    return props.hub.on((e) => {
      if (e.projectid === props.projectId && isEventOf(e.type, 'finding')) void load();
    });
  }, [load, props.hub, props.projectId]);
  if (!p) return <p className="pv-muted">{error ?? 'Loading the posture…'}</p>;
  const open = p.open.critical + p.open.high + p.open.medium + p.open.low + p.open.info;
  const tools = new Map<string, Posture['trend'][number]>();
  for (const s of p.trend) tools.set(s.tool, s);
  const line = trendPath(
    p.trend.map((s) => s.found),
    520,
    120,
  );
  return (
    <div className="pv-stack">
      <div className="pv-split">
        <Card title="Security posture">
          <div className="pv-posture">
            <Ring
              value={p.score}
              max={100}
              size={96}
              tone={p.score >= 80 ? 'success' : p.score >= 50 ? 'warning' : 'danger'}
            />
            <div className="pv-stack">
              <p className="pv-muted pv-small">
                Score of 100: open findings weighted by their risk. {p.trend.length} scan
                {p.trend.length === 1 ? '' : 's'} so far.
              </p>
              {line ? (
                <svg
                  className="pv-chart"
                  viewBox="0 0 520 120"
                  role="img"
                  aria-label="Findings per scan"
                >
                  <path className="pv-burndown-actual" d={line} />
                </svg>
              ) : null}
            </div>
          </div>
        </Card>
        <Card title="Blocks the next release">
          {gate ? (
            gate.results.length ? (
              <ul className="pv-checks">
                {gate.results.map((r) => (
                  <li
                    key={r.policy}
                    className={
                      r.violations.length ? 'pv-check pv-check--no' : 'pv-check pv-check--ok'
                    }
                  >
                    <PIcon name={r.violations.length ? 'x' : 'check'} size={15} />
                    <span>
                      <strong>{r.policy}</strong>{' '}
                      <span className="pv-muted pv-small">
                        {r.violations.length ? r.violations.join('; ') : 'passes'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pv-muted pv-small">
                No release policies yet: set them under Policies and campaigns.
              </p>
            )
          ) : (
            <p className="pv-muted pv-small">Members see what the release policies would block.</p>
          )}
        </Card>
      </div>
      <div className="pv-stats">
        <Stat
          label="Open findings"
          value={String(open)}
          sub={String(p.open.critical) + ' critical · ' + String(p.open.high) + ' high'}
          tone={p.open.critical ? 'danger' : p.open.high ? 'warning' : undefined}
          icon="security"
        />
        <Stat
          label="Past SLA"
          value={String(p.slaBreaches)}
          tone={p.slaBreaches ? 'danger' : 'success'}
          icon="clock"
        />
        <Stat
          label="Median time to fix"
          value={
            p.medianDaysToFix === null
              ? '—'
              : String(Math.round(p.medianDaysToFix * 10) / 10).replace('.', ',') + ' days'
          }
          icon="time"
        />
        <Stat
          label="Risks accepted"
          value={String(p.accepted)}
          sub="each until a date"
          icon="signoff"
        />
      </div>
      <Card flush title="Scanners">
        {tools.size ? (
          <table className="pv-table">
            <tbody>
              {[...tools.values()].map((s) => (
                <tr key={s.tool}>
                  <td className="pv-cell-strong">{s.tool}</td>
                  <td className="pv-cell-grow pv-muted">last run {ago(s.at)} ago</td>
                  <td className="pv-muted v2-nowrap">
                    {s.newCount} new · {s.fixedCount} fixed
                  </td>
                  <td>
                    {s.found ? (
                      <Chip tone="warning">{s.found} found</Chip>
                    ) : (
                      <Chip tone="success">clean</Chip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pv-empty">No scans yet. `orq scan` or CI uploads SARIF from any scanner.</p>
        )}
      </Card>
      {/* [PCODE-322 | S15 | v0.1.0] the EPSS and known-exploited feeds */}
      <FeedsCard workspaceId={props.workspaceId} isAdmin={props.isAdmin} />
    </div>
  );
}

// ── findings ──

function Findings(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
  isAdmin: boolean;
  go: (p: string) => void;
}): ReactNode {
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [list, setList] = useState<Finding[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Finding[]>(
      'GET',
      W(
        props.workspaceId,
        '/projects/' + props.projectId + '/findings' + (status === 'open' ? '?status=open' : ''),
      ),
    );
    if (r.ok) setList(r.data);
    else setError(r.error.message);
  }, [props.workspaceId, props.projectId, status]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!list) return <p className="pv-muted">{error ?? 'Loading findings…'}</p>;
  const f = list.find((x) => x.id === sel) ?? list[0];
  return (
    <div className="pv-split">
      <Card
        flush
        title={'Findings by risk · ' + String(list.length)}
        action={
          <span className="v2-inline">
            {/* [PCODE-321 | S15 | v0.1.0] any scanner's SARIF, from the browser */}
            {props.canEdit ? (
              <SarifUpload
                workspaceId={props.workspaceId}
                projectId={props.projectId}
                onDone={() => void load()}
              />
            ) : null}
            <label className="pv-switch">
              <input
                type="checkbox"
                checked={status === 'all'}
                onChange={(e) => {
                  setStatus(e.target.checked ? 'all' : 'open');
                }}
              />
              <span>Show fixed and decided</span>
            </label>
          </span>
        }
      >
        {list.length ? (
          <div className="pv-grid-scroll">
            <table className="pv-table">
              <thead>
                <tr>
                  <th className="pv-num">Risk</th>
                  <th>Finding</th>
                  <th>Signals</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {list.map((x) => {
                  const st = findingState(x);
                  return (
                    <tr
                      key={x.id}
                      className={'pv-click-row' + (x.id === f?.id ? ' pv-row-sel' : '')}
                      onClick={() => {
                        setSel(x.id);
                      }}
                    >
                      <td className="pv-num">
                        <span className={'pv-risk-pill pv-risk-pill--' + riskBand(x.riskScore)}>
                          {x.riskScore}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="pv-link-btn"
                          onClick={() => {
                            setSel(x.id);
                          }}
                        >
                          {x.title}
                        </button>
                        <span className="pv-muted pv-block pv-small">
                          {x.cve || x.rule} ·{' '}
                          {x.file ? x.file + (x.line ? ':' + String(x.line) : '') : x.tool}
                          {x.slaDueAt && x.status === 'open'
                            ? ' · fix by ' + dateText(x.slaDueAt)
                            : ''}
                        </span>
                      </td>
                      <td>
                        <span className="pv-signals">
                          <Chip tone={SEV_TONE[x.severity] ?? 'neutral'}>{x.severity}</Chip>
                          {x.kev ? <Chip tone="danger">KEV</Chip> : null}
                          {x.reachable ? <Chip tone="warning">reachable</Chip> : null}
                          {x.exposed ? <Chip tone="info">exposed</Chip> : null}
                        </span>
                      </td>
                      <td>
                        <Chip tone={st.tone}>{st.text}</Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="pv-empty">{status === 'open' ? 'No open findings.' : 'No findings yet.'}</p>
        )}
      </Card>
      {f ? (
        <Detail
          key={f.id}
          workspaceId={props.workspaceId}
          f={f}
          canEdit={props.canEdit}
          isAdmin={props.isAdmin}
          go={props.go}
          onChange={() => void load()}
        />
      ) : null}
    </div>
  );
}

function Detail(props: {
  workspaceId: string;
  f: Finding;
  canEdit: boolean;
  isAdmin: boolean;
  go: (p: string) => void;
  onChange: () => void;
}): ReactNode {
  const { f } = props;
  const F = W(props.workspaceId, '/findings/' + f.id);
  const [risk, setRisk] = useState<Risk | null>(null);
  const [mode, setMode] = useState<'' | 'accept' | 'fp' | 'facts'>('');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [facts, setFacts] = useState({
    cvss: '',
    epss: '',
    kev: false,
    reachable: '',
    exposed: '',
  });
  const [triage, setTriage] = useState(f.triage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Risk>('GET', F + '/risk');
    if (r.ok) {
      setRisk(r.data);
      setFacts({
        cvss: r.data.cvss === null ? '' : String(r.data.cvss),
        epss: r.data.epss === null ? '' : String(r.data.epss),
        kev: r.data.kev,
        reachable: r.data.reachable === null ? '' : String(r.data.reachable),
        exposed: r.data.exposed === null ? '' : String(r.data.exposed),
      });
    }
  }, [F]);
  useEffect(() => {
    void load();
  }, [load]);
  const call = async (method: 'POST' | 'PATCH', path: string, body?: object): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const r = await api<{ triage?: string }>(method, F + path, body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return false;
    }
    if (typeof r.data.triage === 'string') setTriage(r.data.triage);
    setMode('');
    setReason('');
    props.onChange();
    void load();
    return true;
  };
  const tri = (v: string): boolean | null => (v === 'true' ? true : v === 'false' ? false : null);
  const factor = (label: string, value: string, on: boolean | null): ReactNode => (
    <li className={'pv-factor' + (on ? ' pv-factor--on' : '')}>
      <span>{label}</span>
      <strong>{value}</strong>
    </li>
  );
  const st = findingState(f);
  return (
    <Card title={f.title}>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pv-risk-head">
        <span className="pv-risk-score">{risk?.riskScore ?? f.riskScore}</span>
        <div>
          <div className="pv-strong">Risk score</div>
          <div className="pv-muted pv-small">orders the list; severity alone does not</div>
        </div>
        <Chip tone={SEV_TONE[f.severity] ?? 'neutral'}>{f.severity}</Chip>
        <Chip tone={st.tone}>{st.text}</Chip>
      </div>
      {risk ? (
        <ul className="pv-factors">
          {factor(
            'CVSS',
            risk.cvss === null ? '—' : risk.cvss.toFixed(1).replace('.', ','),
            risk.cvss !== null && risk.cvss >= 7,
          )}
          {factor(
            'Exploit likelihood (EPSS)',
            risk.epss === null ? '—' : String(Math.round(risk.epss * 100)) + ' %',
            risk.epss !== null && risk.epss > 0.1,
          )}
          {factor('Known exploited (KEV)', risk.kev ? 'yes' : 'no', risk.kev)}
          {factor(
            'Reachable from our code',
            risk.reachable === null ? 'unknown' : risk.reachable ? 'yes' : 'no',
            risk.reachable,
          )}
          {factor(
            'Exposed to the internet',
            risk.exposed === null ? 'unknown' : risk.exposed ? 'yes' : 'no',
            risk.exposed,
          )}
        </ul>
      ) : null}
      <div className="pv-kv pv-mt">
        <span>Where</span>
        <span className="pv-mono pv-small">
          {f.file ? f.file + (f.line ? ':' + String(f.line) : '') : '—'}
        </span>
        <span>Rule</span>
        <span className="pv-mono pv-small">
          {f.rule} · {f.tool}
        </span>
        {f.package ? (
          <>
            <span>Package</span>
            <span className="pv-mono pv-small">
              {f.package} {risk?.packageVersion ?? ''}
              {risk?.fixedVersion ? ' → fixed in ' + risk.fixedVersion : ''}
            </span>
          </>
        ) : null}
        <span>Introduced by</span>
        <span>
          {risk?.introducedBy ? (
            <button
              type="button"
              className="pv-link-btn"
              onClick={() => {
                props.go('/items/' + (risk.introducedBy?.id ?? ''));
              }}
            >
              {risk.introducedBy.ref} {risk.introducedBy.title}
            </button>
          ) : (
            <span className="pv-muted">no fingerprint on that code</span>
          )}
        </span>
        <span>Task</span>
        <span>
          {f.itemId ? (
            <button
              type="button"
              className="pv-link-btn"
              onClick={() => {
                props.go('/items/' + (f.itemId ?? ''));
              }}
            >
              {f.itemRef}
            </button>
          ) : (
            '—'
          )}
        </span>
        <span>SLA</span>
        <span className={risk?.slaBreached ? 'pv-text-danger' : ''}>
          {risk?.slaDueAt
            ? 'fix by ' + dateText(risk.slaDueAt) + (risk.slaBreached ? ' · overdue' : '')
            : 'none'}
        </span>
        {f.reason ? (
          <>
            <span>Reason</span>
            <span>
              {f.reason}
              {f.decidedBy ? ' · ' + f.decidedBy : ''}
            </span>
          </>
        ) : null}
      </div>
      {triage ? (
        <div className="pv-callout pv-callout--agent pv-mt">
          <PIcon name="agents" size={16} />
          <div>{triage}</div>
        </div>
      ) : null}
      {props.canEdit && mode === 'facts' ? (
        <form
          className="v2-form pv-mt"
          onSubmit={(e) => {
            e.preventDefault();
            void call('PATCH', '/risk', {
              cvss: facts.cvss ? Number(facts.cvss.replace(',', '.')) : null,
              epss: facts.epss ? Number(facts.epss.replace(',', '.')) : null,
              kev: facts.kev,
              reachable: tri(facts.reachable),
              exposed: tri(facts.exposed),
            });
          }}
        >
          <input
            className="v2-input v2-input--sm"
            aria-label="CVSS"
            placeholder="CVSS 0–10"
            value={facts.cvss}
            onChange={(e) => {
              setFacts({ ...facts, cvss: e.target.value });
            }}
          />
          <input
            className="v2-input v2-input--sm"
            aria-label="EPSS"
            placeholder="EPSS 0–1"
            value={facts.epss}
            onChange={(e) => {
              setFacts({ ...facts, epss: e.target.value });
            }}
          />
          {(['reachable', 'exposed'] as const).map((k) => (
            <select
              key={k}
              className="v2-input v2-input--sm"
              aria-label={k}
              value={facts[k]}
              onChange={(e) => {
                setFacts({ ...facts, [k]: e.target.value });
              }}
            >
              <option value="">{k}: unknown</option>
              <option value="true">{k}: yes</option>
              <option value="false">{k}: no</option>
            </select>
          ))}
          <label className="v2-switch">
            <input
              type="checkbox"
              checked={facts.kev}
              onChange={(e) => {
                setFacts({ ...facts, kev: e.target.checked });
              }}
            />
            <span>Known exploited</span>
          </label>
          <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm" disabled={busy}>
            Save
          </button>
        </form>
      ) : null}
      {mode === 'accept' || mode === 'fp' ? (
        <form
          className="v2-form pv-mt"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === 'accept') void call('POST', '/accept', { reason: reason.trim(), until });
            else
              void call('POST', '/decision', { status: 'false_positive', reason: reason.trim() });
          }}
        >
          <input
            className="v2-input"
            aria-label="Reason"
            placeholder={
              mode === 'accept' ? 'Why the risk is acceptable for now' : 'Why this is not a problem'
            }
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
          {mode === 'accept' ? (
            <input
              className="v2-input v2-input--sm"
              type="date"
              aria-label="Accepted until"
              value={until}
              onChange={(e) => {
                setUntil(e.target.value);
              }}
            />
          ) : null}
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={
              busy ||
              reason.trim().length < (mode === 'accept' ? 10 : 1) ||
              (mode === 'accept' && !until)
            }
          >
            {mode === 'accept' ? 'Accept until this date' : 'Mark as false positive'}
          </button>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setMode('');
            }}
          >
            Cancel
          </Button>
        </form>
      ) : null}
      {props.canEdit && mode === '' ? (
        <div className="pv-page-actions pv-mt">
          {f.status === 'open' && !f.itemId ? (
            <Button
              kind="primary"
              icon="planning"
              disabled={busy}
              onClick={() => void call('POST', '/task')}
            >
              Make a task
            </Button>
          ) : null}
          {f.status === 'open' && f.workflow === 'new' ? (
            <Button
              disabled={busy}
              onClick={() => void call('POST', '/workflow', { to: 'confirmed' })}
            >
              Confirm
            </Button>
          ) : null}
          {f.status === 'open' && (f.workflow === 'new' || f.workflow === 'confirmed') ? (
            <Button
              disabled={busy}
              onClick={() => void call('POST', '/workflow', { to: 'fixing' })}
            >
              Fixing
            </Button>
          ) : null}
          {/* [PCODE-324 | S15 | v0.1.0] the change that fixes it, as a pull request */}
          {f.status === 'open' && !f.fixPrUrl && !f.rule.startsWith('secret/') ? (
            <Button
              icon="git"
              disabled={busy}
              title={
                f.package
                  ? 'Raise ' + f.package + ' to its fixed version'
                  : 'The Security agent writes the fix; a person reviews it'
              }
              onClick={() => void call('POST', '/fix-pr')}
            >
              {f.package ? 'Open an upgrade pull request' : 'Open a fix pull request'}
            </Button>
          ) : null}
          {f.fixPrUrl ? (
            <a
              className="pv-btn pv-btn--ghost pv-btn--sm"
              href={f.fixPrUrl}
              target="_blank"
              rel="noopener"
            >
              The fix pull request
            </a>
          ) : null}
          <Button
            icon="agents"
            kind="ghost"
            disabled={busy}
            onClick={() => void call('POST', '/triage')}
          >
            {busy ? 'Working…' : 'Ask the Security agent'}
          </Button>
          <Button
            kind="ghost"
            onClick={() => {
              setMode('facts');
            }}
          >
            Risk facts
          </Button>
          {props.isAdmin && f.status === 'open' ? (
            <>
              <Button
                kind="ghost"
                onClick={() => {
                  setMode('accept');
                }}
              >
                Accept risk until…
              </Button>
              <Button
                kind="ghost"
                onClick={() => {
                  setMode('fp');
                }}
              >
                False positive
              </Button>
            </>
          ) : null}
          {props.isAdmin && (f.status === 'accepted' || f.status === 'false_positive') ? (
            <Button
              kind="ghost"
              disabled={busy}
              onClick={() => void call('POST', '/decision', { status: 'open' })}
            >
              Open again
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

// ── SBOM ──

interface SbomRow {
  id: string;
  format: string;
  releaseId: string | null;
  releaseVersion: string | null;
  components: number;
  licences: string[];
  createdAt: string;
}
interface Component {
  name: string;
  version: string;
  purl: string;
  licences: string[];
}
const COPYLEFT = /^(A?GPL|LGPL|SSPL|EUPL|MPL|OSL|CC-BY-SA)/i;

function Sbom(props: { workspaceId: string; projectId: string; canEdit: boolean }): ReactNode {
  const P = W(props.workspaceId, '/projects/' + props.projectId);
  const [list, setList] = useState<SbomRow[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [parts, setParts] = useState<Component[]>([]);
  const [diff, setDiff] = useState<{
    added: Component[];
    removed: Component[];
    changed: { name: string; from: string; to: string }[];
  } | null>(null);
  const [pkg, setPkg] = useState('');
  const [hits, setHits] = useState<
    | { projectKey: string; version: string; releasedAt: string | null; componentVersion: string }[]
    | null
  >(null);
  const [releases, setReleases] = useState<{ id: string; version: string }[]>([]);
  const [rel, setRel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<SbomRow[]>('GET', P + '/sboms');
    if (r.ok) setList(r.data);
    else setError(r.error.message);
    const rs = await api<{ releases: { id: string; version: string }[] }>('GET', P + '/releases');
    if (rs.ok) setReleases(rs.data.releases);
  }, [P]);
  useEffect(() => {
    void load();
  }, [load]);
  const current = list?.find((s) => s.id === sel) ?? list?.[0];
  const previous = list && current ? list[list.indexOf(current) + 1] : undefined;
  useEffect(() => {
    if (!current) return;
    void api<{ components: Component[] }>('GET', W(props.workspaceId, '/sboms/' + current.id)).then(
      (r) => {
        if (r.ok) setParts(r.data.components);
      },
    );
    if (previous)
      void api<NonNullable<typeof diff>>(
        'GET',
        W(props.workspaceId, '/sbom-diff?a=' + previous.id + '&b=' + current.id),
      ).then((r) => {
        setDiff(r.ok ? r.data : null);
      });
    else setDiff(null);
  }, [current, previous, props.workspaceId]);
  const upload = async (file: File): Promise<void> => {
    setError(null);
    let doc: unknown;
    try {
      doc = JSON.parse(await file.text());
    } catch {
      setError(file.name + ' is not JSON: send CycloneDX or SPDX in JSON.');
      return;
    }
    const r = await api<{ id: string }>('POST', P + '/sboms', {
      document: doc,
      ...(rel ? { releaseId: rel } : {}),
    });
    if (!r.ok) setError(r.error.message);
    else {
      setSel(r.data.id);
      void load();
    }
  };
  const ask = async (): Promise<void> => {
    const [name, version] = pkg.trim().split('@');
    const r = await api<NonNullable<typeof hits>>(
      'GET',
      W(
        props.workspaceId,
        '/package-exposure?name=' +
          encodeURIComponent(name ?? '') +
          (version ? '&version=' + encodeURIComponent(version) : ''),
      ),
    );
    if (r.ok) setHits(r.data);
    else setError(r.error.message);
  };
  if (!list) return <p className="pv-muted">{error ?? 'Loading…'}</p>;
  return (
    <div className="pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pv-split">
        <Card
          flush
          title={
            current
              ? 'Bill of materials · ' +
                (current.releaseVersion ?? 'no release') +
                ' · ' +
                String(current.components) +
                ' packages'
              : 'Bill of materials'
          }
          action={
            list.length > 1 ? (
              <select
                className="v2-input v2-input--sm"
                aria-label="SBOM"
                value={current?.id ?? ''}
                onChange={(e) => {
                  setSel(e.target.value);
                }}
              >
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {(s.releaseVersion ?? 'no release') +
                      ' · ' +
                      s.format +
                      ' · ' +
                      dateText(s.createdAt)}
                  </option>
                ))}
              </select>
            ) : null
          }
        >
          {current ? (
            <div className="pv-grid-scroll">
              <table className="pv-table">
                <thead>
                  <tr>
                    <th>Package</th>
                    <th>Version</th>
                    <th>Licence</th>
                  </tr>
                </thead>
                <tbody>
                  {parts.slice(0, 500).map((c) => (
                    <tr key={c.name + '@' + c.version}>
                      <td className="pv-mono">{c.name}</td>
                      <td className="pv-mono">{c.version}</td>
                      <td>
                        {c.licences.length ? (
                          c.licences.map((l) => (
                            <Chip key={l} tone={COPYLEFT.test(l) ? 'warning' : 'neutral'}>
                              {l}
                            </Chip>
                          ))
                        ) : (
                          <span className="pv-muted">unknown</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="pv-empty">
              No SBOM yet. Upload one per release (CycloneDX or SPDX, JSON).
            </p>
          )}
          {diff && previous ? (
            <p className="pv-muted pv-small v2-pad">
              Compared with {previous.releaseVersion ?? dateText(previous.createdAt)}:{' '}
              {diff.added.length} added, {diff.removed.length} removed, {diff.changed.length}{' '}
              changed
              {diff.changed.length
                ? ' (' +
                  diff.changed
                    .slice(0, 5)
                    .map((x) => x.name + ' ' + x.from + ' → ' + x.to)
                    .join(', ') +
                  ')'
                : ''}
              .
            </p>
          ) : null}
        </Card>
        <div className="pv-stack">
          <Card title="A new CVE: which shipped versions contain the package?">
            <form
              className="pv-ask"
              onSubmit={(e) => {
                e.preventDefault();
                if (pkg.trim()) void ask();
              }}
            >
              <input
                aria-label="Package"
                placeholder="xml2js or xml2js@0.4.23"
                value={pkg}
                onChange={(e) => {
                  setPkg(e.target.value);
                }}
              />
              <button type="submit" className="pv-btn pv-btn--primary" disabled={!pkg.trim()}>
                Check
              </button>
            </form>
            {hits ? (
              hits.length ? (
                <ul className="pv-checks">
                  {hits.map((h) => (
                    <li key={h.projectKey + h.version} className="pv-check pv-check--no">
                      <PIcon name="x" size={15} />
                      <span>
                        <strong>
                          {h.projectKey} {h.version}
                        </strong>{' '}
                        <span className="pv-muted pv-small">
                          contains {h.componentVersion}
                          {h.releasedAt ? ' · shipped ' + dateText(h.releasedAt) : ''}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="pv-checks">
                  <li className="pv-check pv-check--ok">
                    <PIcon name="check" size={15} />
                    <span>No shipped release contains it.</span>
                  </li>
                </ul>
              )
            ) : (
              <p className="pv-muted pv-small">
                Every shipped version keeps its bill of materials, so old releases can be checked
                against new CVEs.
              </p>
            )}
          </Card>
          {props.canEdit ? (
            <Card title="Upload an SBOM">
              <div className="v2-form">
                <select
                  className="v2-input v2-input--sm"
                  aria-label="For release"
                  value={rel}
                  onChange={(e) => {
                    setRel(e.target.value);
                  }}
                >
                  <option value="">Not for a release</option>
                  {releases.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.version}
                    </option>
                  ))}
                </select>
                <input
                  type="file"
                  accept="application/json,.json"
                  aria-label="SBOM file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                    e.target.value = '';
                  }}
                />
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── policies and campaigns ──

interface Policy {
  id: string;
  projectId: string | null;
  name: string;
  appliesTo: string;
  rule: {
    maxSeverity?: string;
    minRisk?: number;
    bannedLicences?: string[];
    liveSecrets?: boolean;
    newOnly?: boolean;
    testsPass?: boolean; // [PCODE-316 | S15 | v0.1.0]
    testsSigned?: boolean;
  };
  enabled: boolean;
}
interface Campaign {
  id: string;
  title: string;
  rule: string;
  package: string;
  cve: string;
  dueDate: string | null;
  status: string;
  open: number;
  fixed: number;
  projects: { projectId: string; key: string; open: number; fixed: number }[];
}

/** A policy's rule in words. */
export function ruleText(r: Policy['rule']): string {
  const parts: string[] = [];
  if (r.maxSeverity)
    parts.push(
      'no open ' + r.maxSeverity + (r.maxSeverity === 'critical' ? '' : ' or worse') + ' finding',
    );
  if (r.minRisk !== undefined)
    parts.push('no finding with a risk of ' + String(r.minRisk) + ' or more');
  if (r.liveSecrets) parts.push('no secret in the code');
  if (r.bannedLicences?.length) parts.push('no package under ' + r.bannedLicences.join(', '));
  // [PCODE-316 | S15 | v0.1.0]
  if (r.testsPass) parts.push('every test passes');
  if (r.testsSigned) parts.push('a test run is signed off');
  return (parts.join(', ') || 'no rule') + (r.newOnly ? ' (new issues only)' : '');
}

function Policies(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
  isAdmin: boolean;
}): ReactNode {
  const [pols, setPols] = useState<Policy[] | null>(null);
  const [camps, setCamps] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    appliesTo: 'release',
    kind: 'maxSeverity',
    value: 'high',
    newOnly: false,
  });
  const [camp, setCamp] = useState({ title: '', target: 'package', value: '', due: '' });
  const load = useCallback(async () => {
    const [p, c] = await Promise.all([
      api<Policy[]>('GET', W(props.workspaceId, '/policies')),
      api<Campaign[]>('GET', W(props.workspaceId, '/campaigns')),
    ]);
    if (p.ok)
      setPols(p.data.filter((x) => x.projectId === null || x.projectId === props.projectId));
    else setError(p.error.message);
    if (c.ok) setCamps(c.data);
  }, [props.workspaceId, props.projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  const send = async (method: 'POST' | 'PATCH', path: string, body: object): Promise<boolean> => {
    const r = await api(method, W(props.workspaceId, path), body);
    if (!r.ok) {
      setError(r.error.message);
      return false;
    }
    setError(null);
    void load();
    return true;
  };
  const addPolicy = async (): Promise<void> => {
    const rule =
      form.kind === 'maxSeverity'
        ? { maxSeverity: form.value }
        : form.kind === 'minRisk'
          ? { minRisk: Number(form.value) || 70 }
          : form.kind === 'liveSecrets'
            ? { liveSecrets: true }
            : form.kind === 'testsPass' // [PCODE-316 | S15 | v0.1.0]
              ? { testsPass: true }
              : form.kind === 'testsSigned'
                ? { testsSigned: true }
                : {
                    bannedLicences: form.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  };
    if (
      await send('POST', '/policies', {
        name: form.name.trim(),
        appliesTo: form.appliesTo,
        rule: { ...rule, ...(form.newOnly ? { newOnly: true } : {}) },
        projectId: props.projectId,
      })
    )
      setForm({ ...form, name: '' });
  };
  const addCampaign = async (): Promise<void> => {
    if (
      await send('POST', '/campaigns', {
        title: camp.title.trim(),
        [camp.target]: camp.value.trim(),
        ...(camp.due ? { dueDate: camp.due } : {}),
      })
    )
      setCamp({ title: '', target: camp.target, value: '', due: '' });
  };
  if (!pols) return <p className="pv-muted">{error ?? 'Loading…'}</p>;
  return (
    <div className="pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pv-split">
        <Card flush title="Policies (gates)">
          {pols.length ? (
            <ul className="pv-rows">
              {pols.map((p) => (
                <li key={p.id} className="pv-row pv-row--static">
                  <span className="pv-row-main">
                    <span className="pv-row-title">{p.name}</span>
                    <span className="pv-row-sub">
                      Blocks a {p.appliesTo}: {ruleText(p.rule)} ·{' '}
                      {p.projectId ? 'this project' : 'every project'}
                    </span>
                  </span>
                  <label className="pv-switch">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      disabled={!props.isAdmin}
                      onChange={(e) =>
                        void send('PATCH', '/policies/' + p.id, { enabled: e.target.checked })
                      }
                    />
                    <span>{p.enabled ? 'on' : 'off'}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pv-empty">
              No policies yet. A release policy is checked when a release ships.
            </p>
          )}
          {props.isAdmin ? (
            <form
              className="v2-form v2-pad"
              onSubmit={(e) => {
                e.preventDefault();
                if (form.name.trim()) void addPolicy();
              }}
            >
              <input
                className="v2-input v2-input--sm"
                aria-label="Policy name"
                placeholder="Name, e.g. No high findings"
                value={form.name}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value });
                }}
              />
              <select
                className="v2-input v2-input--sm"
                aria-label="Gate"
                value={form.appliesTo}
                onChange={(e) => {
                  setForm({ ...form, appliesTo: e.target.value });
                }}
              >
                <option value="release">Blocks a release</option>
                <option value="merge">Blocks a merge</option>
              </select>
              <select
                className="v2-input v2-input--sm"
                aria-label="Rule"
                value={form.kind}
                onChange={(e) => {
                  setForm({
                    ...form,
                    kind: e.target.value,
                    value:
                      e.target.value === 'maxSeverity'
                        ? 'high'
                        : e.target.value === 'minRisk'
                          ? '70'
                          : '',
                  });
                }}
              >
                <option value="maxSeverity">Severity at or above</option>
                <option value="minRisk">Risk score at or above</option>
                <option value="liveSecrets">Secrets in the code</option>
                <option value="bannedLicences">Banned licences</option>
                {/* [PCODE-316 | S15 | v0.1.0] release gates on tests */}
                {form.appliesTo === 'release' ? (
                  <>
                    <option value="testsPass">Every test passes</option>
                    <option value="testsSigned">A test run is signed off</option>
                  </>
                ) : null}
              </select>
              {form.kind === 'maxSeverity' ? (
                <select
                  className="v2-input v2-input--sm"
                  aria-label="Severity"
                  value={form.value}
                  onChange={(e) => {
                    setForm({ ...form, value: e.target.value });
                  }}
                >
                  {['critical', 'high', 'medium', 'low'].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : ['liveSecrets', 'testsPass', 'testsSigned'].includes(form.kind) ? null : (
                <input
                  className="v2-input v2-input--sm"
                  aria-label="Value"
                  placeholder={form.kind === 'minRisk' ? '70' : 'AGPL-3.0, SSPL-1.0'}
                  value={form.value}
                  onChange={(e) => {
                    setForm({ ...form, value: e.target.value });
                  }}
                />
              )}
              <label className="v2-switch">
                <input
                  type="checkbox"
                  checked={form.newOnly}
                  onChange={(e) => {
                    setForm({ ...form, newOnly: e.target.checked });
                  }}
                />
                <span>New issues only</span>
              </label>
              <button
                type="submit"
                className="pv-btn pv-btn--secondary pv-btn--sm"
                disabled={!form.name.trim()}
              >
                Add policy
              </button>
            </form>
          ) : null}
        </Card>
        <Card
          title={
            'Campaigns · ' + String(camps.filter((c) => c.status === 'active').length) + ' active'
          }
        >
          {camps.length ? (
            <div className="pv-stack">
              {camps.map((c) => (
                <div key={c.id} className="pv-stack">
                  <div className="pv-page-actions">
                    <strong>{c.title}</strong>
                    <Chip
                      tone={
                        c.status === 'active'
                          ? 'primary'
                          : c.status === 'done'
                            ? 'success'
                            : 'neutral'
                      }
                    >
                      {c.status}
                    </Chip>
                    <span className="pv-muted pv-small">
                      {c.package || c.cve || c.rule} · {c.fixed} fixed, {c.open} open
                      {c.dueDate ? ' · due ' + dateText(c.dueDate) : ''}
                    </span>
                    {props.isAdmin && c.status === 'active' ? (
                      <Button
                        size="sm"
                        kind="ghost"
                        onClick={() => void send('PATCH', '/campaigns/' + c.id, { status: 'done' })}
                      >
                        Done
                      </Button>
                    ) : null}
                  </div>
                  {c.projects.length ? (
                    <ul className="pv-share">
                      {c.projects.map((p) => (
                        <li key={p.projectId} className="pv-share-row pv-share-row--wide">
                          <span className="pv-share-label pv-mono">{p.key}</span>
                          <Bar
                            value={p.fixed}
                            max={Math.max(1, p.fixed + p.open)}
                            tone={p.open ? 'warning' : 'success'}
                          />
                          <span className="pv-share-value pv-small">
                            {p.fixed}/{p.fixed + p.open}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="pv-muted pv-small">No project has it.</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="pv-muted pv-small">
              A campaign clears one package, CVE or rule in every project.
            </p>
          )}
          {props.isAdmin ? (
            <form
              className="v2-form pv-mt"
              onSubmit={(e) => {
                e.preventDefault();
                if (camp.title.trim() && camp.value.trim()) void addCampaign();
              }}
            >
              <input
                className="v2-input v2-input--sm"
                aria-label="Campaign title"
                placeholder="Remove xml2js 0.4 everywhere"
                value={camp.title}
                onChange={(e) => {
                  setCamp({ ...camp, title: e.target.value });
                }}
              />
              <select
                className="v2-input v2-input--sm"
                aria-label="Target"
                value={camp.target}
                onChange={(e) => {
                  setCamp({ ...camp, target: e.target.value });
                }}
              >
                <option value="package">Package</option>
                <option value="cve">CVE</option>
                <option value="rule">Rule</option>
              </select>
              <input
                className="v2-input v2-input--sm v2-mono"
                aria-label="Target value"
                placeholder={
                  camp.target === 'cve'
                    ? 'CVE-2026-31144'
                    : camp.target === 'rule'
                      ? 'js/eval'
                      : 'xml2js'
                }
                value={camp.value}
                onChange={(e) => {
                  setCamp({ ...camp, value: e.target.value });
                }}
              />
              <input
                className="v2-input v2-input--sm"
                type="date"
                aria-label="Due"
                value={camp.due}
                onChange={(e) => {
                  setCamp({ ...camp, due: e.target.value });
                }}
              />
              <button
                type="submit"
                className="pv-btn pv-btn--secondary pv-btn--sm"
                disabled={!camp.title.trim() || !camp.value.trim()}
              >
                Start campaign
              </button>
            </form>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
