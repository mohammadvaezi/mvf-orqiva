// ── [PCODE-279 | S15 | v0.1.0] T29.1 Document blocks: callouts, math and Mermaid diagrams rendered by our own code ──
//    Why:  formulas in pages without a math library: a subset of TeX is read into MathML nodes, which every
//          current browser draws. The subset is what engineering pages use: fractions, roots, powers and
//          indices, big operators with limits, Greek letters, operators and relations, text, accents and
//          stretchy brackets. Anything else is reported, so the page shows the source instead of guessing.

export interface MathNode {
  tag:
    | 'math'
    | 'mrow'
    | 'mi'
    | 'mn'
    | 'mo'
    | 'mtext'
    | 'mspace'
    | 'mfrac'
    | 'msqrt'
    | 'mroot'
    | 'msup'
    | 'msub'
    | 'msubsup'
    | 'mover'
    | 'munder'
    | 'munderover';
  attrs?: Record<string, string>;
  text?: string;
  children?: MathNode[];
}

export class TexError extends Error {}

const GREEK: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ϵ',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  varpi: 'ϖ',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'ϕ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
};

const OPS: Record<string, string> = {
  times: '×',
  cdot: '⋅',
  pm: '±',
  mp: '∓',
  div: '÷',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  neq: '≠',
  ne: '≠',
  approx: '≈',
  sim: '∼',
  equiv: '≡',
  propto: '∝',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  Rightarrow: '⇒',
  Leftarrow: '⇐',
  leftrightarrow: '↔',
  Leftrightarrow: '⇔',
  mapsto: '↦',
  in: '∈',
  notin: '∉',
  subset: '⊂',
  subseteq: '⊆',
  supset: '⊃',
  cup: '∪',
  cap: '∩',
  forall: '∀',
  exists: '∃',
  neg: '¬',
  land: '∧',
  lor: '∨',
  infty: '∞',
  partial: '∂',
  nabla: '∇',
  ldots: '…',
  cdots: '⋯',
  emptyset: '∅',
  circ: '∘',
  ll: '≪',
  gg: '≫',
  perp: '⊥',
  parallel: '∥',
  angle: '∠',
  deg: '°',
};

const BIG: Record<string, string> = {
  sum: '∑',
  prod: '∏',
  int: '∫',
  oint: '∮',
  bigcup: '⋃',
  bigcap: '⋂',
};
const FUNCS = ['sin', 'cos', 'tan', 'log', 'ln', 'exp', 'min', 'max', 'lim', 'det', 'sup', 'inf'];
const ACCENTS: Record<string, string> = {
  hat: '^',
  bar: '¯',
  vec: '→',
  dot: '˙',
  tilde: '~',
  overline: '¯',
};
const SPACES: Record<string, string> = {
  ',': '0.17em',
  ':': '0.22em',
  ';': '0.28em',
  quad: '1em',
  qquad: '2em',
  ' ': '0.25em',
};
const FENCES: Record<string, string> = {
  '(': '(',
  ')': ')',
  '[': '[',
  ']': ']',
  '|': '|',
  '.': '',
  '\\{': '{',
  '\\}': '}',
  langle: '⟨',
  rangle: '⟩',
};

type Tok =
  | { k: 'cmd'; v: string }
  | { k: 'ch'; v: string }
  | { k: 'num'; v: string }
  // spaces count only inside \text
  | { k: 'sp'; v: string };

function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] ?? '';
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
      if (!m) throw new TexError('A lone backslash');
      out.push({ k: 'cmd', v: m[1] ?? '' });
      i += m[0].length;
      // a command eats the spaces after it
      if (/^[a-zA-Z]/.test(m[1] ?? '')) while (src[i] === ' ') i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+|^[0-9]+/.exec(src.slice(i));
      const v = m?.[0] ?? c;
      out.push({ k: 'num', v });
      i += v.length;
    } else if (/\s/.test(c)) {
      if (out.at(-1)?.k !== 'sp') out.push({ k: 'sp', v: ' ' });
      i++;
    } else {
      out.push({ k: 'ch', v: c });
      i++;
    }
  }
  return out;
}

const row = (children: MathNode[]): MathNode =>
  children.length === 1 ? (children[0] as MathNode) : { tag: 'mrow', children };

class Reader {
  private i = 0;
  constructor(private readonly t: Tok[]) {}

  /** The next token that is not a space. */
  private peek(): Tok | undefined {
    while (this.t[this.i]?.k === 'sp') this.i++;
    return this.t[this.i];
  }

  /** A sequence until a closing brace, \right or the end. */
  list(stop: (t: Tok) => boolean = () => false): MathNode[] {
    const out: MathNode[] = [];
    for (;;) {
      const t = this.peek();
      if (!t || stop(t)) return out;
      let base = this.atom();
      // scripts: ^ and _ in either order
      let sup: MathNode | null = null;
      let sub: MathNode | null = null;
      for (;;) {
        const n = this.peek();
        if (n?.k === 'ch' && n.v === '^' && !sup) {
          this.i++;
          sup = this.argument();
        } else if (n?.k === 'ch' && n.v === '_' && !sub) {
          this.i++;
          sub = this.argument();
        } else if (n?.k === 'ch' && n.v === "'") {
          this.i++;
          sup = { tag: 'mo', text: '′' };
        } else break;
      }
      const big = base.attrs?.['data-big'] === '1';
      if (big && base.attrs) delete base.attrs['data-big'];
      if (sup && sub) base = { tag: big ? 'munderover' : 'msubsup', children: [base, sub, sup] };
      else if (sup) base = { tag: big ? 'mover' : 'msup', children: [base, sup] };
      else if (sub) base = { tag: big ? 'munder' : 'msub', children: [base, sub] };
      out.push(base);
    }
  }

