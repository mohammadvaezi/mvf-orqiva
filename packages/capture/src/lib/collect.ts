// ── [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox ──
//    Why:  what a page keeps for the next bug: the last console messages, requests and actions, each in a
//          ring that forgets the oldest. An element is named the way a person points at it (button "Pay"),
//          and what someone typed is never kept, only where.

export interface ConsoleEntry {
  level: 'error' | 'warn' | 'info' | 'log' | 'debug';
  text: string;
  at: string;
}
export interface NetworkEntry {
  method: string;
  url: string;
  status: number;
  ms: number;
  at: string;
}
export interface ActionEntry {
  kind: 'click' | 'input' | 'navigate' | 'submit' | 'key';
  target: string;
  at: string;
}

export interface Device {
  userAgent: string;
  platform: string;
  language: string;
  viewport: { width: number; height: number };
  screen: { width: number; height: number; pixelRatio: number };
  timeZone: string;
}

export interface Collected {
  page: { url: string; title: string };
  device: Device;
  console: ConsoleEntry[];
  network: NetworkEntry[];
  actions: ActionEntry[];
}

/** The last n entries, the oldest forgotten. */
export class Ring<T> {
  private items: T[] = [];
  constructor(private readonly size: number) {}
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.size) this.items.splice(0, this.items.length - this.size);
  }
  list(): T[] {
    return [...this.items];
  }
}

/** A console call's arguments as one line of text. */
export function consoleText(args: readonly unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.name + ': ' + a.message;
      try {
        // undefined for a function or undefined itself
        const json = JSON.stringify(a) as string | undefined;
        return json ?? String(a);
      } catch {
        return String(a);
      }
    })
    .join(' ')
    .slice(0, 2000);
}

/** The parts of an element the description reads. */
export interface ElementLike {
  tagName: string;
  getAttribute(name: string): string | null;
  textContent: string | null;
}

const clip = (s: string, n = 40): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/** An element as a person names it: button "Pay", input[name=email], a "Checkout". */
export function describeTarget(el: ElementLike): string {
  const tag = el.tagName.toLowerCase();
  const attr = (n: string): string => el.getAttribute(n) ?? '';
  const label = attr('aria-label') || attr('title') || attr('alt');
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const type = attr('type');
    const name = attr('name') || attr('id') || attr('placeholder') || label;
    return (
      tag +
      (type && tag === 'input' ? '[type=' + type + ']' : '') +
      (name ? '[name=' + clip(name, 30) + ']' : '')
    );
  }
  const text = clip(label || el.textContent || '');
  const id = attr('id');
  return tag + (text ? ' "' + text + '"' : id ? '#' + clip(id, 30) : '');
}

/** The device and window the bug happened in. */
export function deviceOf(w: {
  navigator: { userAgent: string; language: string; platform: string };
  innerWidth: number;
  innerHeight: number;
  screen: { width: number; height: number };
  devicePixelRatio: number;
}): Device {
  return {
    userAgent: w.navigator.userAgent.slice(0, 500),
    platform: w.navigator.platform.slice(0, 100),
    language: w.navigator.language.slice(0, 40),
    viewport: { width: w.innerWidth, height: w.innerHeight },
    screen: { width: w.screen.width, height: w.screen.height, pixelRatio: w.devicePixelRatio },
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** A page address as an action keeps it: path and fragment, not the query (it may carry data). */
export const pathOf = (url: string): string => {
  try {
    const u = new URL(url);
    return u.pathname + u.hash;
  } catch {
    return url.slice(0, 300);
  }
};
