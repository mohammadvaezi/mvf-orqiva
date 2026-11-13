// ── [PCODE-275 | S15 | v0.1.0] T28.4 PRD: templates per idea kind, citations per statement, version diff, MD, PDF and Word export ──
//    Why:  a PRD goes to people who live in Word, so it is written as a .docx of our own: a ZIP of a few XML
//          parts (content types, relationships, the document, its styles, its title), no dependency. The
//          input is the Markdown the other exports use, read for the little it holds: headings, paragraphs,
//          bullet lines, a table, bold and italic runs. Word's own styles (Title, Heading 1–3, List Bullet)
//          carry the look, so the document follows the reader's theme.
import { zip } from './zip.js';

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // characters XML 1.0 does not allow
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** Markdown's escapes undone: what the reader should see. */
const plain = (s: string): string => s.replace(/\\([\\*_`<>#|[\]])/g, '$1');

/** Runs of a line: **bold** and _italic_ parts, the rest plain. */
export function runs(line: string): string {
  const out: string[] = [];
  const re = /\*\*(.+?)\*\*|(?<![\w\\])_(.+?)_(?!\w)/g;
  let at = 0;
  const run = (text: string, props = ''): void => {
    if (text)
      out.push(
        '<w:r>' +
          (props ? '<w:rPr>' + props + '</w:rPr>' : '') +
          '<w:t xml:space="preserve">' +
          esc(plain(text)) +
          '</w:t></w:r>',
      );
  };
  for (const m of line.matchAll(re)) {
    run(line.slice(at, m.index));
    if (m[1] !== undefined) run(m[1], '<w:b/>');
    else run(m[2] ?? '', '<w:i/>');
    at = m.index + m[0].length;
  }
  run(line.slice(at));
  return out.join('');
}

const para = (style: string, body: string): string =>
  '<w:p>' + (style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : '') + body + '</w:p>';

const cell = (text: string, header: boolean, right: boolean): string =>
  '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>' +
  (right ? '<w:pPr><w:jc w:val="right"/></w:pPr>' : '') +
  runs(header ? '**' + text + '**' : text) +
  '</w:p></w:tc>';

/** The document body from Markdown lines. */
export function wordBody(markdown: string): string {
  const lines = markdown.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let i = 0;
  let first = true;
  while (i < lines.length) {
    const l = lines[i] ?? '';
    if (/^\|.*\|\s*$/.test(l)) {
      const rows: string[][] = [];
      let align: boolean[] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i] ?? '')) {
        const cells = (lines[i] ?? '')
          .trim()
          .slice(1, -1)
          .split(/(?<!\\)\|/)
          .map((x) => x.trim());
        if (cells.every((x) => /^:?-{3,}:?$/.test(x))) align = cells.map((x) => x.endsWith(':'));
        else rows.push(cells);
        i++;
      }
      out.push(
        '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr>' +
          rows
            .map(
              (r, n) =>
                '<w:tr>' +
                r.map((x, k) => cell(x, n === 0, align[k] ?? false)).join('') +
                '</w:tr>',
            )
            .join('') +
          '</w:tbl>',
      );
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) {
      const level = (h[1] ?? '#').length;
      out.push(para(first && level === 1 ? 'Title' : 'Heading' + String(level), runs(h[2] ?? '')));
    } else if (/^- /.test(l)) out.push(para('ListBullet', runs(l.slice(2))));
    else if (l.trim()) out.push(para('', runs(l)));
    first = false;
    i++;
  }
  return out.join('');
}

const TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '</Types>';

const RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '</Relationships>';

const DOC_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>';

const style = (id: string, name: string, ppr: string, rpr: string): string =>
  '<w:style w:type="paragraph" w:styleId="' +
  id +
  '"><w:name w:val="' +
  name +
  '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
  (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') +
  (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') +
  '</w:style>';

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  style('Title', 'Title', '<w:spacing w:after="80"/>', '<w:b/><w:sz w:val="40"/>') +
  style(
    'Heading1',
    'heading 1',
    '<w:keepNext/><w:spacing w:before="280" w:after="80"/><w:outlineLvl w:val="0"/>',
    '<w:b/><w:sz w:val="30"/>',
  ) +
  style(
    'Heading2',
    'heading 2',
    '<w:keepNext/><w:spacing w:before="240" w:after="60"/><w:outlineLvl w:val="1"/>',
    '<w:b/><w:sz w:val="26"/>',
  ) +
  style(
    'Heading3',
    'heading 3',
    '<w:keepNext/><w:spacing w:before="160" w:after="40"/><w:outlineLvl w:val="2"/>',
    '<w:b/><w:sz w:val="22"/>',
  ) +
  style(
    'ListBullet',
    'List Bullet',
    '<w:spacing w:after="40"/><w:ind w:left="360" w:hanging="240"/>',
    '',
  ) +
  '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((b) => '<w:' + b + ' w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>')
    .join('') +
  '</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
  '</w:styles>';

/** A Word document from the Markdown of a PRD; bullet lines get a bullet sign. */
export function markdownDocx(markdown: string, title: string, when = new Date()): Buffer {
  const withBullets = markdown.replace(/^- /gm, '- • ');
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    wordBody(withBullets) +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>';
  const core =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:title>' +
    esc(title) +
    '</dc:title><dc:creator>Orqiva</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' +
    when.toISOString().replace(/\.\d+Z$/, 'Z') +
    '</dcterms:created></cp:coreProperties>';
  return zip(
    [
      { name: '[Content_Types].xml', data: Buffer.from(TYPES, 'utf8') },
      { name: '_rels/.rels', data: Buffer.from(RELS, 'utf8') },
      { name: 'word/document.xml', data: Buffer.from(document, 'utf8') },
      { name: 'word/_rels/document.xml.rels', data: Buffer.from(DOC_RELS, 'utf8') },
      { name: 'word/styles.xml', data: Buffer.from(STYLES, 'utf8') },
      { name: 'docProps/core.xml', data: Buffer.from(core, 'utf8') },
    ],
    when,
  );
}
