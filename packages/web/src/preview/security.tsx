// ── [PCODE-156 | S15 | v0.1.0] D4 preview: Versions, Security, Code map and Releases ──
//    Why:  the Security tab as a command center: one posture score and its trend, every scanner in one
//          list, and findings ordered by a single risk score built from severity, exploit likelihood (EPSS),
//          known exploitation (KEV), reachability and exposure. Each finding names the code and the task
//          (and agent) that introduced it; it can go to an agent to fix, or be accepted with a reason and an
//          expiry. Policies are gates; the SBOM answers "which shipped versions are affected".
import { useState, type ReactNode } from 'react';
import { FINDINGS, POLICIES, POSTURE, SBOM, SCANNERS, type Finding } from './data4.js';
import { euro, person } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Bar, Button, Card, Chip, Ring, Stat } from './ui.js';

const SEV_TONE: Record<Finding['severity'], 'danger' | 'warning' | 'info' | 'neutral'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
};

function Trend(): ReactNode {
  const w = 520;
  const h = 120;
  const x = (i: number): number => 10 + (i / (POSTURE.length - 1)) * (w - 20);
  const y = (v: number): number => h - 10 - ((v - 50) / 50) * (h - 20);
  const line = POSTURE.map(
    (v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1),
  ).join(' ');
  return (
    <svg
      className="pv-chart"
      viewBox={'0 0 ' + String(w) + ' ' + String(h)}
      role="img"
      aria-label="Posture over 12 weeks"
    >
      {[60, 70, 80, 90].map((v) => (
        <line key={v} className="pv-gridline" x1="10" x2={w - 10} y1={y(v)} y2={y(v)} />
      ))}
      <path
        className="pv-burndown-area"
        d={
          line +
          ' L' +
          String(x(POSTURE.length - 1)) +
          ' ' +
          String(h - 10) +
          ' L10 ' +
          String(h - 10) +
          ' Z'
        }
      />
      <path className="pv-burndown-actual" d={line} />
    </svg>
  );
}

