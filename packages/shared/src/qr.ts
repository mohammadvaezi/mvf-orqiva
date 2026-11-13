// ── [PCODE-224 | S15 | v0.1.0] T21.1 Phone sign-in by pairing code, device tokens, QR code in the web app ──
//    Why:  the web app shows the pairing link as a QR code for the phone's camera. Our own encoder
//          (ISO/IEC 18004): byte mode, error correction level M, versions 1 to 10 (up to 213 bytes, far more
//          than a pairing link needs), all eight masks scored by the standard's penalty rules. It returns
//          the modules as rows of booleans (true is dark); drawing them is the caller's business.

const ALIGNMENT: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];
/** Level M per version: error correction codewords per block, and the blocks as [count, data codewords]. */
const BLOCKS_M: readonly { ec: number; groups: readonly (readonly [number, number])[] }[] = [
  { ec: 10, groups: [[1, 16]] },
  { ec: 16, groups: [[1, 28]] },
  { ec: 26, groups: [[1, 44]] },
  { ec: 18, groups: [[2, 32]] },
  { ec: 24, groups: [[2, 43]] },
  { ec: 16, groups: [[4, 27]] },
  { ec: 18, groups: [[4, 31]] },
  {
    ec: 22,
    groups: [
      [2, 38],
      [2, 39],
    ],
  },
  {
    ec: 22,
    groups: [
      [3, 36],
      [2, 37],
    ],
  },
  {
    ec: 26,
    groups: [
      [4, 43],
      [1, 44],
    ],
  },
];
export const QR_MAX_VERSION = BLOCKS_M.length;

const dataCodewords = (version: number): number =>
  (BLOCKS_M[version - 1]?.groups ?? []).reduce((n, [count, size]) => n + count * size, 0);

// ── GF(256) with the polynomial x^8 + x^4 + x^3 + x^2 + 1 ──
const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] ?? 0;
}
const mul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : (EXP[(LOG[a] ?? 0) + (LOG[b] ?? 0)] ?? 0);

/** The Reed-Solomon remainder of `data` for `degree` error correction codewords. */
export function reedSolomon(data: readonly number[], degree: number): number[] {
  // generator (x - a^0)(x - a^1)…, highest coefficient (1) left out
  let gen = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] = (next[j] ?? 0) ^ (gen[j] ?? 0);
      next[j + 1] = (next[j + 1] ?? 0) ^ mul(gen[j] ?? 0, EXP[i] ?? 0);
    }
    gen = next;
  }
  const rem = new Array<number>(degree).fill(0);
  for (const b of data) {
    const factor = b ^ (rem.shift() ?? 0);
    rem.push(0);
    for (let j = 0; j < degree; j++) rem[j] = (rem[j] ?? 0) ^ mul(gen[j + 1] ?? 0, factor);
  }
  return rem;
}

