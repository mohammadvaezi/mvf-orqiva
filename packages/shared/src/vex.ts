// ── [PCODE-323 | S15 | v0.1.0] T32.7b VEX statements and the security posture per version ──
//    Why:  a scanner says a package version has a CVE; whether the product that ships it is affected is a
//          person's statement. VEX says it per version in a form other tools read (OpenVEX 0.2.0): not
//          affected and why, affected and what to do, fixed, or under investigation. A version's posture
//          counts only what such a statement has not set aside.

export const VEX_STATUSES = ['not_affected', 'affected', 'fixed', 'under_investigation'] as const;
export type VexStatus = (typeof VEX_STATUSES)[number];

/** OpenVEX's reasons a product is not affected. */
export const VEX_JUSTIFICATIONS = [
  'component_not_present',
  'vulnerable_code_not_present',
  'vulnerable_code_not_in_execute_path',
  'vulnerable_code_cannot_be_controlled_by_adversary',
  'inline_mitigations_already_exist',
] as const;
export type VexJustification = (typeof VEX_JUSTIFICATIONS)[number];

export interface VexStatement {
  cve: string;
  package: string;
  version: string;
  purl: string;
  status: VexStatus;
  justification: VexJustification | null;
  /** why it is not affected, or what to do when it is */
  note: string;
  at: string;
}

/** The release's statements as an OpenVEX 0.2.0 document. */
export function openVex(o: {
  id: string;
  author: string;
  product: string;
  timestamp: string;
  version: number;
  statements: readonly VexStatement[];
}): Record<string, unknown> {
  return {
    '@context': 'https://openvex.dev/ns/v0.2.0',
    '@id': o.id,
    author: o.author,
    timestamp: o.timestamp,
    version: o.version,
    statements: o.statements.map((s) => ({
      vulnerability: { name: s.cve },
      timestamp: s.at,
      products: [{ '@id': o.product, subcomponents: [{ '@id': s.purl }] }],
      status: s.status,
      ...(s.status === 'not_affected'
        ? {
            justification: s.justification ?? 'vulnerable_code_not_in_execute_path',
            ...(s.note ? { impact_statement: s.note } : {}),
          }
        : {}),
      ...(s.status === 'affected' ? { action_statement: s.note || 'Upgrade the package.' } : {}),
      ...(s.status === 'under_investigation' && s.note ? { status_notes: s.note } : {}),
    })),
  };
}

/** A package's purl from the SBOM, or a generic one made from its name and version. */
export const purlOf = (name: string, version: string, given = ''): string =>
  given || 'pkg:generic/' + encodeURIComponent(name) + '@' + encodeURIComponent(version);

/** Whether a statement takes a vulnerability out of the version's posture. */
export const setAside = (status: VexStatus | null): boolean =>
  status === 'not_affected' || status === 'fixed';

/** A version's score of 100, as the project's: the open risk of what is left, a tenth a point. */
export const versionScore = (risks: readonly number[]): number =>
  Math.max(0, Math.round(100 - risks.reduce((n, r) => n + r, 0) / 10));
