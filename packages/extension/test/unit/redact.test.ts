// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-2 | S01 | v0.1.0] Add the output channel logger with secret redaction ──
//    Why:  guard test for criticals.md #1 (secrets never in logs).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearRegisteredSecrets, redact, registerSecret } from '../../src/util/redact';
import { Logger, resetLoggerForTests } from '../../src/util/log';
import { recorded, resetRecorded } from '../mocks/vscode';

describe('redact', () => {
  afterEach(() => {
    clearRegisteredSecrets();
  });

  // ── [PCODE-2 | S01 | v0.1.0] known secret shapes are masked ──
  // ── [PCODE-74 | S13 | v0.1.0] the sample is unmistakably invented ──
  //    A redaction test wants a literal shaped like the real thing, which in a public repository is
  //    exactly the literal somebody will try. Counting up in hex has the same shape and can be read
  //    as a fixture at a glance.
  it('masks Plane API keys wherever they appear', () => {
    expect(redact('key plane_api_0123456789abcdef0123 here')).toBe('key *** here');
    expect(redact('PLANE_API_KEY=plane_api_abc123DEF')).toBe('PLANE_API_KEY=***');
  });

  it('masks bearer tokens and API-key headers, keeping the label', () => {
    expect(redact('Authorization: Bearer eyJhbGciOi.abc-def_ghi')).toBe(
      'Authorization: Bearer ***',
    );
    expect(redact('X-API-Key: sk-live-0123456789')).toBe('X-API-Key: ***');
    expect(redact('"X-API-Key": "sk-live-0123456789"')).toBe('"X-API-Key": ***"');
  });

  it('masks registered secrets and extra secrets', () => {
    registerSecret('s3cr3t-token-value');
    // [PCODE-66 | S13 | v0.1.0] orqiva:allow-secret - invented; the assertion is that it is masked
    expect(redact('token=s3cr3t-token-value done')).toBe('token=*** done');
    expect(redact('other-secret-xyz here', ['other-secret-xyz'])).toBe('*** here');
  });

  // ── [PCODE-2 | S01 | v0.1.0] ordinary text and short values are untouched ──
  it('leaves ordinary text unchanged', () => {
    const text = 'PCODE-12 Start task · Sprint 03 · v0.1.0 · https://plan.broszio.com/x';
    expect(redact(text)).toBe(text);
    registerSecret('abc'); // too short to register
    expect(redact('abc def')).toBe('abc def');
  });
});

describe('Logger', () => {
  beforeEach(() => {
    resetRecorded();
    resetLoggerForTests();
    clearRegisteredSecrets();
  });

  // ── [PCODE-2 | S01 | v0.1.0] every line goes through the channel redacted, with level and timestamp ──
  it('writes redacted, timestamped lines to the Orqiva channel', () => {
    registerSecret('plane_api_hidden_value_1');
    const log = new Logger();
    log.info('connected with', 'plane_api_hidden_value_1', { key: 'plane_api_hidden_value_1' });
    log.debug('not written at info level');
    const out = recorded.outputs.find((o) => o.name === 'Orqiva');
    expect(out?.lines).toHaveLength(1);
    const line = out?.lines[0] ?? '';
    expect(line).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T.*\] \[INFO \] connected with \*\*\* \{"key":"\*\*\*"\}$/,
    );
    expect(line).not.toContain('hidden_value');
  });

  it('honours the level and show() surfaces the channel', () => {
    const log = new Logger();
    log.setLevel('debug');
    log.debug('d');
    log.error('e', new Error('boom'));
    log.show();
    const out = recorded.outputs.find((o) => o.name === 'Orqiva');
    expect(out).toBeDefined();
    expect(out?.lines).toHaveLength(2);
    expect(out?.lines[1]).toContain('[ERROR] e');
    expect(out?.lines[1]).toContain('boom');
    expect(out?.shown).toBe(1);
  });
});
