// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
//    Why:  how likely a vulnerability is to be exploited, and whether it already is, changes what to fix
//          first. CISA's Known Exploited Vulnerabilities catalog and FIRST's EPSS scores are read in the
//          shapes they publish; EPSS is asked for in batches of the CVEs a workspace actually has.

export interface KevEntry {
  cve: string;
  added: string;
  due: string;
  ransomware: boolean;
}

const asObj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const day = (v: unknown): string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '';
const CVE = /^CVE-\d{4}-\d{4,}$/;

/** The catalog's entries by CVE (known_exploited_vulnerabilities.json). */
export function parseKev(feed: unknown): Map<string, KevEntry> {
  const out = new Map<string, KevEntry>();
  const list = asObj(feed)['vulnerabilities'];
  for (const raw of Array.isArray(list) ? list : []) {
    const v = asObj(raw);
    const cve = typeof v['cveID'] === 'string' ? v['cveID'].trim().toUpperCase() : '';
    if (!CVE.test(cve)) continue;
    out.set(cve, {
      cve,
      added: day(v['dateAdded']),
      due: day(v['dueDate']),
      ransomware: String(v['knownRansomwareCampaignUse']).toLowerCase() === 'known',
    });
  }
  return out;
}

export interface EpssEntry {
  cve: string;
  /** the probability of exploitation in the next 30 days, 0 to 1 */
  epss: number;
  percentile: number;
}

/** One answer of the EPSS API (api.first.org/data/v1/epss): its data, scores given as text. */
export function parseEpss(answer: unknown): EpssEntry[] {
  const data = asObj(answer)['data'];
  const out: EpssEntry[] = [];
  for (const raw of Array.isArray(data) ? data : []) {
    const d = asObj(raw);
    const cve = typeof d['cve'] === 'string' ? d['cve'].trim().toUpperCase() : '';
    const epss = Number(d['epss']);
    const percentile = Number(d['percentile']);
    if (!CVE.test(cve) || !Number.isFinite(epss) || epss < 0 || epss > 1) continue;
    out.push({ cve, epss, percentile: Number.isFinite(percentile) ? percentile : 0 });
  }
  return out;
}

/** The EPSS addresses to ask for the CVEs: a hundred to a request, CVE ids only (GHSA ids have no score). */
export function epssUrls(base: string, cves: readonly string[]): string[] {
  const list = [...new Set(cves.map((c) => c.toUpperCase()).filter((c) => CVE.test(c)))].sort();
  const out: string[] = [];
  for (let i = 0; i < list.length; i += 100)
    out.push(base + '?cve=' + list.slice(i, i + 100).join(','));
  return out;
}

/** The sentence an alert says about a CVE in shipped versions. */
export function exposureText(
  cve: string,
  pkg: string,
  version: string,
  releases: readonly { version: string; environment: string | null }[],
  exploited: boolean,
): string {
  const where = releases
    .slice(0, 4)
    .map((r) => r.version + (r.environment ? ' (' + r.environment + ')' : ''))
    .join(', ');
  return (
    (exploited ? cve + ' is now known to be exploited. ' : '') +
    pkg +
    ' ' +
    version +
    ' with ' +
    cve +
    ' is in ' +
    (releases.length === 1 ? 'the shipped version ' : 'the shipped versions ') +
    where +
    (releases.length > 4 ? ' and ' + String(releases.length - 4) + ' more' : '') +
    '.'
  );
}
