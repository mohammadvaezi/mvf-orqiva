// ── [PCODE-319 | S15 | v0.1.0] T32.5a Bug capture on the server: a report with page, device, console, network and actions becomes a bug ──
//    Why:  the bug reads in the order a developer asks: where, the screenshot, the steps before, the
//          failures first, then the console and the requests; browsers are named the way people say them.
import { describe, expect, it } from 'vitest';
import { browserOf, bugReportMarkdown, type BugReport } from '../src/bugreport.js';

const report: BugReport = {
  title: 'Checkout button does nothing',
  note: 'Clicked Pay twice.',
  page: { url: 'https://shop.test/checkout', title: 'Checkout' },
  device: {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    platform: 'Windows',
    language: 'de-DE',
    viewport: { width: 1280, height: 720 },
    screen: { width: 1920, height: 1080, pixelRatio: 1.5 },
    timeZone: 'Europe/Berlin',
  },
  console: [
    { level: 'log', text: 'cart ready', at: '2026-10-14T10:00:01.000Z' },
    { level: 'error', text: 'TypeError: total is undefined', at: '2026-10-14T10:00:05.000Z' },
  ],
  network: [
    {
      method: 'GET',
      url: 'https://shop.test/api/cart',
      status: 200,
      ms: 81.4,
      at: '2026-10-14T10:00:02.000Z',
    },
    {
      method: 'POST',
      url: 'https://shop.test/api/pay',
      status: 502,
      ms: 1200,
      at: '2026-10-14T10:00:05.000Z',
    },
  ],
  actions: [
    { kind: 'navigate', target: '/checkout', at: '2026-10-14T10:00:00.000Z' },
    { kind: 'click', target: 'button "Pay"', at: '2026-10-14T10:00:04.000Z' },
  ],
};

describe('bug reports', () => {
  it('names the browser', () => {
    expect(browserOf(report.device.userAgent)).toBe('Edge 141');
    expect(
      browserOf('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'),
    ).toBe('Firefox 131');
    expect(
      browserOf(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      ),
    ).toBe('Safari 18');
    expect(browserOf('curl/8')).toBe('Unknown browser');
  });

  it('writes the bug in sections, the failures first', () => {
    const md = bugReportMarkdown(report, {
      screenshot: '/api/workspaces/w/files/f/content',
      recording: null,
    });
    expect(md.split('\n').slice(0, 9)).toEqual([
      'Clicked Pay twice.',
      '',
      '## Where',
      '',
      '- Page: Checkout · https://shop.test/checkout',
      '- Browser: Edge 141 on Windows',
      '- Window: 1280×720, screen 1920×1080 at 1.5x',
      '- Language and time zone: de-DE, Europe/Berlin',
      '',
    ]);
    expect(md).toContain('![Screenshot](/api/workspaces/w/files/f/content)');
    expect(md).toContain('1. 10:00:00 navigate /checkout\n2. 10:00:04 click button "Pay"');
    expect(md).toContain(
      '## Failures\n\n- `POST https://shop.test/api/pay` → 502 after 1200 ms\n- error: `TypeError: total is undefined`',
    );
    expect(md).toContain('| 10:00:02 | `GET https://shop.test/api/cart` | 200 | 81 |');
    expect(md).not.toContain('## Recording');
  });
});
