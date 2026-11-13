// ── [PCODE-452 | S15 | v0.1.0] Landing page: cinematic arrival of the 3D mark, framed and timed ──
// ── [PCODE-451 | S15 | v0.1.0] Landing page: steady server-room loop, 3D Orqiva mark in the finale ──
// ── [PCODE-449 | S15 | v0.1.0] Landing page: the product tour as real video of Orqiva in use ──
// ── [PCODE-446 | S15 | v0.1.0] Landing page: one scroll step per chapter in the tour ──
// ── [PCODE-445 | S15 | v0.1.0] Landing page: fly through the real product, warmer sections ──
// ── [PCODE-443 | S15 | v0.1.0] Cinematic landing page for the public site ──
//    Why:  the landing page's only script, loaded as a module from the site itself (no inline script, so
//          a strict CSP holds). It ties the tour's 3D deck of product screens to the scroll, runs the
//          approval card, types the install terminal when it comes into view, plays footage only when it
//          is in view, and reports what visitors do as `orqiva:track` events (and to window.dataLayer
//          when a tag manager put one there). The site has no analytics of its own, so by default
//          nothing leaves the browser.
import { createClips } from './clips.js';
import { createDeck, type Deck } from './deck.js';
import { createMark3d } from './mark3d.js';
import { createStepper } from './steps.js';

// ── events ──

interface TrackDetail {
  event: string;
  [key: string]: string | number | boolean;
}

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

const seen = new Set<string>();

