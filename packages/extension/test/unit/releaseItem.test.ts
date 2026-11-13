// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-49 | S09 | v0.1.0] Create or update the Release item in Plane on bump via plane new ──
//    Why:  an existing Release item is reused without spawning anything, a missing one is created with the
//          argv and the description file the engine expects, and offline nothing happens at all.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngineCommands } from '../../src/engine/commands';
import { runEngine } from '../../src/engine/run';
import {
  ensureReleaseItem,
  releaseDescription,
  releaseTitle,
  RELEASE_ACCEPTANCE,
} from '../../src/release/releaseItem';
import type { Issue } from '../../src/plane/types';
import { Store } from '../../src/state/store';

const SECTION = '## v0.1.1 (2026-02-06)\n\n### Features\n\n- FIX-2 Something\n';
const LINK = {
  project_id: 'p1',
  identifier: 'FIX',
  name: 'Fixture',
  workspace: 'ws',
  version: '0.1.1',
};

function store(): Store {
  const s = new Store();
  s.state.link = LINK;
  return s;
}

const issue = (seq: number, name: string): Issue => ({
  id: `i-${String(seq)}`,
  sequence_id: seq,
  name,
  state: 's',
  priority: 'low',
  labels: [],
});

describe('release item', () => {
  it('titles and describes the release', () => {
    expect(releaseTitle('0.2.0')).toBe('Release v0.2.0');
    const text = releaseDescription('0.2.0', SECTION, '2026-02-06');
    expect(text.startsWith('Release v0.2.0, cut on 2026-02-06.')).toBe(true);
    expect(text).toContain('- FIX-2 Something');
    expect(text).not.toContain('## v0.1.1'); // the heading belongs to CHANGELOG.md, not to the item
    expect(text).toContain(`- [ ] ${RELEASE_ACCEPTANCE}`);
  });

  // ── [PCODE-49 | S09 | v0.1.0] an existing item is reused, nothing is spawned ──
  it('reuses an existing Release item', async () => {
    let spawned = 0;
    const r = await ensureReleaseItem({
      client: {
        getIssues: () => Promise.resolve([issue(7, 'Release v0.1.1'), issue(8, 'Something else')]),
        webUrl: (p, id) => `https://plane.example.test/ws/projects/${p}/issues/${id ?? ''}/`,
      },
      engine: {
        newTask: () => {
          spawned++;
          return Promise.resolve({ ref: 'FIX-9', title: '', sprint: '', url: '' });
        },
      },
      store: store(),
      hasApiKey: () => Promise.resolve(true),
      version: '0.1.1',
      section: SECTION,
      today: '2026-02-06',
    });
    expect(r).toMatchObject({ ref: 'FIX-7', created: false, skipped: 'exists' });
    expect(r.url).toBe('https://plane.example.test/ws/projects/p1/issues/i-7/');
    expect(spawned).toBe(0);
  });

  it('creates a missing one with the description file', async () => {
    const calls: {
      title: string;
      sprint?: string;
      label?: string;
      priority?: string;
      descFile: string;
    }[] = [];
    let written = '';
    const r = await ensureReleaseItem({
      client: {
        getIssues: () => Promise.resolve([issue(1, 'Another task')]),
        webUrl: () => 'https://plane.example.test/ws/projects/p1/issues/',
      },
      engine: {
        newTask: (input) => {
          calls.push({
            title: input.title,
            ...(input.sprint ? { sprint: input.sprint } : {}),
            ...(input.label ? { label: input.label } : {}),
            ...(input.priority ? { priority: input.priority } : {}),
            descFile: input.descFile,
          });
          return Promise.resolve({
            ref: 'FIX-12',
            title: input.title,
            sprint: 'Sprint 09',
            url: 'https://plane.example.test/i/12/',
          });
        },
      },
      store: store(),
      hasApiKey: () => Promise.resolve(true),
      version: '0.1.1',
      section: SECTION,
      today: '2026-02-06',
      io: {
        mkdirSync: () => undefined,
        writeFileSync: (_p, d) => {
          written = d;
        },
        unlinkSync: () => undefined,
      },
    });
    expect(r).toMatchObject({ ref: 'FIX-12', created: true, skipped: null });
    expect(calls[0]).toMatchObject({
      title: 'Release v0.1.1',
      sprint: 'today',
      label: 'chore',
      priority: 'low',
    });
    expect(calls[0]?.descFile).toMatch(/release-0\.1\.1\.md$/);
    expect(written).toContain('- FIX-2 Something');
    expect(written).toContain(`- [ ] ${RELEASE_ACCEPTANCE}`);
  });

  it('does nothing without a key or when the lookup fails', async () => {
    let spawned = 0;
    const engine = {
      newTask: () => {
        spawned++;
        return Promise.resolve({ ref: 'X-1', title: '', sprint: '', url: '' });
      },
    };
    const offline = await ensureReleaseItem({
      client: { getIssues: () => Promise.resolve([]), webUrl: () => '' },
      engine,
      store: store(),
      hasApiKey: () => Promise.resolve(false),
      version: '0.1.1',
      section: SECTION,
      today: '2026-02-06',
    });
    expect(offline).toMatchObject({ ref: null, created: false, skipped: 'offline' });
    const failed = await ensureReleaseItem({
      client: {
        getIssues: () => Promise.reject(new Error('Plane GET /issues/ failed (503).')),
        webUrl: () => '',
      },
      engine,
      store: store(),
      hasApiKey: () => Promise.resolve(true),
      version: '0.1.1',
      section: SECTION,
      today: '2026-02-06',
    });
    expect(failed.skipped).toBe('offline');
    expect(spawned).toBe(0);
  });
});

