// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
//    Why:  a value can be set for yourself, and for the workspace (admins), the team or the project in view.
import { describe, expect, it } from 'vitest';
import { editableScopes } from '../src/v2/settings.js';

describe('settings scopes in the screen', () => {
  const all = ['workspace', 'team', 'project', 'user'];
  it('offers the scopes in view', () => {
    expect(editableScopes(all, { admin: false, teamId: '', projectId: '' })).toEqual(['user']);
    expect(editableScopes(all, { admin: true, teamId: '', projectId: '' })).toEqual([
      'workspace',
      'user',
    ]);
    expect(editableScopes(all, { admin: false, teamId: 't', projectId: 'p' })).toEqual([
      'team',
      'project',
      'user',
    ]);
    expect(
      editableScopes(['workspace', 'project'], { admin: true, teamId: 't', projectId: '' }),
    ).toEqual(['workspace']);
  });
});
