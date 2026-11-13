// ── [PCODE-358 | S15 | v0.1.0] T35.6 Accessibility to WCAG 2.2 AA ──
// ── [PCODE-296 | S15 | v0.1.0] T30.9 Accessibility checks: alt text, names, focus order, target size, in the code and on the page ──
//    Why:  the lint finds each problem in JSX, Vue and CSS without crying wolf on labelled, spread or
//          ignored elements; the page audit measures sizes, spacing, order, focus marks and names on a
//          rendered page (here a small stand-in for one), and its script carries itself whole.
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  A11Y_RULE,
  auditPage,
  auditScript,
  kitRule,
  lintA11y,
  type AuditDocument,
  type AuditElement,
  type AuditStyle,
} from '../src/index.js';

const rules = (path: string, text: string): string[] =>
  lintA11y(path, text).map((f) => String(f.line) + ' ' + f.rule);

describe('the accessibility lint', () => {
  it('finds images, names, clicks, tabindex and labels in JSX', () => {
    const tsx = [
      '<img src={logo} />', // 1 alt-missing
      '<img src={hero} alt="hero.png" />', // 2 alt-filename
      '<img src={x} alt="" />', // 3 decoration: fine
      '<button onClick={close}><XIcon /></button>', // 4 name-missing
      '<button aria-label="Close" onClick={close}><XIcon /></button>', // 5 fine
      '<button>{t("save")}</button>', // 6 an expression may be text: fine
      '<div onClick={open}>Open</div>', // 7 click-not-focusable
      '<div role="button" tabIndex={0} onClick={open}>Open</div>', // 8 fine
      '<a href="/x" tabIndex={3}>Next</a>', // 9 tabindex-positive
      '<input type="text" />', // 10 label-missing
      '<label>Name <input type="text" /></label>', // 11 fine
      '<input id="email" />', // 12 a label may point at it: fine
      '<Img {...props} />', // 13 not an img tag
      '<img {...props} />', // 14 a spread may carry alt: fine
      '<img src={y} /> {/* a11y-ignore */}', // 15 ignored
      '<a href="/home"><img src={h} alt="Home" /></a>', // 16 named by its image
      '<svg role="img" viewBox="0 0 1 1"><path /></svg>', // 17 alt-missing
      '<input type="hidden" name="t" />', // 18 fine
      '<div className="scrim" role="presentation" onClick={close} />', // 19 a backdrop: fine
      '<div role="dialog" onClick={(e) => e.stopPropagation()}>x</div>', // 20 fine
      '<div onClick={(e) => { if (e.target instanceof HTMLImageElement) draw(e.target); }}>', // 21 delegated: fine
      '<span role="button" onClick={go}>Go</span>', // 22 a button the keyboard cannot reach
      '<input type="file" hidden />', // 23 never shown: fine
      '<a href="/d/1"><DeployStatus status={s} /></a>', // 24 a component may render text: fine
      '<a href="/x"><ChevronIcon /></a>', // 25 an icon names nothing
      '<div className="scrim" aria-hidden="true" onClick={close} />', // 26 fine
    ].join('\n');
    expect(rules('src/App.tsx', tsx)).toEqual([
      '1 alt-missing',
      '2 alt-filename',
      '4 name-missing',
      '7 click-not-focusable',
      '9 tabindex-positive',
      '10 label-missing',
      '17 alt-missing',
      '22 click-not-focusable',
      '25 name-missing',
    ]);
  });

  it('reads Vue attributes and tags over several lines, and CSS focus and sizes', () => {
    const vue =
      '<template>\n  <span @click="go"\n    class="x">Go</span>\n  <img\n    :src="a"\n  />\n</template>';
    expect(rules('src/A.vue', vue)).toEqual(['2 click-not-focusable', '4 alt-missing']);
    const css = [
      'button:focus { outline: none; }', // 1 focus-hidden
      'a:focus { outline: 0; box-shadow: 0 0 0 2px blue; }', // 2 another mark: fine
      ':focus-visible { outline: none; }', // 3 not :focus alone… still a choice; not flagged
      '.btn--tiny { width: 16px; height: 16px; }', // 4 target-size
      '.card { width: 12px; }', // 5 not a target
      '.icon-button { height: 1rem; }', // 6 target-size (16 px)
      '/* the input inside its button */', // 7
      '.file-hidden { width: 1px; height: 1px; }', // 8 a comment's word is no selector: fine
      '.btn-file { width: 1px; height: 1px; opacity: 0; }', // 9 visually hidden: fine
    ].join('\n');
    expect(rules('src/app.css', css)).toEqual(['1 focus-hidden', '4 target-size', '6 target-size']);
    expect(rules('node_modules/x/a.tsx', '<img />')).toEqual([]);
  });

  it('tells agents the rules within the kit rule', () => {
    const r = kitRule(
      [{ name: 'space.4', type: 'dimension', valueLight: '16px', valueDark: '', description: '' }],
      [],
    );
    expect(r).toContain(A11Y_RULE);
    expect(r.indexOf('Accessibility')).toBeLessThan(r.indexOf('Tokens:'));
  });
});

