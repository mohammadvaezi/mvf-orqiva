// ── [PCODE-241 | S15 | v0.1.0] T24.2 Reading files through the models: PDF, DOCX, images, audio ──
//    Why:  a Word file is a ZIP archive whose text sits in word/document.xml, so its text needs no model:
//          the archive's central directory names each entry, the entry is inflated (with a cap, so a small
//          file cannot unpack into gigabytes), and the paragraphs, table cells, tabs and line breaks of the
//          XML become plain text. Footnotes, endnotes, headers and footers follow the body.
import { inflateRawSync } from 'node:zlib';

/** The largest entry we unpack: far beyond any real document's XML. */
const MAX_ENTRY = 50 * 1024 * 1024;

export class DocxError extends Error {}

interface Entry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

/** The entries of a ZIP archive, from its central directory. */
export function zipEntries(buf: Buffer): Entry[] {
  // the end-of-central-directory record is in the last 64 KiB plus 22 bytes
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new DocxError('This is not a Word file (no ZIP directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50)
      throw new DocxError('The Word file is damaged (central directory)');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    out.push({
      method: buf.readUInt16LE(p + 10),
      compressed: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      offset: buf.readUInt32LE(p + 42),
      name: buf.toString('utf8', p + 46, p + 46 + nameLen),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** One entry's bytes, inflated. */
export function zipRead(buf: Buffer, e: Entry): Buffer {
  const h = e.offset;
  if (h + 30 > buf.length || buf.readUInt32LE(h) !== 0x04034b50)
    throw new DocxError('The Word file is damaged (entry ' + e.name + ')');
  const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
  const data = buf.subarray(start, start + e.compressed);
  if (e.size > MAX_ENTRY) throw new DocxError('The Word file unpacks to more than 50 MB');
  if (e.method === 0) return data;
  if (e.method !== 8) throw new DocxError('The Word file uses an unknown compression');
  return inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === '#'
      ? String.fromCodePoint(
          e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
        )
      : (ENTITIES[e] ?? m),
  );

/** WordprocessingML to text: paragraphs and rows end lines, cells and tabs are tabs. */
export function wordXmlText(xml: string): string {
  const out: string[] = [];
  const tag = /<(\/?)(w:[A-Za-z]+)\b[^>]*?(\/?)>|([^<]+)/g;
  let inText = false;
  let inTabs = false;
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    const [, close, name, self, text] = m;
    if (text !== undefined) {
      if (inText) out.push(decode(text));
      continue;
    }
    if (name === 'w:t') inText = !close && !self;
    // tab stops of a paragraph's layout are w:tab elements too, inside w:tabs
    else if (name === 'w:tabs') inTabs = !close && !self;
    else if (!close && !inTabs && (name === 'w:tab' || name === 'w:ptab')) out.push('\t');
    else if (!close && (name === 'w:br' || name === 'w:cr')) out.push('\n');
    else if (close && name === 'w:p') out.push('\n');
    // a cell's last paragraph ends the cell, not the line; the row ends the line
    else if (close && name === 'w:tc') {
      if (out[out.length - 1] === '\n') out.pop();
      out.push('\t');
    } else if (close && name === 'w:tr') {
      if (out[out.length - 1] === '\t') out.pop();
      out.push('\n');
    }
  }
  return out
    .join('')
    .replace(/\t+\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const PARTS = [
  /^word\/document\.xml$/,
  /^word\/footnotes\.xml$/,
  /^word\/endnotes\.xml$/,
  /^word\/header\d*\.xml$/,
  /^word\/footer\d*\.xml$/,
];

/** The text of a .docx file. */
export function docxText(buf: Buffer): string {
  const entries = zipEntries(buf);
  if (!entries.some((e) => e.name === 'word/document.xml'))
    throw new DocxError('This is not a Word file (no word/document.xml)');
  const parts: string[] = [];
  for (const re of PARTS)
    for (const e of entries
      .filter((x) => re.test(x.name))
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const text = wordXmlText(zipRead(buf, e).toString('utf8'));
      if (text) parts.push(text);
    }
  return parts.join('\n\n');
}
