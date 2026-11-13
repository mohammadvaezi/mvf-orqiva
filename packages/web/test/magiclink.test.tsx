// ── [PCODE-339 | S15 | v0.1.0] T34.1d Portal magic-link sign-in and passwordless invitations, MFA required per client ──
//    Why:  the authenticator key reads in groups of four; the sign-in link pages have their own addresses.
import { describe, expect, it } from 'vitest';
import { grouped } from '../src/magiclink.js';
import { screenOf } from '../src/core/nav.js';

describe('sign-in links', () => {
  it('groups the key for typing', () => {
    expect(grouped('ABCDEFGHIJKLMN')).toBe('ABCD EFGH IJKL MN');
  });
  it('routes the link pages', () => {
    expect(screenOf('/sign-in/email')).toBe('linkask');
    expect(screenOf('/sign-in/link')).toBe('link');
  });
});
