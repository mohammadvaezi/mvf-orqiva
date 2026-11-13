// ── [PCODE-449 | S15 | v0.1.0] Landing page: the product tour as real video of Orqiva in use ──
//    Why:  Records the tour clips (a scripted person in the preview, visible cursor) into packages/site/media/clip-*.webm.
//    Run:  npm run build -w @orqiva/web; node deploy/site/tools/serve-preview.mjs (keep it running), then
//          node deploy/site/tools/record-clips.mjs [names…]. Needs playwright-core (npm i --no-save playwright-core)
//          and its cached Chromium and ffmpeg (npx playwright install chromium ffmpeg). Not part of the build.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const RAW = new URL('../../../out/clips-raw/', import.meta.url);
mkdirSync(RAW, { recursive: true });
const W = 1600;
const H = 1000;
const BASE = 'http://127.0.0.1:8732/preview';

// a visible cursor with a click ripple, and the real bank's name kept out of every frame
const INIT = () => {
  localStorage.setItem('orqiva.lang', 'en');
  localStorage.setItem('pv-dark', '1');
  const scrub = () => {
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length || !/\bKFW\b|Förderbank|Grant calculator/i.test(el.textContent ?? ''))
        continue;
      // the whole row goes (a project row, a heatmap line), not only the name
      const row =
        el.closest('tr, li, [class*="row"], [class*="Row"]') ?? el.closest('button') ?? el;
      row.style.display = 'none';
    }
  };
  const start = () => {
    const css = document.createElement('style');
    css.textContent = `.pv-banner{display:none!important}
      #rec-cursor{position:fixed;left:0;top:0;z-index:2147483647;width:22px;height:22px;pointer-events:none;transform:translate(-2px,-2px);transition:none}
      #rec-cursor svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))}
      .rec-ripple{position:fixed;z-index:2147483646;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #ff7a59;pointer-events:none;animation:rec 520ms ease-out forwards}
      @keyframes rec{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}`;
    document.head.append(css);
    const c = document.createElement('div');
    c.id = 'rec-cursor';
    c.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l15 8.5-6.4 1.7L8.6 19z" fill="#fff" stroke="#14132b" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.append(c);
    addEventListener(
      'mousemove',
      (e) => {
        c.style.left = e.clientX + 'px';
        c.style.top = e.clientY + 'px';
      },
      true,
    );
    addEventListener(
      'mousedown',
      (e) => {
        const r = document.createElement('div');
        r.className = 'rec-ripple';
        r.style.left = e.clientX + 'px';
        r.style.top = e.clientY + 'px';
        document.body.append(r);
        setTimeout(() => r.remove(), 600);
      },
      true,
    );
    scrub();
    new MutationObserver(scrub).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start);
  else start();
};

/** Moves the cursor smoothly to an element (or a point) and optionally clicks it. */
async function to(
  page,
  target,
  { click = false, dx = 0.5, dy = 0.5, pause = 350, steps = 28 } = {},
) {
  let x;
  let y;
  if (Array.isArray(target)) [x, y] = target;
  else {
    const loc = typeof target === 'string' ? page.locator(target).first() : target;
    const b = await loc.boundingBox({ timeout: 2000 }).catch(() => null);
    if (!b) {
      console.log('   not found:', String(loc).slice(0, 120));
      return false;
    }
    x = b.x + b.width * dx;
    y = b.y + b.height * dy;
  }
  await page.mouse.move(x, y, { steps });
  await page.waitForTimeout(pause);
  if (click) {
    await page.mouse.down();
    await page.waitForTimeout(90);
    await page.mouse.up();
  }
  return true;
}
const btn = (page, name) => page.getByRole('button', { name, exact: true }).first();
const btnLike = (page, name) => page.getByRole('button', { name, exact: false }).first();

