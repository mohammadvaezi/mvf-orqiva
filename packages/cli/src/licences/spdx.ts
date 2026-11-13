// ── [PCODE-85 | S08 | v0.1.0] Build our own licence checker and SBOM generator that fail CI on a denied licence ──
//    Why:  a package's manifest declares its licence as an SPDX expression ("MIT", "(MIT OR GPL-3.0)",
//          "Apache-2.0 WITH LLVM-exception"). We evaluate it ourselves: OR means we may pick the accepted
//          branch, AND means every part applies, WITH keeps the base licence's verdict.

export type SpdxNode =
  | { kind: 'id'; id: string; exception?: string }
  | { kind: 'and' | 'or'; left: SpdxNode; right: SpdxNode };

/** Parses an SPDX licence expression; returns null for anything that is not one (e.g. "SEE LICENSE IN x"). */
export function parseSpdx(text: string): SpdxNode | null {
  const tokens = text.match(/\(|\)|[^\s()]+/g) ?? [];
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const isWord = (t: string | undefined, w: string): boolean => t?.toUpperCase() === w;

  function factor(): SpdxNode | null {
    const t = peek();
    if (t === undefined) return null;
    if (t === '(') {
      pos++;
      const inner = expr();
      if (peek() !== ')') return null;
      pos++;
      return inner;
    }
    if (t === ')' || isWord(t, 'AND') || isWord(t, 'OR') || isWord(t, 'WITH')) return null;
    if (!/^[A-Za-z0-9.+-]+$/.test(t)) return null;
    pos++;
    if (isWord(peek(), 'WITH')) {
      pos++;
      const exception = peek();
      if (exception === undefined || !/^[A-Za-z0-9.+-]+$/.test(exception)) return null;
      pos++;
      return { kind: 'id', id: t, exception };
    }
    return { kind: 'id', id: t };
  }
  function term(): SpdxNode | null {
    let left = factor();
    while (left && isWord(peek(), 'AND')) {
      pos++;
      const right = factor();
      if (!right) return null;
      left = { kind: 'and', left, right };
    }
    return left;
  }
  function expr(): SpdxNode | null {
    let left = term();
    while (left && isWord(peek(), 'OR')) {
      pos++;
      const right = term();
      if (!right) return null;
      left = { kind: 'or', left, right };
    }
    return left;
  }

  const tree = expr();
  return tree && pos === tokens.length ? tree : null;
}

/** Every licence id the expression names, in order. */
export function spdxIds(node: SpdxNode): string[] {
  if (node.kind === 'id') return [node.id];
  return [...spdxIds(node.left), ...spdxIds(node.right)];
}

/**
 * The licences we would be bound by if we pick accepted branches of every OR, or null when no choice
 * avoids a licence outside `accepted`.
 */
export function chooseAccepted(node: SpdxNode, accepted: ReadonlySet<string>): string[] | null {
  if (node.kind === 'id') return accepted.has(node.id) ? [node.id] : null;
  const left = chooseAccepted(node.left, accepted);
  const right = chooseAccepted(node.right, accepted);
  if (node.kind === 'or') return left ?? right;
  return left && right ? [...left, ...right] : null;
}