// ── a stand-in for a rendered page ──
interface Fake {
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  rect: [number, number, number, number];
  kids?: Fake[];
  /** how its look changes on focus */
  focusLook?: Partial<AuditStyle>;
  labels?: number;
  /** [PCODE-358 | S15 | v0.1.0] cannot take the focus (inside a closed menu) */
  closed?: boolean;
}
function page(nodes: Fake[]): { doc: AuditDocument; focused: string[] } {
  const focused: string[] = [];
  let active: AuditElement | null = null;
  const base: AuditStyle = {
    outlineStyle: 'none',
    outlineWidth: '0px',
    boxShadow: 'none',
    borderColor: 'rgb(0, 0, 0)',
    backgroundColor: 'rgb(255, 255, 255)',
    textDecorationLine: 'none',
    visibility: 'visible',
    display: 'block',
  };
  const flat: { el: AuditElement; spec: Fake }[] = [];
  const make = (f: Fake, parent: AuditElement | null): AuditElement => {
    const kids: AuditElement[] = [];
    const el: AuditElement = {
      tagName: f.tag.toUpperCase(),
      id: f.attrs?.['id'] ?? '',
      textContent: '',
      parentElement: parent,
      getAttribute: (n) => f.attrs?.[n] ?? null,
      hasAttribute: (n) => f.attrs?.[n] !== undefined,
      getBoundingClientRect: () => ({
        left: f.rect[0],
        top: f.rect[1],
        width: f.rect[2],
        height: f.rect[3],
      }),
      querySelectorAll: (sel) => select(sel, kids),
      focus: () => {
        if (f.closed) return;
        active = el;
        focused.push(f.tag + (f.attrs?.['id'] ? '#' + f.attrs['id'] : ''));
      },
      blur: () => {
        active = null;
      },
      labels: Array.from({ length: f.labels ?? 0 }),
    };
    flat.push({ el, spec: f });
    for (const k of f.kids ?? []) kids.push(make(k, el));
    el.textContent = (f.text ?? '') + kids.map((k) => k.textContent ?? '').join('');
    return el;
  };
  const isTarget = (e: AuditElement): boolean => {
    const t = e.tagName.toLowerCase();
    return (
      (t === 'a' && e.hasAttribute('href')) ||
      ['button', 'select', 'textarea'].includes(t) ||
      (t === 'input' && e.getAttribute('type') !== 'hidden') ||
      ['button', 'link'].includes(e.getAttribute('role') ?? '') ||
      e.hasAttribute('tabindex')
    );
  };
  const isImage = (e: AuditElement): boolean =>
    e.tagName === 'IMG' || e.getAttribute('role') === 'img';
  const within = (kids: AuditElement[]): AuditElement[] =>
    kids.flatMap((k) => [k, ...within(Array.from(k.querySelectorAll('*')))]);
  function select(sel: string, scope: AuditElement[] | null): AuditElement[] {
    const pool = scope ? within(scope) : flat.map((x) => x.el);
    if (sel === '*') return scope ?? [];
    if (sel.startsWith('img, input[type=image]')) return pool.filter(isImage);
    if (sel.startsWith('a[href], button')) return pool.filter(isTarget);
    if (sel === 'img[alt]') return pool.filter((e) => e.tagName === 'IMG' && e.hasAttribute('alt'));
    if (sel === 'title') return pool.filter((e) => e.tagName === 'TITLE');
    return [];
  }
  for (const n of nodes) make(n, null);
  const doc: AuditDocument = {
    title: 'Fake',
    get activeElement() {
      return active;
    },
    querySelectorAll: (sel) => select(sel, null),
    getElementById: (id) => flat.find((x) => x.el.id === id)?.el ?? null,
    defaultView: {
      innerWidth: 1280,
      innerHeight: 800,
      getComputedStyle: (e) => ({
        ...base,
        ...(active === e ? (flat.find((x) => x.el === e)?.spec.focusLook ?? {}) : {}),
      }),
    },
  };
  return { doc, focused };
}

