// ── [PCODE-224 | S15 | v0.1.0] T21.1 Phone sign-in by pairing code, device tokens, QR code in the web app ──
import { describe, expect, it } from 'vitest';
import {
  normalizePairingCode,
  normalizeServer,
  pairingCodeText,
  pairingLink,
  parsePairingLink,
} from '../src/index.js';

describe('pairing codes and links', () => {
  it('reads a typed code however it is written, and refuses what cannot be one', () => {
    expect(normalizePairingCode('ab3k-7mqx')).toBe('AB3K7MQX');
    expect(normalizePairingCode(' AB3K 7MQX ')).toBe('AB3K7MQX');
    expect(normalizePairingCode('AB3K7MQ')).toBeNull();
    expect(normalizePairingCode('AB3K7MQO')).toBeNull(); // O is not in the alphabet
    expect(pairingCodeText('AB3K7MQX')).toBe('AB3K-7MQX');
  });

  it('turns a typed server into an address', () => {
    expect(normalizeServer('orqiva.example.com')).toBe('https://orqiva.example.com');
    expect(normalizeServer('http://localhost:8480/')).toBe('http://localhost:8480');
    expect(normalizeServer('https://example.com/orqiva/')).toBe('https://example.com/orqiva');
    expect(normalizeServer('ftp://example.com')).toBeNull();
    expect(normalizeServer('https://user:pw@example.com')).toBeNull();
    expect(normalizeServer('')).toBeNull();
  });

  it('round-trips a link through the QR code text', () => {
    const link = pairingLink('http://localhost:8480', 'AB3K7MQX');
    expect(link).toBe('orqiva://pair?server=http%3A%2F%2Flocalhost%3A8480&code=AB3K7MQX');
    expect(parsePairingLink(link)).toEqual({ server: 'http://localhost:8480', code: 'AB3K7MQX' });
    expect(parsePairingLink('https://evil.example/pair?code=AB3K7MQX')).toBeNull();
    expect(parsePairingLink('orqiva://pair?server=x&code=short')).toBeNull();
  });
});
