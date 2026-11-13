// ── [PCODE-150 | S15 | v0.1.0] Add the cloud tenant and harden sign-in, rate limits and headers ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoginScreen } from '../src/screens.js';
import { grouped } from '../src/twostep.js';

describe('two-step sign-in', () => {
  it('shows the key in groups of four', () => {
    expect(grouped('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
  });

  it('starts the login form with email and password only', () => {
    const html = renderToString(
      <LoginScreen onLogin={() => Promise.resolve(null)} onGoSignup={() => undefined} />,
    );
    expect(html).toContain('id="password"');
    expect(html).not.toContain('id="code"');
  });
});