// ── [PCODE-49 | S09 | v0.1.0] against the fake engine: created once, then never again ──
describe('release item (fake engine, real python)', () => {
  const python = (() => {
    for (const c of [['py', '-3'], ['python3'], ['python']]) {
      const r = spawnSync(c[0] ?? '', [...c.slice(1), '--version'], { encoding: 'utf8' });
      if (r.status === 0 && /Python 3/.test(r.stdout + r.stderr)) return c;
    }
    return null;
  })();
  let engineHome = '';
  let calls = '';
  beforeEach(() => {
    engineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-release-engine-'));
    fs.copyFileSync(
      path.resolve(__dirname, '..', 'fixtures', 'fake-engine', 'plane_task.py'),
      path.join(engineHome, 'plane_task.py'),
    );
    calls = path.join(engineHome, 'calls.jsonl');
  });
  afterEach(() => {
    fs.rmSync(engineHome, { recursive: true, force: true });
  });

  it.skipIf(!python)('calls plane new once, and not again for the same version', async () => {
    const created: Issue[] = [];
    const deps = {
      client: {
        getIssues: () => Promise.resolve([...created]),
        webUrl: (p: string, id?: string) => `https://plane.example.test/${p}/${id ?? ''}`,
      },
      engine: new EngineCommands((script, args) =>
        runEngine({ python: python ?? [], home: engineHome }, script, args, { cwd: engineHome }),
      ),
      store: store(),
      hasApiKey: () => Promise.resolve(true),
      version: '0.1.1',
      section: SECTION,
      today: '2026-02-06',
    };
    const first = await ensureReleaseItem(deps);
    // the fake engine answers every `new` with FIX-9
    expect(first).toMatchObject({ ref: 'FIX-9', created: true });
    const argv = fs
      .readFileSync(calls, 'utf8')
      .trim()
      .split('\n')
      .map((l) => (JSON.parse(l) as { argv: string[] }).argv);
    expect(argv).toHaveLength(1);
    expect(argv[0]?.slice(0, 2)).toEqual(['new', 'Release v0.1.1']);
    expect(argv[0]).toContain('--label');
    expect(argv[0]).toContain('chore');

    created.push(issue(9, 'Release v0.1.1'));
    const second = await ensureReleaseItem(deps);
    expect(second).toMatchObject({ ref: 'FIX-9', created: false, skipped: 'exists' });
    expect(fs.readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(1);
  });
});
