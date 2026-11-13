// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-25 | S05 | v0.1.0] Add the Welcome view variants for no engine, no key and no linked project ──
//    Why:  the eight combinations of engine / key / link map to the right welcome, and the keys are pushed
//          to VS Code only when they change.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Services } from '../../src/services';
import { Store } from '../../src/state/store';
import { computeContextKeys, hasRelease, WelcomeState } from '../../src/views/welcome';

describe('computeContextKeys', () => {
  // ── [PCODE-25 | S05 | v0.1.0] all eight combinations ──
  it('picks the first missing prerequisite', () => {
    const table: [boolean, boolean, boolean, string][] = [
      [false, false, false, 'setup'],
      [false, false, true, 'setup'],
      [false, true, false, 'setup'],
      [false, true, true, 'setup'],
      [true, false, false, 'connect'],
      [true, false, true, 'connect'],
      [true, true, false, 'link'],
      [true, true, true, 'board'],
    ];
    for (const [engineFound, connected, linked, variant] of table) {
      const k = computeContextKeys({ engineFound, connected, linked });
      expect(k['orqiva.welcome'], `${engineFound} ${connected} ${linked}`).toBe(variant);
      expect(k['orqiva.engineFound']).toBe(engineFound);
      expect(k['orqiva.connected']).toBe(connected);
      expect(k['orqiva.linked']).toBe(linked);
    }
  });
});

// [PCODE-453 | S15 | v0.1.0] a home without an Orqiva sign-in
const noHome = (): string => path.join(os.tmpdir(), 'orqiva-test-no-sign-in');

describe('WelcomeState', () => {
  it('pushes keys on refresh, only when they change, and follows the store link', async () => {
    const store = new Store();
    let hasKey = false;
    const services = {
      store,
      location: () =>
        Promise.resolve({ home: 'C:\\e', python: ['py', '-3'], versions: {}, problems: [] }),
      secrets: { hasApiKey: () => Promise.resolve(hasKey) },
    } as unknown as Services;
    const set: [string, unknown][] = [];
    const w = new WelcomeState(
      services,
      (k, v) => {
        set.push([k, v]);
        return Promise.resolve();
      },
      noHome,
    );
    let keys = await w.refresh();
    expect(keys['orqiva.welcome']).toBe('connect');
    // [PCODE-64 | S12 | v0.1.0] seven keys now: the four welcome ones plus the walkthrough's three
    expect(set).toHaveLength(7);
    await w.refresh();
    expect(set).toHaveLength(7); // unchanged -> nothing pushed
    hasKey = true;
    store.state.link = {
      workspace: 'w',
      project_id: 'p',
      identifier: 'FIX',
      name: 'F',
      version: '0.1.0',
    };
    keys = await w.refresh();
    expect(keys['orqiva.welcome']).toBe('board');
    expect(set.at(-1)).toEqual(['orqiva.welcome', 'board']);
    w.dispose();
  });
});

// ── [PCODE-64 | S12 | v0.1.0] Add the Get Started walkthrough content and smoke checklist for Sprint 12 ──
//    Why:  a walkthrough step that completes on onCommand ticks when a panel is opened, not when the thing
//          is done. Each step here names a context key, so the checklist can only tick on real state - and
//          that only holds while the manifest and the keys agree, which is what these tests compare.
describe('the walkthrough', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
  ) as {
    contributes: {
      walkthroughs: {
        id: string;
        steps: {
          id: string;
          title: string;
          description: string;
          media: { markdown: string };
          completionEvents: string[];
        }[];
      }[];
    };
  };
  const walkthrough = pkg.contributes.walkthroughs[0];

  it('has the six steps, in the order the work happens', () => {
    expect(walkthrough?.steps.map((s) => s.id)).toEqual([
      'setup',
      'connect',
      'link',
      'plan',
      'develop',
      'release',
    ]);
  });

  it('completes every step on a context key the extension actually sets', () => {
    const keys = Object.keys(
      computeContextKeys({ engineFound: true, connected: true, linked: true }),
    );
    for (const step of walkthrough?.steps ?? []) {
      expect(step.completionEvents, step.id).toHaveLength(1);
      const event = step.completionEvents[0] ?? '';
      expect(event, step.id).toMatch(/^onContext:/);
      expect(keys, step.id).toContain(event.slice('onContext:'.length));
    }
  });

  it('ships a page for each step and offers a command to run it', () => {
    for (const step of walkthrough?.steps ?? []) {
      const file = path.resolve(__dirname, '..', '..', step.media.markdown);
      expect(fs.existsSync(file), step.media.markdown).toBe(true);
      const text = fs.readFileSync(file, 'utf8');
      expect(text, step.id).toContain('# ');
      expect(text.length, step.id).toBeGreaterThan(400);
      // the step's own description offers at least one command link
      expect(step.description, step.id).toMatch(/\(command:orqiva\.\w+\)/);
    }
  });

  it('keeps the pages out of the ignore list so they reach the installed extension', () => {
    const ignore = fs.readFileSync(path.resolve(__dirname, '..', '..', '.vscodeignore'), 'utf8');
    expect(ignore).toContain('!media/walkthrough/**');
  });
});

// ── [PCODE-64 | S12 | v0.1.0] released: the CHANGELOG a bump writes ──
describe('hasRelease', () => {
  it('is true only when the project root holds a CHANGELOG', () => {
    const root = path.join('C:', 'proj');
    expect(hasRelease(root, (p) => p === path.join(root, 'CHANGELOG.md'))).toBe(true);
    expect(hasRelease(root, () => false)).toBe(false);
    expect(hasRelease(null, () => true)).toBe(false);
  });
});

// ── [PCODE-453 | S15 | v0.1.0] signed in to Orqiva: no engine and no Plane key are asked for ──
describe('WelcomeState on Orqiva', () => {
  it('a computer signed in to an Orqiva server goes straight to linking the folder', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-home-'));
    try {
      fs.mkdirSync(path.join(home, '.orqiva'));
      fs.writeFileSync(
        path.join(home, '.orqiva', 'credentials.json'),
        JSON.stringify({ servers: { 'http://s:8490': { token: 'orq_t', email: 'a@b.c' } } }),
      );
      const services = {
        store: new Store(),
        location: () => Promise.resolve({ home: '', python: [], versions: {}, problems: [] }),
        secrets: { hasApiKey: () => Promise.resolve(false) },
      } as unknown as Services;
      const w = new WelcomeState(
        services,
        () => Promise.resolve(),
        () => home,
      );
      const keys = await w.refresh();
      expect(keys['orqiva.engineFound']).toBe(true);
      expect(keys['orqiva.connected']).toBe(true);
      expect(keys['orqiva.welcome']).toBe('link');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('a new computer without Python is asked to sign in, not to install the engine', async () => {
    const services = {
      store: new Store(),
      location: () => Promise.resolve({ home: '', python: [], versions: {}, problems: [] }),
      secrets: { hasApiKey: () => Promise.resolve(false) },
    } as unknown as Services;
    const w = new WelcomeState(services, () => Promise.resolve(), noHome);
    expect((await w.refresh())['orqiva.welcome']).toBe('connect');
  });
});
