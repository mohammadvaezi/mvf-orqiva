// ── [PCODE-449 | S15 | v0.1.0] Landing page: the product tour as real video of Orqiva in use ──
//    Why:  the tour's screens move: each has a short recording of the product in use, played over its
//          screenshot. In the deck only the screen in front plays, from its start, and the next one is
//          fetched ahead; on phones a clip plays while it is in view. One button pauses or plays them all
//          (moving content must be pausable), and the choice is kept for the visitor. With Save-Data
//          they start paused, and nothing is fetched until the visitor presses play.

export interface Clips {
  /** the deck brought this screen to the front */
  activate(index: number): void;
  /** whether moving pictures play (the visitor's choice) */
  playing(): boolean;
}

const KEY = 'orqiva.motion';

const stored = (): 'on' | 'off' | null => {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
};

export function createClips(saveData: boolean, onToggle: (playing: boolean) => void): Clips {
  const pref = stored();
  // the product in use is the content of the page, so it plays unless the visitor saves data or paused
  // it before; reduced motion still keeps the 3D camera from travelling (client/deck.ts)
  let playing = pref ? pref === 'on' : !saveData;
  let current = -1;

  const deckClips = new Map<number, HTMLVideoElement>();
  for (const v of document.querySelectorAll<HTMLVideoElement>('.shot__video')) {
    const i = Number(v.closest<HTMLElement>('[data-shot]')?.dataset['shot'] ?? -1);
    if (i >= 0) deckClips.set(i, v);
  }
  const inline = [...document.querySelectorAll<HTMLVideoElement>('.chapter__video')];
  const inView = new Set<HTMLVideoElement>();

  /** Gives a clip its source the first time it is needed; it shows once it really plays. */
  const load = (v: HTMLVideoElement | undefined): void => {
    if (!v || v.src) return;
    v.preload = 'auto';
    v.addEventListener('playing', () => {
      v.classList.add('is-playing');
    });
    v.src = v.dataset['clip'] ?? '';
  };
  const play = (v: HTMLVideoElement | undefined, fromStart: boolean): void => {
    if (!v) return;
    load(v);
    if (fromStart) v.currentTime = 0;
    v.play().catch(() => {
      // refused (autoplay rules): the screenshot stays
    });
  };

  const button = document.querySelector<HTMLButtonElement>('[data-motion]');
  const label = button?.querySelector<HTMLElement>('[data-motion-label]');
  const show = (): void => {
    button?.setAttribute('aria-pressed', playing ? 'false' : 'true');
    if (label) label.textContent = playing ? 'Pause the screens' : 'Play the screens';
  };
  show();

  button?.addEventListener('click', () => {
    playing = !playing;
    try {
      window.localStorage.setItem(KEY, playing ? 'on' : 'off');
    } catch {
      // private window: the choice lasts for this page only
    }
    show();
    if (playing) {
      play(deckClips.get(current), false);
      for (const v of inView) play(v, false);
    } else {
      for (const v of deckClips.values()) v.pause();
      for (const v of inline) v.pause();
    }
    onToggle(playing);
  });

  // on phones (and wherever the deck is not used) a clip plays while half of it is in view
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement;
        if (e.isIntersecting) {
          inView.add(v);
          if (playing) play(v, false);
        } else {
          inView.delete(v);
          v.pause();
        }
      }
    },
    { threshold: 0.5 },
  );
  for (const v of inline) io.observe(v);

  return {
    playing: () => playing,
    activate(index) {
      if (index === current) return;
      current = index;
      for (const [i, v] of deckClips) if (i !== index) v.pause();
      if (!playing) return;
      play(deckClips.get(index), true);
      // the next screen's clip is fetched while this one plays
      load(deckClips.get(index + 1));
    },
  };
}
