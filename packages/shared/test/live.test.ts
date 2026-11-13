// ── [PCODE-196 | S15 | v0.1.0] B8.4 VS Code: ideation interview, and presence per file and block (workspace switch, off by default) ──
//    Why:  a presence report may name a file only as a plain repo path; anything that could point outside
//          the repository, or is not a path at all, makes the whole report invalid. Agent steps read the
//          same everywhere (the shared wording of PCODE-195).
import { describe, expect, it } from 'vitest';
import { isRepoPath, parseClientMessage, stepLabel } from '../src/index.js';

const WS = '11111111-1111-4111-8111-111111111111';
const report = (file: unknown): string =>
  JSON.stringify({
    type: 'presence',
    workspaceId: WS,
    projectId: null,
    itemId: null,
    state: 'viewing',
    file,
  });

describe('presence with a file', () => {
  it('takes a repo path and nothing else', () => {
    expect(isRepoPath('packages/web/src/app.tsx')).toBe(true);
    const bad = [
      '',
      '/etc/passwd',
      'C:/x.ts',
      'a/../b',
      '../x',
      'a//b',
      'a\\b',
      'a\u0000b',
      'a\nb',
      5,
    ];
    for (const b of bad) expect(isRepoPath(b), JSON.stringify(b)).toBe(false);
  });

  it('keeps the file in a report, and refuses a report with a bad one', () => {
    expect(parseClientMessage(report('src/a.ts'))).toMatchObject({ file: 'src/a.ts' });
    expect(parseClientMessage(report(null))).not.toHaveProperty('file');
    expect(parseClientMessage(report('../secret'))).toBeNull();
  });
});

describe('agent steps', () => {
  it('reads the same in the web, VS Code and the terminal', () => {
    expect(stepLabel({ kind: 'approval', content: { tool: 'deploy' } })).toBe(
      'asks a person: deploy',
    );
    expect(stepLabel({ kind: 'decision', content: { approve: true } })).toBe(
      'approved by a person',
    );
  });
});

// [PCODE-230 | S15 | v0.1.0] the phone app marks its reports; nothing else may be claimed
describe('presence from a phone', () => {
  const from = (device: unknown): string =>
    JSON.stringify({
      type: 'presence',
      workspaceId: WS,
      projectId: null,
      itemId: null,
      state: 'viewing',
      device,
    });
  it('keeps device phone, and refuses any other device', () => {
    expect(parseClientMessage(from('phone'))).toMatchObject({ device: 'phone' });
    expect(parseClientMessage(from(undefined))).not.toHaveProperty('device');
    expect(parseClientMessage(from('tablet'))).toBeNull();
    expect(parseClientMessage(from(1))).toBeNull();
  });
});
