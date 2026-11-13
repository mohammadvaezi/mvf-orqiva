// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-143 | S15 | v0.1.0] Map compliance controls for ISO 27001, SOC 2, GDPR and the EU CRA to live evidence ──
//    Why:  the frameworks a team must show evidence for, as starter packs: each control's reference and our
//          own short summary of what it asks (the ISO and AICPA texts are copyrighted and are not copied;
//          GDPR and the Cyber Resilience Act are EU law), mapped to the evidence Orqiva already keeps.
//          "manual" means a person adds the evidence (a note or a link); everything else is measured.

export const EVIDENCE_SOURCES = [
  'scan_clean',
  'deps_scanned',
  'tests_passing',
  'gate_g1',
  'gate_g2',
  'gate_g3',
  'proposal_signed',
  'secrets_vault',
  'deploy_health',
  'roles',
  'reviews',
  'backups',
  'activity_log',
  'manual',
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const SOURCE_TEXT: Record<EvidenceSource, string> = {
  scan_clean: 'A recent full security scan with no open high or critical finding',
  deps_scanned: 'A recent dependency audit',
  tests_passing: 'The last test run passed',
  gate_g1: 'G1 go / no-go signed',
  gate_g2: 'G2 environment ready signed',
  gate_g3: 'G3 quality gate signed',
  proposal_signed: 'A proposal signed by the owner, with its risks',
  secrets_vault: 'Secrets kept in the vault, none found in the code',
  deploy_health: 'Every environment’s last deploy passed its health check',
  roles: 'Members with roles; owners and admins named',
  reviews: 'Finished work reviewed and approved',
  backups: 'Backups configured and a restore tried (G2)',
  activity_log: 'The activity log records who did what',
  manual: 'Evidence added by a person',
};

export interface ControlDef {
  id: string;
  ref: string;
  summary: string;
  sources: EvidenceSource[];
}

export interface FrameworkDef {
  key: string;
  name: string;
  note: string;
  controls: ControlDef[];
}

const c = (id: string, ref: string, summary: string, sources: EvidenceSource[]): ControlDef => ({
  id,
  ref,
  summary,
  sources,
});

export const FRAMEWORKS: FrameworkDef[] = [
  {
    key: 'iso27001',
    name: 'ISO/IEC 27001:2022 (Annex A)',
    note: 'A starter set of Annex A controls that software delivery touches; references only, summaries in our words.',
    controls: [
      c('a5-15', 'A.5.15', 'Decide who may access what, and keep it to what each role needs.', [
        'roles',
      ]),
      c('a5-17', 'A.5.17', 'Keep passwords, keys and tokens secret and managed.', [
        'secrets_vault',
      ]),
      c('a5-24', 'A.5.24', 'Have a plan for handling security incidents.', ['manual']),
      c('a8-8', 'A.8.8', 'Find technical vulnerabilities and deal with them in time.', [
        'scan_clean',
        'deps_scanned',
      ]),
      c('a8-13', 'A.8.13', 'Back up information and check that it can be restored.', ['backups']),
      c('a8-15', 'A.8.15', 'Record activity so events can be traced.', ['activity_log']),
      c(
        'a8-25',
        'A.8.25',
        'Build security into the development life cycle, with decision points.',
        ['gate_g1', 'gate_g3'],
      ),
      c('a8-28', 'A.8.28', 'Write code securely and check it.', ['scan_clean', 'reviews']),
      c('a8-29', 'A.8.29', 'Test security during development and before acceptance.', [
        'tests_passing',
        'scan_clean',
      ]),
      c('a8-32', 'A.8.32', 'Control changes: review and approve them before release.', [
        'reviews',
        'gate_g3',
      ]),
    ],
  },
  {
    key: 'soc2',
    name: 'SOC 2 (Trust Services Criteria)',
    note: 'A starter set of common criteria; references only, summaries in our words.',
    controls: [
      c('cc3-2', 'CC3.2', 'Identify and assess risks to the objectives.', ['proposal_signed']),
      c('cc6-1', 'CC6.1', 'Restrict logical access to people with a reason to have it.', [
        'roles',
        'secrets_vault',
      ]),
      c('cc7-1', 'CC7.1', 'Detect vulnerabilities and configuration changes.', [
        'scan_clean',
        'deps_scanned',
      ]),
      c('cc7-2', 'CC7.2', 'Monitor systems and record events.', ['activity_log', 'deploy_health']),
      c('cc8-1', 'CC8.1', 'Authorise, test and approve changes before they go live.', [
        'reviews',
        'tests_passing',
        'gate_g3',
      ]),
      c('a1-2', 'A1.2', 'Back up and be able to recover.', ['backups']),
    ],
  },
  {
    key: 'gdpr',
    name: 'GDPR (Regulation (EU) 2016/679)',
    note: 'Articles that bear on building and running software that handles personal data.',
    controls: [
      c('art25', 'Art. 25', 'Data protection by design and by default: decided before building.', [
        'gate_g1',
        'manual',
      ]),
      c('art30', 'Art. 30', 'Keep a record of the processing activities.', ['manual']),
      c(
        'art32',
        'Art. 32',
        'Secure the processing: access control, secrets, resilience, regular testing.',
        ['roles', 'secrets_vault', 'backups', 'tests_passing'],
      ),
      c('art33', 'Art. 33', 'Be able to report a personal data breach within 72 hours.', [
        'manual',
        'activity_log',
      ]),
      c('art35', 'Art. 35', 'Assess the impact where processing is high-risk.', ['manual']),
    ],
  },
  {
    key: 'cra',
    name: 'EU Cyber Resilience Act (Regulation (EU) 2024/2847)',
    note: 'Essential requirements of Annex I for products with digital elements.',
    controls: [
      c(
        'i-1',
        'Annex I, Part I (1)',
        'Designed, developed and produced with an appropriate level of cybersecurity.',
        ['gate_g3'],
      ),
      c(
        'i-2a',
        'Annex I, Part I (2)(a)',
        'Made available without known exploitable vulnerabilities.',
        ['scan_clean', 'deps_scanned'],
      ),
      c('i-2d', 'Annex I, Part I (2)(d)', 'Protected from unauthorised access.', [
        'roles',
        'secrets_vault',
      ]),
      c(
        'ii-1',
        'Annex I, Part II (1)',
        'Identify and document the components, e.g. a software bill of materials.',
        ['manual', 'deps_scanned'],
      ),
      c('ii-2', 'Annex I, Part II (2)', 'Address and remediate vulnerabilities without delay.', [
        'scan_clean',
      ]),
      c('ii-3', 'Annex I, Part II (3)', 'Test and review security regularly.', [
        'tests_passing',
        'reviews',
      ]),
      c('ii-5', 'Annex I, Part II (5)', 'Have a coordinated vulnerability disclosure policy.', [
        'manual',
      ]),
    ],
  },
];

export type ControlStatus = 'met' | 'partial' | 'missing' | 'exempt';

/** A control's status from its sources: all met is met, some is partial, none is missing. */
export function controlStatus(
  sources: ('met' | 'partial' | 'missing')[],
  exempt: boolean,
): ControlStatus {
  if (exempt) return 'exempt';
  if (sources.length && sources.every((s) => s === 'met')) return 'met';
  if (sources.some((s) => s !== 'missing')) return 'partial';
  return 'missing';
}

export const frameworkOf = (key: string): FrameworkDef | undefined =>
  FRAMEWORKS.find((f) => f.key === key);
