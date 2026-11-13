// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-7 | S02 | v0.1.0] Implement the engine locator for Python and PLANE_CLAUDE_HOME with diagnostics ──
//    Why:  the resolution rules (setting > env, real Python 3 only, clear problems) must hold without VS Code.
import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { locate, pythonCandidates, resolveHome, type Probe } from '../../src/engine/locate';

const ENGINE = 'C:\\Tools\\plane-claude';
const allEngineFiles = (p: string): boolean => p.startsWith(ENGINE);

function probeWith(table: Partial<Record<string, { code: number; out: string }>>): Probe {
  return (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const hit = table[key];
    if (!hit) return Promise.reject(new Error(`spawn ${cmd} ENOENT`));
    return Promise.resolve({ code: hit.code, stdout: hit.out, stderr: '' });
  };
}

describe('resolveHome', () => {
  // ── [PCODE-7 | S02 | v0.1.0] setting wins over env, env wins over nothing ──
  it('prefers the setting over the environment variable', () => {
    const r = resolveHome(
      { engineHome: ENGINE },
      { PLANE_CLAUDE_HOME: 'D:\\other' },
      allEngineFiles,
    );
    expect(r.home).toBe(ENGINE);
    expect(r.problem).toBeUndefined();
  });

  it('falls back to PLANE_CLAUDE_HOME', () => {
    const r = resolveHome({}, { PLANE_CLAUDE_HOME: ENGINE }, allEngineFiles);
    expect(r.home).toBe(ENGINE);
  });

  it('names the setting when nothing is configured or the folder lacks the scripts', () => {
    expect(resolveHome({}, {}, allEngineFiles).problem).toContain('orqiva.engineHome');
    const bad = resolveHome({ engineHome: ENGINE }, {}, (p) => !p.endsWith('plane_task.py'));
    expect(bad.home).toBe('');
    expect(bad.problem).toContain('plane_task.py');
    expect(bad.problem).toContain('orqiva.engineHome');
  });
});

describe('locate', () => {
  it('lists the setting first, then py -3 on Windows, then python3 and python', () => {
    expect(pythonCandidates({ pythonPath: 'C:\\py\\python.exe' }, 'win32')).toEqual([
      ['C:\\py\\python.exe'],
      ['py', '-3'],
      ['python3'],
      ['python'],
    ]);
    expect(pythonCandidates({}, 'linux')).toEqual([['python3'], ['python']]);
  });

  // ── [PCODE-7 | S02 | v0.1.0] the Microsoft Store stub (exit 9009, no version text) is skipped ──
  it('skips the Store stub and keeps the first real Python 3', async () => {
    const r = await locate({
      settings: { engineHome: ENGINE },
      env: {},
      platform: 'win32',
      exists: allEngineFiles,
      probe: probeWith({
        'py -3 --version': { code: 9009, out: '' },
        'python3 --version': { code: 0, out: 'Python 3.12.4\n' },
        'python --version': { code: 0, out: 'Python 3.14.0' },
      }),
    });
    expect(r.python).toEqual(['python3']);
    expect(r.versions.python).toBe('Python 3.12');
    expect(r.problems).toEqual([]);
    expect(r.home).toBe(ENGINE);
  });

  it('rejects Python 2 and reports every candidate tried', async () => {
    const r = await locate({
      settings: {},
      env: { PLANE_CLAUDE_HOME: ENGINE },
      platform: 'linux',
      exists: allEngineFiles,
      probe: probeWith({ 'python --version': { code: 0, out: 'Python 2.7.18' } }),
    });
    expect(r.python).toEqual([]);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('python3, python');
    expect(r.problems[0]).toContain('orqiva.pythonPath');
  });

  it('reports a missing engine folder as a problem naming the setting', async () => {
    const r = await locate({
      settings: {},
      env: {},
      platform: 'win32',
      exists: () => false,
      probe: probeWith({ 'py -3 --version': { code: 0, out: 'Python 3.11.9' } }),
    });
    expect(r.home).toBe('');
    expect(r.problems[0]).toContain('orqiva.engineHome');
    expect(r.python).toEqual(['py', '-3']);
    expect(path.isAbsolute(ENGINE)).toBe(true);
  });
});
