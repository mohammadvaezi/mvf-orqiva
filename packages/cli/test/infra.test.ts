// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-133 | S15 | v0.1.0] Add infrastructure templates and deploy from a gate ──
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { holdsSecret, infraTemplates, writeTemplates } from '../src/infra/templates.js';

describe('orq infra init', () => {
  it('writes starters whose secrets are variables only', () => {
    const t = infraTemplates('APP');
    expect(t.map((x) => x.path)).toEqual([
      'deploy/compose.yaml',
      'infra/main.tf',
      'infra/.gitignore',
      'deploy/.gitignore',
      'deploy/README.md',
    ]);
    for (const x of t) expect(holdsSecret(x.text)).toBe(false);
    expect(t[0]?.text).toContain('POSTGRES_PASSWORD: ${DB_PASSWORD}');
    expect(t[1]?.text).toContain('sensitive = true');
    expect(t[2]?.text).toContain('*.tfstate');
  });

  it('spots a secret value, but not a variable', () => {
    expect(holdsSecret('password: hunter2hunter2')).toBe(true);
    expect(holdsSecret('POSTGRES_PASSWORD: ${DB_PASSWORD}')).toBe(false);
  });

  it('keeps files a team already has, unless forced', () => {
    const root = mkdtempSync(join(tmpdir(), 'pe-infra-'));
    expect(writeTemplates(root, 'APP').written).toHaveLength(5);
    writeFileSync(join(root, 'deploy', 'compose.yaml'), 'mine\n');
    const again = writeTemplates(root, 'APP');
    expect(again).toEqual({
      written: [],
      kept: expect.arrayContaining(['deploy/compose.yaml']) as string[],
    });
    expect(readFileSync(join(root, 'deploy', 'compose.yaml'), 'utf8')).toBe('mine\n');
    expect(writeTemplates(root, 'APP', true).written).toHaveLength(5);
  });
});
