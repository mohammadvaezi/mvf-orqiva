// ── [PCODE-449 | S15 | v0.1.0] Landing page: the product tour as real video of Orqiva in use ──
//    Why:  Captures the tour screens from the preview (English, dark, banner hidden) into packages/site/media/screen-*.webp.
//    Run:  npm run build -w @orqiva/web; node deploy/site/tools/serve-preview.mjs (keep it running), then
//          node deploy/site/tools/capture-screens.mjs [names…]. Needs playwright-core (npm i --no-save playwright-core)
//          and its cached Chromium and ffmpeg (npx playwright install chromium ffmpeg). Not part of the build.
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = 'C:\\Broszio Apps\\planecode\\packages\\site\\media\\';
const SCREENS = {
  home: '',
  ideation: 'projects/PE/ideation',
  canvas: 'projects/PE/canvas',
  agents: 'agents',
  test: 'projects/PE/test',
  security: 'projects/PE/security',
  releases: 'releases',
  command: 'command',
  inbox: 'inbox',
};
const only = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath:
    process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1237\\chrome-win64\\chrome.exe',
});
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
await ctx.addInitScript(() => {
  localStorage.setItem('orqiva.lang', 'en');
  localStorage.setItem('pv-dark', '1');
});
const page = await ctx.newPage();
const resizer = await ctx.newPage();
for (const [name, route] of Object.entries(SCREENS)) {
  if (only.length && !only.includes(name)) continue;
  await page.goto('http://127.0.0.1:8732/preview' + (route ? '/' + route : ''), {
    waitUntil: 'networkidle',
  });
  await page.addStyleTag({ content: '.pv-banner{display:none!important}' });
  // a real bank's name is in one sample project; it stays off the public page
  const removed = await page.evaluate(() => {
    let n = 0;
    for (const el of [...document.querySelectorAll('body *')]) {
      if (el.children.length || !/\bKFW\b|Förderbank/i.test(el.textContent ?? '')) continue;
      const row = el.closest('tr, li, [class*="row"], [class*="Row"]') ?? el;
      row.remove();
      n++;
    }
    return n;
  });
  await page.waitForTimeout(800);
  const png = await page.screenshot();
  const b64 = await resizer.evaluate(async (src) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 2000;
    c.height = 1250;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, 2000, 1250);
    return c.toDataURL('image/webp', 0.86).split(',')[1];
  }, png.toString('base64'));
  const buf = Buffer.from(b64, 'base64');
  writeFileSync(OUT + 'screen-' + name + '.webp', buf);
  console.log(
    name,
    Math.round(buf.length / 1024) + ' KB',
    removed ? '(removed ' + removed + ' KFW elements)' : '',
  );
}
await browser.close();
