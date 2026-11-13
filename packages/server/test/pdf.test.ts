// ── [PCODE-189 | S15 | v0.1.0] B7.5 Portal budget and invoices with PDF, quotes, meeting booking with agenda and calendar file ──
//    Why:  the PDF writer makes files readers accept: every cross-reference points at its object, special
//          characters are escaped, euro signs use WinAnsi, and right-aligned amounts end where they should.
import { describe, expect, it } from 'vitest';
import { meetingIcs, money } from '../src/api/invoices.js';
import { pdfDocument, textWidth } from '../src/lib/pdf.js';

const BS = '\\';

describe('pdf writer', () => {
  it('writes objects whose offsets match the cross-reference table', () => {
    const pdf = pdfDocument(
      [
        {
          texts: [{ x: 50, y: 800, size: 12, text: 'Grüße (A) ' + BS + ' 1.286,00 €' }],
          lines: [{ x1: 50, y1: 790, x2: 300, y2: 790 }],
        },
      ],
      'Test',
    ).toString('latin1');
    const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const entries = pdf
      .slice(xrefAt)
      .split('\n')
      .filter((l) => / n $/.test(l));
    expect(entries.length).toBeGreaterThan(4);
    entries.forEach((e, i) => {
      const off = Number(e.slice(0, 10));
      const head = String(i + 1) + ' 0 obj';
      expect(pdf.slice(off, off + head.length)).toBe(head);
    });
    const expected =
      '(Gr' +
      BS +
      '374' +
      BS +
      '337e ' +
      BS +
      '(A' +
      BS +
      ') ' +
      BS +
      BS +
      ' 1.286,00 ' +
      BS +
      '200)';
    expect(pdf).toContain(expected);
  });

  it('measures digits for right alignment, formats money and calendar files', () => {
    expect(textWidth('1.286,00', 10)).toBeCloseTo(((6 * 556 + 2 * 278) * 10) / 1000);
    expect(money(128600)).toBe('1.286,00 €');
    const ics = meetingIcs({
      id: 'm1',
      title: 'Review, with Helio',
      startsAt: new Date('2026-10-07T08:00:00Z'),
      minutes: 45,
      agenda: 'Line one\nLine two',
      videoUrl: '',
    });
    expect(ics).toContain('DTSTART:20261007T080000Z\r\nDTEND:20261007T084500Z');
    expect(ics).toContain('SUMMARY:Review' + BS + ', with Helio');
    expect(ics).toContain('DESCRIPTION:Line one' + BS + 'nLine two');
  });
});
