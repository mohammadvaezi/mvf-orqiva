// ── [PCODE-316 | S15 | v0.1.0] T32.3b Named run sign-off with a frozen snapshot, and a release gate on tests ──
// ── [PCODE-176 | S15 | v0.1.0] B4.2 Security and Code map on the server: risk score, workflow, SBOM, policies, campaigns, posture, code files, hotspots, API inventory ──
//    Why:  the rules of the Security center and the Code map, shared by server, web app and extension:
//          one risk score from severity, CVSS, EPSS, known exploitation, reachability and exposure; SLA
//          days per severity; SBOMs read from CycloneDX and SPDX and compared; policies evaluated against
//          findings and components; the health of a file and how hot a spot it is.

export interface RiskFacts {
  severity: string;
  cvss?: number | null;
  epss?: number | null;
  kev?: boolean;
  reachable?: boolean | null;
  exposed?: boolean | null;
}

const BASE: Record<string, number> = { critical: 9.5, high: 7.5, medium: 5, low: 2.5, info: 0.5 };

/**
 * 0–100. The CVSS (or the severity's typical score) sets the base; a likely exploit (EPSS) raises it,
 * a known exploited one (KEV) raises it most; code that is not reachable halves it, an exposed service
 * raises it a little.
 */
export function riskScore(f: RiskFacts): number {
  let s = (f.cvss ?? BASE[f.severity] ?? 5) * 10;
  if (f.epss !== null && f.epss !== undefined) s += f.epss * 25;
  if (f.kev) s = Math.max(s, 90) + 10;
  if (f.reachable === false) s *= 0.5;
  if (f.exposed === true) s *= 1.15;
  return Math.max(0, Math.min(100, Math.round(s)));
}

/** Days to fix by severity; info has no deadline. */
export const SLA_DAYS: Record<string, number | null> = {
  critical: 7,
  high: 30,
  medium: 90,
  low: 180,
  info: null,
};

export interface SbomComponent {
  name: string;
  version: string;
  purl: string;
  licences: string[];
}

const o = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const t = (v: unknown, max = 300): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** Components of a CycloneDX (JSON) or SPDX (JSON) document; null when it is neither. */
export function parseSbom(
  doc: unknown,
): { format: 'cyclonedx' | 'spdx'; components: SbomComponent[] } | null {
  const d = o(doc);
  if (d['bomFormat'] === 'CycloneDX') {
    const out: SbomComponent[] = [];
    const walk = (list: unknown[]): void => {
      for (const raw of list) {
        const c = o(raw);
        const licences = a(c['licenses'])
          .map((l) => o(l))
          .map(
            (l) =>
              t(o(l['license'])['id'], 80) ||
              t(o(l['license'])['name'], 80) ||
              t(l['expression'], 120),
          )
          .filter(Boolean);
        if (t(c['name']))
          out.push({
            name: t(c['name'], 200),
            version: t(c['version'], 80),
            purl: t(c['purl'], 500),
            licences,
          });
        walk(a(c['components']));
      }
    };
    walk(a(d['components']));
    return { format: 'cyclonedx', components: out };
  }
  if (typeof d['spdxVersion'] === 'string') {
    const comps = a(d['packages'])
      .map((raw) => o(raw))
      .filter((p) => t(p['name']) && !t(p['SPDXID']).endsWith('-DOCUMENT'))
      .map((p) => {
        const ref = a(p['externalRefs'])
          .map(o)
          .find((r) => r['referenceType'] === 'purl');
        const lic = t(p['licenseConcluded'], 200) || t(p['licenseDeclared'], 200);
        return {
          name: t(p['name'], 200),
          version: t(p['versionInfo'], 80),
          purl: t(ref?.['referenceLocator'], 500),
          licences:
            lic && lic !== 'NOASSERTION' && lic !== 'NONE'
              ? lic.split(/\s+(?:AND|OR)\s+/).map((x) => x.replace(/[()]/g, ''))
              : [],
        };
      });
    return { format: 'spdx', components: comps };
  }
  return null;
}

/** What changed between two SBOMs: added, removed and changed versions, by component name. */
export function sbomDiff(
  before: readonly SbomComponent[],
  after: readonly SbomComponent[],
): {
  added: SbomComponent[];
  removed: SbomComponent[];
  changed: { name: string; from: string; to: string }[];
} {
  const b = new Map(before.map((c) => [c.name, c]));
  const n = new Map(after.map((c) => [c.name, c]));
  return {
    added: after.filter((c) => !b.has(c.name)),
    removed: before.filter((c) => !n.has(c.name)),
    changed: after.flatMap((c) => {
      const old = b.get(c.name);
      return old && old.version !== c.version
        ? [{ name: c.name, from: old.version, to: c.version }]
        : [];
    }),
  };
}

