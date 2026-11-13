// ── [PCODE-293 | S15 | v0.1.0] T30.7 Generated asset sizes and a download portal ──
//    Why:  the pixel size of an uploaded size is read from its header, for every format the browser makes.
import { describe, expect, it } from 'vitest';
import { imageSize } from '../src/files/imagesize.js';

describe('image sizes from the header', () => {
  it('reads PNG, GIF, JPEG and the three WebP kinds, and nothing else', () => {
    const png = Buffer.alloc(24);
    png.writeUInt32BE(0x89504e47, 0);
    png.write('IHDR', 12, 'latin1');
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(imageSize(png)).toEqual({ format: 'png', width: 640, height: 480 });

    const gif = Buffer.from('GIF89a\x20\x00\x10\x00', 'latin1');
    expect(imageSize(gif)).toEqual({ format: 'gif', width: 32, height: 16 });

    // SOI, an APP0 of 16 bytes, then SOF0 with height 300 and width 200
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      Buffer.alloc(14),
      Buffer.from([0xff, 0xc4, 0x00, 0x04, 0x00, 0x00]), // a DHT is no frame
      Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x00, 0xc8, 0x03]),
      Buffer.alloc(8),
    ]);
    expect(imageSize(jpeg)).toEqual({ format: 'jpeg', width: 200, height: 300 });

    const riff = (chunk: string, body: Buffer): Buffer =>
      Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP' + chunk, 'latin1'), body]);
    const lossy = Buffer.alloc(14);
    lossy.writeUInt16LE(1200, 10);
    lossy.writeUInt16LE(630, 12);
    expect(imageSize(riff('VP8 ', lossy))).toEqual({ format: 'webp', width: 1200, height: 630 });
    const lossless = Buffer.alloc(14);
    lossless.writeUInt32LE((512 - 1) | ((256 - 1) << 14), 5);
    expect(imageSize(riff('VP8L', lossless))).toEqual({ format: 'webp', width: 512, height: 256 });
    const ext = Buffer.alloc(14);
    ext.writeUIntLE(99, 8, 3);
    ext.writeUIntLE(49, 11, 3);
    expect(imageSize(riff('VP8X', ext))).toEqual({ format: 'webp', width: 100, height: 50 });

    expect(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(imageSize(Buffer.alloc(0))).toBeNull();
  });
});
