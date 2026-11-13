// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-84 | S08 | v0.1.0] Set up the platform monorepo with npm workspaces, own build scripts and CI ──
import { describe, expect, it } from 'vitest';
import { run } from '../src/run.js';

describe('orq', () => {
  it('prints the version', async () => {
    expect(await run(['--version'])).toEqual({ code: 0, out: 'Orqiva 0.1.0' });
  });

  it('prints help with no command', async () => {
    expect((await run([])).out).toContain('Usage: orq');
  });

  it('refuses an unknown command with exit code 2', async () => {
    const r = await run(['frobnicate']);
    expect(r.code).toBe(2);
    expect(r.out).toContain('Unknown command: frobnicate');
  });
});
