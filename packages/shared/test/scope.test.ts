// ── [PCODE-247 | S15 | v0.1.0] T25.2 Agent scopes enforced: files, branches, network, trace redaction ──
import { describe, expect, it } from 'vitest';
import {
  agentScopeAllows,
  branchMatches,
  globMatches,
  hostMatches,
  redactSecrets,
  redactValue,
} from '../src/index.js';

describe('agent scopes', () => {
  it('matches files by folder and glob', () => {
    expect(globMatches('src/api/items.ts', 'src/**')).toBe(true);
    expect(globMatches('src/api/items.ts', 'src')).toBe(true);
    expect(globMatches('srcx/a.ts', 'src')).toBe(false);
    expect(globMatches('docs/a.md', 'docs/*.md')).toBe(true);
    expect(globMatches('docs/x/a.md', 'docs/*.md')).toBe(false);
    expect(globMatches('./test\\a.test.ts', 'test/**')).toBe(true);
  });

  it('matches branches and hosts', () => {
    expect(branchMatches('agent/fix-1', 'agent/*')).toBe(true);
    expect(branchMatches('agent/a/b', 'agent/*')).toBe(false);
    expect(branchMatches('refs/heads/main', 'main')).toBe(true);
    expect(hostMatches('api.github.com', 'api.github.com')).toBe(true);
    expect(hostMatches('API.GitHub.com.', 'api.github.com')).toBe(true);
    expect(hostMatches('docs.example.com', '*.example.com')).toBe(true);
    expect(hostMatches('example.com', '*.example.com')).toBe(false);
    expect(hostMatches('evilexample.com', '*.example.com')).toBe(false);
  });

  it('opens files and branches without a list, keeps the network closed without one', () => {
    expect(agentScopeAllows({}, 'files', 'anything.ts').allowed).toBe(true);
    expect(agentScopeAllows({}, 'branches', 'main').allowed).toBe(true);
    const net = agentScopeAllows({}, 'network', 'api.github.com', 'Coder');
    expect(net).toEqual({
      allowed: false,
      reason: 'Coder may reach no host: its network scope is empty',
    });
    const out = agentScopeAllows({ files: ['src/**'] }, 'files', 'package.json', 'Coder');
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe("package.json is outside Coder's files scope (src/**)");
  });
});

describe('trace redaction', () => {
  it('replaces keys, private keys, URL passwords, bearer tokens and named secrets by their kind', () => {
    const key = 'sk-ant-api03-' + 'a'.repeat(40);
    const r = redactSecrets(
      [
        'key ' + key,
        'aws AKIA' + 'B'.repeat(16),
        'db postgres://app:hunter2secret@db.internal:5432/x',
        'Authorization: Bearer ' + 'c'.repeat(30),
        '{"password": "correct horse"}',
        '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----',
        'token orq_pat_' + 'd'.repeat(43),
      ].join('\n'),
    );
    expect(r.text).not.toContain(key);
    expect(r.text).not.toContain('hunter2secret');
    expect(r.text).not.toContain('correct horse');
    expect(r.text).not.toContain('MIIE');
    expect(r.text).toContain('postgres://app:[redacted]@db.internal');
    expect(r.text).toContain('"password": "[redacted]"');
    expect(r.found.sort()).toEqual([
      'AWS access key',
      'Anthropic key',
      'Orqiva token',
      'bearer token',
      'password in a URL',
      'password or secret',
      'private key',
    ]);
    expect(redactSecrets('plain text about passwords').found).toEqual([]);
  });

  it('cleans every string inside a value', () => {
    const found = new Set<string>();
    const v = redactValue({ a: ['xai-' + 'e'.repeat(30)], b: { c: 3, d: 'fine' } }, found) as {
      a: string[];
      b: { c: number; d: string };
    };
    expect(v).toEqual({ a: ['[redacted xAI key]'], b: { c: 3, d: 'fine' } });
    expect([...found]).toEqual(['xAI key']);
  });
});
