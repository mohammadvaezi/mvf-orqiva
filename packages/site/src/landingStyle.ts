// ── [PCODE-452 | S15 | v0.1.0] Landing page: cinematic arrival of the 3D mark, framed and timed ──
// ── [PCODE-451 | S15 | v0.1.0] Landing page: steady server-room loop, 3D Orqiva mark in the finale ──
// ── [PCODE-449 | S15 | v0.1.0] Landing page: the product tour as real video of Orqiva in use ──
// ── [PCODE-448 | S15 | v0.1.0] Orqiva logo on the public site ──
// ── [PCODE-445 | S15 | v0.1.0] Landing page: fly through the real product, warmer sections ──
// ── [PCODE-444 | S15 | v0.1.0] Landing page: smooth on integrated GPUs, footage and feature visuals ──
// ── [PCODE-443 | S15 | v0.1.0] Cinematic landing page for the public site ──
//    Why:  the landing page's own stylesheet (the docs keep site.css). It wears the product's palette
//          (packages/web theme.css, dark): an indigo canvas, the indigo–violet–magenta band, coral,
//          amber and teal. The tour is plain CSS 3D (perspective, preserve-3d) moved by client/deck.ts
//          with transforms and opacity only, so it stays smooth on integrated graphics and remote
//          desktops. Everything is visible without JavaScript; reduced motion keeps only fades.
export const LANDING_STYLE = `/* [PCODE-445 | S15 | v0.1.0] the landing page */
:root {
  --ink: #0c0b1d; --ink2: #14132b; --surface: #1c1b3a; --surface2: #22214a; --line: rgba(154, 146, 255, .16);
  --fg: #ecebff; --fg2: #bdbce0; --fg3: #9291bd;
  --primary: #9a92ff; --indigo: #4b3fce; --violet: #7a4ce0; --magenta: #c04fae; --pink: #ff4d79;
  --coral: #ff7a59; --amber: #ffad33; --teal: #3ee0b4;
  --band: linear-gradient(100deg, #4b3fce 0%, #7a4ce0 45%, #c04fae 100%);
  --warm: linear-gradient(100deg, #ff4d79 0%, #ff7a59 50%, #ffad33 100%);
  --display: "Segoe UI Variable Display", "SF Pro Display", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --text: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace;
  --gutter: clamp(16px, 4vw, 56px);
  color-scheme: dark;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
body.landing { margin: 0; background: var(--ink); color: var(--fg); font: 16px/1.6 var(--text);
  -webkit-font-smoothing: antialiased; overflow-x: hidden; }
a { color: inherit; }
:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; border-radius: 6px; }
.skip { position: absolute; left: -999px; z-index: 40; }
.skip:focus { left: 12px; top: 12px; background: var(--ink); padding: 6px 10px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
h1, h2, h3 { font-family: var(--display); letter-spacing: -.025em; margin: 0; font-weight: 650; }
code { font: .88em/1.4 var(--mono); }
html.no-js .js-only { display: none !important; }

/* the bar */
.bar { position: fixed; inset: 0 0 auto; z-index: 30; display: flex; align-items: center; gap: 24px;
  height: 64px; padding: 0 var(--gutter); transition: background .3s, border-color .3s; border-bottom: 1px solid transparent; }
.bar.is-solid { background: rgba(12, 11, 29, .9); border-color: var(--line); }
.bar__brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 650; text-decoration: none; font-size: 17px; }
/* [PCODE-448 | S15 | v0.1.0] the Orqiva mark (logo.svg), with a soft glow on the dark page */
.mark { display: block; width: 30px; height: 30px; filter: drop-shadow(0 0 10px rgba(122, 76, 224, .55)); }
.bar__nav { display: flex; gap: 26px; margin-left: auto; font-size: 14px; }
.bar__nav a { color: var(--fg2); text-decoration: none; }
.bar__nav a:hover { color: var(--fg); }

/* buttons */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 46px; padding: 0 22px;
  border-radius: 999px; font: 600 15px/1 var(--text); text-decoration: none; border: 1px solid transparent; cursor: pointer;
  transition: transform .2s ease, box-shadow .2s ease, background .2s ease, filter .2s ease; }
.btn--primary { background: var(--band); color: #fff;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .14) inset, 0 10px 34px -10px rgba(192, 79, 174, .9); }
.btn--primary:hover { transform: translateY(-1px); filter: brightness(1.08); box-shadow: 0 0 0 1px rgba(255, 255, 255, .22) inset, 0 14px 44px -10px rgba(192, 79, 174, 1); }
.btn--ghost { color: var(--fg); border-color: rgba(154, 146, 255, .3); background: rgba(154, 146, 255, .06); }
.btn--ghost:hover { border-color: rgba(154, 146, 255, .6); background: rgba(154, 146, 255, .12); }
.btn--small { min-height: 38px; padding: 0 16px; font-size: 14px; }
.btn--large { min-height: 56px; padding: 0 30px; font-size: 17px; }
.btn--block { display: flex; width: 100%; }
.btn--approve { min-height: 36px; padding: 0 16px; font-size: 13px; background: var(--primary); color: #15113f; }
.btn--approve:hover { filter: brightness(1.1); }
.btn--quiet { min-height: 36px; padding: 0 12px; font-size: 13px; color: var(--fg2); background: transparent; border-color: var(--line); }
.btn__arrow { transition: transform .2s ease; }
.btn:hover .btn__arrow { transform: translateX(3px); }

/* small pieces of the app's own UI, used on the cards */
.tag { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; margin: 0 6px 0 0; border-radius: 6px;
  font: 600 12px/1 var(--text); white-space: nowrap; }
.tag--violet { background: #2e2878; color: #e4e1ff; }
.tag--amber { background: rgba(255, 173, 51, .16); color: #ffc46b; }
.tag--coral { background: rgba(255, 122, 89, .16); color: #ff9a80; }
.tag--teal { background: rgba(62, 224, 180, .14); color: var(--teal); }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.dot--amber { background: var(--amber); box-shadow: 0 0 10px var(--amber); }
.dot--coral { background: var(--coral); box-shadow: 0 0 10px var(--coral); }
.dot--teal { background: var(--teal); box-shadow: 0 0 10px var(--teal); }
.bot, .shield, .play { width: 26px; height: 26px; flex: none; border-radius: 8px; background: #2e2878; position: relative; }
.bot::after { content: ""; position: absolute; inset: 8px 7px; border: 2px solid #c9c4ff; border-radius: 4px; }
.bot--teal { background: #0f6d5c; }
.shield::after { content: ""; position: absolute; inset: 6px 8px; border: 2px solid #c9c4ff; border-radius: 3px 3px 8px 8px; }
.play::after { content: ""; position: absolute; left: 10px; top: 7px; border: 6px solid transparent; border-left: 9px solid #c9c4ff; }
.risk { display: inline-grid; place-items: center; min-width: 34px; height: 26px; border-radius: 7px; background: #e04a4a; color: #fff;
  font: 700 13px/1 var(--text); }
.meter { display: block; height: 6px; margin-top: 10px; border-radius: 3px; background: rgba(154, 146, 255, .16); overflow: hidden; }
.meter__fill { display: block; height: 100%; border-radius: 3px; background: var(--primary); }
.meter__fill--teal { background: var(--teal); }
.meter--54 { width: 54%; } .meter--68 { width: 68%; } .meter--71 { width: 71%; }

/* ── the tour ── */
.tour { position: relative; background: radial-gradient(80% 60% at 70% 30%, #1d1550 0%, var(--ink) 70%); }
.tour__sticky { position: sticky; top: 0; height: 100vh; height: 100svh; overflow: hidden; }
.tour__bgs img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0;
  filter: saturate(1.2) brightness(.5); will-change: opacity; }
html.no-js .tour__bgs img:first-child { opacity: 1; }
.tour__aurora { position: absolute; inset: 0; pointer-events: none;
  background:
    linear-gradient(90deg, rgba(12, 11, 29, .96) 0%, rgba(12, 11, 29, .82) 30%, rgba(12, 11, 29, .25) 58%, rgba(12, 11, 29, .1) 100%),
    radial-gradient(40% 50% at 78% 18%, rgba(122, 76, 224, .35), transparent 70%),
    radial-gradient(35% 45% at 92% 85%, rgba(192, 79, 174, .3), transparent 70%),
    linear-gradient(180deg, rgba(12, 11, 29, .7) 0%, transparent 18%, transparent 78%, rgba(12, 11, 29, .9) 100%); }
.tour__scene { position: absolute; top: 50%; right: 1vw; width: min(57vw, 1160px); aspect-ratio: 16 / 10;
  transform: translateY(-50%); perspective: 2400px; perspective-origin: 20% 45%; pointer-events: none; }
.tour__rig { position: absolute; inset: 0; transform-style: preserve-3d; transform: rotateY(-17deg) rotateX(8deg) rotateZ(1deg); }
.shot { position: absolute; inset: 0; margin: 0; transform-style: preserve-3d; opacity: 0; will-change: transform, opacity; }
html.no-js .shot:first-child { opacity: 1; }
.shot__frame { position: absolute; inset: 0; border-radius: 16px; overflow: hidden; background: var(--ink2);
  box-shadow: 0 0 0 1px rgba(154, 146, 255, .28), 0 60px 140px -40px rgba(0, 0, 0, .9), 0 0 110px -20px rgba(122, 76, 224, .55); }
.shot__img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: left top; }
.shot__dim { position: absolute; inset: 0; background: var(--ink); opacity: 0; }
/* [PCODE-449 | S15 | v0.1.0] the recorded clip over the screen; it fades in once it really plays */
.shot__video, .chapter__video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  object-position: left top; opacity: 0; transition: opacity .45s ease; }
.shot__video.is-playing, .chapter__video.is-playing { opacity: 1; }
.chapter__video { border-radius: 12px; }
.motion { position: absolute; right: var(--gutter); bottom: 92px; z-index: 3; display: inline-flex; align-items: center; gap: 8px;
  min-height: 34px; padding: 0 14px 0 12px; border-radius: 999px; border: 1px solid rgba(154, 146, 255, .35);
  background: rgba(12, 11, 29, .7); color: var(--fg2); font: 600 12px/1 var(--text); cursor: pointer; }
.motion:hover { color: var(--fg); border-color: rgba(154, 146, 255, .7); }
.motion__icon { width: 10px; height: 12px; border-left: 3px solid currentColor; border-right: 3px solid currentColor; }
.motion[aria-pressed="true"] .motion__icon { width: 0; height: 0; border: 6px solid transparent; border-left: 10px solid currentColor;
  border-right: 0; margin-left: 2px; }

/* the cards lifted off a screen */
.pop { position: absolute; width: min(19em, 46%); padding: 14px 16px; border-radius: 14px; font: 13px/1.45 var(--text);
  background: rgba(28, 27, 58, .94); border: 1px solid rgba(154, 146, 255, .38); color: var(--fg);
  box-shadow: 0 30px 70px -24px rgba(0, 0, 0, .9), 0 0 50px -14px rgba(154, 146, 255, .55);
  transform: translateZ(40px); opacity: 0; transition: opacity .5s ease, transform .7s cubic-bezier(.2, .7, .2, 1); }
.shot.is-active .pop { opacity: 1; transform: translateZ(130px); pointer-events: auto; }
.shot.is-active .pop + .pop { transform: translateZ(90px); transition-delay: .12s; }
html.no-js .shot:first-child .pop { opacity: 1; transform: translateZ(110px); }
.pop--tr { top: 6%; right: 2%; }
.pop--bl { bottom: 7%; left: 3%; }
.pop--approve { top: 24%; left: -4%; width: min(23em, 56%); }
.pop p { margin: 0; }
.pop__k { color: var(--fg3); font-size: 12px; }
.pop__big { font: 700 30px/1.15 var(--display); letter-spacing: -.02em; margin: 2px 0 !important; }
.pop__s { color: var(--fg2); margin-top: 4px !important; }
.pop__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.approve__actions { display: flex; gap: 8px; margin-top: 12px !important; }
.approve__done { display: flex; align-items: center; gap: 8px; margin-top: 12px !important; color: var(--teal); font-weight: 600; }
.approve__done[hidden], .approve__actions[hidden] { display: none; }
.approve.is-approved { border-color: rgba(62, 224, 180, .5); }

/* the line from idea to release, now the tour's navigation */
.rail { position: absolute; left: var(--gutter); right: var(--gutter); bottom: 26px; z-index: 3; }
.rail ol { position: relative; display: flex; justify-content: space-between; list-style: none; margin: 0; padding: 0; }
.rail__track { position: absolute; left: 6px; right: 6px; bottom: 6px; height: 2px; border-radius: 1px; background: rgba(154, 146, 255, .18); }
.rail__fill { position: absolute; inset: 0; transform-origin: left; transform: scaleX(0); border-radius: 1px; background: var(--band);
  box-shadow: 0 0 14px rgba(192, 79, 174, .8); }
.rail__stop { display: flex; flex-direction: column-reverse; align-items: center; gap: 10px; text-decoration: none; color: var(--fg3);
  font: 600 11px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
.rail li:first-child .rail__stop { align-items: flex-start; }
.rail li:last-child .rail__stop { align-items: flex-end; }
.rail__dot { width: 14px; height: 14px; border-radius: 50%; background: var(--ink); border: 2px solid rgba(154, 146, 255, .45); transition: all .3s; }
.rail__stop.is-passed .rail__dot { border-color: var(--primary); background: var(--primary); }
.rail__stop.is-current { color: var(--fg); }
.rail__stop.is-current .rail__dot { border-color: #fff; background: var(--pink); box-shadow: 0 0 0 4px rgba(255, 77, 121, .25), 0 0 16px var(--pink); }
.rail__stop:hover { color: var(--fg); }
.tour__note { position: absolute; right: var(--gutter); bottom: 64px; margin: 0; font-size: 12px; color: var(--fg3); z-index: 3; }

.tour__chapters { position: relative; z-index: 2; margin-top: -100vh; margin-top: -100svh; pointer-events: none; }
.chapter { min-height: 125vh; min-height: 125svh; display: flex; align-items: center; gap: 48px; padding: 0 var(--gutter); }
.chapter__text { width: min(440px, 33vw); pointer-events: auto; text-shadow: 0 2px 24px rgba(12, 11, 29, .9); }
.chapter h2 { font-size: clamp(30px, 3vw, 44px); line-height: 1.06; margin: 0 0 16px; }
.chapter p { margin: 0 0 14px; color: var(--fg2); font-size: 17px; }
.chapter__shot { display: none; margin: 0; position: relative; }
/* [PCODE-445 | S15 | v0.1.0] the approval card in the chapter, for phones */
.chapter__demo { display: none; position: static; width: auto; opacity: 1; transform: none; margin: 18px 0 4px; text-shadow: none; }
.chapter__img { display: block; width: 100%; height: auto; border-radius: 12px;
  box-shadow: 0 0 0 1px rgba(154, 146, 255, .28), 0 30px 80px -30px rgba(0, 0, 0, .9), 0 0 60px -20px rgba(122, 76, 224, .5); }
html.js .chapter__text { opacity: 0; transform: translateY(26px); transition: opacity .7s ease, transform .8s cubic-bezier(.2, .7, .2, 1); }
html.js .chapter.is-active .chapter__text { opacity: 1; transform: none; }

.kicker, .eyebrow { display: flex; align-items: center; gap: 12px; margin: 0 0 18px; font: 600 12px/1.2 var(--mono);
  letter-spacing: .16em; text-transform: uppercase; color: var(--primary); }
.kicker--center { justify-content: center; }
.kicker__n { display: inline-grid; place-items: center; min-width: 32px; height: 24px; padding: 0 7px; border-radius: 7px;
  background: var(--band); color: #fff; letter-spacing: .04em; }
.eyebrow__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--teal); box-shadow: 0 0 12px var(--teal); }
.chapter__links { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 20px 0 0 !important; font-size: 15px !important; }
.chapter__links a { color: #d4d0ff; text-decoration: none; border-bottom: 1px solid rgba(154, 146, 255, .45); }
.chapter__links a:hover { color: #fff; border-color: #fff; }
.chapter__links a::after { content: " →"; }

.hero .chapter__text { width: min(620px, 41vw); }
.hero { min-height: 100vh; min-height: 100svh; padding-top: 64px; }
.hero h1 { font-size: clamp(38px, 3.9vw, 64px); line-height: 1.03; letter-spacing: -.04em; }
.h1__band { color: transparent; background: linear-gradient(100deg, #b3abff 0%, #d38be0 55%, #ff9a80 100%);
  -webkit-background-clip: text; background-clip: text; }
.hero__lead { font-size: clamp(17px, 1.35vw, 20px) !important; line-height: 1.6; color: #d1cff0 !important; margin: 26px 0 32px !important; }
.hero__actions { display: flex; flex-wrap: wrap; gap: 12px; margin: 0; }
.hero__actions--center { justify-content: center; }
.hero__fine { color: var(--fg3) !important; font-size: 13px !important; margin: 18px 0 0 !important; }

/* ── bands below the tour ── */
.band { position: relative; isolation: isolate; overflow: hidden; padding: clamp(96px, 12vw, 168px) var(--gutter); }
.band__inner { position: relative; max-width: 1200px; margin: 0 auto; }
.band h2 { font-size: clamp(34px, 4.4vw, 60px); line-height: 1.04; max-width: 17ch; margin: 0 0 22px; }
.band p { color: var(--fg2); }
.band__lead { font-size: clamp(17px, 1.45vw, 20px); max-width: 62ch; }
.band__note { color: var(--fg3) !important; font-size: 14px; max-width: 72ch; }
.band__note a { color: #d4d0ff; }
.center { text-align: center; margin-left: auto; margin-right: auto; }
.center h2, .center .band__lead { margin-left: auto; margin-right: auto; }
.split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: clamp(40px, 6vw, 96px); align-items: center; }
.band__glow { position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background:
    radial-gradient(45% 55% at 12% 20%, rgba(75, 63, 206, .38), transparent 70%),
    radial-gradient(40% 50% at 88% 40%, rgba(192, 79, 174, .3), transparent 70%),
    radial-gradient(35% 40% at 60% 100%, rgba(255, 122, 89, .18), transparent 70%); }
.band__glow::after { content: ""; position: absolute; inset: 0; opacity: .35;
  background-image: linear-gradient(rgba(154, 146, 255, .07) 1px, transparent 1px), linear-gradient(90deg, rgba(154, 146, 255, .07) 1px, transparent 1px);
  background-size: 56px 56px; mask-image: radial-gradient(70% 70% at 50% 40%, #000, transparent); -webkit-mask-image: radial-gradient(70% 70% at 50% 40%, #000, transparent); }
.band__glow--warm { background:
    radial-gradient(50% 50% at 50% 0%, rgba(122, 76, 224, .4), transparent 70%),
    radial-gradient(40% 45% at 15% 90%, rgba(255, 77, 121, .22), transparent 70%),
    radial-gradient(40% 45% at 85% 90%, rgba(255, 173, 51, .18), transparent 70%); }

/* your machines, over footage */
.band--owned { background: var(--ink); }
.film { position: absolute; inset: 0; z-index: -1; }
.film__poster, .film__video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.film__video { opacity: 0; transition: opacity 1.4s ease; }
.film__video.is-playing { opacity: 1; }
.film::after { content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, rgba(12, 11, 29, .92) 0%, rgba(12, 11, 29, .6) 42%, rgba(12, 11, 29, 0) 72%),
    linear-gradient(180deg, var(--ink) 0%, transparent 14%, transparent 86%, var(--ink) 100%),
    linear-gradient(0deg, rgba(122, 76, 224, .18), rgba(122, 76, 224, .18)); }
.facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 48px 0 30px; }
.facts > div { padding: 24px 22px; border-radius: 16px; background: rgba(28, 27, 58, .78); border: 1px solid var(--line); }
.facts dt { font: 700 clamp(36px, 4vw, 56px)/1 var(--display); letter-spacing: -.04em; margin-bottom: 12px;
  color: transparent; background: linear-gradient(180deg, #fff, #b3abff); -webkit-background-clip: text; background-clip: text; }
.facts dd { margin: 0; color: var(--fg2); font-size: 14px; line-height: 1.5; }

/* the first hour: a timeline beside a terminal */
.band--start { background: linear-gradient(180deg, var(--ink) 0%, #120f2c 100%); }
.steps { list-style: none; margin: 36px 0 28px; padding: 0; position: relative; }
.steps::before { content: ""; position: absolute; left: 17px; top: 18px; bottom: 18px; width: 2px; background: linear-gradient(180deg, #4b3fce, #c04fae, #ffad33); }
.step { position: relative; display: flex; gap: 18px; padding: 0 0 22px; }
.step__n { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: var(--ink2);
  border: 2px solid var(--primary); font: 700 14px/1 var(--mono); color: #fff; box-shadow: 0 0 16px rgba(154, 146, 255, .45); z-index: 1; }
.step:last-child .step__n { background: var(--warm); border-color: transparent; }
.step h3 { display: flex; align-items: center; gap: 10px; font-size: 19px; margin: 4px 0 4px; }
.step__time { font: 600 11px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--amber);
  padding: 4px 7px; border-radius: 6px; background: rgba(255, 173, 51, .12); }
.step p { margin: 0; font-size: 15px; }
.term { margin: 0; border-radius: 16px; overflow: hidden; background: #0a0918; border: 1px solid rgba(154, 146, 255, .3);
  transform: perspective(1600px) rotateY(-9deg) rotateX(4deg);
  box-shadow: 0 50px 120px -40px rgba(0, 0, 0, .9), 0 0 100px -20px rgba(192, 79, 174, .5), 0 0 0 1px rgba(255, 255, 255, .03) inset; }
.term__bar { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 14px; background: #15132e; border-bottom: 1px solid var(--line); }
.term__bar > span { width: 12px; height: 12px; border-radius: 50%; background: var(--coral); }
.term__bar > span:nth-child(2) { background: var(--amber); }
.term__bar > span:nth-child(3) { background: var(--teal); }
.term__bar b { margin-left: 10px; font: 600 12px/1 var(--mono); color: var(--fg3); }
.term__copy { margin-left: auto; min-height: 28px; padding: 0 10px; border-radius: 7px; border: 1px solid var(--line); background: transparent;
  color: var(--fg2); font: 600 12px/1 var(--text); cursor: pointer; }
.term__copy:hover { color: var(--fg); border-color: rgba(154, 146, 255, .5); }
.term__body { margin: 0; padding: 22px 22px 26px; font: 13px/1.85 var(--mono); white-space: pre-wrap; word-break: break-word; min-height: 330px; }
.term__line { display: block; color: var(--fg2); }
.term__line--cmd { color: #fff; margin-top: 10px; }
.term__line--cmd:first-child { margin-top: 0; }
.term__ps { color: var(--pink); }
.term__line--ok { color: #bff5e6; }
.term__line--done { color: var(--amber); font-weight: 600; }
.term figcaption { padding: 10px 22px 14px; font-size: 12px; color: var(--fg3); border-top: 1px solid var(--line); }
html.js .term__line { opacity: 0; transform: translateY(4px); transition: opacity .25s ease, transform .25s ease; }
html.js .term.is-on .term__line { opacity: 1; transform: none; }
${Array.from({ length: 9 }, (_, i) => `.term.is-on .term__line:nth-child(${i + 1}) { transition-delay: ${(i * 0.42 + (i >= 6 ? 0.6 : 0)).toFixed(2)}s; }`).join('\n')}

/* plans: cards, the free one glowing */
.band--plans { background: #100e26; }
.plans { list-style: none; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; margin: 52px 0 26px; padding: 0; }
.plan { position: relative; display: flex; flex-direction: column; padding: 26px 22px 22px; border-radius: 20px;
  background: linear-gradient(180deg, rgba(34, 33, 74, .9), rgba(22, 21, 48, .9)); border: 1px solid var(--line);
  transition: transform .3s ease, border-color .3s ease; }
.plan:hover { transform: translateY(-4px); border-color: rgba(154, 146, 255, .45); }
.plan--free { border: 1.5px solid transparent;
  background: linear-gradient(180deg, #26215a, #191740) padding-box, linear-gradient(135deg, #7a4ce0, #ff4d79, #ffad33) border-box;
  box-shadow: 0 30px 90px -30px rgba(255, 77, 121, .55), 0 0 60px -20px rgba(122, 76, 224, .6); }
.plan__ribbon { position: absolute; top: -12px; left: 22px; padding: 5px 10px; border-radius: 999px; background: var(--warm);
  color: #2a0d12; font: 700 11px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
.plan__name { font-size: 20px; }
.plan__price { margin: 10px 0 4px; font: 700 34px/1.1 var(--display); letter-spacing: -.03em; color: var(--fg) !important; }
.plan__price small { display: block; margin-top: 2px; font: 500 13px var(--text); color: var(--fg3); letter-spacing: 0; }
.plan__who { margin: 0 0 16px; font-size: 13px; color: var(--fg3) !important; }
.plan__list { list-style: none; margin: 0 0 22px; padding: 0; flex: 1; font-size: 14px; color: var(--fg2); }
.plan__list li { position: relative; padding: 5px 0 5px 24px; }
.plan__list li::before { content: ""; position: absolute; left: 0; top: 10px; width: 14px; height: 8px; border-left: 2px solid var(--teal);
  border-bottom: 2px solid var(--teal); transform: rotate(-45deg); }

/* questions, beside the inbox */
.band--faq { background: radial-gradient(50% 60% at 15% 50%, rgba(75, 63, 206, .28), transparent 70%), var(--ink); }
.split--faq { align-items: start; }
.faq__shot { margin: 34px 0 0; transform: perspective(1600px) rotateY(10deg) rotateX(3deg); transform-origin: left center; }
.faq__shot img { display: block; width: 100%; height: auto; border-radius: 14px;
  box-shadow: 0 0 0 1px rgba(154, 146, 255, .28), 0 40px 100px -40px rgba(0, 0, 0, .9), 0 0 80px -20px rgba(122, 76, 224, .55); }
.faq__shot figcaption { margin-top: 10px; font-size: 12px; color: var(--fg3); }
.faqs { display: grid; gap: 12px; }
.faq { border-radius: 16px; background: rgba(28, 27, 58, .7); border: 1px solid var(--line); transition: border-color .2s, background .2s; }
.faq[open] { background: rgba(34, 33, 74, .9); border-color: rgba(154, 146, 255, .45); }
.faq summary { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 20px 22px; cursor: pointer; list-style: none;
  font: 600 18px/1.35 var(--display); }
.faq summary::-webkit-details-marker { display: none; }
.faq summary::after { content: "+"; flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%;
  background: #2e2878; color: #e4e1ff; font-weight: 400; transition: transform .25s ease; }
.faq[open] summary::after { transform: rotate(45deg); background: var(--band); }
.faq p { margin: 0; padding: 0 22px 22px; max-width: 62ch; }

/* [PCODE-451 | S15 | v0.1.0] the finale: the mark in 3D, the name, the invitation */
.finale { position: relative; isolation: isolate; overflow: hidden; display: grid; place-items: center; text-align: center;
  min-height: 100vh; padding: 96px var(--gutter) 110px; }
.finale__light { position: absolute; inset: 0; z-index: -1;
  background: radial-gradient(34% 30% at 50% 34%, rgba(122, 76, 224, .42), transparent 70%),
    radial-gradient(28% 22% at 58% 30%, rgba(192, 79, 174, .3), transparent 70%),
    radial-gradient(60% 18% at 50% 100%, rgba(75, 63, 206, .25), transparent 70%); }
.finale__inner { max-width: 860px; }
/* [PCODE-452 | S15 | v0.1.0] a larger stage: the ring fills about two thirds of it, so it never touches the edge */
.mark3d { position: relative; width: min(540px, 92vw); aspect-ratio: 1; margin: -60px auto -84px; }
.mark3d__still { position: absolute; inset: 18%; width: 64%; height: 64%; transition: opacity .6s ease; }
.mark3d__canvas { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; transition: opacity .6s ease; }
.mark3d.is-live .mark3d__canvas { opacity: 1; }
.mark3d.is-live .mark3d__still { opacity: 0; }
.finale .wordmark { margin: 0 0 30px !important; font: 700 clamp(60px, 9vw, 124px)/1 var(--display); letter-spacing: -.045em;
  color: #fff; }
/* [PCODE-452 | S15 | v0.1.0] the gradient sits on each letter: on the parent it breaks while the letters turn */
.wordmark__l { display: inline-block; padding-bottom: .08em; color: transparent;
  background: linear-gradient(180deg, #ffffff 20%, #b9b1ff 100%); -webkit-background-clip: text; background-clip: text; }
/* [PCODE-452 | S15 | v0.1.0] the name once the ring has settled, then the invitation. Keyframes, not
   transitions: a transition is skipped when the browser never computed the hidden state, an animation
   always starts from its first frame */
@keyframes wordmark-in {
  from { opacity: 0; transform: perspective(600px) translateY(.35em) rotateX(55deg); filter: blur(8px); }
  to { opacity: 1; transform: none; filter: none; }
}
@keyframes finale-rise {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: none; }
}
html.js .wordmark__l, html.js .finale h2, html.js .finale .finale__line, html.js .finale .hero__actions { opacity: 0; }
html.js .finale.is-on .wordmark__l { animation: wordmark-in 1.1s cubic-bezier(.2, .7, .2, 1) both; }
${Array.from({ length: 6 }, (_, i) => `html.js .finale.is-on .wordmark__l--${i} { animation-delay: ${(2.9 + i * 0.12).toFixed(2)}s; }`).join('\n')}
html.js .finale.is-on h2, html.js .finale.is-on .finale__line { animation: finale-rise 1s cubic-bezier(.2, .7, .2, 1) 3.7s both; }
html.js .finale.is-on .hero__actions { animation: finale-rise 1s cubic-bezier(.2, .7, .2, 1) 3.95s both; }
html.js .finale.is-still .wordmark__l, html.js .finale.is-still h2, html.js .finale.is-still .finale__line,
html.js .finale.is-still .hero__actions { animation-delay: 0s !important; animation-duration: .5s !important; }
.finale h2 { font-size: clamp(28px, 3.6vw, 48px); line-height: 1.1; letter-spacing: -.035em; margin-bottom: 14px; }
.finale p { color: #d1cff0; font-size: 18px; margin: 0 0 30px; }

.foot2 { border-top: 1px solid var(--line); padding: 32px var(--gutter); font-size: 13px; color: var(--fg3); background: var(--ink); }
.foot2__inner { max-width: 1200px; margin: 0 auto; display: flex; flex-wrap: wrap; align-items: center; gap: 16px 28px; }
.foot2 nav { display: flex; flex-wrap: wrap; gap: 8px 20px; }
.foot2 a { color: var(--fg2); text-decoration: none; }
.foot2 a:hover { color: var(--fg); }
.foot2__ver { margin-left: auto; }

/* without JavaScript, or on a phone: each chapter shows its screen inline, no 3D deck */
html.no-js .tour__sticky { display: none; }
html.no-js .tour__chapters { margin-top: 0; pointer-events: auto; }
html.no-js .chapter { min-height: 0; padding-top: 80px; padding-bottom: 80px; }
html.no-js .chapter__shot { display: block; flex: 1; min-width: 0; }
@media (max-width: 1100px) {
  .rail__label { display: none; }
  .rail__stop.is-current .rail__label { display: block; position: absolute; bottom: 24px; white-space: nowrap; }
  .facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .plans { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 860px) {
  .tour__sticky { display: none; }
  .tour__chapters { margin-top: 0; pointer-events: auto; }
  .chapter, .hero { flex-direction: column; align-items: stretch; min-height: 0; gap: 28px; padding-top: 72px; padding-bottom: 72px; }
  .hero { padding-top: 104px; }
  .chapter__text, .hero .chapter__text { width: auto; }
  .chapter__shot { display: block; }
  .chapter__demo { display: block; }
  html.js .chapter__text { opacity: 1; transform: none; }
  .split { grid-template-columns: minmax(0, 1fr); }
  .term, .faq__shot { transform: none; }
}
@media (max-width: 640px) {
  body.landing { font-size: 15px; }
  .bar { gap: 12px; height: 58px; }
  .bar__nav { display: none; }
  .bar .btn--small { margin-left: auto; }
  .facts, .plans { grid-template-columns: minmax(0, 1fr); }
  .term__body { font-size: 11.5px; padding: 16px; min-height: 0; }
  .foot2__ver { margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation: none !important; }
  .btn, .plan, .faq summary::after, .term__line, .rail__dot { transition: none !important; }
  html.js .chapter__text { transform: none; transition: opacity .5s ease; }
  .pop, .shot.is-active .pop { transition: opacity .5s ease; }
  /* [PCODE-452 | S15 | v0.1.0] keyframes are off here: the name and the invitation simply show */
  html.js .wordmark__l, html.js .finale h2, html.js .finale .finale__line, html.js .finale .hero__actions { opacity: 1; }
}
`;
