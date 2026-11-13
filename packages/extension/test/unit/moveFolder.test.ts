// ── [PCODE-455 | S15 | v0.1.0] Rename the project folder .plane to .orqiva on Orqiva folders, with a one-time move ──
//    Why:  an Orqiva folder reads its project files from .orqiva and a legacy folder from .plane; an Orqiva
//          folder's leftover .plane moves over once, without losing a file: what .orqiva already has and the
//          legacy engine's own files go to .orqiva/legacy, and the old folder is gone afterwards.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { descriptionPath } from '../../src/plan/planService';
import { planePath, projectDir, projectRel, readPlan } from '../../src/state/files';
import { DRAFT_TASK, draftCommandLine, draftTask } from '../../src/plan/draft';
import { moveToOrqiva } from '../../src/state/moveFolder';

let root = '';
const put = (rel: string, text = rel): void => {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const read = (rel: string): string => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
const LINK = JSON.stringify({
  server: 'http://s.test',
  workspaceId: 'w1',
  projectId: 'p1',
  projectKey: 'MARK',
  projectName: 'Marketspider',
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-move-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("the project's folder", () => {
  it('is .orqiva on a folder linked to Orqiva and .plane on a legacy folder', () => {
    put('.plane/project.json', '{}');
    expect(projectDir(root)).toBe('.plane');
    expect(descriptionPath(root)).toBe(path.join(root, '.plane', 'description', 'description.md'));
    put('.orqiva/project.json', LINK);
    expect(projectDir(root)).toBe('.orqiva');
    expect(planePath(root, 'plan')).toBe(path.join(root, '.orqiva', 'plan.json'));
    expect(projectRel(root, ['description', 'description.md'])).toBe(
      '.orqiva/description/description.md',
    );
    put('.orqiva/plan.json', '{"version":"0.1.0","sprints":[]}');
    expect(readPlan(root)).toEqual({ version: '0.1.0', sprints: [] });
  });
});

describe('moveToOrqiva', () => {
  it('does nothing on a legacy folder or when there is no .plane', () => {
    put('.plane/project.json', '{}');
    put('.plane/plan.json');
    expect(moveToOrqiva(root)).toBeNull();
    expect(read('.plane/plan.json')).toBe('.plane/plan.json');
    fs.rmSync(path.join(root, '.plane'), { recursive: true });
    put('.orqiva/project.json', LINK);
    expect(moveToOrqiva(root)).toBeNull();
  });

  it('moves every file once, keeps what .orqiva has, and removes the old folder', () => {
    put('.orqiva/project.json', LINK);
    put('.orqiva/fingerprints.md', 'from orq');
    put('.plane/description/description.md', 'the idea');
    put('.plane/architecture.md');
    put('.plane/plan.json');
    put('.plane/fingerprints.md', 'from the engine');
    put('.plane/state/published.json');
    put('.plane/state/active.json');
    put('.plane/project.json', '{"identifier":"OLD"}');
    put('.plane/plane-archive.json');
    const r = moveToOrqiva(root);
    expect(r?.stayed).toEqual([]);
    expect(r?.removed).toBe(true);
    expect(fs.existsSync(path.join(root, '.plane'))).toBe(false);
    expect(read('.orqiva/description/description.md')).toBe('the idea');
    expect(read('.orqiva/architecture.md')).toBe('.plane/architecture.md');
    expect(read('.orqiva/plan.json')).toBe('.plane/plan.json');
    expect(read('.orqiva/state/published.json')).toBe('.plane/state/published.json');
    // .orqiva's own file wins; the old one is kept aside
    expect(read('.orqiva/fingerprints.md')).toBe('from orq');
    expect(read('.orqiva/legacy/fingerprints.md')).toBe('from the engine');
    // the legacy engine's own files are kept aside too, never over the orq link
    expect(JSON.parse(read('.orqiva/project.json'))).toMatchObject({ projectKey: 'MARK' });
    expect(read('.orqiva/legacy/project.json')).toBe('{"identifier":"OLD"}');
    expect(read('.orqiva/legacy/state/active.json')).toBe('.plane/state/active.json');
    expect(read('.orqiva/legacy/plane-archive.json')).toBe('.plane/plane-archive.json');
    expect(r?.moved).toContainEqual({
      from: '.plane/description/description.md',
      to: '.orqiva/description/description.md',
    });
    expect(moveToOrqiva(root)).toBeNull();
  });

  it('leaves a file that cannot move, and tries again next time', () => {
    put('.orqiva/project.json', LINK);
    put('.plane/rules.md');
    put('.plane/criticals.md');
    const io = {
      existsSync: fs.existsSync,
      readdirSync: fs.readdirSync,
      mkdirSync: fs.mkdirSync,
      rmdirSync: fs.rmdirSync,
      renameSync: (from: string, to: string): void => {
        if (from.endsWith('rules.md')) throw new Error('EBUSY');
        fs.renameSync(from, to);
      },
    };
    const r = moveToOrqiva(root, io);
    expect(r?.stayed).toEqual(['rules.md']);
    expect(r?.removed).toBe(false);
    expect(read('.orqiva/criticals.md')).toBe('.plane/criticals.md');
    const again = moveToOrqiva(root);
    expect(again?.moved.map((m) => m.to)).toEqual(['.orqiva/rules.md']);
    expect(again?.removed).toBe(true);
  });
});

describe('the planning run on an Orqiva folder', () => {
  it('sends Claude to the description and the prompt in .orqiva', () => {
    const line = draftCommandLine(
      'claude',
      '.orqiva/state/plan_prompt.txt',
      'posix',
      draftTask('.orqiva'),
    );
    expect(line).toContain('.orqiva/state/plan_prompt.txt');
    expect(line).toContain('read .orqiva/description/');
    expect(line).not.toContain('.plane');
    expect(DRAFT_TASK).toContain('.plane/description/');
  });
});