/** One event to whoever listens: `window.addEventListener('orqiva:track', e => …)`, or a tag manager. */
export function track(
  event: string,
  extra: Record<string, string | number | boolean> = {},
  once = false,
): void {
  const key = event + JSON.stringify(extra);
  if (once && seen.has(key)) return;
  seen.add(key);
  const detail: TrackDetail = { event, ...extra };
  window.dispatchEvent(new CustomEvent<TrackDetail>('orqiva:track', { detail }));
  if (Array.isArray(window.dataLayer)) window.dataLayer.push({ ...detail });
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- a typed querySelector
const $ = <T extends Element>(sel: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(sel);
const $$ = <T extends Element>(sel: string, root: ParentNode = document): T[] => [
  ...root.querySelectorAll<T>(sel),
];

const media = (q: string): boolean => window.matchMedia(q).matches;
const reducedMotion = media('(prefers-reduced-motion: reduce)');
const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
const saveData = conn?.saveData === true;

document.documentElement.classList.remove('no-js');
document.documentElement.classList.add('js');

// ── clicks, opened questions, scroll depth ──

document.addEventListener('click', (e) => {
  const el = (e.target as Element | null)?.closest<HTMLElement>('[data-track]');
  if (!el) return;
  const name = el.dataset['track'] ?? 'click';
  const href = el.getAttribute('href') ?? '';
  track(name, href ? { href } : {});
  // every way into the install guide is the start of a sign-up for a self-hosted product
  if (href.startsWith('getting-started.html')) track('install_start', { from: name });
});

for (const d of $$<HTMLDetailsElement>('details[data-track-open]'))
  d.addEventListener('toggle', () => {
    if (d.open)
      track(
        d.dataset['trackOpen'] ?? 'open',
        { question: $('summary', d)?.textContent ?? '' },
        true,
      );
  });

const depths = [25, 50, 75, 100];
const bar = $<HTMLElement>('[data-bar]');
const onScroll = (): void => {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const pct = max > 0 ? (window.scrollY / max) * 100 : 100;
  while (depths.length && pct >= (depths[0] ?? 101))
    track('scroll_depth', { percent: depths.shift() ?? 0 });
  bar?.classList.toggle('is-solid', window.scrollY > 40);
};

// ── [PCODE-445 | S15 | v0.1.0] the tour: the deck follows the chapter being read ──

const tour = $<HTMLElement>('[data-tour]');
const chapters = $$<HTMLElement>('[data-chapter]');
let deck: Deck | null = null;
// [PCODE-449 | S15 | v0.1.0] the recorded clips over the screens, and their pause button
let toggleFilms: (playing: boolean) => void = () => undefined;
let toggleMark: (playing: boolean) => void = () => undefined;
const clips = createClips(saveData, (playing) => {
  toggleFilms(playing);
  toggleMark(playing);
  track('motion', { playing });
});

/**
 * The camera position from the scroll: a screen holds while the first half of its chapter is read,
 * then travels to the next one while the rest of the chapter scrolls by.
 */
const tourPosition = (): number => {
  const mid = window.innerHeight / 2;
  for (const c of chapters) {
    const r = c.getBoundingClientRect();
    if (r.top <= mid && r.bottom > mid) {
      const i = Number(c.dataset['chapter'] ?? 0);
      const u = (mid - r.top) / r.height;
      const t = Math.min(1, Math.max(0, (u - 0.55) / 0.45));
      return i + t * t * (3 - 2 * t);
    }
  }
  const first = chapters[0]?.getBoundingClientRect();
  return first && first.top > mid ? 0 : chapters.length - 1;
};

function startTour(): void {
  const rig = $<HTMLElement>('[data-rig]');
  // phones read the chapters with their screens inline; the deck is for wider screens
  if (!tour || !rig || !media('(min-width: 861px)')) return;
  const backdrops = new Map<number, HTMLElement>();
  for (const b of $$<HTMLElement>('[data-bg]')) backdrops.set(Number(b.dataset['bg']), b);
  deck = createDeck(
    {
      rig,
      shots: $$<HTMLElement>('[data-shot]'),
      backdrops,
      railStops: $$<HTMLElement>('[data-rail]'),
      railFill: $<HTMLElement>('[data-rail-fill]'),
    },
    reducedMotion,
    // [PCODE-449 | S15 | v0.1.0] the screen in front plays its clip
    (index) => {
      clips.activate(index);
    },
  );
  deck.setPosition(tourPosition());
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) deck?.setRunning(e.isIntersecting && !document.hidden);
  });
  io.observe(tour);
  document.addEventListener('visibilitychange', () => {
    const r = tour.getBoundingClientRect();
    deck?.setRunning(!document.hidden && r.bottom > 0 && r.top < window.innerHeight);
  });
  if (media('(pointer: fine)'))
    window.addEventListener(
      'pointermove',
      (e) => {
        deck?.setPointer(
          (e.clientX / window.innerWidth) * 2 - 1,
          (e.clientY / window.innerHeight) * 2 - 1,
        );
      },
      { passive: true },
    );
  track('tour_start', { reducedMotion }, true);

  // [PCODE-446 | S15 | v0.1.0] one wheel notch or key press moves one chapter; links to a chapter glide too
  const stepper = createStepper(tour, chapters, reducedMotion, (index, how) => {
    track('tour_step', { index, how });
  });
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
    const id = a?.getAttribute('href')?.slice(1);
    const chapter = id ? document.getElementById(id) : null;
    if (!chapter?.dataset['chapter']) return;
    e.preventDefault();
    stepper.go(Number(chapter.dataset['chapter']));
  });
}
startTour();

// the chapter in the middle of the screen is the active one
const chapterIo = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      for (const c of chapters) c.classList.toggle('is-active', c === el);
      track('chapter_view', { chapter: el.id || 'top' }, true);
    }
  },
  { rootMargin: '-45% 0px -45% 0px' },
);
for (const c of chapters) chapterIo.observe(c);
chapters[0]?.classList.add('is-active');

let ticking = false;
window.addEventListener(
  'scroll',
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      deck?.setPosition(tourPosition());
      onScroll();
    });
  },
  { passive: true },
);
onScroll();

// ── [PCODE-445 | S15 | v0.1.0] the approval card: the Coder waits for the visitor ──

function approvalCard(card: HTMLElement): void {
  const done = $<HTMLElement>('[data-approved]', card);
  const actions = $<HTMLElement>('.approve__actions', card);
  // the outcome is announced; the card itself does not chatter
  const said = document.createElement('span');
  said.className = 'sr';
  said.setAttribute('aria-live', 'polite');
  card.append(said);
  const finish = (approved: boolean): void => {
    if (done) {
      done.hidden = false;
      done.lastChild?.remove();
      done.append(
        approved
          ? 'Approved by you. Coder continues, and the step is in the trace.'
          : 'Still waiting in the inbox. Nothing runs until a person approves.',
      );
      said.textContent = done.textContent;
    }
    actions?.setAttribute('hidden', '');
    card.classList.toggle('is-approved', approved);
    track('demo_decision', { approved }, true);
  };
  $('[data-approve]', card)?.addEventListener('click', () => {
    finish(true);
  });
  $('[data-hold]', card)?.addEventListener('click', () => {
    finish(false);
  });
}
// the deck's card on wide screens, the chapter's card on phones
for (const card of $$<HTMLElement>('[data-approve-card]')) approvalCard(card);

