// ── [PCODE-446 | S15 | v0.1.0] Landing page: one scroll step per chapter in the tour ──
//    Why:  in the tour, one wheel notch or one key press moves exactly one chapter, as one eased glide
//          that ends with the chapter centred and the deck resting on its screen. A trackpad gesture or a
//          spinning wheel sends many events; they count as one step, because input is swallowed until it
//          goes quiet. Above and below the tour the page scrolls as usual, and scrolling back up into
//          the tour lands on its last chapter. Fields, buttons and links keep their own keys.

export interface Stepper {
  /** glide to a chapter, e.g. from the rail */
  go(index: number): void;
}

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Keys that page through the tour, and their direction. */
const KEYS: Record<string, 1 | -1> = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 };

export function createStepper(
  tour: HTMLElement,
  chapters: HTMLElement[],
  reducedMotion: boolean,
  onStep: (index: number, how: string) => void,
): Stepper {
  // where each chapter is centred, the deck then resting exactly on its screen
  const targets = (): number[] =>
    chapters.map((c) => {
      const r = c.getBoundingClientRect();
      return Math.max(
        0,
        Math.round(window.scrollY + r.top + r.height / 2 - window.innerHeight / 2),
      );
    });

  let gliding = false;
  /** input before this moment belongs to the gesture that started the last step */
  let quietUntil = 0;
  const QUIET = 260;

  const glide = (to: number, index: number, how: string): void => {
    const from = window.scrollY;
    const dist = Math.abs(to - from);
    onStep(index, how);
    if (dist < 2) return;
    if (reducedMotion) {
      window.scrollTo({ top: to, behavior: 'instant' });
      quietUntil = performance.now() + QUIET;
      return;
    }
    const duration = Math.min(1300, Math.max(750, 600 + dist * 0.22));
    const start = performance.now();
    gliding = true;
    const frame = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      window.scrollTo({ top: from + (to - from) * ease(t), behavior: 'instant' });
      if (t < 1) requestAnimationFrame(frame);
      else {
        gliding = false;
        quietUntil = performance.now() + QUIET;
      }
    };
    requestAnimationFrame(frame);
  };

  /** The top of the section after the tour: leaving the tour is one step too. */
  const exitAt = (): number =>
    Math.round(window.scrollY + tour.getBoundingClientRect().bottom - 64);

  /** One step in a direction; false when the page should scroll by itself instead. */
  const step = (dir: 1 | -1, how: string): boolean => {
    const t = targets();
    const first = t[0] ?? 0;
    const last = t[t.length - 1] ?? 0;
    const exit = exitAt();
    const y = window.scrollY;
    if (dir > 0) {
      if (y >= exit - 2) return false; // past the tour: the page goes on
      if (y >= last - 2) {
        glide(exit, t.length, how);
        return true;
      }
      const i = t.findIndex((v) => v > y + 2);
      if (i < 0) return false;
      glide(t[i] ?? last, i, how);
      return true;
    }
    // well below the tour the page scrolls itself; from the top of the next section one step leads back in
    if (y > exit + window.innerHeight / 2) return false;
    if (y > last + 2) {
      // coming back up into the tour: its last chapter first
      glide(last, t.length - 1, how);
      return true;
    }
    if (y <= first + 2) return false;
    let i = -1;
    t.forEach((v, k) => {
      if (v < y - 2) i = k;
    });
    if (i < 0) return false;
    glide(t[i] ?? first, i, how);
    return true;
  };

  const inTour = (): boolean => window.scrollY <= exitAt() + window.innerHeight / 2;

  window.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX) || e.deltaY === 0) return;
      const now = performance.now();
      if (gliding || now < quietUntil) {
        // the rest of the gesture that already moved one step
        if (inTour()) {
          e.preventDefault();
          quietUntil = Math.max(quietUntil, now + QUIET);
        }
        return;
      }
      if (step(e.deltaY > 0 ? 1 : -1, 'wheel')) {
        e.preventDefault();
        quietUntil = now + QUIET;
      }
    },
    { passive: false },
  );

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;
    let dir = KEYS[e.key];
    if (e.key === ' ') {
      // Space on a button, a link or a question belongs to it
      if (el?.closest('button, a, summary')) return;
      dir = e.shiftKey ? -1 : 1;
    }
    if (!dir) return;
    if (gliding) {
      if (inTour()) e.preventDefault();
      return;
    }
    if (step(dir, 'key')) e.preventDefault();
  });

  return {
    go(index) {
      const t = targets();
      const to = t[index];
      if (to !== undefined) glide(to, index, 'rail');
    },
  };
}
