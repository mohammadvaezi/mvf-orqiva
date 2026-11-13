// ── [PCODE-144 | S15 | v0.1.0] Export evidence packs with one click ──
//    Why:  evidence packs are ZIP files any auditor can open. This writes the format (PKWARE APPNOTE 6.3)
//          ourselves: local headers, data compressed with Node's built-in raw deflate, the central
//          directory and its end record, UTF-8 names. Our own CRC-32 checks each file, as the format asks.
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE 802.3), as ZIP uses it. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = (TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Date and time in the DOS form ZIP stores them in. */
function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** A ZIP archive of the entries, compressed with deflate. */
export function zip(entries: ZipEntry[], when = new Date()): Buffer {
  const { time, date } = dosTime(when);
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const packed = deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, packed);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(0x031e, 4); // made by: Unix, 3.0
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(e.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comment
    dir.writeUInt16LE(0, 34); // disk
    dir.writeUInt16LE(0, 36); // internal attributes
    dir.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a regular file, rw-r--r--
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += local.length + name.length + packed.length;
  }
  const dirBytes = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBytes, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, ...central, end]);
}

/** Reads a ZIP written by zip(): names and contents (for tests and checks). */
export function unzip(buf: Buffer): ZipEntry[] {
  const endAt = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error('not a ZIP file');
  const count = buf.readUInt16LE(endAt + 10);
  let at = buf.readUInt32LE(endAt + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    const size = buf.readUInt32LE(at + 20);
    const localName = buf.readUInt16LE(local + 26);
    const localExtra = buf.readUInt16LE(local + 28);
    const start = local + 30 + localName + localExtra;
    out.push({ name, data: inflateRawSync(buf.subarray(start, start + size)) });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