const CLIPS = {
  // home â†’ the decision waiting in the inbox â†’ approved
  home: {
    route: '',
    run: async (p) => {
      await p.mouse.move(820, 520);
      await to(p, p.locator('main a', { hasText: 'Fleet portal' }), { pause: 500 });
      await to(p, p.locator('main a', { hasText: 'Patient app' }), { pause: 500 });
      await to(p, p.locator('main a', { hasText: 'Coder wants to run the migration' }), {
        pause: 700,
        click: true,
        dx: 0.3,
      });
      await p.waitForTimeout(1200);
      await to(p, btn(p, 'Approve'), { pause: 700, click: true });
      await p.waitForTimeout(1600);
    },
  },
  ideation: {
    route: 'projects/PE/ideation',
    run: async (p) => {
      await p.mouse.move(900, 560);
      await to(p, btnLike(p, 'Requirements'), { click: true, pause: 400 });
      await p.waitForTimeout(1300);
      await to(p, btnLike(p, 'Open questions'), { click: true, pause: 400 });
      await p.waitForTimeout(1300);
      await to(p, btn(p, 'Interview'), { click: true, pause: 400 });
      await p.waitForTimeout(700);
      if (await to(p, 'textarea', { click: true, pause: 300 })) {
        await p.keyboard.type(
          'About 2 000 tracking pages on a Monday morning, most between 7 and 9.',
          { delay: 38 },
        );
        await p.waitForTimeout(400);
        await to(p, btn(p, 'Send'), { click: true, pause: 400 });
      }
      await p.waitForTimeout(1800);
    },
  },
  canvas: {
    route: 'projects/PE/canvas',
    run: async (p) => {
      await p.mouse.move(1000, 600);
      await to(p, p.locator('button', { hasText: 'Live re-routing (NWL-188)' }), {
        click: true,
        pause: 500,
      });
      await p.waitForTimeout(1400);
      await to(p, p.getByText('Weeks', { exact: true }).first(), { click: true, pause: 400 });
      await p.waitForTimeout(1300);
      await to(p, btn(p, 'Workload'), { click: true, pause: 400 });
      await p.waitForTimeout(1500);
      await to(p, btn(p, 'Gantt'), { click: true, pause: 400 });
      await p.waitForTimeout(800);
      await to(p, p.getByText('Days', { exact: true }).first(), { click: true, pause: 400 });
      await p.waitForTimeout(1200);
    },
  },
  agents: {
    route: 'agents',
    run: async (p) => {
      await p.mouse.move(900, 500);
      await to(
        p,
        p.locator('main', { hasText: 'Coder' }).getByText('Coder', { exact: true }).first(),
        { pause: 600 },
      );
      await to(p, btn(p, 'Runs and traces'), { click: true, pause: 400 });
      await p.waitForTimeout(1600);
      const row = p
        .locator('main tr, main li, main button')
        .filter({ hasText: /NWL-188|HEL-212|run/i })
        .nth(1);
      await to(p, row, { click: true, pause: 400 });
      await p.waitForTimeout(1600);
      await to(p, btn(p, 'Costs'), { click: true, pause: 400 });
      await p.waitForTimeout(1600);
      await to(p, btn(p, 'Fleet'), { click: true, pause: 400 });
      await p.waitForTimeout(900);
    },
  },
  test: {
    route: 'projects/PE/test',
    run: async (p) => {
      await p.mouse.move(900, 600);
      await to(p, p.getByText('Wait for the download').first(), { pause: 700 });
      // the tester works the failed step: Pass, then back to Fail with its evidence, as on a retest
      const step = p
        .locator('li, div')
        .filter({ hasText: /^4\s*Wait for the download/ })
        .last();
      const inStep = (name) => step.getByRole('button', { name, exact: true }).first();
      const passes = p.getByRole('button', { name: 'Pass', exact: true });
      const fails = p.getByRole('button', { name: 'Fail', exact: true });
      const pass4 = (await inStep('Pass').count()) ? inStep('Pass') : passes.nth(3);
      const fail4 = (await inStep('Fail').count()) ? inStep('Fail') : fails.nth(3);
      await to(p, pass4, { click: true, pause: 500 });
      await p.waitForTimeout(1200);
      await to(p, fail4, { click: true, pause: 500 });
      await p.waitForTimeout(1000);
      await to(p, p.getByText(/Recording 0:42/).first(), { click: true, pause: 500 });
      await p.waitForTimeout(1500);
      await to(p, btn(p, 'Sign off the run'), { click: true, pause: 600 });
      await p.waitForTimeout(1800);
    },
  },
  security: {
    route: 'projects/PE/security',
    run: async (p) => {
      await p.mouse.move(700, 450);
      for (const t of [
        'Access token written to the request log',
        'Map provider key in git history',
        'Container runs as root',
        'xml2js prototype pollution',
      ]) {
        await to(p, p.getByText(t).first(), { click: true, pause: 450, dx: 0.3 });
        await p.waitForTimeout(1100);
      }
      await to(p, btn(p, 'Fix with Sentinel'), { pause: 900 });
      await p.waitForTimeout(500);
    },
  },
  releases: {
    route: 'releases',
    run: async (p) => {
      await p.mouse.move(900, 500);
      await to(p, p.getByText('rc.3').first(), { pause: 900 });
      await to(p, p.getByText(/Train .October./).first(), { pause: 700 });
      await to(p, btn(p, 'Changelog'), { click: true, pause: 400 });
      await p.waitForTimeout(1600);
      await to(p, btnLike(p, 'Ship the train'), { pause: 1000 });
      await p.waitForTimeout(700);
    },
  },
  command: {
    route: 'command',
    run: async (p) => {
      await p.mouse.move(900, 500);
      const range = p.locator('input[type=range]').first();
      const b = await range.boundingBox();
      if (b) {
        const y = b.y + b.height / 2;
        await p.mouse.move(b.x + b.width - 4, y, { steps: 25 });
        await p.waitForTimeout(400);
        await p.mouse.down();
        await p.mouse.move(b.x + b.width * 0.08, y, { steps: 90 });
        await p.waitForTimeout(500);
        await p.mouse.move(b.x + b.width * 0.55, y, { steps: 60 });
        await p.waitForTimeout(300);
        await p.mouse.move(b.x + b.width - 4, y, { steps: 50 });
        await p.mouse.up();
      }
      await p.waitForTimeout(700);
      await to(p, p.locator('button', { hasText: 'HEL Patient app' }).first(), { pause: 800 });
      await p.waitForTimeout(800);
    },
  },
  inbox: {
    route: 'inbox',
    run: async (p) => {
      await p.mouse.move(900, 500);
      await to(p, btn(p, 'Approve'), { click: true, pause: 600 });
      await p.waitForTimeout(1500);
    },
  },
};

