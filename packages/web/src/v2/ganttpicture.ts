// ── [PCODE-410 | S15 | v0.1.0] T36.5 Security pass ──
// ── [PCODE-264 | S15 | v0.1.0] T27.6 Canvas pictures and sharing: PNG and PDF with page fitting, read-only share link with iCal subscription ──
//    Why:  the Gantt leaves the app as a picture for slides, mails and print: one standalone SVG (names, WBS,
//          bars, links, milestones, today, the axis, with its colours inside so it looks the same anywhere),
//          turned into a PNG in the browser, or laid on A4 or A3 pages for the browser's print to PDF. The
//          page fitting is plain arithmetic, tested on its own.
import type { PlanData } from './canvas.js';
import { axisTicks, dayWidth, ganttSpan, type Zoom } from './gantt.js';

const DAY = 86_400_000;
const ROW = 24;
const HEAD = 40;
const NAMES = 300;
const t0 = (iso: string): number => Date.parse(iso + 'T00:00:00Z');
const daysBetween = (a: string, b: string): number => Math.round((t0(b) - t0(a)) / DAY);
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number): string => String(Math.round(v * 10) / 10);

const C = {
  text: '#1d1b2e',
  muted: '#6b6a80',
  line: '#e4e3ec',
  bar: '#d9d6f7',
  done: '#5b4fe0',
  crit: '#f6d4d0',
  critDone: '#d0453a',
  weekend: '#f5f4f9',
  today: '#5b4fe0',
};

