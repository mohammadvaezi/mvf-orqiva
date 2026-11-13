// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-84 | S08 | v0.1.0] Set up the platform monorepo with npm workspaces, own build scripts and CI ──
import { describe, expect, it } from 'vitest';
import { PLATFORM_VERSION, PRODUCT_NAME, PROTOCOL_VERSION } from '../src/index.js';

describe('shared identity', () => {
  it('names the product and carries a semver platform version', () => {
    expect(PRODUCT_NAME).toBe('Orqiva');
    expect(PLATFORM_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
  });
});
