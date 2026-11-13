// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-49 | S09 | v0.1.0] Create or update the Release item in Plane on bump via plane new ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  every version gets one item in Plane called "Release vX.Y.Z", carrying the changelog section, so
//          the deployment history of Sprint 11 has somewhere to post. It is looked up through the client
//          (reading is cheap) and created through the engine's `plane new` (writing belongs to the engine,
//          criticals #2) - and never created twice for the same version.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { EngineCommands } from '../engine/commands';
import type { PlaneClient } from '../plane/client';
import type { Store } from '../state/store';

export const RELEASE_LABEL = 'chore';
export const RELEASE_ACCEPTANCE = 'deployed to a target';

export function releaseTitle(version: string): string {
  return `Release v${version}`;
}

// ── [PCODE-49 | S09 | v0.1.0] releaseDescription: the changelog section plus the one thing left to do ──
export function releaseDescription(version: string, section: string, today: string): string {
  return [
    `Release v${version}, cut on ${today}.`,
    '',
    section
      .trim()
      .replace(/^## .*\n?/, '')
      .trim(),
    '',
    'Acceptance',
    `- [ ] ${RELEASE_ACCEPTANCE}`,
    '',
  ].join('\n');
}

export interface ReleaseItemDeps {
  client: Pick<PlaneClient, 'getIssues' | 'webUrl'>;
  engine: Pick<EngineCommands, 'newTask'>;
  store: Pick<Store, 'state'>;
  hasApiKey: () => Promise<boolean>;
  version: string;
  section: string;
  today: string;
  /** injected for tests */
  tmpDir?: string;
  io?: {
    mkdirSync: (p: string, o: { recursive: true }) => void;
    writeFileSync: (p: string, d: string, enc: 'utf8') => void;
    unlinkSync: (p: string) => void;
  };
  log?: (line: string) => void;
}

export interface ReleaseItemResult {
  ref: string | null;
  title: string;
  url: string | null;
  created: boolean;
  /** why nothing happened, when nothing happened */
  skipped: 'offline' | 'exists' | null;
}

const defaultIo = {
  mkdirSync: (p: string, o: { recursive: true }) => {
    fs.mkdirSync(p, o);
  },
  writeFileSync: (p: string, d: string, enc: 'utf8') => {
    fs.writeFileSync(p, d, enc);
  },
  unlinkSync: (p: string) => {
    fs.unlinkSync(p);
  },
};

// ── [PCODE-49 | S09 | v0.1.0] ensureReleaseItem: find it, else create it once through `plane new` ──
export async function ensureReleaseItem(deps: ReleaseItemDeps): Promise<ReleaseItemResult> {
  const title = releaseTitle(deps.version);
  const link = deps.store.state.link;
  const out: ReleaseItemResult = { ref: null, title, url: null, created: false, skipped: null };
  if (!link || !(await deps.hasApiKey())) return { ...out, skipped: 'offline' };
  try {
    const issues = await deps.client.getIssues(link.project_id);
    const existing = issues.find((i) => i.name.trim().toLowerCase() === title.toLowerCase());
    if (existing)
      return {
        ...out,
        ref: `${link.identifier}-${String(existing.sequence_id)}`,
        url: deps.client.webUrl(link.project_id, existing.id),
        skipped: 'exists',
      };
  } catch (e) {
    deps.log?.(`release item lookup failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ...out, skipped: 'offline' };
  }
  const io = deps.io ?? defaultIo;
  const dir = deps.tmpDir ?? path.join(os.tmpdir(), 'orqiva-release');
  io.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `release-${deps.version}.md`);
  io.writeFileSync(file, releaseDescription(deps.version, deps.section, deps.today), 'utf8');
  try {
    const created = await deps.engine.newTask({
      title,
      sprint: 'today',
      label: RELEASE_LABEL,
      priority: 'low',
      descFile: file,
    });
    return { ...out, ref: created.ref, url: created.url, created: true };
  } finally {
    try {
      io.unlinkSync(file);
    } catch {
      /* already gone */
    }
  }
}
