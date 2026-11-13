// ── [PCODE-241 | S15 | v0.1.0] T24.2 Reading files through the models: PDF, DOCX, images, audio ──
//    Why:  a Word file's text is read on the server: paragraphs, bold runs, tabs, line breaks, tables and
//          footnotes come out as plain text; tab stops of the layout do not; files that are not Word files,
//          and archives that would unpack into gigabytes, are refused with a reason.
import { describe, expect, it } from 'vitest';
import { docxText, DocxError, wordXmlText } from '../src/files/docx.js';
import { readMethodOf } from '../src/files/reading.js';
import { sampleDocx, zip } from './docxfile.js';

describe('Word files', () => {
  it('reads paragraphs, tables and footnotes into plain text', () => {
    expect(docxText(sampleDocx())).toBe(
      [
        'Booking export',
        'The export must include cancelled appointments & their reason.\tOwner: Ines',
        'Due: 31 Oct',
        'Field\tFormat',
        'Date\tDD.MM.YYYY',
        '',
        'See the GDPR note – 2026.',
      ].join('\n'),
    );
  });

  it('decodes entities and ignores everything that is not text', () => {
    expect(
      wordXmlText(
        '<w:p><w:r><w:instrText>PAGE</w:instrText><w:t>a &lt; b &#x2264; c &quot;d&quot;</w:t></w:r></w:p>',
      ),
    ).toBe('a < b ≤ c "d"');
  });

  it('refuses what is not a Word file', () => {
    expect(() => docxText(Buffer.from('%PDF-1.7 not a zip'))).toThrow(DocxError);
    expect(() => docxText(zip({ 'xl/workbook.xml': '<x/>' }))).toThrow('no word/document.xml');
  });

  it('knows which files are read and how', () => {
    expect(readMethodOf('spec.docx', 'application/octet-stream')).toBe('docx');
    expect(readMethodOf('scan.pdf', 'application/pdf')).toBe('pdf');
    expect(readMethodOf('shot.png', 'image/png')).toBe('image');
    expect(readMethodOf('call.m4a', 'audio/mp4')).toBe('audio');
    expect(readMethodOf('call.mp3', 'application/octet-stream')).toBe('audio');
    expect(readMethodOf('demo.mp4', 'video/mp4')).toBe('audio');
    expect(readMethodOf('logo.svg', 'image/svg+xml')).toBeNull();
    expect(readMethodOf('notes.zip', 'application/zip')).toBeNull();
  });
});