/** The codewords for `bytes` in `version`: data with its padding, interleaved with error correction. */
function codewords(bytes: Uint8Array, version: number): number[] {
  const capacity = dataCodewords(version);
  const bits: number[] = [];
  const put = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    data.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);

  const spec = BLOCKS_M[version - 1];
  if (!spec) throw new Error('unknown QR version ' + String(version));
  const blocks: number[][] = [];
  let at = 0;
  for (const [count, size] of spec.groups)
    for (let i = 0; i < count; i++) {
      blocks.push(data.slice(at, at + size));
      at += size;
    }
  const ecc = blocks.map((b) => reedSolomon(b, spec.ec));
  const out: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.length) out.push(b[i] ?? 0);
  for (let i = 0; i < spec.ec; i++) for (const e of ecc) out.push(e[i] ?? 0);
  return out;
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Grid {
  readonly size: number;
  readonly dark: boolean[][];
  readonly fixed: boolean[][];
  readonly version: number;

  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  /** Sets a function module at column x, row y. */
  set(x: number, y: number, dark: boolean): void {
    const row = this.dark[y];
    const fixedRow = this.fixed[y];
    if (!row || !fixedRow || x < 0 || x >= this.size) return;
    row[x] = dark;
    fixedRow[x] = true;
  }

  functionPatterns(): void {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [
      [3, 3],
      [n - 4, 3],
      [3, n - 4],
    ] as const)
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          this.set(cx + dx, cy + dy, d !== 2 && d !== 4);
        }
    const pos = ALIGNMENT[this.version - 1] ?? [];
    const last = pos.length - 1;
    pos.forEach((cy, i) => {
      pos.forEach((cx, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      });
    });
    this.formatBits(0); // reserves the areas; drawn again with the chosen mask
    if (this.version >= 7) {
      let rem = this.version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (this.version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = ((bits >>> i) & 1) === 1;
        const a = n - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.set(a, b, bit);
        this.set(b, a, bit);
      }
    }
  }

  /** The format information: level M (00) and the mask, BCH-protected, in both copies. */
  formatBits(mask: number): void {
    const n = this.size;
    const data = mask; // level M is 00
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number): boolean => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, n - 15 + i, bit(i));
    this.set(8, n - 8, true);
  }

  place(words: readonly number[]): void {
    const n = this.size;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? n - 1 - vert : vert;
          const row = this.dark[y];
          if (!row || this.fixed[y]?.[x] || i >= words.length * 8) continue;
          row[x] = (((words[i >>> 3] ?? 0) >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
    }
  }

  mask(mask: number): void {
    const f = MASKS[mask];
    if (!f) return;
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) {
        const row = this.dark[y];
        if (row && !this.fixed[y]?.[x] && f(x, y)) row[x] = !row[x];
      }
  }

  /** The standard's penalty: runs, 2×2 blocks, finder-like patterns, and the balance of dark modules. */
  penalty(): number {
    const n = this.size;
    const at = (x: number, y: number): boolean => this.dark[y]?.[x] ?? false;
    let score = 0;
    const lines = (get: (i: number, j: number) => boolean): void => {
      for (let i = 0; i < n; i++) {
        let run = 1;
        let word = 0;
        for (let j = 0; j < n; j++) {
          const v = get(i, j);
          if (j > 0) {
            if (v === get(i, j - 1)) run++;
            else {
              if (run >= 5) score += run - 2;
              run = 1;
            }
          }
          word = ((word << 1) | (v ? 1 : 0)) & 0x7ff;
          if (j >= 10 && (word === 0x5d0 || word === 0x05d)) score += 40;
        }
        if (run >= 5) score += run - 2;
      }
    };
    lines((i, j) => at(j, i));
    lines((i, j) => at(i, j));
    let darkCount = 0;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (at(x, y)) darkCount++;
        if (x < n - 1 && y < n - 1) {
          const v = at(x, y);
          if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) score += 3;
        }
      }
    const percent = (darkCount * 100) / (n * n);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;
    return score;
  }
}

/** The smallest version that holds `length` bytes at level M, or null when none up to version 10 does. */
export function qrVersionFor(length: number): number | null {
  for (let v = 1; v <= QR_MAX_VERSION; v++) {
    const header = 4 + (v < 10 ? 8 : 16);
    if (header + length * 8 <= dataCodewords(v) * 8) return v;
  }
  return null;
}

/** The QR code for `text` (UTF-8, byte mode, level M), as rows of modules; true is dark. */
export function qrEncode(
  text: string,
  opts: { mask?: number; version?: number } = {},
): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const least = qrVersionFor(bytes.length);
  if (least === null) throw new Error('Too long for a QR code: ' + String(bytes.length) + ' bytes');
  const version = Math.max(least, opts.version ?? least);
  if (version > QR_MAX_VERSION)
    throw new Error('QR version ' + String(version) + ' is not supported');
  const words = codewords(bytes, version);
  const build = (mask: number): Grid => {
    const g = new Grid(version);
    g.functionPatterns();
    g.place(words);
    g.mask(mask);
    g.formatBits(mask);
    return g;
  };
  if (opts.mask !== undefined) return build(opts.mask).dark;
  let best: Grid | null = null;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const g = build(m);
    const p = g.penalty();
    if (p < bestScore) {
      best = g;
      bestScore = p;
    }
  }
  return (best ?? build(0)).dark;
}

/** The modules as one SVG path ("M x y h1 v1 h-1 z" per dark module), with a quiet zone of `margin`. */
export function qrPath(modules: readonly (readonly boolean[])[], margin = 4): string {
  let d = '';
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += 'M' + String(x + margin) + ' ' + String(y + margin) + 'h1v1h-1z';
    });
  });
  return d;
}
