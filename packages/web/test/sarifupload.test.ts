// ── [PCODE-321 | S15 | v0.1.0] T32.6 Secrets in the Git history, SARIF upload in the web app, dependency facts on findings ──
//    Why:  an upload says per tool what it found, what is new and what it closed.
import { describe, expect, it } from 'vitest';
import { scansText } from '../src/v2/sarifupload.js';

describe('SARIF upload', () => {
  it('says what each tool’s scan did', () => {
    expect(
      scansText([
        { tool: 'CodeQL', found: 12, newCount: 3, fixedCount: 1 },
        { tool: 'Trivy', found: 0, newCount: 0, fixedCount: 4 },
      ]),
    ).toBe('CodeQL: 12 found, 3 new, 1 fixed · Trivy: 0 found, 0 new, 4 fixed');
  });
});
