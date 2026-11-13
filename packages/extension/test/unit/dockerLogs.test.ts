// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-53 | S10 | v0.1.0] Stream build and container logs into the Orqiva Docker output channel ──
//    Why:  the ring keeps the last 2000 lines and no more, ANSI never reaches the panel, a secret is masked
//          in both sinks, and a long stream leaves the memory flat.
import { beforeEach, describe, expect, it } from 'vitest';
import { channelLine, LogBuffer, PANEL_LINES, stripAnsi } from '../../src/release/dockerLogs';
import { clearRegisteredSecrets, registerSecret } from '../../src/util/redact';

describe('docker logs', () => {
  beforeEach(() => {
    clearRegisteredSecrets();
  });

  it('strips what a terminal would paint', () => {
    expect(stripAnsi('\u001b[34m#1 [internal]\u001b[0m load build definition')).toBe(
      '#1 [internal] load build definition',
    );
    expect(stripAnsi('progress\r=> done')).toBe('progress=> done');
    expect(stripAnsi('plain text')).toBe('plain text');
  });

  it('timestamps a channel line', () => {
    expect(channelLine('hello', new Date('2026-02-02T10:11:12.000Z'))).toBe(
      '[2026-02-02T10:11:12.000Z] hello',
    );
  });

  // ── [PCODE-53 | S10 | v0.1.0] the ring: last 2000, the rest counted as dropped ──
  it('keeps the last 2000 lines', () => {
    const buffer = new LogBuffer();
    for (let i = 0; i < PANEL_LINES + 500; i++) buffer.push(`line ${String(i)}`);
    expect(buffer.length).toBe(PANEL_LINES);
    expect(buffer.total).toBe(PANEL_LINES + 500);
    expect(buffer.dropped).toBe(500);
    expect(buffer.lines[0]).toBe('line 500');
    expect(buffer.lines.at(-1)).toBe(`line ${String(PANEL_LINES + 499)}`);
    expect(buffer.tail(3)).toEqual([
      `line ${String(PANEL_LINES + 497)}`,
      `line ${String(PANEL_LINES + 498)}`,
      `line ${String(PANEL_LINES + 499)}`,
    ]);
    buffer.clear();
    expect(buffer.length).toBe(0);
    expect(buffer.dropped).toBe(0);
  });

  // ── [PCODE-53 | S10 | v0.1.0] a build arg with a secret in it is masked wherever the line goes ──
  it('masks a secret for both sinks', () => {
    registerSecret('plane_api_key_that_must_not_appear');
    const buffer = new LogBuffer();
    const stored = buffer.push(
      // [PCODE-66 | S13 | v0.1.0] orqiva:allow-secret - invented; the assertion is that it is redacted
      '\u001b[33m#5 [build] --build-arg TOKEN=plane_api_key_that_must_not_appear\u001b[0m',
    );
    expect(stored).toBe('#5 [build] --build-arg TOKEN=***');
    expect(buffer.lines[0]).toBe(stored);
    expect(channelLine(stored)).toContain('TOKEN=***');
    expect(JSON.stringify(buffer.lines)).not.toContain('plane_api_key_that_must_not_appear');
    clearRegisteredSecrets();
  });

  it('stays flat over a long stream', () => {
    const buffer = new LogBuffer();
    // five minutes of a chatty container at ~100 lines/second
    for (let i = 0; i < 30_000; i++) buffer.push(`api-1  | request ${String(i)} handled in 3 ms`);
    expect(buffer.length).toBe(PANEL_LINES);
    expect(buffer.dropped).toBe(28_000);
    const bytes = buffer.lines.reduce((sum, l) => sum + l.length, 0);
    expect(bytes).toBeLessThan(200_000); // 2000 short lines, never the whole stream
  });
});
