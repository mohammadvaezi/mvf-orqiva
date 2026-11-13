// ── [PCODE-299 | S15 | v0.1.0] T31.1 GitLab and Azure Repos: webhooks, secrets, setup, read into one shape ──
//    Why:  each host asks for its own repository name and gets its own webhook steps.
import { describe, expect, it } from 'vitest';
import { REPO_HINT, webhookSteps } from '../src/git.js';

describe('Git hosts in the Repositories screen', () => {
  it('checks the name each host uses and tells where its webhook goes', () => {
    expect(REPO_HINT.gitlab.pattern.test('acme/web/shop')).toBe(true);
    expect(REPO_HINT.github.pattern.test('acme/web/shop')).toBe(false);
    expect(REPO_HINT.azure.pattern.test('contoso/Shop App/shop-web')).toBe(true);
    expect(REPO_HINT.azure.pattern.test('contoso/shop')).toBe(false);
    expect(webhookSteps('gitlab')).toMatchObject({ secretLabel: 'Secret token' });
    expect(webhookSteps('azure').where).toContain('Service hooks');
    expect(webhookSteps('azure').events).toContain('Build completed');
    expect(webhookSteps('github').events).toBe('Pushes, pull requests, and branch or tag creation');
  });
});
