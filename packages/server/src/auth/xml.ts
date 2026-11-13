// ── [PCODE-212 | S15 | v0.1.0] T19.1 SAML 2.0 single sign-on per workspace, own XML signature verification with wrapping defences ──
//    Why:  SAML responses are signed XML. To check a signature we need the exact bytes the signer hashed,
//          which is the "exclusive canonical" form of an element (W3C Exclusive XML Canonicalization 1.0,
//          without comments). This is a small, strict XML reader for that purpose: no DTD, no entities
//          except the five predefined ones and character references, namespaces resolved, and a
//          canonicaliser that writes an element the way the standard says.

export class XmlError extends Error {}

export interface XmlAttr {
  /** qualified name as written: prefix:local or local */
  name: string;
  prefix: string;
  local: string;
  /** namespace URI ('' for none; unprefixed attributes have none) */
  ns: string;
  value: string;
}
export interface XmlElement {
  kind: 'element';
  name: string;
  prefix: string;
  local: string;
  ns: string;
  /** namespace declarations made on this element: prefix ('' for default) → URI */
  decls: Map<string, string>;
  /** all namespaces in scope here, inherited ones included */
  scope: Map<string, string>;
  attrs: XmlAttr[];
  children: XmlNode[];
  parent: XmlElement | null;
}
export interface XmlText {
  kind: 'text';
  text: string;
}
export interface XmlPi {
  kind: 'pi';
  target: string;
  data: string;
}
export type XmlNode = XmlElement | XmlText | XmlPi;

const XMLNS = 'http://www.w3.org/2000/xmlns/';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const NAME = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/;

function decode(text: string): string {
  return text.replace(/&(#x[0-9A-Fa-f]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    if (!Number.isFinite(code) || code < 0x9 || code > 0x10ffff)
      throw new XmlError('Bad character reference');
    return String.fromCodePoint(code);
  });
}