export interface PolicyRule {
  /** findings at or above this severity block */
  maxSeverity?: 'critical' | 'high' | 'medium' | 'low';
  /** findings at or above this risk score block */
  minRisk?: number;
  bannedLicences?: string[];
  /** any open finding of a secret rule blocks */
  liveSecrets?: boolean;
  /** only findings first seen in the last 14 days count (new issues gate, old debt does not) */
  newOnly?: boolean;
  // [PCODE-316 | S15 | v0.1.0] release gates on tests
  /** every test of the release's tasks passes: none failing, none without a result */
  testsPass?: boolean;
  /** the release has a test run its approver signed off */
  testsSigned?: boolean;
}

/** [PCODE-316 | S15 | v0.1.0] A release's tests as the test rules read them. */
export interface PolicyTests {
  cases: number;
  failing: number;
  untested: number;
  signedRuns: number;
}

export interface PolicyFinding {
  title: string;
  severity: string;
  risk: number;
  rule: string;
  open: boolean;
  firstSeenDaysAgo: number;
}

const RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** What a policy finds wrong; empty when it passes. */
export function evaluatePolicy(
  rule: PolicyRule,
  findings: readonly PolicyFinding[],
  components: readonly SbomComponent[],
  tests: PolicyTests | null = null,
): string[] {
  const out: string[] = [];
  const live = findings.filter((f) => f.open && (!rule.newOnly || f.firstSeenDaysAgo <= 14));
  if (rule.maxSeverity) {
    const n = live.filter(
      (f) => (RANK[f.severity] ?? 0) >= (RANK[rule.maxSeverity ?? 'critical'] ?? 4),
    ).length;
    if (n)
      out.push(
        String(n) +
          ' open ' +
          rule.maxSeverity +
          (rule.maxSeverity === 'critical' ? '' : ' or worse') +
          ' finding' +
          (n === 1 ? '' : 's'),
      );
  }
  if (rule.minRisk !== undefined) {
    const n = live.filter((f) => f.risk >= (rule.minRisk ?? 100)).length;
    if (n)
      out.push(
        String(n) +
          ' finding' +
          (n === 1 ? '' : 's') +
          ' with a risk of ' +
          String(rule.minRisk) +
          ' or more',
      );
  }
  if (rule.liveSecrets) {
    const n = findings.filter((f) => f.open && f.rule.startsWith('secret/')).length;
    if (n) out.push(String(n) + ' secret' + (n === 1 ? '' : 's') + ' in the code');
  }
  if (rule.bannedLicences?.length) {
    const banned = new Set(rule.bannedLicences.map((l) => l.toLowerCase()));
    for (const c of components) {
      const bad = c.licences.filter((l) => banned.has(l.toLowerCase()));
      if (bad.length) out.push(c.name + ' ' + c.version + ' is under ' + bad.join(', '));
    }
  }
  // [PCODE-316 | S15 | v0.1.0] the test rules apply to a release; a merge has no tests of its own here
  if (tests && rule.testsPass) {
    if (!tests.cases) out.push('no test checks its tasks');
    if (tests.failing)
      out.push(String(tests.failing) + ' test' + (tests.failing === 1 ? '' : 's') + ' failing');
    if (tests.untested)
      out.push(
        String(tests.untested) + ' test' + (tests.untested === 1 ? '' : 's') + ' without a result',
      );
  }
  if (tests && rule.testsSigned && !tests.signedRuns) out.push('no test run is signed off');
  return out;
}

export interface FileMetrics {
  lines: number;
  complexity: number;
  churn: number;
}

/** Code health 1–10 (10 is healthy): complexity per line, size and churn wear it down. */
export function codeHealth(f: FileMetrics): number {
  const density = f.lines ? f.complexity / f.lines : 0;
  let h = 10;
  h -= Math.min(4, density * 20);
  h -= f.lines > 1500 ? 2.5 : f.lines > 600 ? 1.5 : f.lines > 300 ? 0.5 : 0;
  h -= f.churn > 40 ? 2 : f.churn > 15 ? 1 : 0;
  return Math.max(1, Math.round(h * 10) / 10);
}

/** How hot a spot is, 0–100 within its project: churn times complexity against the project's hottest. */
export function hotspots<T extends FileMetrics>(files: readonly T[]): (T & { hotspot: number })[] {
  const max = Math.max(1, ...files.map((f) => f.churn * f.complexity));
  return files.map((f) => ({ ...f, hotspot: Math.round(((f.churn * f.complexity) / max) * 100) }));
}
