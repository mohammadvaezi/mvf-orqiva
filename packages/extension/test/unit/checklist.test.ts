// ── [PCODE-60 | S12 | v0.1.0] Add the security checklist template and a panel with persistent checkboxes ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the file is the state, so the two things worth proving are that a toggle changes exactly one
//          character and that the template is never written over an answer somebody already gave.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_FILE,
  ensureChecklist,
  parseChecklist,
  progressLine,
  shortProgress,
  toggleItem,
  writeToggle,
  type ChecklistIo,
} from '../../src/security/checklist';

const SAMPLE = [
  '# Security checklist',
  '',
  'Intro paragraph that must survive a toggle.',
  '',
  '## Secrets and config',
  '',
  '- [ ] No credential is committed.',
  '      _Search the history, not only the working tree._',
  '- [x] `.env` is in `.gitignore`.',
  '',
  '## Dependencies',
  '',
  '- [ ] The lock file is committed.',
  '',
].join('\n');

/** an in-memory disk, so no test touches the real one */
function memIo(files: Record<string, string>): ChecklistIo & { files: Record<string, string> } {
  const dirs = new Set<string>();
  return {
    files,
    existsSync: (p) => p in files || dirs.has(p),
    readFileSync: (p) => {
      const v = files[p];
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    writeFileSync: (p, d) => {
      files[p] = d;
    },
    mkdirSync: (p) => {
      dirs.add(p);
    },
  };
}

describe('parseChecklist', () => {
  it('reads sections, items and the hint under an item', () => {
    const list = parseChecklist(SAMPLE);
    expect(list.sections.map((s) => s.title)).toEqual(['Secrets and config', 'Dependencies']);
    expect(list.total).toBe(3);
    expect(list.checked).toBe(1);
    const first = list.sections[0]?.items[0];
    expect(first?.text).toBe('No credential is committed.');
    expect(first?.checked).toBe(false);
    expect(first?.hint).toBe('Search the history, not only the working tree.');
    expect(list.sections[0]?.items[1]?.checked).toBe(true);
  });

  it('numbers items over the whole file, not per section', () => {
    const list = parseChecklist(SAMPLE);
    expect(list.sections.flatMap((s) => s.items).map((i) => i.index)).toEqual([0, 1, 2]);
    expect(list.sections[1]?.items[0]?.index).toBe(2);
  });

  it('counts progress in both shapes', () => {
    const list = parseChecklist(SAMPLE);
    expect(progressLine(list)).toBe('1 of 3 checked');
    expect(shortProgress(list)).toBe('1/3');
  });
});

describe('toggleItem', () => {
  it('changes one character and leaves every other line byte-identical', () => {
    const next = toggleItem(SAMPLE, 0, true);
    const before = SAMPLE.split('\n');
    const after = next.split('\n');
    expect(after.length).toBe(before.length);
    after.forEach((line, i) => {
      if (i === 6) expect(line).toBe('- [x] No credential is committed.');
      else expect(line).toBe(before[i]);
    });
    expect(next.length).toBe(SAMPLE.length);
  });

  it('round-trips: tick and untick returns the original text', () => {
    expect(toggleItem(toggleItem(SAMPLE, 2, true), 2, false)).toBe(SAMPLE);
    expect(toggleItem(toggleItem(SAMPLE, 1, false), 1, true)).toBe(SAMPLE);
  });

  it('keeps CRLF when the file uses it', () => {
    const crlf = SAMPLE.replace(/\n/g, '\r\n');
    const next = toggleItem(crlf, 0, true);
    expect(next.includes('\r\n')).toBe(true);
    expect(next.split('\r\n')[6]).toBe('- [x] No credential is committed.');
    expect(parseChecklist(next).checked).toBe(2);
  });

  it('keeps the indentation of a nested item', () => {
    const nested = '## A\n\n  - [ ] indented item\n';
    expect(toggleItem(nested, 0, true)).toBe('## A\n\n  - [x] indented item\n');
  });

  it('is a no-op for an index that is not in the file', () => {
    expect(toggleItem(SAMPLE, 99, true)).toBe(SAMPLE);
  });
});

describe('ensureChecklist', () => {
  const root = path.join('C:', 'proj');
  const ext = path.join('C:', 'ext');
  const target = path.join(root, '.plane', ...CHECKLIST_FILE); // [PCODE-455 | S15 | v0.1.0] a legacy folder
  const template = path.join(ext, 'templates', 'security.md');

  it('copies the template when the file is missing', () => {
    const io = memIo({ [template]: SAMPLE });
    const res = ensureChecklist({ root, extensionPath: ext, io });
    expect(res.created).toBe(true);
    expect(io.files[target]).toBe(SAMPLE);
  });

  it('never writes over a file that already exists', () => {
    const mine = '## Mine\n\n- [x] already answered\n';
    const io = memIo({ [template]: SAMPLE, [target]: mine });
    const res = ensureChecklist({ root, extensionPath: ext, io });
    expect(res.created).toBe(false);
    expect(res.text).toBe(mine);
    expect(io.files[target]).toBe(mine);
  });

  it('falls back to a one-item list when the template is not packaged', () => {
    const io = memIo({});
    const res = ensureChecklist({ root, extensionPath: ext, io });
    expect(res.created).toBe(true);
    expect(parseChecklist(res.text).total).toBe(1);
  });
});

describe('writeToggle', () => {
  const root = path.join('C:', 'proj');
  const target = path.join(root, '.plane', ...CHECKLIST_FILE); // [PCODE-455 | S15 | v0.1.0] a legacy folder

  it('saves the tick immediately and reports the new count', () => {
    const io = memIo({ [target]: SAMPLE });
    const list = writeToggle(root, 0, true, io);
    expect(list?.checked).toBe(2);
    expect(io.files[target]?.split('\n')[6]).toBe('- [x] No credential is committed.');
  });

  it('answers null when the project has no checklist yet', () => {
    expect(writeToggle(root, 0, true, memIo({}))).toBeNull();
  });
});

// ── [PCODE-60 | S12 | v0.1.0] the shipped template is part of the acceptance, so it is asserted ──
describe('templates/security.md', () => {
  const text = fs.readFileSync(
    path.join(__dirname, '..', '..', 'templates', 'security.md'),
    'utf8',
  );
  const list = parseChecklist(text);

  it('lists at least 30 items across nine sections', () => {
    expect(list.sections.length).toBe(9);
    expect(list.total).toBeGreaterThanOrEqual(30);
  });

  it('starts with nothing ticked', () => {
    expect(list.checked).toBe(0);
  });

  it('names the areas the checklist is meant to cover', () => {
    const titles = list.sections.map((s) => s.title.toLowerCase()).join(' | ');
    for (const word of ['secrets', 'dependencies', 'authentication', 'docker', 'backups']) {
      expect(titles).toContain(word);
    }
  });

  it('gives every section at least three items', () => {
    for (const section of list.sections) expect(section.items.length).toBeGreaterThanOrEqual(3);
  });
});
