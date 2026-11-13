// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-68 | S14 | v0.1.0] Write the user documentation: install, setup, daily loop, release and deploy ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  documentation rots the moment a command is added and nobody remembers the guide. The check is
//          mechanical - every command and every setting the manifest contributes must be named somewhere
//          in the docs - so the next command that is added fails the build instead of going unmentioned.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

interface Manifest {
  contributes: {
    commands: { command: string; title: string }[];
    configuration: { properties: Record<string, unknown> };
  };
}
const pkg = JSON.parse(read('package.json')) as Manifest;
const GUIDE = read('docs/guide.md');
const INSTALL = read('docs/install.md');
const RELEASE = read('docs/release.md');
const README = read('README.md');
const ALL_DOCS = [GUIDE, INSTALL, RELEASE].join('\n');

describe('the documents exist and link to each other', () => {
  // [PCODE-222 | S15 | v0.1.0] the README is the Marketplace listing; the developer notes lead to the docs
  it('the developer notes point at all three, and the README names no repository path', () => {
    const dev = read('docs/development.md');
    for (const target of ['install.md', 'guide.md', 'release.md'])
      expect(dev, target).toContain(target);
    // the Marketplace shows the README without the repository: no relative links in it
    expect(README).not.toMatch(/\]\((?!https?:)/);
  });

  it('install leads to the guide, and the guide to release', () => {
    expect(INSTALL).toContain('guide.md');
    expect(GUIDE).toContain('release.md');
    expect(GUIDE).toContain('install.md');
  });

  it('every internal link points at a file that exists', () => {
    const files: [string, string][] = [
      ['README.md', README],
      ['docs/guide.md', GUIDE],
      ['docs/install.md', INSTALL],
      ['docs/release.md', RELEASE],
    ];
    for (const [name, text] of files) {
      const dir = path.dirname(path.join(ROOT, name));
      for (const m of text.matchAll(/]\(([^)#][^)]*?)(?:#[^)]*)?\)/g)) {
        const target = m[1] ?? '';
        if (/^https?:/.test(target)) continue;
        expect(fs.existsSync(path.resolve(dir, target)), `${name} -> ${target}`).toBe(true);
      }
    }
  });
});

// ── [PCODE-68 | S14 | v0.1.0] the acceptance: every palette command is mentioned ──
describe('every contributed command is documented', () => {
  const commands = pkg.contributes.commands;

  it('names each command title in the guide, install or release page', () => {
    const missing = commands
      .filter((c) => !ALL_DOCS.includes(c.title.replace(/…$/, '')))
      .map((c) => `${c.command} ("${c.title}")`);
    expect(missing).toEqual([]);
  });

  it('documents the commands of the daily loop in the guide itself', () => {
    for (const title of ['Sync', 'Start', 'Done', 'New task', 'Start development', 'Note']) {
      expect(GUIDE, title).toContain(`Orqiva: ${title}`);
    }
  });
});

describe('every setting is documented', () => {
  it('names each configuration key in the guide', () => {
    const keys = Object.keys(pkg.contributes.configuration.properties);
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.filter((k) => !GUIDE.includes(k))).toEqual([]);
  });
});

// ── [PCODE-68 | S14 | v0.1.0] no secret may travel in the documentation ──
describe('the documentation carries nothing it should not', () => {
  it('has no credential-shaped literal and no personal address', () => {
    for (const [name, text] of [
      ['guide', GUIDE],
      ['install', INSTALL],
      ['release', RELEASE],
      ['README', README],
    ] as const) {
      expect(text, name).not.toMatch(/plane_api_[0-9a-f]{20,}/);
      expect(text, name).not.toMatch(/\bghp_[A-Za-z0-9]{20,}/);
      expect(text, name).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
      // an address that is not an obvious placeholder
      const mails = [...text.matchAll(/[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g)].map(
        (m) => m[0],
      );
      expect(
        mails.filter((m) => !/example\.|\.test$|noreply/.test(m)),
        name,
      ).toEqual([]);
    }
  });

  it('tells the reader where the key must never be typed', () => {
    expect(INSTALL).toMatch(/never into a terminal command, a chat window or a file/i);
  });
});

// ── [PCODE-70 | S14 | v0.1.0] Add the extension icon, marketplace metadata, licence and CHANGELOG for 0.1.0 ──
//    Why:  the Extensions view is the first thing a person sees, and a missing icon or a stale repository
//          link is only noticed after publishing. Each field is asserted here, and so is the one packaging
//          trap this repository has already hit twice: media/** is excluded, so anything under it that has
//          to ship needs its own negation.
describe('marketplace metadata', () => {
  const manifest = JSON.parse(read('package.json')) as Record<string, unknown>;

  it('carries what the Extensions view shows', () => {
    expect(manifest['displayName']).toBe('Orqiva');
    expect(String(manifest['description']).length).toBeGreaterThan(40);
    expect(manifest['publisher']).toBe('broszio');
    // [PCODE-83 | S15 | v0.1.0] proprietary: the manifest points at the licence file
    expect(manifest['license']).toBe('SEE LICENSE IN LICENSE');
    expect(manifest['icon']).toBe('media/icon.png');
    expect(manifest['categories']).toEqual(['Other', 'SCM Providers']);
    expect(manifest['extensionKind']).toEqual(['workspace']);
    expect((manifest['keywords'] as string[]).length).toBeGreaterThanOrEqual(5);
  });

  it('ships the icon: media is excluded wholesale, so it needs its own negation', () => {
    expect(fs.existsSync(path.join(ROOT, 'media', 'icon.png'))).toBe(true);
    expect(read('.vscodeignore')).toContain('!media/icon.png');
  });

  it('has a licence file matching the declared licence', () => {
    expect(read('LICENSE')).toContain('Orqiva Proprietary Licence');
    // the extension ships the same licence as the repository root
    expect(read('LICENSE')).toBe(read('../../LICENSE'));
  });

  it('points every link at the repository the code actually lives in', () => {
    const repo = manifest['repository'] as { url: string; directory?: string };
    expect(repo.url).toContain('Orqiva');
    expect(repo.directory).toBe('packages/extension'); // [PCODE-222 | S15 | v0.1.0]
    expect(String(manifest['homepage'])).toContain('Orqiva');
    expect((manifest['bugs'] as { url: string }).url).toContain('Orqiva');
    // the badge outlived one repository already
    expect(README).not.toContain('Farivarz/orqiva');
  });

  it('has a changelog whose top section is this version', () => {
    const changelog = read('CHANGELOG.md');
    expect(changelog).toContain(`## v${String(manifest['version'])} (`);
    expect(changelog).toMatch(/^### Features$/m);
    // a hand-written paragraph, not only a generated list
    expect(changelog).toContain('## About 0.1.0');
  });
});
