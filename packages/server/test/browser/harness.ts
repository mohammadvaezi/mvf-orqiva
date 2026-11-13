// ── [PCODE-366 | S15 | v0.1.0] T36.2 End-to-end journeys for every role in a real browser ──
//    Why:  journeys click through the real web app in a real browser (headless Edge or Chrome over the
//          DevTools protocol), against the real server with its own database, the way a person works:
//          fields found by their label, buttons by their words, waits for what appears. No test library:
//          the protocol is a WebSocket and a few JSON messages.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The browser to drive: ORQIVA_BROWSER, else Edge or Chrome where they usually are. */
export function browserPath(): string | null {
  const env = process.env['ORQIVA_BROWSER'];
  if (env) return existsSync(env) ? env : null;
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

const OUT = join(process.cwd(), '..', '..', 'out', 'e2e');

type Pending = (r: { result?: unknown; error?: { message: string } }) => void;

/** One browser tab, driven over the DevTools protocol. */
export class Page {
  /** console errors and uncaught exceptions, for the journey to check at the end */
  readonly errors: string[] = [];
  private id = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly loads: (() => void)[] = [];

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (m: { data: unknown }) => {
      const d = JSON.parse(String(m.data)) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        result?: unknown;
        error?: { message: string };
      };
      if (d.id !== undefined) {
        this.pending.get(d.id)?.(d);
        this.pending.delete(d.id);
      } else if (d.method === 'Runtime.exceptionThrown') {
        const ex = d.params?.['exceptionDetails'] as {
          text: string;
          exception?: { description?: string };
        };
        this.errors.push(ex.exception?.description ?? ex.text);
      } else if (d.method === 'Runtime.consoleAPICalled' && d.params?.['type'] === 'error') {
        const args = d.params['args'] as { value?: unknown; description?: string }[];
        this.errors.push(
          args
            .map((a) =>
              typeof a.value === 'string' ? a.value : (a.description ?? JSON.stringify(a.value)),
            )
            .join(' '),
        );
      } else if (d.method === 'Page.loadEventFired') {
        for (const f of this.loads.splice(0)) f();
      }
    });
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, (r) => {
        if (r.error) reject(new Error(method + ': ' + r.error.message));
        else resolve(r.result as T);
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** The value of an expression in the page (awaited when it is a promise). */
  async eval<T>(expression: string): Promise<T> {
    const r = await this.send<{
      result: { value?: T };
      exceptionDetails?: { exception?: { description?: string }; text: string };
    }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }

  /** Opens an address and waits for the page to load and settle. */
  async goto(url: string): Promise<void> {
    const loaded = new Promise<void>((r) => this.loads.push(r));
    await this.send('Page.navigate', { url });
    await loaded;
    await this.settle();
  }

  /** Waits until the expression is truthy. */
  async waitFor(expression: string, what: string, timeoutMs = 10_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      if (await this.eval<boolean>('Boolean(' + expression + ')').catch(() => false)) return;
      if (Date.now() > until) {
        await this.shot('timeout');
        throw new Error('Waited ' + String(timeoutMs) + ' ms for ' + what);
      }
      await sleep(100);
    }
  }

  /** Lets the app finish what a click started: no request in flight for a moment. */
  async settle(): Promise<void> {
    await sleep(250);
  }

  /** Waits until the text shows on the page. */
  async see(text: string, timeoutMs = 10_000): Promise<void> {
    await this.waitFor(
      'document.body.innerText.includes(' + JSON.stringify(text) + ')',
      '“' + text + '”',
      timeoutMs,
    );
  }

  /** Whether the text shows on the page now. */
  shows(text: string): Promise<boolean> {
    return this.eval<boolean>('document.body.innerText.includes(' + JSON.stringify(text) + ')');
  }

  /** Types into the field with this label (its <label>, aria-label or placeholder), replacing its text. */
  async fill(label: string, value: string): Promise<void> {
    // [PCODE-415 | S15 | v0.1.0] the field may still be on its way: wait for it as a person would
    const want = JSON.stringify(label);
    await this.waitFor(
      `[...document.querySelectorAll('input, textarea, select, [contenteditable="true"]')].some((e) => e.getClientRects().length > 0 && ((e.labels && [...e.labels].some((l) => (l.textContent ?? '').replace(/\\s+/g, ' ').trim().startsWith(${want}))) || (e.getAttribute('aria-label') ?? '').trim() === ${want} || (e.getAttribute('placeholder') ?? '').trim() === ${want}))`,
      'the field “' + label + '”',
    ).catch(() => undefined);
    const found = await this.eval<boolean>(`(() => {
      const want = ${JSON.stringify(label)};
      const norm = (s) => (s ?? '').replace(/\\s+/g, ' ').trim();
      const fields = [...document.querySelectorAll('input, textarea, select, [contenteditable="true"]')]
        .filter((e) => e.getClientRects().length > 0);
      const byLabel = (e) => {
        if (e.labels && [...e.labels].some((l) => norm(l.textContent).startsWith(want))) return true;
        return norm(e.getAttribute('aria-label')) === want || norm(e.getAttribute('placeholder')) === want;
      };
      const el = fields.find(byLabel);
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.focus();
      if (el.select) el.select();
      return true;
    })()`);
    if (!found) {
      await this.shot('no-field');
      throw new Error('No field “' + label + '”');
    }
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Delete',
      code: 'Delete',
      windowsVirtualKeyCode: 46,
    });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete' });
    if (value) await this.send('Input.insertText', { text: value });
  }

  /** Picks an option of the select with this label, by the option's words. */
  async choose(label: string, option: string): Promise<void> {
    // the options may still be loading: wait for them as a person would
    await this.waitFor(
      `[...document.querySelectorAll('select')].some((e) => [...e.options].some((o) => o.textContent.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(option)}))`,
      'the choice “' + option + '”',
    );
    const ok = await this.eval<boolean>(`(() => {
      const norm = (s) => (s ?? '').replace(/\\s+/g, ' ').trim();
      const sel = [...document.querySelectorAll('select')].find((e) =>
        (e.labels && [...e.labels].some((l) => norm(l.textContent).startsWith(${JSON.stringify(label)}))) ||
        norm(e.getAttribute('aria-label')) === ${JSON.stringify(label)});
      if (!sel) return false;
      const opt = [...sel.options].find((o) => norm(o.textContent) === ${JSON.stringify(option)});
      if (!opt) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      set.call(sel, opt.value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error('No choice “' + option + '” in “' + label + '”');
    await this.settle();
  }

  /** Clicks the button, link or tab with these words (or this aria-label), as a person would. */
  async click(words: string, opts: { within?: string } = {}): Promise<void> {
    const until = Date.now() + 10_000;
    for (;;) {
      const box = await this.eval<{ x: number; y: number } | null>(`(() => {
        const want = ${JSON.stringify(words)};
        const norm = (s) => (s ?? '').replace(/\\s+/g, ' ').trim();
        const root = ${opts.within ? 'document.querySelector(' + JSON.stringify(opts.within) + ')' : 'document'};
        if (!root) return null;
        // a field's <label> only when no button or link has the words (a form's "Comment" button
        // and its visually hidden "Comment" label)
        const all = [...root.querySelectorAll('button, a, [role=button], [role=tab], [role=menuitem], summary, label')]
          .filter((e) => e.getClientRects().length > 0 && !e.disabled)
          .sort((a, b) => Number(a.tagName === 'LABEL') - Number(b.tagName === 'LABEL'));
        const el = all.find((e) => norm(e.textContent) === want || norm(e.getAttribute('aria-label')) === want)
          ?? all.find((e) => norm(e.textContent).startsWith(want));
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
      if (box) {
        for (const type of ['mousePressed', 'mouseReleased'])
          await this.send('Input.dispatchMouseEvent', {
            type,
            x: box.x,
            y: box.y,
            button: 'left',
            clickCount: 1,
          });
        await this.settle();
        return;
      }
      if (Date.now() > until) {
        await this.shot('no-button');
        throw new Error('Nothing to click called “' + words + '”');
      }
      await sleep(100);
    }
  }

  /** Presses a key on the focused element (Enter, Escape, Tab …). */
  async press(key: string, text?: string): Promise<void> {
    const codes: Record<string, number> = { Enter: 13, Escape: 27, Tab: 9 };
    const base = { key, code: key, windowsVirtualKeyCode: codes[key] ?? key.charCodeAt(0) };
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      ...base,
      ...(text ? { text } : {}),
    });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await this.settle();
  }

  /** The path of the page now. */
  path(): Promise<string> {
    return this.eval<string>('location.pathname');
  }

  /** A screenshot into out/e2e, for a person to look at when a journey fails. */
  async shot(name: string): Promise<void> {
    try {
      const r = await this.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      mkdirSync(OUT, { recursive: true });
      writeFileSync(
        join(OUT, name + '-' + String(Date.now()) + '.png'),
        Buffer.from(r.data, 'base64'),
      );
    } catch {
      // a screenshot is a help, never a failure of its own
    }
  }
}

