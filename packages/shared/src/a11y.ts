// ── [PCODE-411 | S15 | v0.1.0] T36.6 Keyboard-only and screen-reader passes ──
// ── [PCODE-358 | S15 | v0.1.0] T35.6 Accessibility to WCAG 2.2 AA ──
// ── [PCODE-296 | S15 | v0.1.0] T30.9 Accessibility checks: alt text, names, focus order, target size, in the code and on the page ──
//    Why:  two readings of the same rules. In the code, a lint finds what is wrong on its face: images
//          without alt text or with a file name for one, icon-only buttons without a name, clicks on
//          elements the keyboard cannot reach, positive tabindex, inputs without a label, focus styles
//          that hide the outline, buttons styled smaller than 24 px. On a page, an audit run in the
//          browser measures what only the rendered page knows: real target sizes (WCAG 2.5.8, 24 × 24 px
//          or enough space around), the focus order as Tab walks it, whether focus is visible, and names.

export const A11Y_RULES = {
  'alt-missing': 'Image without alt text',
  'alt-filename': 'Alt text that says nothing (a file name or “image”)',
  'name-missing': 'Button or link without a name',
  'click-not-focusable': 'Click on an element the keyboard cannot reach',
  'tabindex-positive': 'Positive tabindex: the focus order jumps',
  'label-missing': 'Form field without a label',
  'focus-hidden': 'Focus style that removes the outline',
  'focus-invisible': 'No visible focus mark',
  'focus-order': 'Focus moves against the reading order',
  'target-size': 'Target smaller than 24 × 24 px',
} as const;
export type A11yRule = keyof typeof A11Y_RULES;

export interface A11yCodeFinding {
  path: string;
  line: number;
  rule: A11yRule;
  /** the start of the element or rule, for the reader */
  snippet: string;
}

export const isMarkupFile = (path: string): boolean =>
  /\.(tsx|jsx|vue|svelte|html|astro)$/i.test(path);
export const isStyleFile = (path: string): boolean => /\.(css|scss|sass|less)$/i.test(path);

const MARKUP_SKIP = /(^|\/)(node_modules|dist|build|out|coverage|vendor)\/|\.min\./;

/** The tag starting at `at` (the '<'): its attributes' text and where it ends, braces and quotes kept. */
export function readTag(
  text: string,
  at: number,
): { attrs: string; end: number; selfClosing: boolean } | null {
  let depth = 0;
  let quote = '';
  for (let i = at + 1; i < text.length && i < at + 4000; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth <= 0) {
      const inner = text.slice(at + 1, i);
      return {
        attrs: inner.replace(/^[\w.:-]+/, ''),
        end: i + 1,
        selfClosing: inner.trimEnd().endsWith('/'),
      };
    }
  }
  return null;
}

const has = (attrs: string, name: string): boolean =>
  new RegExp('(^|\\s)(' + name + ')(\\s*=|\\s|/|$)', 'i').test(attrs);
const attr = (attrs: string, name: string): string | null => {
  const m = new RegExp(
    '(?:^|\\s)(?:' +
      name +
      ')\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|\\{\\s*["\'`]([^"\'`]*)["\'`]\\s*\\}|\\{([^}]*)\\}|([^\\s>]+))',
    'i',
  ).exec(attrs);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? (m[4] !== undefined ? '{' + m[4] + '}' : (m[5] ?? ''));
};
/** A spread ({...props}) may carry any attribute: nothing is claimed missing then. */
const spreads = (attrs: string): boolean => /\{\s*\.\.\./.test(attrs);

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'switch',
  'treeitem',
  'gridcell',
  'slider',
  'spinbutton',
]);

const SAYS_NOTHING =
  /^(image|img|picture|photo|icon|graphic|[\w-]+\.(png|jpe?g|gif|webp|svg|avif))$/i;

