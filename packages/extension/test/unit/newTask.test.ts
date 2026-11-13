// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-23 | S04 | v0.1.0] Build the New task form creating items via plane new with a description file ──
//    Why:  validation rules, the description file the engine reads, the exact argv, and cleanup on failure.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngineCommands } from '../../src/engine/commands';
import { submitNewTask } from '../../src/webviews/newTask/panel';
import {
  descriptionFile,
  isValid,
  parseAcceptanceLines,
  validate,
} from '../../src/webviews/newTask/validate';
import { OrqivaError } from '../../src/util/errors';

const good = {
  title: 'Add the login form',
  sprint: 'today',
  label: 'feature',
  priority: 'high',
  description: 'A login form with e-mail and password so users can sign in; verify by logging in.',
  acceptance: ['form renders', 'wrong password shows an error'],
};

describe('validate', () => {
  // ── [PCODE-23 | S04 | v0.1.0] Create is disabled with an empty title, short description, or no acceptance ──
  it('names the missing field', () => {
    expect(validate(good)).toEqual({});
    expect(validate({ ...good, title: '  ' }).title).toContain('title');
    expect(validate({ ...good, title: 'x'.repeat(81) }).title).toContain('80');
    expect(validate({ ...good, description: 'too short' }).description).toContain('40');
    expect(validate({ ...good, acceptance: [' '] }).acceptance).toContain('acceptance');
    expect(validate({ ...good, label: 'weird' }).label).toBeDefined();
    expect(isValid({ ...good, acceptance: [] })).toBe(false);
    expect(parseAcceptanceLines('- [ ] a\n* b\n\n  c  \n')).toEqual(['a', 'b', 'c']);
  });

  it('writes the description file the engine expects', () => {
    expect(descriptionFile(good)).toBe(
      `${good.description}\n\n### Acceptance\n- [ ] form renders\n- [ ] wrong password shows an error\n`,
    );
  });
});

describe('submitNewTask', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-new-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('calls the engine with the exact argv and a file holding the acceptance lines, then removes it', async () => {
    const calls: string[][] = [];
    let seen = '';
    const engine = new EngineCommands((_s, args) => {
      calls.push(args);
      const i = args.indexOf('--desc-file');
      seen = fs.readFileSync(args[i + 1] ?? '', 'utf8');
      return Promise.resolve({
        code: 0,
        stdout:
          'Created FIX-9 Add the login form in Sprint 01 - Foundation -> https://x/9/\nNext: plane start FIX-9\n',
        stderr: '',
      });
    });
    const r = await submitNewTask(engine, root, good, () => 123);
    expect(r).toEqual({
      ref: 'FIX-9',
      title: 'Add the login form',
      sprint: 'Sprint 01 - Foundation',
    });
    const file = path.join(root, '.plane', 'state', 'desc-123.md');
    expect(calls[0]).toEqual([
      'new',
      'Add the login form',
      '--desc-file',
      file,
      '--sprint',
      'today',
      '--label',
      'feature',
      '--priority',
      'high',
    ]);
    expect(seen).toContain('- [ ] form renders');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('removes the temp file even when the engine fails, and refuses an invalid form', async () => {
    const engine = new EngineCommands(() =>
      Promise.reject(new OrqivaError('a task needs a complete description', 'engine')),
    );
    await expect(submitNewTask(engine, root, good, () => 7)).rejects.toThrow(
      /complete description/,
    );
    expect(fs.existsSync(path.join(root, '.plane', 'state', 'desc-7.md'))).toBe(false);
    await expect(submitNewTask(engine, root, { ...good, title: '' })).rejects.toThrow(
      /not complete/,
    );
  });
});