/** The Gantt as one standalone SVG: the task names on the left, the schedule on the right. */
export function ganttSvg(
  plan: Pick<
    PlanData,
    'tasks' | 'schedule' | 'dependencies' | 'start' | 'finish' | 'today' | 'workingDays'
  >,
  opts: { zoom: Zoom; title: string; critical: boolean },
): { svg: string; width: number; height: number } {
  const dw = Math.max(dayWidth(opts.zoom), opts.zoom === 'day' ? 18 : 0.5);
  const range = ganttSpan(plan, opts.zoom);
  const chart = Math.ceil(range.days * dw);
  const width = NAMES + chart;
  const top = 34;
  const height = top + HEAD + plan.schedule.length * ROW + 10;
  const task = new Map(plan.tasks.map((t) => [t.id, t]));
  const index = new Map(plan.schedule.map((s, i) => [s.id, i]));
  const x = (d: string): number => NAMES + daysBetween(range.from, d) * dw;
  const y = (i: number): number => top + HEAD + i * ROW;
  const end = (s: { finish: string; milestone: boolean }): number =>
    x(s.finish) + (s.milestone ? 0 : dw);
  const ticks = axisTicks(opts.zoom, range.from, range.days);
  const out: string[] = [];
  out.push(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      String(width) +
      '" height="' +
      String(height) +
      '" viewBox="0 0 ' +
      String(width) +
      ' ' +
      String(height) +
      '" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-size="11">',
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    '<text x="12" y="22" font-size="15" font-weight="650" fill="' +
      C.text +
      '">' +
      esc(opts.title) +
      '</text>',
  );
  if (opts.zoom === 'day' || opts.zoom === 'week')
    for (let i = 0; i < range.days; i++) {
      const d = new Date(t0(range.from) + i * DAY);
      const wd = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getUTCDay()] ?? '';
      if (!plan.workingDays.includes(wd))
        out.push(
          '<rect x="' +
            n(NAMES + i * dw) +
            '" y="' +
            String(top + HEAD) +
            '" width="' +
            n(dw) +
            '" height="' +
            String(height - top - HEAD) +
            '" fill="' +
            C.weekend +
            '"/>',
        );
    }
  for (const i of ticks.lines)
    out.push(
      '<line x1="' +
        n(NAMES + i * dw) +
        '" x2="' +
        n(NAMES + i * dw) +
        '" y1="' +
        String(top + 14) +
        '" y2="' +
        String(height) +
        '" stroke="' +
        C.line +
        '"/>',
    );
  for (const t of ticks.top)
    out.push(
      '<text x="' +
        n(NAMES + t.i * dw + 3) +
        '" y="' +
        String(top + 12) +
        '" fill="' +
        C.muted +
        '">' +
        esc(t.label) +
        '</text>',
    );
  for (const t of ticks.bottom)
    if (ticks.lines.includes(t.i) || opts.zoom !== 'day')
      out.push(
        '<text x="' +
          n(NAMES + t.i * dw + 3) +
          '" y="' +
          String(top + 30) +
          '" fill="' +
          C.text +
          '" font-weight="600">' +
          esc(t.label) +
          '</text>',
      );
  out.push(
    '<line x1="0" x2="' +
      String(width) +
      '" y1="' +
      String(top + HEAD) +
      '" y2="' +
      String(top + HEAD) +
      '" stroke="' +
      C.line +
      '"/>',
    '<line x1="' +
      String(NAMES) +
      '" x2="' +
      String(NAMES) +
      '" y1="' +
      String(top) +
      '" y2="' +
      String(height) +
      '" stroke="' +
      C.line +
      '"/>',
    '<text x="12" y="' + String(top + 30) + '" fill="' + C.muted + '" font-weight="600">WBS</text>',
    '<text x="56" y="' +
      String(top + 30) +
      '" fill="' +
      C.muted +
      '" font-weight="600">Task</text>',
  );
  // the links under the bars
  for (const d of plan.dependencies) {
    const i = index.get(d.successorId);
    const j = index.get(d.predecessorId);
    const to = i !== undefined ? plan.schedule[i] : undefined;
    const from = j !== undefined ? plan.schedule[j] : undefined;
    if (!to || !from || i === undefined || j === undefined) continue;
    const startSide = d.kind === 'SS' || d.kind === 'SF';
    const x1 = startSide ? x(from.start) : end(from);
    const x2 = d.kind === 'FF' || d.kind === 'SF' ? end(to) : x(to.start) - 1;
    const bend = startSide ? x1 - 5 : x1 + 5;
    const crit = opts.critical && to.critical && from.critical;
    out.push(
      '<path d="M' +
        n(x1) +
        ' ' +
        n(y(j) + ROW / 2) +
        ' H' +
        n(bend) +
        ' V' +
        n(y(i) + ROW / 2) +
        ' H' +
        n(x2) +
        '" fill="none" stroke="' +
        (crit ? C.critDone : C.muted) +
        '" stroke-width="1"/>',
      '<path d="M' +
        n(x2) +
        ' ' +
        n(y(i) + ROW / 2) +
        ' l-5 -3 v6z" fill="' +
        (crit ? C.critDone : C.muted) +
        '"/>',
    );
  }
  plan.schedule.forEach((s, i) => {
    const t = task.get(s.id);
    const cy = y(i) + ROW / 2;
    const name =
      (t?.title ?? '').length > 40 ? (t?.title ?? '').slice(0, 39) + '…' : (t?.title ?? '');
    out.push(
      '<text x="12" y="' + n(cy + 4) + '" fill="' + C.muted + '">' + esc(s.wbs) + '</text>',
      '<text x="' +
        String(56 + Math.min(3, s.level) * 12) +
        '" y="' +
        n(cy + 4) +
        '" fill="' +
        C.text +
        '"' +
        (s.summary ? ' font-weight="650"' : '') +
        '>' +
        esc(name) +
        '</text>',
    );
    const crit = opts.critical && s.critical;
    if (s.milestone)
      out.push(
        '<path d="M' +
          n(x(s.start)) +
          ' ' +
          n(cy - 7) +
          ' l7 7 -7 7 -7 -7z" fill="' +
          (crit ? C.critDone : C.text) +
          '"/>',
      );
    else if (s.summary)
      out.push(
        '<path d="M' +
          n(x(s.start)) +
          ' ' +
          n(cy + 4) +
          ' V' +
          n(cy - 4) +
          ' H' +
          n(end(s)) +
          ' V' +
          n(cy + 4) +
          ' l-4 -3 H' +
          n(x(s.start) + 4) +
          'z" fill="' +
          C.text +
          '"/>',
      );
    else {
      const parts = s.segments?.length ? s.segments : [{ start: s.start, finish: s.finish }];
      // the pauses of a split task, dotted
      for (let k = 1; k < parts.length; k++)
        out.push(
          '<line x1="' +
            n(end({ finish: parts[k - 1]?.finish ?? s.start, milestone: false })) +
            '" x2="' +
            n(x(parts[k]?.start ?? s.start)) +
            '" y1="' +
            n(cy) +
            '" y2="' +
            n(cy) +
            '" stroke="' +
            C.muted +
            '" stroke-dasharray="2 3"/>',
        );
      for (const p of parts) {
        const px = x(p.start);
        const pw = Math.max(3, end({ finish: p.finish, milestone: false }) - px);
        out.push(
          '<rect x="' +
            n(px) +
            '" y="' +
            n(cy - 6) +
            '" width="' +
            n(pw) +
            '" height="12" rx="3" fill="' +
            (crit ? C.crit : C.bar) +
            '"/>',
        );
      }
      const full = end(s) - x(s.start);
      out.push(
        '<rect x="' +
          n(x(s.start)) +
          '" y="' +
          n(cy - 6) +
          '" width="' +
          n((full * s.percentDone) / 100) +
          '" height="12" rx="3" fill="' +
          (crit ? C.critDone : C.done) +
          '"/>',
      );
    }
    if (!s.summary)
      out.push(
        '<text x="' +
          n(end(s) + (s.milestone ? 10 : 5)) +
          '" y="' +
          n(cy + 4) +
          '" fill="' +
          C.muted +
          '">' +
          (s.milestone ? esc(s.start) : String(s.percentDone) + ' %') +
          '</text>',
      );
  });
  const tx = x(plan.today);
  if (tx >= NAMES)
    out.push(
      '<line x1="' +
        n(tx) +
        '" x2="' +
        n(tx) +
        '" y1="' +
        String(top + 14) +
        '" y2="' +
        String(height) +
        '" stroke="' +
        C.today +
        '" stroke-dasharray="4 3" stroke-width="1.5"/>',
    );
  out.push('</svg>');
  return { svg: out.join(''), width, height };
}

