// ── [PCODE-224 | S15 | v0.1.0] T21.1 Phone sign-in by pairing code, device tokens, QR code in the web app ──
//    Why:  a QR code that a phone cannot read fails silently. The expected modules come from a reference
//          encoder (the qrcode package, byte mode, level M); during development all eight masks of
//          versions 1 to 10 matched it module for module.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { qrEncode, qrPath, qrVersionFor, reedSolomon } from '../src/index.js';

const rows = (m: boolean[][]): string[] => m.map((r) => r.map((d) => (d ? '1' : '0')).join(''));

describe('QR code', () => {
  it('encodes version 1 exactly as the reference does', () => {
    expect(rows(qrEncode('hello', { mask: 0 }))).toEqual([
      '111111100110001111111',
      '100000101100001000001',
      '101110100101101011101',
      '101110100011001011101',
      '101110101100101011101',
      '100000100000101000001',
      '111111101010101111111',
      '000000000011100000000',
      '101010100101000010010',
      '001011000010001000011',
      '010100101110100011111',
      '110010000000001000010',
      '011010110010101010000',
      '000000001111010100111',
      '111111100011011100111',
      '100000100011110110000',
      '101110101011011100011',
      '101110100100001100110',
      '101110101110100010101',
      '100000100100001010010',
      '111111101110101100011',
    ]);
  });

  it('encodes version 7 (with version information and two block groups) as the reference does', () => {
    const m = qrEncode('z'.repeat(120), { mask: 5 });
    expect(m).toHaveLength(45);
    expect(createHash('sha256').update(rows(m).join('\n')).digest('hex')).toBe(
      '3ac380595cc4ba1255ddaea4bc4dc8006ee1889457206b4c2aa140585db0c503',
    );
  });

  it('picks the smallest version and the mask with the lowest penalty', () => {
    expect(qrVersionFor(14)).toBe(1);
    expect(qrVersionFor(15)).toBe(2);
    expect(qrVersionFor(213)).toBe(10);
    expect(qrVersionFor(214)).toBeNull();
    // the reference picks mask 0 for this one too
    expect(rows(qrEncode('hello'))).toEqual(rows(qrEncode('hello', { mask: 0 })));
    expect(() => qrEncode('x'.repeat(300))).toThrow(/Too long/);
  });

  it('computes Reed-Solomon codewords', () => {
    // ISO/IEC 18004 Annex I: "01234567" in version 1-M
    const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
    expect(reedSolomon(data, 10)).toEqual([165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
  });

  it('draws the dark modules as one path inside a quiet zone', () => {
    const d = qrPath([
      [true, false],
      [false, true],
    ]);
    expect(d).toBe('M4 4h1v1h-1zM5 5h1v1h-1z');
  });
});