/** Accessibility problems visible in markup and styles. A line with a11y-ignore is skipped. */
export function lintA11y(path: string, text: string): A11yCodeFinding[] {
  if (MARKUP_SKIP.test(path)) return [];
  const out: A11yCodeFinding[] = [];
  const lineOf = (i: number): number => text.slice(0, i).split('\n').length;
  const ignored = (i: number): boolean => {
    const start = text.lastIndexOf('\n', i) + 1;
    const end = text.indexOf('\n', i);
    return text.slice(start, end < 0 ? undefined : end).includes('a11y-ignore');
  };
  const push = (i: number, rule: A11yRule): void => {
    if (ignored(i)) return;
    const snippet = text.slice(i, i + 80).split('\n')[0] ?? '';
    out.push({ path, line: lineOf(i), rule, snippet: snippet.trim() });
  };

  if (isMarkupFile(path)) {
    const jsx = /\.(tsx|jsx)$/i.test(path);
    for (const m of text.matchAll(
      /<(img|button|a|input|textarea|select|div|span|li|svg)(?=[\s/>])/gi,
    )) {
      const at = m.index;
      const tag = (m[1] ?? '').toLowerCase();
      const t = readTag(text, at);
      if (!t) continue;
      const a = t.attrs;
      if (spreads(a)) continue;
      // what is never shown or read out has nothing to fix
      if (has(a, 'hidden') || /aria-hidden\s*=\s*\{?\s*["']?true/.test(a)) continue;
      const tabindex = attr(a, jsx ? 'tabIndex' : 'tabindex');
      if (tabindex !== null) {
        const n = Number(tabindex.replace(/[{}\s]/g, ''));
        if (Number.isFinite(n) && n > 0) push(at, 'tabindex-positive');
      }
      if (tag === 'img') {
        const alt = attr(a, 'alt');
        if (alt === null) push(at, 'alt-missing');
        else if (SAYS_NOTHING.test(alt.trim())) push(at, 'alt-filename');
      } else if (tag === 'button' || tag === 'a') {
        if (tag === 'a' && !has(a, 'href')) continue;
        if (has(a, 'aria-label') || has(a, 'aria-labelledby') || has(a, 'title')) continue;
        if (t.selfClosing) {
          push(at, 'name-missing');
          continue;
        }
        const close = text.toLowerCase().indexOf('</' + tag, t.end);
        if (close < 0) continue;
        const inner = text.slice(t.end, close);
        // text or an expression that may be text names it; tags alone (an icon) do not
        const words = inner
          .replace(/<img\b[^>]*\balt\s*=\s*["{][^"}]+["}][^>]*>/gi, ' name ')
          .replace(/<[^>]*>/g, ' ')
          .trim();
        // a component inside may render text; one named like an icon does not
        const component = [...inner.matchAll(/<([A-Z][\w.]*)/g)].some(
          (c) => !/icon|svg|glyph|chevron|arrow|logo/i.test(c[1] ?? ''),
        );
        if (!words && !component) push(at, 'name-missing');
      } else if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        const type = (attr(a, 'type') ?? '').toLowerCase();
        if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) {
          if (type === 'image' && attr(a, 'alt') === null) push(at, 'alt-missing');
          continue;
        }
        if (has(a, 'aria-label') || has(a, 'aria-labelledby') || has(a, 'id') || has(a, 'title'))
          continue;
        // inside an open <label>…</label> it is labelled
        const before = text.slice(Math.max(0, at - 2000), at).toLowerCase();
        if (before.lastIndexOf('<label') > before.lastIndexOf('</label')) continue;
        push(at, 'label-missing');
      } else if (tag === 'svg') {
        // an svg the reader meets must say what it shows; decorative ones say aria-hidden
        if (attr(a, 'role') === 'img' && !has(a, 'aria-label') && !has(a, 'aria-labelledby')) {
          const close = text.indexOf('</svg', t.end);
          if (close < 0 || !/<title[\s>]/i.test(text.slice(t.end, close))) push(at, 'alt-missing');
        }
      } else {
        const click =
          has(a, 'onClick') ||
          has(a, '@click') ||
          has(a, 'v-on:click') ||
          has(a, 'on:click') ||
          has(a, 'onclick');
        if (!click) continue;
        // a backdrop or a dialog that only closes or stops a click is no target; a handler that
        // reads the event's target serves the elements inside it
        const role = (attr(a, 'role') ?? '').toLowerCase();
        if (role && !INTERACTIVE_ROLES.has(role)) continue;
        if (/\.target\b/.test(a)) continue;
        if (!(role && has(a, jsx ? 'tabIndex' : 'tabindex'))) push(at, 'click-not-focusable');
      }
    }
  }

  if (isStyleFile(path) || /\.(vue|svelte|astro|html)$/i.test(path)) {
    // rules: the selector before each { … }; comments blanked out, lines kept
    const css = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (m[1] ?? '').trim();
      const body = m[2] ?? '';
      const at = m.index + (m[0].length - m[0].trimStart().length);
      if (
        /:focus(?!-visible|-within)/.test(selector) &&
        /outline\s*:\s*(none|0)\b/.test(body) &&
        !/box-shadow|border/.test(body)
      )
        push(at, 'focus-hidden');
      if (
        /(^|[\s,>+~])(button|\.btn[\w-]*|\.button[\w-]*|\[role=["']?button|a)([\s.:#[,]|$)|icon-?button/i.test(
          selector,
        )
      ) {
        // a visually hidden element (a file input inside its button) is not the target
        if (/opacity\s*:\s*0(\.0+)?\s*(;|$)|pointer-events\s*:\s*none|clip(-path)?\s*:/.test(body))
          continue;
        for (const d of body.matchAll(
          /(?:^|;)\s*(width|height)\s*:\s*(\d+(?:\.\d+)?)(px|rem)\b/g,
        )) {
          const px = Number(d[2]) * (d[3] === 'rem' ? 16 : 1);
          if (px > 0 && px < 24) {
            push(at, 'target-size');
            break;
          }
        }
      }
    }
  }
  return out;
}

// ── the page audit, run in the browser ──

/** The parts of the DOM the audit uses; a browser's document has them all. */
export interface AuditRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface AuditElement {
  tagName: string;
  id: string;
  textContent: string | null;
  parentElement: AuditElement | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  getBoundingClientRect(): AuditRect;
  querySelectorAll(selector: string): ArrayLike<AuditElement>;
  focus?(): void;
  blur?(): void;
  labels?: ArrayLike<unknown> | null;
}
export interface AuditStyle {
  outlineStyle: string;
  outlineWidth: string;
  boxShadow: string;
  borderColor: string;
  backgroundColor: string;
  textDecorationLine: string;
  visibility: string;
  display: string;
}
export interface AuditDocument {
  title: string;
  querySelectorAll(selector: string): ArrayLike<AuditElement>;
  getElementById(id: string): AuditElement | null;
  defaultView: {
    getComputedStyle(e: AuditElement): AuditStyle;
    innerWidth: number;
    innerHeight: number;
  } | null;
  location?: { href: string };
  activeElement?: AuditElement | null; // [PCODE-358 | S15 | v0.1.0]
}

export interface A11yPageFinding {
  rule: A11yRule;
  selector: string;
  message: string;
}
export interface A11yPageReport {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  checked: { targets: number; focusable: number; images: number };
  findings: A11yPageFinding[];
}

/** Audits the page as it is rendered. Self-contained: `orq a11y script` sends its source to a browser,
 *  so it uses nothing from outside its own body. */
export function auditPage(doc: AuditDocument): A11yPageReport {
  const view = doc.defaultView;
  const findings: A11yPageFinding[] = [];
  const all = (sel: string, root?: AuditElement): AuditElement[] =>
    Array.from((root ?? doc).querySelectorAll(sel));
  const look = (e: AuditElement): string => {
    // a copy of the computed look: the live object changes with the focus
    const s = view?.getComputedStyle(e);
    return s
      ? [
          s.outlineStyle + ' ' + s.outlineWidth,
          s.boxShadow,
          s.borderColor,
          s.backgroundColor,
          s.textDecorationLine,
        ].join('|')
      : '';
  };
  const shown = (e: AuditElement): boolean => {
    const r = e.getBoundingClientRect();
    const s = view?.getComputedStyle(e);
    if (s && (s.visibility === 'hidden' || s.display === 'none')) return false;
    if (e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true') return false;
    return r.width > 0 && r.height > 0;
  };
  const selectorOf = (e: AuditElement): string => {
    const parts: string[] = [];
    let at: AuditElement | null = e;
    while (at && parts.length < 4) {
      const tag = at.tagName.toLowerCase();
      if (at.id) {
        parts.unshift(tag + '#' + at.id);
        break;
      }
      const cls = (at.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean)[0];
      parts.unshift(cls ? tag + '.' + cls : tag);
      at = at.parentElement;
    }
    return parts.join(' > ');
  };
  const nameOf = (e: AuditElement): string => {
    const label = e.getAttribute('aria-label');
    if (label?.trim()) return label.trim();
    const by = e.getAttribute('aria-labelledby');
    if (by) {
      const t = by
        .split(/\s+/)
        .map((id) => doc.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim();
      if (t) return t;
    }
    const text = (e.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) return text;
    const alts = all('img[alt]', e)
      .map((i) => i.getAttribute('alt') ?? '')
      .join(' ')
      .trim();
    if (alts) return alts;
    return (e.getAttribute('title') ?? e.getAttribute('value') ?? '').trim();
  };
  const add = (e: AuditElement, rule: A11yRule, message: string): void => {
    findings.push({ rule, selector: selectorOf(e), message });
  };
  const says = /^(image|img|picture|photo|icon|graphic|[\w-]+\.(png|jpe?g|gif|webp|svg|avif))$/i;
  const tabindexOf = (e: AuditElement): number => Number(e.getAttribute('tabindex') ?? '0') || 0;

  // images: alt text
  const images = all('img, input[type=image], svg[role=img], [role=img]').filter(shown);
  for (const img of images) {
    const tag = img.tagName.toLowerCase();
    if (tag === 'img' || tag === 'input') {
      const alt = img.getAttribute('alt');
      if (alt === null)
        add(img, 'alt-missing', 'The image has no alt text; use alt="" when it is decoration');
      else if (says.test(alt.trim()))
        add(img, 'alt-filename', 'The alt text "' + alt + '" does not say what the image shows');
    } else if (!nameOf(img) && !all('title', img).length)
      add(img, 'alt-missing', 'The graphic has no name (aria-label or a <title>)');
  }

  // targets: what can be clicked or focused
  const TARGET =
    'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=switch], [tabindex]:not([tabindex="-1"])'; // [PCODE-411 | S15 | v0.1.0] -1: focus by script only, never a target
  const targets = all(TARGET).filter((e) => shown(e) && !e.hasAttribute('disabled'));
  const rects = targets.map((e) => e.getBoundingClientRect());
  targets.forEach((e, i) => {
    const r = rects[i];
    if (!r) return;
    const tag = e.tagName.toLowerCase();
    const role = e.getAttribute('role');
    const type = (e.getAttribute('type') ?? '').toLowerCase();
    if ((tag === 'button' || tag === 'a' || role === 'button' || role === 'link') && !nameOf(e))
      add(
        e,
        'name-missing',
        'Nothing names this ' +
          (tag === 'a' || role === 'link' ? 'link' : 'button') +
          ' for a screen reader',
      );
    if (
      (tag === 'input' || tag === 'select' || tag === 'textarea') &&
      !['submit', 'button', 'reset', 'image'].includes(type)
    ) {
      const labelled =
        (e.labels?.length ?? 0) > 0 ||
        Boolean(e.getAttribute('aria-label')?.trim()) ||
        e.hasAttribute('aria-labelledby') ||
        e.hasAttribute('title');
      if (!labelled) add(e, 'label-missing', 'The field has no label');
    }
    const ti = tabindexOf(e);
    if (ti > 0)
      add(
        e,
        'tabindex-positive',
        'tabindex=' + String(ti) + ' puts it ahead of everything else when tabbing',
      );
    // size: 24 × 24, or no other target within 24 px of its centre (WCAG 2.5.8)
    if (r.width >= 24 && r.height >= 24) return;
    if (tag === 'a') {
      // a link inside a sentence is excepted
      const p = e.parentElement;
      const own = (e.textContent ?? '').trim().length;
      if (p && (p.textContent ?? '').trim().length > own + 20) return;
    }
    if (tag === 'input' && (type === 'checkbox' || type === 'radio') && (e.labels?.length ?? 0) > 0)
      return; // its label is part of the target
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const crowded = rects.some((o, j) => {
      if (j === i) return false;
      const nx = Math.max(o.left, Math.min(cx, o.left + o.width));
      const ny = Math.max(o.top, Math.min(cy, o.top + o.height));
      return Math.hypot(nx - cx, ny - cy) < 24;
    });
    if (crowded)
      add(
        e,
        'target-size',
        'The target is ' +
          String(Math.round(r.width)) +
          ' × ' +
          String(Math.round(r.height)) +
          ' px with another target closer than 24 px',
      );
  });

  // the focus order as Tab walks it: positive tabindex first, then the document's order
  const focusable = targets.filter((e) => Number(e.getAttribute('tabindex') ?? '0') >= 0);
  const order = [
    ...focusable.filter((e) => tabindexOf(e) > 0).sort((a, b) => tabindexOf(a) - tabindexOf(b)),
    ...focusable.filter((e) => tabindexOf(e) <= 0),
  ];
  for (let k = 1; k < order.length; k += 1) {
    const prev = order[k - 1];
    const next = order[k];
    if (!prev || !next) continue;
    const a = prev.getBoundingClientRect();
    const b = next.getBoundingClientRect();
    // a jump back up the page within the same column reads against the order
    if (b.top + b.height < a.top - 48 && Math.abs(b.left - a.left) < 200)
      add(next, 'focus-order', 'Focus moves up the page from ' + selectorOf(prev) + ' to here');
  }

  // a visible focus mark: focus each and compare its look before and after
  if (view)
    for (const e of focusable.slice(0, 300)) {
      if (!e.focus) continue;
      const was = look(e);
      e.focus();
      // [PCODE-358 | S15 | v0.1.0] an element that cannot take the focus here (inside a closed menu) has nothing to show
      if (doc.activeElement !== undefined && doc.activeElement !== e) continue;
      const s = view.getComputedStyle(e);
      const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      if (!outline && look(e) === was)
        add(e, 'focus-invisible', 'Nothing changes when it gets the focus');
      e.blur?.();
    }

  return {
    url: doc.location?.href ?? '',
    title: doc.title,
    viewport: { width: view?.innerWidth ?? 0, height: view?.innerHeight ?? 0 },
    checked: { targets: targets.length, focusable: focusable.length, images: images.length },
    findings: findings.slice(0, 500),
  };
}

/** The script for a browser: runs the audit on the page and gives the report. */
export function auditScript(): string {
  return '(' + auditPage.toString() + ')(document)';
}

/** What agents are told about accessibility when they write UI. */
export const A11Y_RULE =
  'Accessibility: every img has alt text (alt="" for decoration); icon-only buttons and links get an aria-label; clickable elements are buttons or links, never a div; no tabindex above 0; every field has a label; never remove the focus outline without another focus mark; targets are at least 24 × 24 px.';
