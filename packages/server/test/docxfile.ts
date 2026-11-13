// ── [PCODE-241 | S15 | v0.1.0] T24.2 Reading files through the models: PDF, DOCX, images, audio ──
//    Why:  tests need real Word files: a ZIP archive with word/document.xml, written here with deflate
//          like Word writes it, so the reader is checked against the format and not against itself.
import { crc32, deflateRawSync } from 'node:zlib';

/** A ZIP archive of the given entries, deflated. */
export function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text, 'utf8');
    const packed = deflateRawSync(data);
    const n = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, packed);
    centrals.push(central, n);
    offset += 30 + n.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** A Word file with a heading, a paragraph with a tab and a break, a table, and a footnote. */
export function sampleDocx(): Buffer {
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Booking export</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">The export </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>must</w:t></w:r><w:r><w:t xml:space="preserve"> include cancelled appointments &amp; their reason.</w:t></w:r><w:r><w:tab/><w:t>Owner: Ines</w:t><w:br/><w:t>Due: 31 Oct</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Field</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Format</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Date</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>DD.MM.YYYY</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:sectPr/></w:body></w:document>`;
  const notes = `<?xml version="1.0" encoding="UTF-8"?><w:footnotes ${W}><w:footnote w:id="1"><w:p><w:r><w:t>See the GDPR note &#8211; 2026.</w:t></w:r></w:p></w:footnote></w:footnotes>`;
  return zip({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': doc,
    'word/footnotes.xml': notes,
  });
}