/** A headless browser with one page, at desktop or phone width, in English. */
export async function launch(
  opts: { width?: number; height?: number; mobile?: boolean } = {},
): Promise<{ page: Page; close: () => Promise<void> }> {
  const exe = browserPath();
  if (!exe) throw new Error('No browser found; set ORQIVA_BROWSER');
  const profile = mkdtempSync(join(tmpdir(), 'orqiva-e2e-'));
  const proc: ChildProcess = spawn(
    exe,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      '--lang=en-US',
      '--no-first-run',
      '--no-default-browser-check',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  // the browser writes the port it chose into the profile
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) {
    try {
      port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
    } catch {
      await sleep(100);
    }
  }
  if (!port) throw new Error('The browser did not start');
  let target: { type: string; webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 50 && !target; i++) {
    const list = (await (await fetch('http://127.0.0.1:' + String(port) + '/json')).json()) as {
      type: string;
      webSocketDebuggerUrl: string;
    }[];
    target = list.find((t) => t.type === 'page');
    if (!target) await sleep(100);
  }
  if (!target) throw new Error('The browser has no page');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => {
    socket.addEventListener('open', r, { once: true });
  });
  const page = new Page(socket);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: opts.width ?? 1400,
    height: opts.height ?? 900,
    deviceScaleFactor: 1,
    mobile: opts.mobile ?? false,
  });
  return {
    page,
    close: async () => {
      socket.close();
      // the browser's helper processes hold the profile a moment after it ends (Windows)
      const ended = new Promise((r) => proc.once('exit', r));
      proc.kill();
      await Promise.race([ended, sleep(3000)]);
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch {
        // a left-over temporary profile is no failure of the journey
      }
    },
  };
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
