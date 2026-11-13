// ── [PCODE-422 | S15 | v0.1.0] T37 medium: German leftovers ──
// ── [PCODE-357 | S15 | v0.1.0] T35.5b German texts for the whole app ──
// ── [PCODE-356 | S15 | v0.1.0] T35.5a Translation layer for a German UI, language choice, text extraction ──
//    Why:  Orqiva's texts are written in English in its screens. With German chosen, this layer shows each
//          text from the dictionary instead: exactly when the text is known, by a rule when it carries
//          numbers or names ("12 events match"), and leaves it as it is when neither knows it. It works on
//          the page itself (text, placeholders, labels, titles), so every screen takes part without each
//          one asking for its texts; code, names and what people wrote stay untouched.

export type Dictionary = Readonly<Record<string, string>>;

/** A rule for a text with parts that change: "{n} events match" → "{n} Ereignisse passen". */
export interface Pattern {
  re: RegExp;
  to: string;
  /** the placeholders of the rule, in order: {n}, {x}, {x2} … */
  names: string[];
  /** how much of the English text is fixed */
  fixed: number;
}

/** Rules from dictionary entries that hold {n} (a number) or {x} (anything) in the English text. */
export function patternsOf(dict: Dictionary): Pattern[] {
  const out: Pattern[] = [];
  for (const [en, de] of Object.entries(dict)) {
    if (!/\{[nx]\d?\}/.test(en)) continue;
    const names: string[] = [];
    const src = en
      .split(/(\{[nx]\d?\})/)
      .map((part) => {
        const m = /^\{([nx])(\d?)\}$/.exec(part);
        if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        names.push(part);
        return m[1] === 'n' ? '(-?[\\d.,]+)' : '(.+?)';
      })
      .join('');
    out.push({
      re: new RegExp('^' + src + '$'),
      to: de,
      names,
      fixed: en.replace(/\{[nx]\d?\}/g, '').length,
    });
  }
  // the rule with the most fixed text first: the more specific rule wins
  return out.sort((a, b) => b.fixed - a.fixed);
}

export interface Translator {
  (text: string): string | null;
}

/** A translator over a dictionary: exact texts first, then the rules; null when it does not know the text. */
export function translator(
  dict: Dictionary,
  patterns: readonly Pattern[] = patternsOf(dict),
): Translator {
  // [PCODE-422 | S15 | v0.1.0] a text by its rules: exact, then a rule with placeholders, whose names are
  // translated in turn ("last seen 3 d ago" → "zuletzt gesehen vor 3 T.")
  const byRule = (core: string, depth: number): string | null => {
    const exact = dict[core];
    if (exact !== undefined) return exact;
    for (const p of patterns) {
      const m = p.re.exec(core);
      if (!m) continue;
      let out = p.to;
      p.names.forEach((name, i) => {
        const v = m[i + 1] ?? '';
        out = out
          .split(name)
          .join(name.startsWith('{x') ? ((depth < 2 ? byRule(v, depth + 1) : dict[v]) ?? v) : v);
      });
      return out;
    }
    return null;
  };
  return (text: string): string | null => {
    const lead = /^\s*/.exec(text)?.[0] ?? '';
    const trail = /\s*$/.exec(text)?.[0] ?? '';
    const core = text.trim().replace(/\s+/g, ' ');
    if (!core || !/[A-Za-z]/.test(core)) return null;
    const whole = byRule(core, 0);
    if (whole !== null) return lead + whole + trail;
    // [PCODE-357 | S15 | v0.1.0] parts joined with " · " ("Dev Workspace · Owner"): each part on its own
    const one = (x: string): string | null => {
      // [PCODE-422 | S15 | v0.1.0] a part may match a rule too ("12 agents")
      const ruled = byRule(x, 0);
      if (ruled !== null) return ruled;
      // a number before or after a known text: "6 waiting for a decision", "Alerts without an incident 1"
      const pre = /^(-?[\d.,]+ ?%?)\s+(.+)$/.exec(x);
      const preText = pre?.[2] ? dict[pre[2]] : undefined;
      if (preText !== undefined) return (pre?.[1] ?? '') + ' ' + preText;
      const post = /^(.+?)\s+(-?[\d.,]+)$/.exec(x);
      const postText = post?.[1] ? dict[post[1]] : undefined;
      if (postText !== undefined) return postText + ' ' + (post?.[2] ?? '');
      return null;
    };
    const parts = core.split(' · ');
    const each = parts.map(one);
    if (each.some((x) => x !== null))
      return lead + parts.map((x, i) => each[i] ?? x).join(' · ') + trail;
    return null;
  };
}

const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'] as const;
/** Inside these, nothing is translated: code, what people write, and anything marked translate="no". */
const SKIP =
  'code, pre, kbd, textarea, script, style, [translate="no"], [contenteditable="true"], .pv-mono, .ProseMirror';

const ORIGINAL = new WeakMap<Node, string>();
const ORIGINAL_ATTR = new WeakMap<Element, Map<string, string>>();

function textNode(n: Text, t: Translator): void {
  const now = n.nodeValue ?? '';
  const before = ORIGINAL.get(n);
  // React changed the text since: start from what it wrote
  const source = before !== undefined && now === (t(before) ?? before) ? before : now;
  const de = t(source);
  ORIGINAL.set(n, source);
  if (de !== null && de !== now) n.nodeValue = de;
}

function element(el: Element, t: Translator): void {
  let kept = ORIGINAL_ATTR.get(el);
  for (const a of ATTRS) {
    const now = el.getAttribute(a);
    if (now === null) continue;
    const before = kept?.get(a);
    const source = before !== undefined && now === (t(before) ?? before) ? before : now;
    const de = t(source);
    if (!kept) {
      kept = new Map();
      ORIGINAL_ATTR.set(el, kept);
    }
    kept.set(a, source);
    if (de !== null && de !== now) el.setAttribute(a, de);
  }
}

/** Translates everything under a node once. */
export function translateTree(root: Node, t: Translator): void {
  if (root.nodeType === 3) {
    const parent = root.parentElement;
    if (parent && !parent.closest(SKIP)) textNode(root as Text, t);
    return;
  }
  if (!(root instanceof Element) || root.closest(SKIP)) return;
  element(root, t);
  const walker = root.ownerDocument.createTreeWalker(root, 1 | 4, {
    acceptNode: (n) =>
      n.nodeType === 1 && (n as Element).matches(SKIP) ? 2 /* reject the subtree */ : 1,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) textNode(n as Text, t);
    else element(n as Element, t);
  }
}

/** Keeps a page translated as it changes; returns the function that stops it. */
export function startTranslating(root: Element, t: Translator): () => void {
  translateTree(root, t);
  const busy = { on: false };
  const obs = new MutationObserver((records) => {
    if (busy.on) return;
    busy.on = true;
    try {
      for (const r of records) {
        if (r.type === 'childList')
          r.addedNodes.forEach((n) => {
            translateTree(n, t);
          });
        else if (r.type === 'characterData') translateTree(r.target, t);
        else if (r.target instanceof Element) translateTree(r.target, t);
      }
    } finally {
      // our own changes come back as records: drop them
      obs.takeRecords();
      busy.on = false;
    }
  });
  obs.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRS],
  });
  return () => {
    obs.disconnect();
  };
}