/** Parses a document; returns its root element. DOCTYPE, entities and unknown references are refused. */
export function parseXml(input: string, maxLength = 2_000_000): XmlElement {
  if (input.length > maxLength) throw new XmlError('The document is too large');
  let i = 0;
  const src = input.replace(/\r\n?/g, '\n');
  const fail = (why: string): never => {
    throw new XmlError(why + ' at ' + String(i));
  };
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  const pushText = (text: string): void => {
    const top = stack.at(-1);
    if (!top) {
      if (text.trim()) fail('Text outside the root element');
      return;
    }
    if (/&(?!(#x[0-9A-Fa-f]+|#\d+|amp|lt|gt|quot|apos);)/.test(text)) fail('Unknown entity');
    top.children.push({ kind: 'text', text: decode(text) });
  };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      pushText(src.slice(i));
      break;
    }
    if (lt > i) pushText(src.slice(i, lt));
    i = lt;
    if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i);
      if (end < 0) fail('Unclosed processing instruction');
      const body = src.slice(i + 2, end);
      const [target = '', ...rest] = body.split(/\s+/);
      if (target.toLowerCase() !== 'xml' && stack.length)
        stack.at(-1)?.children.push({ kind: 'pi', target, data: rest.join(' ') });
      i = end + 2;
      continue;
    }
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i);
      if (end < 0) fail('Unclosed comment');
      i = end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i);
      if (end < 0) fail('Unclosed CDATA');
      const top = stack.at(-1);
      if (!top) fail('CDATA outside the root element');
      top?.children.push({ kind: 'text', text: src.slice(i + 9, end) });
      i = end + 3;
      continue;
    }
    if (src.startsWith('<!', i)) fail('DOCTYPE and declarations are not allowed');
    if (src.startsWith('</', i)) {
      const end = src.indexOf('>', i);
      if (end < 0) fail('Unclosed end tag');
      const name = src.slice(i + 2, end).trim();
      const top = stack.pop();
      if (!top || top.name !== name) fail('Mismatched end tag ' + name);
      i = end + 1;
      continue;
    }
    // a start tag
    i++;
    const nameEnd = src.slice(i).search(/[\s/>]/);
    if (nameEnd <= 0) fail('Bad tag');
    const name = src.slice(i, i + nameEnd);
    if (!NAME.test(name)) fail('Bad element name');
    i += nameEnd;
    const raw: { name: string; value: string }[] = [];
    let selfClose = false;
    for (;;) {
      while (/\s/.test(src[i] ?? '')) i++;
      if (src[i] === '>') {
        i++;
        break;
      }
      if (src.startsWith('/>', i)) {
        i += 2;
        selfClose = true;
        break;
      }
      const m = /^([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(src.slice(i));
      if (!m) fail('Bad attribute');
      const an = m?.[1] ?? '';
      if (!NAME.test(an)) fail('Bad attribute name');
      const av = m?.[3] ?? m?.[4] ?? '';
      if (av.includes('<')) fail('< in an attribute value');
      if (/&(?!(#x[0-9A-Fa-f]+|#\d+|amp|lt|gt|quot|apos);)/.test(av)) fail('Unknown entity');
      if (raw.some((r) => r.name === an)) fail('Repeated attribute ' + an);
      raw.push({ name: an, value: decode(av).replace(/[\t\n]/g, ' ') });
      i += m?.[0].length ?? 0;
    }
    const parent = stack.at(-1) ?? null;
    const decls = new Map<string, string>();
    for (const a of raw) {
      if (a.name === 'xmlns') decls.set('', a.value);
      else if (a.name.startsWith('xmlns:')) decls.set(a.name.slice(6), a.value);
    }
    const scope = new Map(parent?.scope ?? [['xml', XML_NS]]);
    for (const [k, v] of decls) scope.set(k, v);
    const split = (q: string): [string, string] => {
      const c = q.indexOf(':');
      return c < 0 ? ['', q] : [q.slice(0, c), q.slice(c + 1)];
    };
    const [prefix, local] = split(name);
    const ns = scope.get(prefix);
    if (prefix && ns === undefined) fail('Unbound prefix ' + prefix);
    const attrs: XmlAttr[] = raw
      .filter((a) => a.name !== 'xmlns' && !a.name.startsWith('xmlns:'))
      .map((a) => {
        const [p, l] = split(a.name);
        const u = p ? scope.get(p) : '';
        if (p && u === undefined) fail('Unbound prefix ' + p);
        return { name: a.name, prefix: p, local: l, ns: u ?? '', value: a.value };
      });
    const el: XmlElement = {
      kind: 'element',
      name,
      prefix,
      local,
      ns: ns ?? '',
      decls,
      scope,
      attrs,
      children: [],
      parent,
    };
    if (parent) parent.children.push(el);
    else if (root) fail('A second root element');
    else root = el;
    if (!selfClose) stack.push(el);
  }
  if (stack.length) throw new XmlError('Unclosed element ' + (stack.at(-1)?.name ?? ''));
  if (!root) throw new XmlError('No root element');
  return root;
}

// ── navigation ──
export const childElements = (e: XmlElement): XmlElement[] =>
  e.children.filter((c): c is XmlElement => c.kind === 'element');
export const children = (e: XmlElement, ns: string, local: string): XmlElement[] =>
  childElements(e).filter((c) => c.ns === ns && c.local === local);
export const child = (e: XmlElement, ns: string, local: string): XmlElement | undefined =>
  children(e, ns, local)[0];
export function descendants(e: XmlElement, ns: string, local: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (x: XmlElement): void => {
    for (const c of childElements(x)) {
      if (c.ns === ns && c.local === local) out.push(c);
      walk(c);
    }
  };
  walk(e);
  return out;
}
export const attr = (e: XmlElement, local: string, ns = ''): string | undefined =>
  e.attrs.find((a) => a.local === local && a.ns === ns)?.value;
export const textOf = (e: XmlElement): string =>
  e.children
    .map((c) => (c.kind === 'text' ? c.text : c.kind === 'element' ? textOf(c) : ''))
    .join('');

// ── exclusive canonicalization (without comments) ──
const escText = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const escAttr = (t: string): string =>
  t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');

/**
 * The exclusive canonical form of an element and what is under it. `omit` leaves one element out (the
 * enveloped signature); `inclusive` lists prefixes rendered as in inclusive canonicalization.
 */
export function canonicalize(
  e: XmlElement,
  opts: { omit?: XmlElement; inclusive?: string[] } = {},
): string {
  const inclusive = new Set(opts.inclusive ?? []);
  const out: string[] = [];
  const write = (x: XmlElement, rendered: Map<string, string>): void => {
    // the prefixes this element visibly uses: its own and its attributes'
    const used = new Set<string>([x.prefix]);
    for (const a of x.attrs) if (a.prefix && a.prefix !== 'xml') used.add(a.prefix);
    for (const p of inclusive)
      if (x.scope.has(p === '#default' ? '' : p)) used.add(p === '#default' ? '' : p);
    const decls: [string, string][] = [];
    const next = new Map(rendered);
    for (const p of used) {
      if (p === 'xml') continue;
      const uri = x.scope.get(p) ?? '';
      // the default namespace "" is only written when it changes an inherited non-empty default
      if (p === '' && uri === '' && (rendered.get('') ?? '') === '') continue;
      if (rendered.get(p) === uri) continue;
      decls.push([p, uri]);
      next.set(p, uri);
    }
    decls.sort((a, b) =>
      a[0] === '' ? -1 : b[0] === '' ? 1 : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    );
    const attrs = [...x.attrs].sort((a, b) =>
      a.ns === b.ns ? (a.local < b.local ? -1 : a.local > b.local ? 1 : 0) : a.ns < b.ns ? -1 : 1,
    );
    out.push('<' + x.name);
    for (const [p, uri] of decls)
      out.push(' ' + (p ? 'xmlns:' + p : 'xmlns') + '="' + escAttr(uri) + '"');
    for (const a of attrs) out.push(' ' + a.name + '="' + escAttr(a.value) + '"');
    out.push('>');
    for (const c of x.children) {
      if (c.kind === 'text') out.push(escText(c.text));
      else if (c.kind === 'pi') out.push('<?' + c.target + (c.data ? ' ' + c.data : '') + '?>');
      else if (c !== opts.omit) write(c, next);
    }
    out.push('</' + x.name + '>');
  };
  write(e, new Map());
  return out.join('');
}

export const NS = { xmlns: XMLNS, xml: XML_NS };
