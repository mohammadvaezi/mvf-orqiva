// ── [PCODE-282 | S15 | v0.1.0] T29.4 Live co-editing of documents with our own three-way merge ──
//    Why:  two people editing one page at once each change it from a common ancestor. The merge keeps
//          both: line by line against the ancestor, then word by word inside a line both changed. Where
//          both changed the same words differently, both versions stay (theirs first, then mine) and are
//          counted, so nothing typed is ever lost and the editors are told where to look.

// [PCODE-302 | S15 | v0.1.0] T31.3 PR review queue (riskiest first) and side-by-side diff with fingerprints and viewed files
//   also the line diff of a pull request's file when the host sends both versions instead of a patch
/** Positions where two sequences agree, as [index in a, index in b], in order (longest common run). */
export function commonRun(a: readonly string[], b: readonly string[]): [number, number][] {
  // common start and end are matched without the table
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  )
    suf++;
  const out: [number, number][] = [];
  for (let i = 0; i < pre; i++) out.push([i, i]);
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  if (am.length && bm.length && am.length * bm.length <= 4_000_000) {
    const n = am.length;
    const m = bm.length;
    const t = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        t[i * (m + 1) + j] =
          am[i] === bm[j]
            ? (t[(i + 1) * (m + 1) + j + 1] ?? 0) + 1
            : Math.max(t[(i + 1) * (m + 1) + j] ?? 0, t[i * (m + 1) + j + 1] ?? 0);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) {
        out.push([pre + i, pre + j]);
        i++;
        j++;
      } else if ((t[(i + 1) * (m + 1) + j] ?? 0) >= (t[i * (m + 1) + j + 1] ?? 0)) i++;
      else j++;
    }
  }
  for (let k = suf; k > 0; k--) out.push([a.length - k, b.length - k]);
  return out;
}

const same = (x: readonly string[], y: readonly string[]): boolean =>
  x.length === y.length && x.every((v, i) => v === y[i]);

export interface MergeResult<T = string> {
  parts: T[];
  conflicts: number;
}

/** The three-way merge of token lists; resolve() decides a chunk both sides changed differently. */
function merge(
  base: readonly string[],
  mine: readonly string[],
  theirs: readonly string[],
  resolve: (b: string[], m: string[], t: string[]) => { parts: string[]; conflict: boolean },
): MergeResult {
  const ma = new Map(commonRun(base, mine));
  const mb = new Map(commonRun(base, theirs));
  const out: string[] = [];
  let conflicts = 0;
  let i = 0;
  let a = 0;
  let b = 0;
  const chunk = (k: number, ak: number, bk: number): void => {
    const cb = base.slice(i, k);
    const cm = mine.slice(a, ak);
    const ct = theirs.slice(b, bk);
    if (same(cm, cb)) out.push(...ct);
    else if (same(ct, cb) || same(cm, ct)) out.push(...cm);
    else {
      const r = resolve(cb, cm, ct);
      out.push(...r.parts);
      if (r.conflict) conflicts++;
    }
  };
  for (let k = 0; k < base.length; k++) {
    const ak = ma.get(k);
    const bk = mb.get(k);
    // a line of the ancestor both still have, at or after where each side is: it anchors a chunk
    if (ak === undefined || bk === undefined || ak < a || bk < b) continue;
    chunk(k, ak, bk);
    out.push(base[k] ?? '');
    i = k + 1;
    a = ak + 1;
    b = bk + 1;
  }
  chunk(base.length, mine.length, theirs.length);
  return { parts: out, conflicts };
}

const words = (s: string): string[] => s.split(/(\s+)/).filter((w) => w !== '');

/** A line both changed: merged word by word, or both kept when the same words changed differently. */
function lines(b: string[], m: string[], t: string[]): { parts: string[]; conflict: boolean } {
  // the same number of lines on every side: each line is merged on its own (neighbouring lines changed
  // by different people are not a clash)
  if (b.length === m.length && b.length === t.length) {
    const out: string[] = [];
    for (let i = 0; i < b.length; i++) {
      const [lb, lm, lt] = [b[i] ?? '', m[i] ?? '', t[i] ?? ''];
      if (lm === lb || lm === lt) out.push(lt);
      else if (lt === lb) out.push(lm);
      else {
        const w = merge(words(lb), words(lm), words(lt), () => ({ parts: [], conflict: true }));
        if (w.conflicts) return { parts: [...t, ...m], conflict: true };
        out.push(w.parts.join(''));
      }
    }
    return { parts: out, conflict: false };
  }
  return { parts: [...t, ...m], conflict: true };
}

/** Merges two edits of a text made from the same ancestor. */
export function merge3(
  base: string,
  mine: string,
  theirs: string,
): { text: string; conflicts: number } {
  if (mine === theirs || theirs === base) return { text: mine, conflicts: 0 };
  if (mine === base) return { text: theirs, conflicts: 0 };
  const r = merge(base.split('\n'), mine.split('\n'), theirs.split('\n'), lines);
  return { text: r.parts.join('\n'), conflicts: r.conflicts };
}