  /** A script or command argument: one group or one atom. */
  argument(): MathNode {
    return this.atom();
  }

  private group(): MathNode {
    const inner = this.list((t) => t.k === 'ch' && t.v === '}');
    const close = this.peek();
    if (!close) throw new TexError('A { is not closed');
    this.i++;
    return row(inner);
  }

  private rawGroup(): string {
    const open = this.peek();
    if (!(open?.k === 'ch' && open.v === '{')) throw new TexError('\\text needs { }');
    this.i++;
    let depth = 1;
    let out = '';
    for (;;) {
      const t = this.t[this.i];
      if (!t) throw new TexError('A { is not closed');
      this.i++;
      if (t.k === 'ch' && t.v === '{') depth++;
      if (t.k === 'ch' && t.v === '}' && --depth === 0) return out;
      out += t.k === 'cmd' ? (t.v.length === 1 ? t.v : '\\' + t.v) : t.v;
    }
  }

  private fence(): string {
    const t = this.peek();
    if (!t) throw new TexError('\\left or \\right needs a bracket');
    this.i++;
    const key = t.k === 'cmd' ? (t.v === '{' || t.v === '}' ? '\\' + t.v : t.v) : t.v;
    const f = FENCES[key];
    if (f === undefined) throw new TexError('Unknown bracket ' + key);
    return f;
  }

  atom(): MathNode {
    const t = this.peek();
    if (!t) throw new TexError('Something is missing at the end');
    this.i++;
    if (t.k === 'num') return { tag: 'mn', text: t.v };
    if (t.k === 'ch') {
      if (t.v === '{') return this.group();
      if (t.v === '}') throw new TexError('A } without its {');
      if (/[a-zA-Z]/.test(t.v)) return { tag: 'mi', text: t.v };
      if (t.v === '^' || t.v === '_') throw new TexError('A ' + t.v + ' without a base');
      return { tag: 'mo', text: t.v === '-' ? '−' : t.v === '*' ? '∗' : t.v };
    }
    const v = t.v;
    if (GREEK[v]) return { tag: 'mi', text: GREEK[v] };
    if (OPS[v]) return { tag: 'mo', text: OPS[v] };
    if (BIG[v]) return { tag: 'mo', text: BIG[v], attrs: { largeop: 'true', 'data-big': '1' } };
    if (FUNCS.includes(v))
      return {
        tag: 'mi',
        text: v,
        attrs: v === 'lim' ? { 'data-big': '1' } : { mathvariant: 'normal' },
      };
    if (SPACES[v]) return { tag: 'mspace', attrs: { width: SPACES[v] } };
    if (v === '{' || v === '}' || v === '%' || v === '$' || v === '#' || v === '&' || v === '_')
      return { tag: 'mo', text: v };
    if (v === '\\') return { tag: 'mspace', attrs: { linebreak: 'newline' } };
    if (v === 'frac' || v === 'dfrac' || v === 'tfrac')
      return { tag: 'mfrac', children: [this.argument(), this.argument()] };
    if (v === 'sqrt') {
      const n = this.peek();
      if (n?.k === 'ch' && n.v === '[') {
        this.i++;
        const index = row(this.list((x) => x.k === 'ch' && x.v === ']'));
        this.i++;
        return { tag: 'mroot', children: [this.argument(), index] };
      }
      return { tag: 'msqrt', children: [this.argument()] };
    }
    if (v === 'text' || v === 'mathrm' || v === 'operatorname')
      return v === 'text'
        ? { tag: 'mtext', text: this.rawGroup() }
        : { tag: 'mi', text: this.rawGroup(), attrs: { mathvariant: 'normal' } };
    if (v === 'mathbf') return { tag: 'mi', text: this.rawGroup(), attrs: { mathvariant: 'bold' } };
    if (ACCENTS[v])
      return {
        tag: 'mover',
        attrs: { accent: 'true' },
        children: [this.argument(), { tag: 'mo', text: ACCENTS[v] }],
      };
    if (v === 'left') {
      const open = this.fence();
      const inner = this.list((x) => x.k === 'cmd' && x.v === 'right');
      if (!this.peek()) throw new TexError('\\left without \\right');
      this.i++;
      const close = this.fence();
      return {
        tag: 'mrow',
        children: [
          ...(open ? [{ tag: 'mo', text: open, attrs: { stretchy: 'true' } } as MathNode] : []),
          ...inner,
          ...(close ? [{ tag: 'mo', text: close, attrs: { stretchy: 'true' } } as MathNode] : []),
        ],
      };
    }
    throw new TexError('Unknown command \\' + v);
  }

  done(): void {
    if (this.peek()) throw new TexError('A } without its {');
  }
}

/** TeX as a MathML tree; throws TexError on what the subset does not read. */
export function texToMath(src: string, display = false): MathNode {
  const r = new Reader(tokens(src.trim()));
  const body = r.list();
  r.done();
  return {
    tag: 'math',
    attrs: display ? { display: 'block' } : {},
    children: [row(body)],
  };
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The tree as MathML text, for HTML exports. */
export function mathXml(n: MathNode): string {
  const attrs = Object.entries(n.attrs ?? {})
    .map(([k, v]) => ' ' + k + '="' + esc(v) + '"')
    .join('');
  const ns = n.tag === 'math' ? ' xmlns="http://www.w3.org/1998/Math/MathML"' : '';
  const inner = n.children ? n.children.map(mathXml).join('') : esc(n.text ?? '');
  return '<' + n.tag + ns + attrs + '>' + inner + '</' + n.tag + '>';
}
