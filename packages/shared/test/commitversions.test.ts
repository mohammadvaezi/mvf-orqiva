// ── [PCODE-306 | S15 | v0.1.0] T31.6 Versions from commits: conventional commits, tags and components per path ──
//    Why:  commit messages are read the conventional way, tags give the last version per prefix, a folder
//          decides which commits count, and the bump and its reason follow the strongest change.
import { describe, expect, it } from 'vitest';
import {
  applyBump,
  bumpOf,
  bumpReason,
  commitChangelog,
  lastTag,
  parseCommit,
  tagVersion,
  touches,
} from '../src/index.js';

describe('conventional commits', () => {
  it('reads type, scope, breaking and subject', () => {
    expect(parseCommit('feat(cart): keep items')).toEqual({
      type: 'feat',
      scope: 'cart',
      breaking: false,
      subject: 'keep items',
      conventional: true,
    });
    expect(parseCommit('fix!: drop the old flag').breaking).toBe(true);
    expect(parseCommit('refactor: x\n\nBREAKING CHANGE: y').breaking).toBe(true);
    expect(parseCommit('Merge branch main')).toMatchObject({
      conventional: false,
      subject: 'Merge branch main',
    });
  });

  it('bumps by the strongest change', () => {
    const p = (m: string) => parseCommit(m);
    expect(bumpOf([p('fix: a'), p('feat: b')])).toBe('minor');
    expect(bumpOf([p('fix: a'), p('feat!: b')])).toBe('major');
    expect(bumpOf([p('docs: a'), p('chore: b')])).toBe('none');
    expect(bumpOf([p('docs: a'), p('Tidy')])).toBe('patch');
    expect(bumpOf([])).toBe('none');
  });

  it('applies a bump, gently before 1.0.0', () => {
    expect(applyBump('1.2.3', 'major')).toBe('2.0.0');
    expect(applyBump('1.2.3', 'minor')).toBe('1.3.0');
    expect(applyBump('1.2.3', 'patch')).toBe('1.2.4');
    expect(applyBump('0.4.1', 'major')).toBe('0.5.0');
    expect(applyBump(null, 'patch')).toBe('0.1.0');
    expect(applyBump(null, 'major')).toBe('1.0.0');
    expect(applyBump('1.2.3', 'none')).toBeNull();
  });

  it('says why', () => {
    const p = (m: string) => parseCommit(m);
    expect(bumpReason([p('feat: a'), p('feat: b')], 'minor')).toBe('2 features');
    expect(bumpReason([p('Tidy')], 'patch')).toBe(
      '1 message not in the conventional form (counted as fixes)',
    );
    expect(bumpReason([p('fix: a'), p('fix: b')], 'patch')).toBe('2 fixes');
    expect(bumpReason([], 'none')).toBe('Nothing new since the last version');
  });
});

describe('tags and folders', () => {
  it('finds the highest version under a prefix', () => {
    const tags = [
      { name: 'v1.9.0', sha: 'a' },
      { name: 'v1.10.0', sha: 'b' },
      { name: 'web-v3.0.0', sha: 'c' },
      { name: 'v2.0.0-rc.1', sha: 'd' },
    ];
    expect(lastTag(tags, 'v')).toEqual({ name: 'v1.10.0', sha: 'b', version: '1.10.0' });
    expect(lastTag(tags, 'web-v')?.version).toBe('3.0.0');
    expect(lastTag(tags, 'api-v')).toBeNull();
    expect(tagVersion('v1.2', 'v')).toBeNull();
  });

  it('decides which commits a folder takes', () => {
    const f = { added: [], modified: ['web/src/a.ts'], removed: [] };
    expect(touches(f, 'web')).toBe(true);
    expect(touches(f, 'webapp')).toBe(false);
    expect(touches(f, '')).toBe(true);
    expect(touches(null, 'web')).toBeNull();
  });

  it('writes the changelog without quiet commits', () => {
    expect(
      commitChangelog([
        { sha: '1111111aaa', message: 'docs: readme' },
        { sha: '2222222bbb', message: 'fix(api): paging' },
      ]),
    ).toBe('### Fixes\n\n- **api:** paging (2222222)');
  });
});