// ── [PCODE-445 | S15 | v0.1.0] the install terminal types itself when it comes into view ──

const term = $<HTMLElement>('[data-term]');
if (term) {
  const termIo = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      term.classList.add('is-on');
      termIo.disconnect();
      track('terminal_view', {}, true);
    },
    { threshold: 0.35 },
  );
  termIo.observe(term);
}

// ── copy the install command ──

for (const b of $$<HTMLButtonElement>('[data-copy]'))
  b.addEventListener('click', () => {
    const text = b.dataset['copy'] ?? '';
    const label = b.textContent;
    const done = (ok: boolean): void => {
      b.textContent = ok ? 'Copied' : 'Select and copy';
      setTimeout(() => (b.textContent = label), 1600);
    };
    if ('clipboard' in navigator)
      navigator.clipboard.writeText(text).then(
        () => {
          done(true);
        },
        () => {
          done(false);
        },
      );
    else done(false);
  });

// ── [PCODE-451 | S15 | v0.1.0] the finale: the mark arrives in 3D and the name assembles when it comes into view ──

const finale = $<HTMLElement>('.finale');
const markBox = $<HTMLElement>('[data-mark3d]');
const markCanvas = $<HTMLCanvasElement>('[data-mark3d-canvas]');
if (finale && markBox && markCanvas) {
  // decorative: with reduced motion it holds its finished frame
  const motionOn = (): boolean => clips.playing() && !reducedMotion;
  const mark = ((): ReturnType<typeof createMark3d> => {
    try {
      return createMark3d(markCanvas, motionOn());
    } catch {
      return null;
    }
  })();
  if (mark) markBox.classList.add('is-live');
  toggleMark = () => {
    mark?.setMotion(motionOn());
  };
  // [PCODE-452 | S15 | v0.1.0] renders while any of the finale is on screen; the arrival and the
  // name begin only once the mark is (nearly) fully in view, so none of it plays off screen
  const finaleIo = new IntersectionObserver(
    (entries) => {
      for (const e of entries) mark?.setRunning(e.isIntersecting && !document.hidden);
    },
    { threshold: 0 },
  );
  finaleIo.observe(finale);
  const arriveIo = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      arriveIo.disconnect();
      // still (paused, reduced motion, no WebGL): everything at once
      finale.classList.toggle('is-still', !motionOn() || !mark);
      finale.classList.add('is-on');
      mark?.play();
      track('finale_view', {}, true);
    },
    { threshold: 0.9 },
  );
  arriveIo.observe(markBox);
  if (mark && media('(pointer: fine)'))
    window.addEventListener(
      'pointermove',
      (e) => {
        mark.setPointer(
          (e.clientX / window.innerWidth) * 2 - 1,
          (e.clientY / window.innerHeight) * 2 - 1,
        );
      },
      { passive: true },
    );
}

// ── [PCODE-449 | S15 | v0.1.0] footage plays in view while moving pictures are on (the tour's button) ──

const films = $$<HTMLVideoElement>('video[data-film]');
const filmsInView = new Set<HTMLVideoElement>();
const playFilm = (v: HTMLVideoElement): void => {
  if (!v.src) {
    v.src = v.dataset['film'] ?? '';
    v.addEventListener(
      'playing',
      () => {
        v.classList.add('is-playing');
      },
      { once: true },
    );
  }
  v.play().catch(() => {
    // autoplay refused: the still stays
  });
};
toggleFilms = (playing) => {
  for (const v of playing ? filmsInView : films) {
    if (playing) playFilm(v);
    else v.pause();
  }
};
if (films.length) {
  const filmIo = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement;
        if (e.isIntersecting) filmsInView.add(v);
        else filmsInView.delete(v);
        if (e.isIntersecting && clips.playing()) playFilm(v);
        else v.pause();
      }
    },
    { rootMargin: '200px 0px' },
  );
  for (const v of films) filmIo.observe(v);
}
