// ── [PCODE-213 | S15 | v0.1.0] T19.2 SCIM 2.0 provisioning (users, role groups, suspend on deactivate) and identity settings (SAML, SCIM tokens) ──
//    Why:  the domains an admin types are read the way people write lists, and Single sign-on is an
//          admin's settings section.
import { describe, expect, it } from 'vitest';
import { domainsOf, ROLE_CHOICES } from '../src/identity.js';
import { appRoute } from '../src/core/nav.js';

describe('identity settings', () => {
  it('reads a list of domains', () => {
    expect(domainsOf('@Example.com, example.de;  sub.example.org\nx.io')).toEqual([
      'example.com',
      'example.de',
      'sub.example.org',
      'x.io',
    ]);
    expect(ROLE_CHOICES).not.toContain('admin');
  });

  it('has its own settings address', () => {
    expect(appRoute('/settings/identity')).toEqual({ kind: 'settings', section: 'identity' });
  });
});
