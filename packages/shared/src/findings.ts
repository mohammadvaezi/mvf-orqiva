// ── [PCODE-321 | S15 | v0.1.0] T32.6 Secrets in the Git history, SARIF upload in the web app, dependency facts on findings ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-139 | S15 | v0.1.0] Add security findings with SARIF import, tasks for findings and the security gate ──
//    Why:  one shape for a security finding, and SARIF 2.1.0 both ways: our scanner writes it, the server
//          reads it from any tool that writes it (CodeQL, Semgrep, Trivy, …). Severity comes from the
//          rule's CVSS-style "security-severity" where a tool gives one, else from the SARIF level.

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface FindingIn {
  rule: string;
  severity: Severity;
  title: string;
  message: string;
  file: string;
  line: number | null;
  /** stays the same across scans for the same problem, so a rescan finds the same finding */
  fingerprint: string;
  /** [PCODE-321 | S15 | v0.1.0] what a dependency finding is about, as data (SARIF result properties) */
  facts?: FindingFacts;
}

export interface FindingFacts {
  cve?: string;
  package?: string;
  version?: string;
  fixedVersion?: string;
  cvss?: number;
}

const FACT_KEYS = ['cve', 'package', 'version', 'fixedVersion'] as const;

/** The facts a SARIF result's properties carry: ours under "orqiva", or the common names tools use. */
export function factsOf(props: Record<string, unknown>): FindingFacts | undefined {
  const own = props['orqiva'];
  const p =
    typeof own === 'object' && own !== null && !Array.isArray(own)
      ? (own as Record<string, unknown>)
      : props;
  const out: FindingFacts = {};
  for (const k of FACT_KEYS) {
    const v = p[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 200);
  }
  if (typeof p['packageName'] === 'string' && !out.package) out.package = p['packageName'];
  if (typeof p['installedVersion'] === 'string' && !out.version)
    out.version = p['installedVersion'];
  const cvss = Number(p['cvss']);
  if (Number.isFinite(cvss) && cvss >= 0 && cvss <= 10) out.cvss = cvss;
  if (out.cve && !/^(CVE-\d{4}-\d{4,}|GHSA(-[23456789cfghjmpqrvwx]{4}){3})$/i.test(out.cve))
    delete out.cve;
  return Object.keys(out).length ? out : undefined;
}

/** A CVSS-like score (0–10) as a severity. */
export function severityOfScore(score: number): Severity {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  if (score > 0) return 'low';
  return 'info';
}

/** True when a finding of this severity holds the gate shut. */
export const blocksGate = (s: Severity): boolean => s === 'critical' || s === 'high';

const levelSeverity: Record<string, Severity> = {
  error: 'high',
  warning: 'medium',
  note: 'low',
  none: 'info',
};

/** A simple, stable hash for fingerprints when a tool gives none (FNV-1a, hex). */
export function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The findings of every run of a SARIF log, with the tool's name. */
export function readSarif(log: unknown): { tool: string; findings: FindingIn[] }[] {
  return arr(obj(log)['runs']).map((runRaw) => {
    const run = obj(runRaw);
    const driver = obj(obj(run['tool'])['driver']);
    const tool = str(driver['name']) || 'sarif';
    const rules = new Map<string, Obj>();
    for (const r of arr(driver['rules'])) rules.set(str(obj(r)['id']), obj(r));
    const findings = arr(run['results']).map((resRaw): FindingIn => {
      const res = obj(resRaw);
      const ruleId = str(res['ruleId']) || str(obj(res['rule'])['id']) || 'unknown';
      const rule = rules.get(ruleId) ?? {};
      const props = obj(rule['properties']);
      const score = Number(props['security-severity']);
      const level =
        str(res['level']) || str(obj(rule['defaultConfiguration'])['level']) || 'warning';
      const loc = obj(obj(arr(res['locations'])[0])['physicalLocation']);
      const file = str(obj(loc['artifactLocation'])['uri']).replace(/^file:\/\//, '');
      const startLine = Number(obj(loc['region'])['startLine']);
      const message = str(obj(res['message'])['text']);
      const prints = { ...obj(res['partialFingerprints']), ...obj(res['fingerprints']) };
      const facts = factsOf(obj(res['properties'])); // [PCODE-321 | S15 | v0.1.0]
      const given = Object.values(prints).find((v) => typeof v === 'string' && v) as
        string | undefined;
      return {
        rule: ruleId.slice(0, 200),
        severity:
          Number.isFinite(score) && props['security-severity'] !== undefined
            ? severityOfScore(score)
            : (levelSeverity[level] ?? 'medium'),
        title: (
          str(obj(rule['shortDescription'])['text']) ||
          message.split('\n')[0] ||
          ruleId
        ).slice(0, 300),
        message: message.slice(0, 10_000),
        file: file.slice(0, 500),
        line: Number.isFinite(startLine) && startLine > 0 ? startLine : null,
        fingerprint: (given ?? fnv(tool + '|' + ruleId + '|' + file + '|' + message)).slice(0, 200),
        ...(facts ? { facts } : {}),
      };
    });
    return { tool: tool.slice(0, 80), findings };
  });
}

const severityLevel: Record<Severity, string> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'note',
  info: 'note',
};
const severityScore: Record<Severity, string> = {
  critical: '9.5',
  high: '8.0',
  medium: '5.5',
  low: '3.0',
  info: '0.0',
};

/** Findings as a SARIF 2.1.0 log of one tool. */
export function toSarif(
  tool: string,
  version: string,
  findings: FindingIn[],
): Record<string, unknown> {
  const ruleIds = [...new Set(findings.map((f) => f.rule))];
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: tool,
            version,
            rules: ruleIds.map((id) => {
              const f = findings.find((x) => x.rule === id);
              return {
                id,
                shortDescription: { text: f?.title ?? id },
                properties: { 'security-severity': severityScore[f?.severity ?? 'medium'] },
              };
            }),
          },
        },
        results: findings.map((f) => ({
          ruleId: f.rule,
          level: severityLevel[f.severity],
          message: { text: f.message || f.title },
          locations: f.file
            ? [
                {
                  physicalLocation: {
                    artifactLocation: { uri: f.file },
                    ...(f.line ? { region: { startLine: f.line } } : {}),
                  },
                },
              ]
            : [],
          partialFingerprints: { orqiva: f.fingerprint },
          ...(f.facts ? { properties: { orqiva: f.facts } } : {}), // [PCODE-321 | S15 | v0.1.0]
        })),
      },
    ],
  };
}
