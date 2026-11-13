// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-85 | S08 | v0.1.0] Build our own licence checker and SBOM generator that fail CI on a denied licence ──
//    Why:  every release carries a software bill of materials in the CycloneDX 1.5 JSON format (an open
//          specification; this generator is ours) and a notices file with the attribution each licence asks for.
import { randomUUID } from 'node:crypto';
import type { Verdict } from './check.js';

/** Package URL for an npm package: pkg:npm/%40scope/name@version. */
export function purl(name: string, version: string): string {
  return 'pkg:npm/' + name.replace(/^@/, '%40') + '@' + encodeURIComponent(version);
}

export interface SbomInput {
  product: string;
  version: string;
  verdicts: Verdict[];
  /** ISO timestamp; injectable so tests are stable */
  timestamp?: string;
  serial?: string;
}

export function buildSbom(input: SbomInput): Record<string, unknown> {
  const components = input.verdicts.map((v) => {
    const ref = purl(v.name, v.version);
    const declaredTree = v.declared && /\s(AND|OR|WITH)\s/i.test(v.declared);
    const licenses = declaredTree
      ? [{ expression: v.declared }]
      : v.licences.map((id) => ({ license: { id } }));
    return {
      type: 'library',
      'bom-ref': ref,
      name: v.name,
      version: v.version,
      purl: ref,
      licenses,
    };
  });
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: 'urn:uuid:' + (input.serial ?? randomUUID()),
    version: 1,
    metadata: {
      timestamp: input.timestamp ?? new Date().toISOString(),
      tools: {
        components: [{ type: 'application', name: 'orq licences', version: input.version }],
      },
      component: { type: 'application', name: input.product, version: input.version },
    },
    components,
  };
}

/** THIRD-PARTY-NOTICES.md: each package, its licence and the licence text it ships with. */
export function buildNotices(product: string, verdicts: Verdict[]): string {
  const lines = [
    '# Third-party notices',
    '',
    product +
      ' includes the following third-party software. Each is used under the licence named here;',
    'the licence texts follow, as each package ships them.',
    '',
    '| Package | Version | Licence |',
    '| --- | --- | --- |',
    ...verdicts.map(
      (v) =>
        '| ' + v.name + ' | ' + v.version + ' | ' + (v.declared ?? v.licences.join(' AND ')) + ' |',
    ),
    '',
  ];
  for (const v of verdicts) {
    lines.push('## ' + v.name + ' ' + v.version, '');
    if (v.files.length === 0) {
      lines.push(
        'Licence: ' +
          (v.declared ?? v.licences.join(' AND ')) +
          ' (the package ships no licence file).',
        '',
      );
      continue;
    }
    for (const f of v.files) {
      lines.push(
        '`' + f.file + '`',
        '',
        '```text',
        f.text.replace(/\r\n/g, '\n').trimEnd(),
        '```',
        '',
      );
    }
  }
  return lines.join('\n');
}