function Overview(): ReactNode {
  return (
    <div className="pv-stack">
      <div className="pv-split">
        <Card title="Security posture">
          <div className="pv-posture">
            <Ring value={81} max={100} size={96} tone="success" />
            <div className="pv-stack">
              <p className="pv-muted pv-small">
                Score of 100: open findings weighted by risk, time past SLA and coverage of the
                scanners. Up 19 in 12 weeks.
              </p>
              <Trend />
            </div>
          </div>
        </Card>
        <Card title="Blocks the next release">
          <ul className="pv-checks">
            <li className="pv-check pv-check--no">
              <PIcon name="x" size={15} />
              <span>
                <strong>F-68 GPL-3.0 package in the driver app</strong>{' '}
                <span className="pv-muted pv-small">licence policy</span>
              </span>
            </li>
            <li className="pv-check pv-check--no">
              <PIcon name="x" size={15} />
              <span>
                <strong>F-79 known-exploited, reachable</strong>{' '}
                <span className="pv-muted pv-small">fix in map-sdk 4.2 (#309, failing)</span>
              </span>
            </li>
            <li className="pv-check pv-check--ok">
              <PIcon name="check" size={15} />
              <span>
                <strong>No live secrets</strong>{' '}
                <span className="pv-muted pv-small">F-74 key revoked 2 Oct</span>
              </span>
            </li>
          </ul>
        </Card>
      </div>
      <div className="pv-stats">
        <Stat
          label="Open findings"
          value="5"
          sub="1 critical (HEL) · 1 high here"
          tone="warning"
          icon="security"
        />
        <Stat label="Past SLA" value="0" sub="next due in 4 days" tone="success" icon="clock" />
        <Stat label="Median time to fix" value="3.2 days" sub="high and critical" icon="time" />
        <Stat
          label="Fixed by agents"
          value="62 %"
          sub={'last 90 days · ' + euro(41) + ' in tokens'}
          icon="agents"
        />
      </div>
      <Card flush title="Scanners">
        <table className="pv-table">
          <tbody>
            {SCANNERS.map((s) => (
              <tr key={s.name}>
                <td className="pv-cell-strong">{s.name}</td>
                <td className="pv-cell-grow pv-muted">{s.tool}</td>
                <td className="pv-muted">last run {s.last}</td>
                <td>
                  {s.found ? (
                    <Chip tone="warning">{s.found} open</Chip>
                  ) : (
                    <Chip tone="success">clean</Chip>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Detail(props: { f: Finding }): ReactNode {
  const f = props.f;
  const [action, setAction] = useState<'' | 'agent' | 'accept' | 'fp'>('');
  const factor = (label: string, value: string, on: boolean | null): ReactNode => (
    <li className={'pv-factor' + (on ? ' pv-factor--on' : '')}>
      <span>{label}</span>
      <strong>{value}</strong>
    </li>
  );
  return (
    <Card title={f.id + ' · ' + f.title}>
      <div className="pv-risk-head">
        <span className="pv-risk-score">{f.risk}</span>
        <div>
          <div className="pv-strong">Risk score</div>
          <div className="pv-muted pv-small">orders the list; severity alone does not</div>
        </div>
        <Chip tone={SEV_TONE[f.severity]}>{f.severity}</Chip>
      </div>
      <ul className="pv-factors">
        {factor('CVSS', f.cvss ? f.cvss.toFixed(1) : '—', f.cvss >= 7)}
        {factor(
          'Exploit likelihood (EPSS)',
          f.epss ? String(Math.round(f.epss * 100)) + ' %' : '—',
          f.epss > 0.1,
        )}
        {factor('Known exploited (KEV)', f.kev ? 'yes' : 'no', f.kev)}
        {factor(
          'Reachable from our code',
          f.reachable === null ? 'n/a' : f.reachable ? 'yes' : 'no',
          f.reachable,
        )}
        {factor('Exposed to the internet', f.exposed ? 'yes' : 'no', f.exposed)}
      </ul>
      <div className="pv-kv pv-mt">
        <span>Where</span>
        <span className="pv-mono">{f.where}</span>
        <span>Introduced by</span>
        <span>{f.introducedBy} · from the fingerprint on that code</span>
        <span>Owner</span>
        <span className="pv-who">
          <Avatar id={f.owner} size="xs" /> {person(f.owner).name}
        </span>
        <span>SLA</span>
        <span>{f.sla}</span>
        {f.kind === 'dependency' ? (
          <>
            <span>Path</span>
            <span className="pv-mono pv-small">fleet-portal → map-sdk 4.1.3 → xml2js 0.4.23</span>
          </>
        ) : null}
      </div>
      {action === 'agent' ? (
        <Chip tone="success" icon="agents">
          Sentinel opened #324: upgrade map-sdk to 4.2.1 · about {euro(0.6, 2)} · tests running
        </Chip>
      ) : action === 'accept' ? (
        <div className="pv-accept">
          <label className="pv-field">
            <span>Reason</span>
            <input defaultValue="Not reachable; only used by the test reporter" />
          </label>
          <label className="pv-field">
            <span>Accepted until</span>
            <input type="date" defaultValue="2026-11-03" />
          </label>
          <Button kind="primary" size="sm">
            Ask Mara to approve
          </Button>
        </div>
      ) : action === 'fp' ? (
        <Chip tone="neutral">
          Marked as false positive; the rule learns from it for this project
        </Chip>
      ) : (
        <div className="pv-page-actions pv-mt">
          <Button
            kind="primary"
            icon="agents"
            onClick={() => {
              setAction('agent');
            }}
          >
            Fix with Sentinel
          </Button>
          <Button icon="planning">Make a task</Button>
          <Button
            kind="ghost"
            onClick={() => {
              setAction('accept');
            }}
          >
            Accept risk until…
          </Button>
          <Button
            kind="ghost"
            onClick={() => {
              setAction('fp');
            }}
          >
            False positive
          </Button>
        </div>
      )}
    </Card>
  );
}

function Findings(): ReactNode {
  const [sel, setSel] = useState('F-79');
  const [onlyNew, setOnlyNew] = useState(false);
  const list = [...FINDINGS].sort((a, b) => b.risk - a.risk).filter((f) => !onlyNew || f.isNew);
  const f = FINDINGS.find((x) => x.id === sel) ?? FINDINGS[0];
  return (
    <div className="pv-split">
      <Card
        flush
        title="Findings by risk"
        action={
          <label className="pv-switch">
            <input
              type="checkbox"
              checked={onlyNew}
              onChange={(e) => {
                setOnlyNew(e.target.checked);
              }}
            />
            <span>Only new in this sprint</span>
          </label>
        }
      >
        <table className="pv-table">
          <thead>
            <tr>
              <th className="pv-num">Risk</th>
              <th>Finding</th>
              <th>Kind</th>
              <th>Signals</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {list.map((x) => (
              <tr
                key={x.id}
                className={'pv-click-row' + (x.id === sel ? ' pv-row-sel' : '')}
                onClick={() => {
                  setSel(x.id);
                }}
              >
                <td className="pv-num">
                  <span
                    className={
                      'pv-risk-pill pv-risk-pill--' +
                      (x.risk >= 80 ? 'high' : x.risk >= 40 ? 'mid' : 'low')
                    }
                  >
                    {x.risk}
                  </span>
                </td>
                <td>
                  <span className="pv-mono pv-muted">{x.id}</span> {x.title}
                  <span className="pv-muted pv-block pv-small">{x.sla}</span>
                </td>
                <td>
                  <Chip>{x.kind}</Chip>
                </td>
                <td>
                  <span className="pv-signals">
                    {x.kev ? <Chip tone="danger">KEV</Chip> : null}
                    {x.reachable ? <Chip tone="warning">reachable</Chip> : null}
                    {x.exposed ? <Chip tone="info">exposed</Chip> : null}
                  </span>
                </td>
                <td>
                  <Chip
                    tone={
                      x.state === 'fixed'
                        ? 'success'
                        : x.state === 'accepted'
                          ? 'neutral'
                          : x.state === 'fixing'
                            ? 'primary'
                            : 'warning'
                    }
                  >
                    {x.state}
                  </Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {f ? <Detail key={f.id} f={f} /> : null}
    </div>
  );
}

function Sbom(): ReactNode {
  const [asked, setAsked] = useState(false);
  return (
    <div className="pv-split">
      <Card
        flush
        title="Bill of materials · v1.4.0-rc.2 · 412 packages"
        action={
          <span className="pv-page-actions">
            <Button size="sm" kind="ghost">
              CycloneDX
            </Button>
            <Button size="sm" kind="ghost">
              SPDX
            </Button>
            <Button size="sm" kind="ghost">
              VEX
            </Button>
          </span>
        }
      >
        <table className="pv-table">
          <thead>
            <tr>
              <th>Package</th>
              <th>Version</th>
              <th>Licence</th>
              <th>Direct</th>
              <th className="pv-num">Vulnerabilities</th>
            </tr>
          </thead>
          <tbody>
            {SBOM.map((p) => (
              <tr key={p.pkg}>
                <td className="pv-mono">{p.pkg}</td>
                <td className="pv-mono">{p.version}</td>
                <td>
                  <Chip tone={p.licence.startsWith('GPL') ? 'danger' : 'neutral'}>{p.licence}</Chip>
                </td>
                <td>{p.direct ? 'yes' : 'via map-sdk'}</td>
                <td className={'pv-num ' + (p.vulns ? 'pv-text-danger' : 'pv-muted')}>{p.vulns}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pv-muted pv-small pv-pad">
          Compared with v1.3.8: 6 packages added, 2 removed, 14 upgraded.
        </p>
      </Card>
      <Card title="A new CVE: which shipped versions are affected?">
        <div className="pv-ask">
          <input defaultValue="CVE-2026-31144 (xml2js)" aria-label="CVE" />
          <Button
            kind="primary"
            onClick={() => {
              setAsked(true);
            }}
          >
            Check
          </Button>
        </div>
        {asked ? (
          <ul className="pv-checks">
            <li className="pv-check pv-check--no">
              <PIcon name="x" size={15} />
              <span>
                <strong>NWL v1.3.8 in production</strong>{' '}
                <span className="pv-muted pv-small">affected, reachable</span>
              </span>
            </li>
            <li className="pv-check pv-check--no">
              <PIcon name="x" size={15} />
              <span>
                <strong>NWD v1.0.0 in store review</strong>{' '}
                <span className="pv-muted pv-small">affected, not reachable</span>
              </span>
            </li>
            <li className="pv-check pv-check--ok">
              <PIcon name="check" size={15} />
              <span>
                <strong>HEL, AUR, PE</strong>{' '}
                <span className="pv-muted pv-small">not affected</span>
              </span>
            </li>
          </ul>
        ) : (
          <p className="pv-muted pv-small">
            Every shipped version keeps its bill of materials, so old releases can be checked
            against new CVEs.
          </p>
        )}
      </Card>
    </div>
  );
}

function Policies(): ReactNode {
  const [rules, setRules] = useState(POLICIES);
  return (
    <div className="pv-split">
      <Card flush title="Policies (gates)">
        <ul className="pv-rows">
          {rules.map((p, i) => (
            <li key={p.rule} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <span className="pv-row-title">{p.rule}</span>
                <span className="pv-row-sub">{p.effect}</span>
              </span>
              <label className="pv-switch">
                <input
                  type="checkbox"
                  checked={p.on}
                  onChange={(e) => {
                    setRules((all) =>
                      all.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)),
                    );
                  }}
                />
                <span>{p.on ? 'on' : 'off'}</span>
              </label>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Campaign: remove xml2js 0.4 everywhere">
        <p className="pv-muted pv-small">Started by Ada on 1 Oct · due 15 Oct · 3 projects</p>
        <ul className="pv-share">
          {[
            ['NWL', 0, 'PR #309 failing'],
            ['NWD', 1, 'merged'],
            ['HEL', 1, 'merged'],
          ].map(([k, v, s]) => (
            <li key={String(k)} className="pv-share-row pv-share-row--wide">
              <span className="pv-share-label pv-mono">{k}</span>
              <Bar value={Number(v)} max={1} tone={v ? 'success' : 'warning'} />
              <span className="pv-share-value pv-small">{s}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

const VIEWS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'overview', label: 'Overview', icon: 'security' },
  { key: 'findings', label: 'Findings', icon: 'incident' },
  { key: 'sbom', label: 'SBOM', icon: 'documents' },
  { key: 'policies', label: 'Policies and campaigns', icon: 'flag' },
];

export function SecurityTab(): ReactNode {
  const [view, setView] = useState('findings');
  return (
    <div className="pv-stack">
      <nav className="pv-subtabs" aria-label="Security view">
        {VIEWS.map((v) => (
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
      {view === 'overview' ? <Overview /> : null}
      {view === 'findings' ? <Findings /> : null}
      {view === 'sbom' ? <Sbom /> : null}
      {view === 'policies' ? <Policies /> : null}
    </div>
  );
}
