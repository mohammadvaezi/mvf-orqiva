// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
//    Why:  the app icons a phone or desktop installs, drawn at build time from the same geometry as the
//          Logo in icons.tsx (a P on a tile with a live dot) and written as PNG with Node's zlib: no image
//          tool needed. "any" icons keep the rounded tile; the maskable one fills the square and keeps the
//          mark inside the safe circle, so launchers may cut any shape from it.
import { crc32, deflateSync } from 'node:zlib';

const TILE = [0x4b, 0x3f, 0xce];
const MARK = [0xff, 0xff, 0xff];
const DOT = [0x16, 0xc7, 0x9a];

const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/** The P stroke: down the stem, along the top, round the bowl, back to the stem. */
function pDist(x, y) {
  let d = Math.min(
    segDist(x, y, 10, 22, 10, 10),
    segDist(x, y, 10, 10, 16.5, 10),
    segDist(x, y, 16.5, 19, 10, 19),
  );
  if (x >= 16.5) d = Math.min(d, Math.abs(Math.hypot(x - 16.5, y - 14.5) - 4.5));
  return d;
}

function inRoundedRect(x, y, x0, y0, w, h, r) {
  const cx = Math.max(x0 + r, Math.min(x, x0 + w - r));
  const cy = Math.max(y0 + r, Math.min(y, y0 + h - r));
  return x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h && Math.hypot(x - cx, y - cy) <= r;
}

/** The colour at a point of the 32-unit design, or null outside the tile. */
function colourAt(x, y, maskable) {
  if (!maskable && !inRoundedRect(x, y, 1, 1, 30, 30, 8)) return null;
  // the maskable icon shrinks the mark to the middle 70 %
  const s = maskable ? 0.7 : 1;
  const u = 16 + (x - 16) / s;
  const v = 16 + (y - 16) / s;
  if (Math.hypot(u - 22.5, v - 22.5) <= 2.6) return DOT;
  if (pDist(u, v) <= 1.3) return MARK;
  return TILE;
}

/** RGBA pixels, four by four samples per pixel for smooth edges. */
function render(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const n = 4;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sj = 0; sj < n; sj++)
        for (let si = 0; si < n; si++) {
          const c = colourAt(
            ((i + (si + 0.5) / n) * 32) / size,
            ((j + (sj + 0.5) / n) * 32) / size,
            maskable,
          );
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a++;
        }
      const o = (j * size + i) * 4;
      if (a) {
        px[o] = Math.round(r / a);
        px[o + 1] = Math.round(g / a);
        px[o + 2] = Math.round(b / a);
      }
      px[o + 3] = Math.round((a / (n * n)) * 255);
    }
  return px;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A PNG (RFC 2083): 8-bit RGBA, each row with filter 0. */
export function png(size, maskable = false) {
  const px = render(size, maskable);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let j = 0; j < size; j++)
    px.copy(raw, j * (size * 4 + 1) + 1, j * size * 4, (j + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The same mark as SVG, for browsers that take it (favicon). */
export const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect x="1" y="1" width="30" height="30" rx="8" fill="#4b3fce"/>' +
  '<path d="M10 22V10h6.5a4.5 4.5 0 0 1 0 9H10" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<circle cx="22.5" cy="22.5" r="2.6" fill="#16c79a"/></svg>\n';
