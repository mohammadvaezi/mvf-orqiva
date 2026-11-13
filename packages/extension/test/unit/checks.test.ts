// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-26 | S05 | v0.1.0] Add environment checks for Python, Node, Claude Code, git and the engine folder ──
//    Why:  each tool missing/present yields the right ok/detail/fix; the hooks check reads a sample settings.json;
//          nothing throws.
import { describe, expect, it } from 'vitest';
import type { Probe } from '../../src/engine/locate';
import { allRequiredOk, hooksCheck, runChecks } from '../../src/setup/checks';

function probeWith(table: Partial<Record<string, { code: number; out: string }>>): Probe {
  return (cmd, args) => {
    const hit = table[[cmd, ...args].join(' ')];
    if (!hit) return Promise.reject(new Error(`spawn ${cmd} ENOENT`));
    return Promise.resolve({ code: hit.code, stdout: hit.out, stderr: '' });
  };
}

const ENGINE = 'C:\\Tools\\engine';
const SETTINGS = 'C:\\Users\\me\\.claude\\settings.json';

describe('runChecks', () => {
  it('everything present is green with versions and no fixes', async () => {
    const results = await runChecks({
      probe: probeWith({
        'py -3 --version': { code: 0, out: 'Python 3.12.4' },
        'node --version': { code: 0, out: 'v20.11.0\n' },
        'claude.cmd --version': { code: 0, out: '2.1.278 (Claude Code)' },
        'git --version': { code: 0, out: 'git version 2.45.1.windows.1' },
        'docker --version': { code: 0, out: 'Docker version 27.1.1, build 1' },
      }),
      settings: { engineHome: ENGINE },
      env: {},
      platform: 'win32',
      exists: (p) => p.startsWith(ENGINE) || p === SETTINGS,
      readFile: () =>
        '{"hooks":{"SessionStart":[{"hooks":[{"command":"python","args":["C:\\\\x\\\\hooks.py"]}]}]},"permissions":{"allow":["Bash(plane *)"]}}',
      claudeSettingsPath: SETTINGS,
    });
    expect(results.map((r) => [r.name, r.ok])).toEqual([
      ['Python 3', true],
      ['Engine folder', true],
      ['Node.js', true],
      ['Claude Code', true],
      ['git', true],
      ['Docker', true],
      ['Claude Code hooks', true],
    ]);
    expect(results.find((r) => r.name === 'Node.js')?.detail).toBe('v20.11.0');
    expect(results.find((r) => r.name === 'Python 3')?.detail).toContain('Python 3.12');
    expect(results.every((r) => r.fix === undefined)).toBe(true);
    expect(allRequiredOk(results)).toBe(true);
  });

  // ── [PCODE-26 | S05 | v0.1.0] missing tools are results with a fix, never exceptions ──
  it('missing tools produce fixes; docker is optional; nothing throws', async () => {
    const results = await runChecks({
      probe: probeWith({ 'python3 --version': { code: 0, out: 'Python 3.11.2' } }),
      settings: {},
      env: {},
      platform: 'linux',
      exists: () => false,
      claudeSettingsPath: SETTINGS,
    });
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName['Python 3']?.ok).toBe(true);
    expect(byName['Engine folder']).toMatchObject({
      ok: false,
      fix: 'workbench.action.openSettings?orqiva.engineHome',
    });
    expect(byName['Node.js']).toMatchObject({
      ok: false,
      detail: 'not found',
      fix: 'https://nodejs.org/',
    });
    expect(byName['Claude Code']?.fix).toContain('claude-code');
    expect(byName['git']?.fix).toContain('git-scm');
    expect(byName['Docker']).toMatchObject({ ok: false, required: false });
    expect(byName['Claude Code hooks']).toMatchObject({
      ok: false,
      fix: 'orqiva.installHooks',
    });
    expect(allRequiredOk(results)).toBe(false);
  });

  it('hooksCheck distinguishes missing hooks from a missing allow rule', () => {
    const ok = hooksCheck(
      SETTINGS,
      () => true,
      () => 'hooks.py Bash(plane *)',
    );
    expect(ok.ok).toBe(true);
    expect(
      hooksCheck(
        SETTINGS,
        () => true,
        () => '{"hooks":{}}',
      ),
    ).toMatchObject({ ok: false, detail: 'hooks not installed' });
    expect(
      hooksCheck(
        SETTINGS,
        () => true,
        () => 'hooks.py only',
      ),
    ).toMatchObject({ ok: false, detail: 'plane command not allow-listed' });
    expect(
      hooksCheck(
        SETTINGS,
        () => true,
        () => {
          throw new Error('EACCES');
        },
      ),
    ).toMatchObject({ ok: false, detail: expect.stringContaining('unreadable') as string });
  });
});
