// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-189 | S15 | v0.1.0] B7.5 Portal budget and invoices with PDF, quotes, meeting booking with agenda and calendar file ──
//    Why:  invoices as PDF without a third-party library (nothing to license, nothing to audit): a small
//          writer for text and lines on A4 pages in the PDF standard fonts Helvetica and Helvetica-Bold,
//          with WinAnsi encoding so euro signs and umlauts print. Amounts are right-aligned with the
//          font's real widths for digits and punctuation.

export interface PdfText {
  x: number;
  y: number;
  size: number;
  text: string;
  bold?: boolean;
  /** right: x is where the text ends */
  align?: 'left' | 'right';
}

export interface PdfLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PdfPage {
  texts: PdfText[];
  lines?: PdfLine[];
}

export const A4 = { width: 595, height: 842 };

// Helvetica widths (per 1000) of the characters that matter for alignment; others count as 556
const WIDTH: Record<string, number> = {
  ' ': 278,
  ',': 278,
  '.': 278,
  ':': 278,
  '-': 333,
  '%': 889,
  '€': 556,
  '/': 278,
  '(': 333,
  ')': 333,
  i: 222,
  l: 222,
  I: 278,
  f: 278,
  t: 278,
  r: 333,
  m: 833,
  w: 722,
  M: 833,
  W: 944,
};

/** Width of a text in points (Helvetica; bold is a little wider). */
export function textWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of text) w += WIDTH[ch] ?? (/[0-9]/.test(ch) ? 556 : 556);
  return (w * size * (bold ? 1.05 : 1)) / 1000;
}

// WinAnsi (Windows-1252) for the characters outside Latin-1 that invoices use
const WIN: Record<string, number> = {
  '€': 0x80,
  '–': 0x96,
  '—': 0x97,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '…': 0x85,
};

/** A PDF string literal: escaped, in WinAnsi; characters it cannot show become "?". */
function pdfString(text: string): string {
  let out = '(';
  for (const ch of text) {
    const code = WIN[ch] ?? ch.charCodeAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (code > 255 || (code < 32 && ch !== '\t')) out += '?';
    else if (code > 126) out += '\\' + code.toString(8).padStart(3, '0');
    else out += String.fromCharCode(code);
  }
  return out + ')';
}

const num = (n: number): string => (Math.round(n * 100) / 100).toString();

/** The PDF bytes for some pages. */
export function pdfDocument(pages: readonly PdfPage[], title = 'Document'): Buffer {
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add('');
  const pagesObj = add('');
  const font = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  const bold = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );
  const kids: number[] = [];
  for (const p of pages) {
    const ops: string[] = [];
    for (const l of p.lines ?? [])
      ops.push(
        '0.75 G 0.5 w ' +
          num(l.x1) +
          ' ' +
          num(l.y1) +
          ' m ' +
          num(l.x2) +
          ' ' +
          num(l.y2) +
          ' l S',
      );
    for (const t of p.texts) {
      const x = t.align === 'right' ? t.x - textWidth(t.text, t.size, t.bold) : t.x;
      ops.push(
        'BT /' +
          (t.bold ? 'F2' : 'F1') +
          ' ' +
          num(t.size) +
          ' Tf ' +
          num(x) +
          ' ' +
          num(t.y) +
          ' Td ' +
          pdfString(t.text) +
          ' Tj ET',
      );
    }
    const stream = ops.join('\n');
    const content = add(
      '<< /Length ' +
        String(Buffer.byteLength(stream, 'latin1')) +
        ' >>\nstream\n' +
        stream +
        '\nendstream',
    );
    kids.push(
      add(
        '<< /Type /Page /Parent ' +
          String(pagesObj) +
          ' 0 R /MediaBox [0 0 ' +
          String(A4.width) +
          ' ' +
          String(A4.height) +
          '] /Resources << /Font << /F1 ' +
          String(font) +
          ' 0 R /F2 ' +
          String(bold) +
          ' 0 R >> >> /Contents ' +
          String(content) +
          ' 0 R >>',
      ),
    );
  }
  objects[catalog - 1] = '<< /Type /Catalog /Pages ' + String(pagesObj) + ' 0 R >>';
  objects[pagesObj - 1] =
    '<< /Type /Pages /Kids [' +
    kids.map((k) => String(k) + ' 0 R').join(' ') +
    '] /Count ' +
    String(kids.length) +
    ' >>';
  const info = add('<< /Title ' + pdfString(title) + ' /Producer (Orqiva) >>');
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += String(i + 1) + ' 0 obj\n' + body + '\nendobj\n';
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + String(objects.length + 1) + '\n0000000000 65535 f \n';
  for (const o of offsets) out += String(o).padStart(10, '0') + ' 00000 n \n';
  out +=
    'trailer\n<< /Size ' +
    String(objects.length + 1) +
    ' /Root ' +
    String(catalog) +
    ' 0 R /Info ' +
    String(info) +
    ' 0 R >>\nstartxref\n' +
    String(xref) +
    '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}
