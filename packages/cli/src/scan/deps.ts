// ── [PCODE-321 | S15 | v0.1.0] T32.6 Secrets in the Git history, SARIF upload in the web app, dependency facts on findings ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-141 | S15 | v0.1.0] Audit dependencies against the OSV database ──
//    Why:  known vulnerabilities in the packages a project ships. We read the lockfiles ourselves
//          (package-lock.json v1–v3, pinned requirements files), ask the public OSV database, which
//          gathers GitHub Advisory, NVD and the ecosystems' own data, in batches, and turn each
//          vulnerable package version into a finding with its advisory, severity and fixed version.
//          Severity comes from the advisory's own rating, else from its CVSS 3 vector, computed here.
import {
  fnv,
  severityOfScore,
  type FindingFacts,
  type FindingIn,
  type Severity,
} from '@orqiva/shared';

export interface Package {
  ecosystem: 'npm' | 'PyPI';
  name: string;
  version: string;
  /** the file it was found in */
  file: string;
}

/** Every installed package of an npm lockfile, once per name and version. */
export function readPackageLock(text: string, file: string): Package[] {
  const lock = JSON.parse(text) as {
    packages?: Record<string, { version?: string; link?: boolean; name?: string }>;
    dependencies?: Record<string, { version?: string; dependencies?: unknown }>;
  };
  const out = new Map<string, Package>();
  const add = (name: string, version: string | undefined): void => {
    if (!name || !version || !/^\d/.test(version)) return;
    out.set(name + '@' + version, { ecosystem: 'npm', name, version, file });
  };
  if (lock.packages) {
    for (const [path, p] of Object.entries(lock.packages)) {
      if (!path || p.link) continue;
      const at = path.lastIndexOf('node_modules/');
      add(p.name ?? (at >= 0 ? path.slice(at + 'node_modules/'.length) : ''), p.version);
    }
  } else if (lock.dependencies) {
    const walk = (deps: Record<string, { version?: string; dependencies?: unknown }>): void => {
      for (const [name, d] of Object.entries(deps)) {
        add(name, d.version);
        if (d.dependencies && typeof d.dependencies === 'object')
          walk(d.dependencies as Record<string, { version?: string; dependencies?: unknown }>);
      }
    };
    walk(lock.dependencies);
  }
  return [...out.values()];
}

/** Exactly pinned packages of a pip requirements file (name==version); ranges cannot be audited. */
export function readRequirements(text: string, file: string): Package[] {
  const out: Package[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').split(';')[0]?.trim() ?? '';
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*===?\s*([^\s,]+)$/.exec(line);
    if (m)
      out.push({
        ecosystem: 'PyPI',
        name: (m[1] ?? '').toLowerCase().replace(/[._]+/g, '-'),
        version: m[2] ?? '',
        file,
      });
  }
  return out;
}

// ── CVSS 3.x base score, from the specification's formula ──

const W: Record<string, Record<string, number>> = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  C: { H: 0.56, L: 0.22, N: 0 },
  I: { H: 0.56, L: 0.22, N: 0 },
  A: { H: 0.56, L: 0.22, N: 0 },
};
const roundUp = (x: number): number => {
  const i = Math.round(x * 100000);
  return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10;
};

/** The base score of a CVSS:3.0/3.1 vector, or null when it is not one. */
export function cvss3Score(vector: string): number | null {
  if (!/^CVSS:3\.[01]\//.test(vector)) return null;
  const m: Record<string, string> = {};
  for (const part of vector.split('/').slice(1)) {
    const [k, v] = part.split(':');
    if (k && v) m[k] = v;
  }
  const scope = m['S'];
  const pr = m['PR'];
  const get = (k: string): number | undefined => W[k]?.[m[k] ?? ''];
  const prW =
    pr === 'N'
      ? 0.85
      : pr === 'L'
        ? scope === 'C'
          ? 0.68
          : 0.62
        : pr === 'H'
          ? scope === 'C'
            ? 0.5
            : 0.27
          : undefined;
  const [av, ac, ui, c, i, a] = [get('AV'), get('AC'), get('UI'), get('C'), get('I'), get('A')];
  if (
    av === undefined ||
    ac === undefined ||
    ui === undefined ||
    c === undefined ||
    i === undefined ||
    a === undefined ||
    prW === undefined ||
    (scope !== 'U' && scope !== 'C')
  )
    return null;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact =
    scope === 'U' ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
  const exploitability = 8.22 * av * ac * prW * ui;
  if (impact <= 0) return 0;
  return scope === 'U'
    ? roundUp(Math.min(impact + exploitability, 10))
    : roundUp(Math.min(1.08 * (impact + exploitability), 10));
}

interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  severity?: { type: string; score: string }[];
  database_specific?: { severity?: string };
  affected?: {
    package?: { name?: string; ecosystem?: string };
    ranges?: { events?: { introduced?: string; fixed?: string }[] }[];
  }[];
}

const RATING: Record<string, Severity> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MODERATE: 'medium',
  MEDIUM: 'medium',
  LOW: 'low',
};

/** A vulnerability's severity: the advisory's own rating, else its CVSS 3 score. */
export function severityOfVuln(v: OsvVuln): Severity {
  const rated = RATING[(v.database_specific?.severity ?? '').toUpperCase()];
  if (rated) return rated;
  for (const s of v.severity ?? []) {
    const score = cvss3Score(s.score);
    if (score !== null) return severityOfScore(score);
  }
  return 'medium';
}

