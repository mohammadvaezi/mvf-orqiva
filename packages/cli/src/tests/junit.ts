// ── [PCODE-136 | S15 | v0.1.0] Stream test results from a running suite and import JUnit ──
//    Why:  JUnit XML is what nearly every CI tool can write after a run. We read it with our own small XML
//          reader (elements, attributes, text, CDATA, comments, entities) rather than a library: the
//          format is simple and the product's code stays its own.
import type { TestResult } from './tap.js';

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e.startsWith('#x') || e.startsWith('#X'))
      return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

export class XmlError extends Error {}

/** Parses an XML document into its root element. */
export function parseXml(src: string): XmlElement {
  const root: XmlElement = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];
  let i = 0;
  const top = (): XmlElement => stack[stack.length - 1] ?? root;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      top().text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) top().text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end < 0) throw new XmlError('An unclosed comment');
      i = end + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      if (end < 0) throw new XmlError('An unclosed CDATA section');
      top().text += src.slice(lt + 9, end);
      i = end + 3;
    } else if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt);
      if (end < 0) throw new XmlError('An unclosed declaration');
      i = end + 1;
    } else if (src.startsWith('</', lt)) {
      const end = src.indexOf('>', lt);
      const name = src.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name)
        throw new XmlError('</' + name + '> does not close <' + (open?.name ?? '') + '>');
      i = end + 1;
    } else {
      // a start tag, with attributes in single or double quotes, perhaps self-closing
      let j = lt + 1;
      let quote = '';
      while (j < src.length) {
        const ch = src[j];
        if (quote) {
          if (ch === quote) quote = '';
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '>') break;
        j++;
      }
      if (j >= src.length) throw new XmlError('An unclosed tag');
      const raw = src.slice(lt + 1, j);
      const selfClosing = raw.endsWith('/');
      const inner = selfClosing ? raw.slice(0, -1) : raw;
      const name = /^[^\s/]+/.exec(inner)?.[0] ?? '';
      const attrs: Record<string, string> = {};
      for (const m of inner.slice(name.length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g))
        attrs[m[1] ?? ''] = decodeEntities(m[3] ?? m[4] ?? '');
      const el: XmlElement = { name, attrs, children: [], text: '' };
      top().children.push(el);
      if (!selfClosing) stack.push(el);
      i = j + 1;
    }
  }
  if (stack.length !== 1) throw new XmlError('<' + top().name + '> is not closed');
  const doc = root.children[0];
  if (!doc) throw new XmlError('The file has no XML element');
  return doc;
}

/** Every <testcase> of a JUnit report as a result; suites nest, and their names lead the key. */
export function readJunit(xml: string): TestResult[] {
  const out: TestResult[] = [];
  const walk = (el: XmlElement, path: string[]): void => {
    if (el.name === 'testcase') {
      const name = el.attrs['name'] ?? 'test';
      const cls = el.attrs['classname'];
      const parts = [...path, ...(cls && !path.includes(cls) ? [cls] : []), name];
      const failure = el.children.find((c) => c.name === 'failure' || c.name === 'error');
      const skipped = el.children.some((c) => c.name === 'skipped');
      const time = Number(el.attrs['time']);
      const result: TestResult = {
        key: parts.join(' > '),
        status: failure ? 'failed' : skipped ? 'skipped' : 'passed',
      };
      if (Number.isFinite(time) && el.attrs['time'] !== undefined)
        result.durationMs = Math.round(time * 1000);
      if (failure)
        result.message = [failure.attrs['message'], failure.text.trim()]
          .filter(Boolean)
          .join('\n')
          .slice(0, 20_000);
      out.push(result);
      return;
    }
    const here = el.name === 'testsuite' && el.attrs['name'] ? [...path, el.attrs['name']] : path;
    for (const c of el.children) walk(c, here);
  };
  walk(parseXml(xml), []);
  return out;
}