const only = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath:
    process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1237\\chrome-win64\\chrome.exe',
});
// Chrome's screencast sends a JPEG whenever the screen changes; the frames are resampled to a steady
// FPS by their timestamps, joined into one MJPEG stream and encoded by Playwright's cached ffmpeg (VP8).
const FPS = 25;
const FFMPEG = process.env.LOCALAPPDATA + '\\ms-playwright\\ffmpeg-1011\\ffmpeg-win64.exe';
const OUT = 'C:\\Broszio Apps\\planecode\\packages\\site\\media\\';
const { execFileSync } = await import('node:child_process');

for (const [name, clip] of Object.entries(CLIPS)) {
  if (only.length ? !only.includes(name) : name === 'inbox') continue;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: 'dark' });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  await page.goto(BASE + (clip.route ? '/' + clip.route : ''), { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => {
    // the frame's own timestamp is on another clock than Date.now(): stamp it on arrival
    frames.push({ t: Date.now() / 1000, data: Buffer.from(f.data, 'base64') });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: W,
    maxHeight: H,
    everyNthFrame: 1,
  });
  const start = Date.now() / 1000;
  await page.waitForTimeout(300);
  await clip.run(page);
  await page.waitForTimeout(300);
  const end = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await ctx.close();
  if (!frames.length) {
    console.log(name, 'no frames');
    continue;
  }
  // a steady frame rate: each output frame shows the latest screen at that moment
  const out = [];
  let k = 0;
  for (let t = start; t < end; t += 1 / FPS) {
    while (k + 1 < frames.length && frames[k + 1].t <= t) k++;
    out.push(frames[k].data);
  }
  const mjpeg = new URL(name + '.mjpeg', RAW);
  writeFileSync(mjpeg, Buffer.concat(out));
  const file = OUT + 'clip-' + name + '.webm';
  execFileSync(FFMPEG, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'image2pipe',
    '-c:v',
    'mjpeg',
    '-framerate',
    String(FPS),
    '-i',
    'file:' + mjpeg.pathname.slice(1).replace(/\//g, '\\').replace(/%20/g, ' '),
    '-c:v',
    'libvpx',
    '-b:v',
    '1400k',
    '-maxrate',
    '2400k',
    '-bufsize',
    '3000k',
    '-qmin',
    '2',
    '-qmax',
    '36',
    '-g',
    '50',
    '-deadline',
    'good',
    '-cpu-used',
    '1',
    '-auto-alt-ref',
    '1',
    '-lag-in-frames',
    '16',
    '-an',
    file,
  ]);
  writeFileSync(
    new URL(name + '.json', RAW),
    JSON.stringify({ frames: frames.length, out: out.length, seconds: end - start }),
  );
  console.log(
    name,
    frames.length,
    'screen frames â†’',
    out.length,
    'video frames,',
    (end - start).toFixed(1),
    's',
  );
}
await browser.close();