export type Paper = 'a4' | 'a3';
export type Orientation = 'landscape' | 'portrait';
export type Fit = 'page' | 'width';
const PAPER: Record<Paper, [number, number]> = { a4: [297, 210], a3: [420, 297] };

/**
 * How a picture of w × h CSS pixels lands on paper with 10 mm margins: on one page, or as wide as the page
 * across as many pages down as it needs (never larger than life).
 */
export function fitPages(
  w: number,
  h: number,
  paper: Paper,
  orientation: Orientation,
  fit: Fit,
): { scale: number; pages: number; pageWidth: number; pageHeight: number } {
  const [long, short] = PAPER[paper];
  const [mmW, mmH] = orientation === 'landscape' ? [long, short] : [short, long];
  const px = (mm: number): number => ((mm - 20) * 96) / 25.4;
  const pageWidth = px(mmW);
  const pageHeight = px(mmH);
  const scale = Math.min(
    1,
    fit === 'page' ? Math.min(pageWidth / w, pageHeight / h) : pageWidth / w,
  );
  return {
    scale,
    pages: Math.max(1, Math.ceil((h * scale) / pageHeight - 1e-9)),
    pageWidth,
    pageHeight,
  };
}

/** The page rules for printing: the paper, its margins, and only the picture on it. */
export function printCss(paper: Paper, orientation: Orientation): string {
  return (
    '@page { size: ' +
    paper.toUpperCase() +
    ' ' +
    orientation +
    '; margin: 10mm; } ' +
    '@media print { body > *:not(#pv-print) { display: none !important; } ' +
    '#pv-print { display: block !important; } #pv-print svg { display: block; break-inside: auto; } } ' +
    '@media screen { #pv-print { display: none; } }'
  );
}

/** The picture at the size it gets on paper. */
export function scaledSvg(
  pic: { svg: string; width: number; height: number },
  scale: number,
): string {
  return pic.svg.replace(
    /^<svg ([^>]*?)width="\d+" height="\d+"/,
    '<svg $1width="' +
      String(Math.floor(pic.width * scale)) +
      '" height="' +
      String(Math.floor(pic.height * scale)) +
      '"',
  );
}

/** Draws the picture at twice its size and saves it as a PNG file. */
export async function downloadPng(
  pic: { svg: string; width: number; height: number },
  name: string,
): Promise<void> {
  // a data address: the app's content policy lets images come from data, not from blobs
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pic.svg);
  {
    const img = new Image();
    await new Promise<void>((ok, fail) => {
      img.onload = () => {
        ok();
      };
      img.onerror = () => {
        fail(new Error('the picture could not be drawn'));
      };
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    // browsers stop drawing beyond about 16 000 pixels a side
    const scale = Math.min(2, 16000 / Math.max(pic.width, pic.height));
    canvas.width = Math.floor(pic.width * scale);
    canvas.height = Math.floor(pic.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((ok) => {
      canvas.toBlob(ok, 'image/png');
    });
    if (!blob) throw new Error('the picture could not be saved');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(a.href);
    }, 5000);
  }
}

/**
 * Prints the picture from this page (the browser's print saves a PDF): the picture goes into a print-only
 * part, the page rules come as a constructed style sheet (the content policy allows those), and both go
 * once the print dialog closes.
 */
export function printPdf(
  pic: { svg: string; width: number; height: number },
  paper: Paper,
  orientation: Orientation,
  fit: Fit,
): void {
  const f = fitPages(pic.width, pic.height, paper, orientation, fit);
  const box = document.createElement('div');
  box.id = 'pv-print';
  // [PCODE-410 | S15 | v0.1.0] pe-scan: ignore js/html-injection -- our own SVG; every title and name in it passes esc()
  box.innerHTML = scaledSvg(pic, f.scale);
  document.body.appendChild(box);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(printCss(paper, orientation));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const done = (): void => {
    box.remove();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== sheet);
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