describe('the page audit', () => {
  it('measures targets with their spacing, names, labels, order and focus marks', () => {
    const ring = { outlineStyle: 'solid', outlineWidth: '2px' };
    const { doc, focused } = page([
      { tag: 'button', attrs: { id: 'save' }, text: 'Save', rect: [0, 0, 80, 32], focusLook: ring },
      // two small icons side by side: too close
      {
        tag: 'button',
        attrs: { id: 'a', 'aria-label': 'Bold' },
        rect: [0, 100, 16, 16],
        focusLook: ring,
      },
      {
        tag: 'button',
        attrs: { id: 'b', 'aria-label': 'Italic' },
        rect: [18, 100, 16, 16],
        focusLook: ring,
      },
      // a small one alone: enough space around
      {
        tag: 'button',
        attrs: { id: 'lone', 'aria-label': 'Help' },
        rect: [600, 100, 16, 16],
        focusLook: ring,
      },
      // no name, no focus mark
      {
        tag: 'button',
        attrs: { id: 'x' },
        rect: [0, 200, 32, 32],
        kids: [{ tag: 'svg', rect: [0, 200, 32, 32] }],
      },
      {
        tag: 'input',
        attrs: { id: 'q', type: 'text' },
        rect: [0, 300, 200, 32],
        focusLook: { boxShadow: '0 0 0 2px blue' },
      },
      {
        tag: 'input',
        attrs: { id: 'n', type: 'text' },
        labels: 1,
        rect: [0, 340, 200, 32],
        focusLook: ring,
      },
      // focus jumps back up the page
      {
        tag: 'a',
        attrs: { id: 'top', href: '#' },
        text: 'Back to top',
        rect: [0, 10, 100, 30],
        focusLook: ring,
      },
      { tag: 'img', attrs: { src: 'p.png' }, rect: [300, 0, 100, 100] },
      { tag: 'img', attrs: { src: 'p.png', alt: 'photo' }, rect: [300, 200, 100, 100] },
      { tag: 'img', attrs: { src: 'd.png', alt: '' }, rect: [300, 400, 100, 100] },
      {
        tag: 'a',
        attrs: { id: 'jump', href: '#', tabindex: '2' },
        text: 'Skip',
        rect: [0, 500, 60, 30],
        focusLook: ring,
      },
    ]);
    const r = auditPage(doc);
    const got = r.findings.map((f) => f.rule + ' ' + f.selector);
    expect(got).toEqual(
      expect.arrayContaining([
        'alt-missing img',
        'alt-filename img',
        'target-size button#a',
        'target-size button#b',
        'name-missing button#x',
        'label-missing input#q',
        'tabindex-positive a#jump',
        'focus-invisible button#x',
      ]),
    );
    expect(got).not.toContain('target-size button#lone');
    expect(got).not.toContain('label-missing input#n');
    expect(got).not.toContain('focus-invisible input#q'); // a box-shadow is a mark too
    // the skip link comes first (tabindex 2): from it focus goes up to Save
    expect(got).toContain('focus-order button#save');
    expect(got).toContain('focus-order a#top');
    expect(r.checked).toEqual({ targets: 9, focusable: 9, images: 3 });
    expect(focused).toHaveLength(9);
  });

  // [PCODE-358 | S15 | v0.1.0]
  it('passes over what cannot take the focus here', () => {
    const { doc } = page([
      {
        tag: 'input',
        attrs: { id: 'c', type: 'checkbox' },
        labels: 1,
        rect: [0, 0, 24, 24],
        closed: true,
      },
    ]);
    expect(auditPage(doc).findings.map((f) => f.rule)).not.toContain('focus-invisible');
  });

  it('carries itself whole into a browser', () => {
    const s = auditScript();
    expect(s.startsWith('(function auditPage(doc)')).toBe(true);
    expect(s.endsWith(')(document)')).toBe(true);
    // nothing from outside: running the text on the stand-in gives the same report
    const { doc } = page([{ tag: 'img', attrs: { src: 'a.png' }, rect: [0, 0, 10, 10] }]);
    // a fresh context has none of this module: only the document it is given
    const report = runInNewContext(s, { document: doc }) as { findings: unknown[] };
    expect(report.findings).toEqual([expect.objectContaining({ rule: 'alt-missing' })]);
  });
});
