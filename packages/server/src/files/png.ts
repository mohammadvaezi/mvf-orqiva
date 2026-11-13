// ── [PCODE-295 | S15 | v0.1.0] T30.8b Visual regression: baselines, pixel diff, orq visual check, the Visual tab ──
//    Why:  screenshots are compared pixel by pixel on the server, without an image library: PNG is read
//          here (8 and 16 bit, grey, RGB, palette, with alpha; not interlaced, as browsers write it) and
//          the diff image written back as PNG. The diff counts a pixel as changed when a channel moves more
//          than a small tolerance, so anti-aliasing noise does not fail a screen.
import { deflateSync, inflateSync } from 'node:zlib';

export interface Rgba {
  width: number;
  height: number;
  /** 4 bytes per pixel, row by row */
  data: Uint8Array;
}

export class PngError extends Error {}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** the most pixels read; a 4K screenshot at 2x fits */
const MAX_PIXELS = 40_000_000;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = (CRC_TABLE[(c ^ x) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function decodePng(buf: Buffer): Rgba {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new PngError('Not a PNG');
  let i = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let palette: Buffer | null = null;
  let alpha: Buffer | null = null;
  const idat: Buffer[] = [];
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const kind = buf.toString('latin1', i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (data.length !== len) throw new PngError('The PNG is cut off');
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8] ?? 0;
      type = data[9] ?? 0;
      if (data[12]) throw new PngError('Interlaced PNGs are not read');
    } else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') alpha = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    i += 12 + len;
  }
  if (!width || !height) throw new PngError('The PNG has no size');
  if (width * height > MAX_PIXELS) throw new PngError('The PNG is too large to compare');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new PngError('Unknown PNG colour type ' + String(type));
  if (type === 3 ? ![1, 2, 4, 8].includes(depth) : depth !== 8 && depth !== 16)
    throw new PngError('PNG bit depth ' + String(depth) + ' is not read');
  if (type === 3 && !palette) throw new PngError('The PNG has no palette');

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = Math.max(1, (channels * depth) >> 3); // bytes per pixel for the filters
  const stride = Math.ceil((width * channels * depth) / 8);
  if (raw.length < (stride + 1) * height) throw new PngError('The PNG data is cut off');
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const src = y * (stride + 1) + 1;
    const at = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const v = raw[src + x] ?? 0;
      const left = x >= bpp ? (rows[at + x - bpp] ?? 0) : 0;
      const up = y ? (rows[at - stride + x] ?? 0) : 0;
      const ul = y && x >= bpp ? (rows[at - stride + x - bpp] ?? 0) : 0;
      let out: number;
      switch (filter) {
        case 0:
          out = v;
          break;
        case 1:
          out = v + left;
          break;
        case 2:
          out = v + up;
          break;
        case 3:
          out = v + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - ul;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - ul);
          out = v + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul);
          break;
        }
        default:
          throw new PngError('Unknown PNG filter ' + String(filter));
      }
      rows[at + x] = out & 0xff;
    }
  }

  const data = new Uint8Array(width * height * 4);
  const sample = (y: number, n: number): number => {
    // the n-th sample of row y, scaled to 8 bits
    if (depth === 8) return rows[y * stride + n] ?? 0;
    if (depth === 16) return rows[y * stride + n * 2] ?? 0;
    const byte = rows[y * stride + ((n * depth) >> 3)] ?? 0;
    const shift = 8 - depth - ((n * depth) & 7);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (type === 3) {
        const k = sample(y, x);
        data[o] = palette?.[k * 3] ?? 0;
        data[o + 1] = palette?.[k * 3 + 1] ?? 0;
        data[o + 2] = palette?.[k * 3 + 2] ?? 0;
        data[o + 3] = alpha && k < alpha.length ? (alpha[k] ?? 255) : 255;
        continue;
      }
      const s = (n: number): number => sample(y, x * channels + n);
      if (type === 0 || type === 4) {
        const g = s(0);
        data[o] = g;
        data[o + 1] = g;
        data[o + 2] = g;
        data[o + 3] = type === 4 ? s(1) : 255;
      } else {
        data[o] = s(0);
        data[o + 1] = s(1);
        data[o + 2] = s(2);
        data[o + 3] = type === 6 ? s(3) : 255;
      }
    }
  return { width, height, data };
}

export function encodePng(img: Rgba): Buffer {
  const { width, height, data } = img;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1,
    );
  }
  const chunk = (kind: string, body: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const head = Buffer.concat([Buffer.from(kind, 'latin1'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(head));
    return Buffer.concat([len, head, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface PixelDiff {
  changed: number;
  total: number;
  /** changed / total */
  ratio: number;
  /** the screenshot faded, with what changed in red */
  image: Rgba;
  /** the smallest box around every change, or null */
  box: { x: number; y: number; w: number; h: number } | null;
}

/** The pixels of two images of one size that differ by more than the tolerance in any channel. */
export function pixelDiff(base: Rgba, next: Rgba, tolerance = 24): PixelDiff {
  if (base.width !== next.width || base.height !== next.height)
    throw new PngError(
      'The sizes differ: ' +
        String(base.width) +
        ' × ' +
        String(base.height) +
        ' against ' +
        String(next.width) +
        ' × ' +
        String(next.height),
    );
  const { width, height } = next;
  const out = new Uint8Array(width * height * 4);
  let changed = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let p = 0; p < width * height; p += 1) {
    const o = p * 4;
    let moved = false;
    for (let k = 0; k < 4; k += 1)
      if (Math.abs((base.data[o + k] ?? 0) - (next.data[o + k] ?? 0)) > tolerance) moved = true;
    if (moved) {
      changed += 1;
      const x = p % width;
      const y = (p - x) / width;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      out[o] = 230;
      out[o + 1] = 30;
      out[o + 2] = 60;
      out[o + 3] = 255;
    } else {
      // the unchanged picture, faded to a light grey
      const g =
        ((next.data[o] ?? 0) * 0.3 +
          (next.data[o + 1] ?? 0) * 0.59 +
          (next.data[o + 2] ?? 0) * 0.11) /
        255;
      const v = Math.round(255 - (1 - g) * 70);
      out[o] = v;
      out[o + 1] = v;
      out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return {
    changed,
    total: width * height,
    ratio: changed / (width * height),
    image: { width, height, data: out },
    box: x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
  };
}
