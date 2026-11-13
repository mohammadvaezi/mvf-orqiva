// ── [PCODE-295 | S15 | v0.1.0] T30.8b Visual regression: baselines, pixel diff, orq visual check, the Visual tab ──
//    Why:  the PNG reader takes back what the writer makes and what browsers write (RGB, grey, palette,
//          16 bit, every filter), and the diff counts only real changes, inside their box.
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, encodePng, pixelDiff, PngError, type Rgba } from '../src/files/png.js';

const solid = (w: number, h: number, rgba: number[]): Rgba => {
  const data = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p += 1) data.set(rgba, p * 4);
  return { width: w, height: h, data };
};

/** A PNG of raw rows (each row: the filter byte, then the samples). */
function rawPng(
  w: number,
  h: number,
  depth: number,
  type: number,
  rows: number[][],
  extra: [string, Buffer][] = [],
): Buffer {
  const chunk = (kind: string, body: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    return Buffer.concat([len, Buffer.from(kind, 'latin1'), body, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = depth;
  ihdr[9] = type;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extra.map(([k, b]) => chunk(k, b)),
    chunk('IDAT', deflateSync(Buffer.from(rows.flat()))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const px = (img: Rgba, x: number, y: number): number[] => [
  ...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4),
];

describe('PNG and the pixel diff', () => {
  it('reads back what it writes', () => {
    const img = solid(3, 2, [10, 20, 30, 200]);
    img.data.set([1, 2, 3, 4], 4);
    const back = decodePng(encodePng(img));
    expect(back.width).toBe(3);
    expect([...back.data]).toEqual([...img.data]);
  });

  it('reads RGB with every filter, grey with alpha, 16 bit and a 2-bit palette', () => {
    // RGB 2×5: filters none, sub, up, average, paeth on rows of the same two pixels
    const rgb = rawPng(2, 5, 8, 2, [
      [0, 10, 20, 30, 40, 50, 60],
      [1, 10, 20, 30, 30, 30, 30],
      [2, 0, 0, 0, 0, 0, 0],
      [3, 5, 10, 15, 15, 15, 15], // the mean of left and up: 10/2 = 5, (10+40)/2 = 25 …
      [4, 0, 0, 0, 0, 0, 0],
    ]);
    const a = decodePng(rgb);
    for (let y = 0; y < 5; y += 1) {
      expect(px(a, 0, y)).toEqual([10, 20, 30, 255]);
      expect(px(a, 1, y)).toEqual([40, 50, 60, 255]);
    }
    expect(px(decodePng(rawPng(1, 1, 8, 4, [[0, 99, 128]])), 0, 0)).toEqual([99, 99, 99, 128]);
    expect(px(decodePng(rawPng(1, 1, 16, 2, [[0, 1, 2, 3, 4, 5, 6]])), 0, 0)).toEqual([
      1, 3, 5, 255,
    ]);
    // a 2-bit palette: four pixels in one byte, indices 3 2 1 0; index 0 transparent
    const pal = rawPng(
      4,
      1,
      2,
      3,
      [[0, 0b11100100]],
      [
        ['PLTE', Buffer.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255])],
        ['tRNS', Buffer.from([0])],
      ],
    );
    const p = decodePng(pal);
    expect([px(p, 0, 0), px(p, 1, 0), px(p, 2, 0), px(p, 3, 0)]).toEqual([
      [0, 0, 255, 255],
      [0, 255, 0, 255],
      [255, 0, 0, 255],
      [0, 0, 0, 0],
    ]);
    expect(() => decodePng(Buffer.from('not a png at all, really not one'))).toThrow(PngError);
  });

  it('counts only changes beyond the tolerance and boxes them', () => {
    const base = solid(10, 10, [255, 255, 255, 255]);
    const next = solid(10, 10, [255, 255, 255, 255]);
    next.data.set([250, 250, 250, 255], 0); // anti-aliasing noise
    const spots: [number, number][] = [
      [3, 4],
      [6, 7],
    ];
    for (const [x, y] of spots) next.data.set([0, 0, 0, 255], (y * 10 + x) * 4);
    const d = pixelDiff(base, next);
    expect(d.changed).toBe(2);
    expect(d.ratio).toBeCloseTo(0.02);
    expect(d.box).toEqual({ x: 3, y: 4, w: 4, h: 4 });
    expect(px(d.image, 3, 4)).toEqual([230, 30, 60, 255]);
    expect(pixelDiff(base, base).box).toBeNull();
    expect(() => pixelDiff(base, solid(10, 11, [0, 0, 0, 255]))).toThrow(
      'The sizes differ: 10 × 10 against 10 × 11',
    );
  });
});
