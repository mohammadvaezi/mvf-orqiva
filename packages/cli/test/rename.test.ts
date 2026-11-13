// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
//    Why:  a repository linked and a machine signed in before the rename keep working: the repository's
//          .prodengine folder moves to .orqiva the first time orq looks, and the token in
//          ~/.prodengine/credentials.json is found and copied to ~/.orqiva.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyLegacyEnv } from '@orqiva/shared';
import { credentialsPath, findRoot, linkPath, loadCredentials } from '../src/loop/config.js';

describe('what was made before the rename', () => {
  it('moves a repository’s .prodengine folder to .orqiva once', () => {
    const root = mkdtempSync(join(tmpdir(), 'orq-repo-'));
    mkdirSync(join(root, '.prodengine', 'state'), { recursive: true });
    writeFileSync(join(root, '.prodengine', 'project.json'), '{"projectKey":"APP"}');
    mkdirSync(join(root, 'src'));
    expect(findRoot(join(root, 'src'))).toBe(root);
    expect(existsSync(join(root, '.orqiva', 'project.json'))).toBe(true);
    expect(existsSync(join(root, '.prodengine'))).toBe(false);
    expect(linkPath(root)).toBe(join(root, '.orqiva', 'project.json'));
  });

  it('finds the token signed in before the rename and keeps it under the new name', () => {
    const home = mkdtempSync(join(tmpdir(), 'orq-home-'));
    mkdirSync(join(home, '.prodengine'));
    const creds = { servers: { 'http://localhost:8480': { token: 't', email: 'a@b.c' } } };
    writeFileSync(join(home, '.prodengine', 'credentials.json'), JSON.stringify(creds));
    expect(loadCredentials(home)).toEqual(creds);
    expect(JSON.parse(readFileSync(credentialsPath(home), 'utf8'))).toEqual(creds);
  });

  it('lets PRODENGINE_* variables stand in for ORQIVA_*', () => {
    const env: Record<string, string | undefined> = {
      PRODENGINE_TOKEN: 'old',
      PRODENGINE_PORT: '8480',
      ORQIVA_PORT: '9000',
    };
    applyLegacyEnv(env);
    expect(env['ORQIVA_TOKEN']).toBe('old');
    expect(env['ORQIVA_PORT']).toBe('9000');
  });
});
