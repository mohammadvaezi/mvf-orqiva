// ── [PCODE-449 | S15 | v0.1.0] Landing page: the product tour as real video of Orqiva in use ──
// ── [PCODE-445 | S15 | v0.1.0] Landing page: fly through the real product, warmer sections ──
//    Why:  the tour's 3D: a deck of Orqiva's real screens in CSS perspective that the camera moves
//          through as the page scrolls. The current screen is in front with its cards lifted off it, the
//          next ones wait behind it in depth, the passed ones fly past the viewer. Only transform and
//          opacity change, so the browser composites it on the GPU without repainting: smooth on
//          integrated graphics and over remote desktops. With reduced motion the screens cross-fade in
//          place instead of travelling.

export interface DeckParts {
  rig: HTMLElement;
  shots: HTMLElement[];
  backdrops: Map<number, HTMLElement>;
  railStops: HTMLElement[];
  railFill: HTMLElement | null;
}

export interface Deck {
  /** the camera position in screens: 0 = first screen, 1 = second, fractions in between */
  setPosition(f: number): void;
  /** -1..1 from the pointer */
  setPointer(x: number, y: number): void;
  setRunning(on: boolean): void;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round3 = (x: number): string => (Math.round(x * 1000) / 1000).toString();

/** Where a screen sits when it is d screens away from the camera (d < 0: already passed). */
function placement(d: number): { transform: string; opacity: number; dim: number } {
  if (d < 0) {
    // passing: towards the viewer and off to the left, fading fast
    const t = -d;
    return {
      transform:
        'translate3d(' +
        round3(-t * 34) +
        '%,' +
        round3(t * 6) +
        '%,' +
        round3(t * 760) +
        'px) rotateY(' +
        round3(t * 6) +
        'deg)',
      opacity: clamp(1 - t * 1.9, 0, 1),
      dim: 0,
    };
  }
  // waiting: behind, up and to the right, a little darker the further back
  return {
    transform:
      'translate3d(' +
      round3(d * 15) +
      '%,' +
      round3(-d * 8) +
      '%,' +
      round3(-d * 520) +
      'px) rotateY(' +
      round3(-d * 3) +
      'deg)',
    opacity: d > 2.6 ? 0 : clamp(1 - d * 0.18, 0, 1),
    dim: clamp(d * 0.34, 0, 0.72),
  };
}

export function createDeck(
  parts: DeckParts,
  reducedMotion: boolean,
  // [PCODE-449 | S15 | v0.1.0] tells the page which screen is in front, so its clip can play
  onActive: (index: number) => void = () => undefined,
): Deck {
  const n = parts.shots.length;
  const dims = parts.shots.map((s) => s.querySelector<HTMLElement>('.shot__dim'));
  // write a style only when it changed, so a settled deck costs nothing
  const last = new WeakMap<HTMLElement, Partial<Record<'transform' | 'opacity', string>>>();
  const set = (
    el: HTMLElement | null | undefined,
    prop: 'transform' | 'opacity',
    value: string,
  ): void => {
    if (!el) return;
    const seen = last.get(el) ?? {};
    if (seen[prop] === value) return;
    seen[prop] = value;
    last.set(el, seen);
    el.style[prop] = value;
  };

  let target = 0;
  let pos = 0;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  let running = false;
  let raf = 0;
  let lastT = 0;
  let current = -1;

  const render = (): void => {
    const active = clamp(Math.round(pos), 0, n - 1);
    parts.shots.forEach((shot, i) => {
      const d = reducedMotion ? (i === active ? 0 : 3) : i - pos;
      const p = placement(d);
      set(shot, 'transform', reducedMotion ? 'none' : p.transform);
      set(shot, 'opacity', round3(reducedMotion ? (i === active ? 1 : 0) : p.opacity));
      // a screen that cannot be seen is not composited at all
      shot.style.visibility = (reducedMotion ? i === active : p.opacity > 0.01)
        ? 'visible'
        : 'hidden';
      set(dims[i], 'opacity', round3(p.dim));
      const bg = parts.backdrops.get(i);
      set(
        bg,
        'opacity',
        round3(clamp(1 - Math.abs(reducedMotion ? i - active : d) * 1.5, 0, 1) * 0.9),
      );
    });
    if (active !== current) {
      current = active;
      onActive(active);
      parts.shots.forEach((s, i) => s.classList.toggle('is-active', i === active));
      parts.railStops.forEach((s, i) => {
        s.classList.toggle('is-passed', i < active);
        s.classList.toggle('is-current', i === active);
        if (i === active) s.setAttribute('aria-current', 'step');
        else s.removeAttribute('aria-current');
      });
    }
    set(
      parts.railFill,
      'transform',
      'scaleX(' + round3(n > 1 ? clamp(pos / (n - 1), 0, 1) : 0) + ')',
    );
    set(
      parts.rig,
      'transform',
      'rotateY(' +
        round3(-17 + pointer.sx * 3.5) +
        'deg) rotateX(' +
        round3(8 - pointer.sy * 2.5) +
        'deg) rotateZ(1deg)',
    );
  };

  const frame = (t: number): void => {
    raf = 0;
    const dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 0.016);
    lastT = t;
    // glide towards the scroll position; with reduced motion jump, and let CSS fade
    const k = reducedMotion ? 1 : 1 - Math.pow(0.003, dt);
    pos += (target - pos) * k;
    pointer.sx += (pointer.x - pointer.sx) * k;
    pointer.sy += (pointer.y - pointer.sy) * k;
    render();
    const settled =
      Math.abs(target - pos) < 0.0008 &&
      Math.abs(pointer.x - pointer.sx) < 0.002 &&
      Math.abs(pointer.y - pointer.sy) < 0.002;
    if (running && !settled) raf = requestAnimationFrame(frame);
    else lastT = 0;
  };

  const kick = (): void => {
    if (running && !raf) raf = requestAnimationFrame(frame);
  };

  if (reducedMotion) for (const s of parts.shots) s.style.transition = 'opacity .5s ease';
  render();

  return {
    setPosition(f) {
      target = clamp(f, 0, n - 1);
      kick();
    },
    setPointer(x, y) {
      if (reducedMotion) return;
      pointer.x = clamp(x, -1, 1);
      pointer.y = clamp(y, -1, 1);
      kick();
    },
    setRunning(on) {
      running = on;
      if (on) kick();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        lastT = 0;
      }
    },
  };
}
