// ── [PCODE-293 | S15 | v0.1.0] T30.7 Generated asset sizes and a download portal ──
//    Why:  a generated size is kept only when the file really is that image: its format and pixel size are
//          read from the header (PNG, GIF, JPEG, WebP), not taken from what the browser says.

export interface ImageSize {
  format: 'png' | 'gif' | 'jpeg' | 'webp';
  width: number;
  height: number;
}

export function imageSize(b: Buffer): ImageSize | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('latin1', 12, 16) === 'IHDR')
    return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length >= 10 && b.toString('latin1', 0, 3) === 'GIF')
    return { format: 'gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (
    b.length >= 30 &&
    b.toString('latin1', 0, 4) === 'RIFF' &&
    b.toString('latin1', 8, 12) === 'WEBP'
  ) {
    const chunk = b.toString('latin1', 12, 16);
    if (chunk === 'VP8 ' && b.length >= 30)
      return {
        format: 'webp',
        width: b.readUInt16LE(26) & 0x3fff,
        height: b.readUInt16LE(28) & 0x3fff,
      };
    if (chunk === 'VP8L' && b.length >= 25) {
      const bits = b.readUInt32LE(21);
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X')
      return { format: 'webp', width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1] ?? 0;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const len = b.readUInt16BE(i + 2);
      // a start of frame (not the DHT, JPG or DAC markers that share the range)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { format: 'jpeg', width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}