// [PCODE-321 | S15 | v0.1.0] the CVE (or the advisory's own id), the package and the versions as data
export function factsOfVuln(v: OsvVuln, p: Package, fixed: string[]): FindingFacts {
  const ids = [v.id, ...(v.aliases ?? [])];
  const cve = ids.find((x) => /^CVE-/i.test(x)) ?? ids.find((x) => /^GHSA-/i.test(x));
  let cvss: number | undefined;
  for (const s of v.severity ?? []) cvss ??= cvss3Score(s.score) ?? undefined;
  return {
    ...(cve ? { cve } : {}),
    package: p.name,
    version: p.version,
    ...(fixed[0] ? { fixedVersion: fixed[0] } : {}),
    ...(cvss === undefined ? {} : { cvss }),
  };
}

/** The versions that fix it for this package. */
export function fixedVersions(v: OsvVuln, p: Package): string[] {
  const out = new Set<string>();
  for (const a of v.affected ?? []) {
    if (
      a.package?.ecosystem !== p.ecosystem ||
      (a.package.name ?? '').toLowerCase() !== p.name.toLowerCase()
    )
      continue;
    for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (e.fixed) out.add(e.fixed);
  }
  return [...out];
}

export interface OsvClient {
  /** ids of the vulnerabilities of each package, in order */
  query(packages: Package[]): Promise<string[][]>;
  vuln(id: string): Promise<OsvVuln>;
}

export function osvClient(fetchImpl: typeof fetch, base = 'https://api.osv.dev'): OsvClient {
  return {
    async query(packages) {
      const out: string[][] = [];
      for (let i = 0; i < packages.length; i += 1000) {
        const batch = packages.slice(i, i + 1000);
        const res = await fetchImpl(base + '/v1/querybatch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            queries: batch.map((p) => ({
              package: { name: p.name, ecosystem: p.ecosystem },
              version: p.version,
            })),
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) throw new Error('OSV answered ' + String(res.status));
        const body = (await res.json()) as { results?: { vulns?: { id: string }[] }[] };
        for (const r of body.results ?? []) out.push((r.vulns ?? []).map((v) => v.id));
      }
      return out;
    },
    async vuln(id) {
      const res = await fetchImpl(base + '/v1/vulns/' + encodeURIComponent(id), {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error('OSV answered ' + String(res.status) + ' for ' + id);
      return (await res.json()) as OsvVuln;
    },
  };
}

/** Audits the packages: one finding per vulnerable package version and advisory. */
export async function audit(packages: Package[], osv: OsvClient): Promise<FindingIn[]> {
  if (!packages.length) return [];
  const ids = await osv.query(packages);
  const wanted = [...new Set(ids.flat())];
  const details = new Map<string, OsvVuln>();
  // a few at a time, to be gentle with the public service
  for (let i = 0; i < wanted.length; i += 8)
    for (const v of await Promise.all(wanted.slice(i, i + 8).map((id) => osv.vuln(id))))
      details.set(v.id, v);
  const findings: FindingIn[] = [];
  packages.forEach((p, n) => {
    for (const id of ids[n] ?? []) {
      const v = details.get(id);
      if (!v) continue;
      const fixed = fixedVersions(v, p);
      const aliases = (v.aliases ?? []).filter((a) => a !== v.id);
      const summary = v.summary ?? v.details?.split('\n')[0] ?? 'Known vulnerability';
      findings.push({
        rule: v.id,
        severity: severityOfVuln(v),
        title: (p.name + '@' + p.version + ': ' + summary).slice(0, 300),
        message: [
          summary,
          aliases.length ? 'Also known as ' + aliases.join(', ') + '.' : '',
          fixed.length
            ? 'Fixed in ' + fixed.join(', ') + '; upgrade ' + p.name + '.'
            : 'No fixed version yet.',
          'https://osv.dev/vulnerability/' + v.id,
        ]
          .filter(Boolean)
          .join('\n'),
        file: p.file,
        line: null,
        fingerprint: fnv(p.ecosystem + '|' + p.name + '|' + p.version + '|' + v.id),
        // [PCODE-321 | S15 | v0.1.0] the same as data, so the server can match it against what shipped
        facts: factsOfVuln(v, p, fixed),
      });
    }
  });
  return findings;
}

/** The lockfiles among the tracked files, read and audited, as a scan of the tool pe-deps. */
export async function scanDependencies(
  files: string[],
  read: (path: string) => Promise<string | null>,
  osv: OsvClient,
): Promise<{ tool: string; findings: FindingIn[]; note: string }> {
  const packages: Package[] = [];
  let lockfiles = 0;
  for (const f of files) {
    const name = f.split('/').pop() ?? '';
    const isLock = name === 'package-lock.json';
    const isReq = /^requirements[\w.-]*\.txt$/i.test(name);
    if (!isLock && !isReq) continue;
    const text = await read(f);
    if (text === null) continue;
    lockfiles += 1;
    packages.push(...(isLock ? readPackageLock(text, f) : readRequirements(text, f)));
  }
  const findings = await audit(packages, osv);
  return {
    tool: 'pe-deps',
    findings,
    note:
      String(packages.length) +
      ' packages in ' +
      String(lockfiles) +
      ' lockfiles, checked against OSV',
  };
}
