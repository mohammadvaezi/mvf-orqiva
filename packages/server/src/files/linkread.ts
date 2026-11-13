// ── [PCODE-272 | S15 | v0.1.0] T28.1 Ideation intake: links read on the server, sources from the CLI and VS Code ──
//    Why:  a link given to an idea is read once by the server, so its text can be cited like a pasted one.
//          Only public addresses are read, every redirect is checked again, the size and time are capped.
//          A web page becomes readable lines (its main part when it marks one, headings and list items kept
//          as such); plain text is kept; a PDF or Word file is handed back as bytes to be stored and read
//          the way uploads are.
import { isPublicUrl } from '../api/documents.js';

export interface LinkReadDeps {
  fetchImpl?: typeof fetch;
  /** tests read from the test server itself; real installs never reach private addresses */
  allowPrivate?: boolean;
}

export type LinkRead =
  | { kind: 'text'; url: string; title: string; text: string; truncated: boolean }
  | { kind: 'file'; url: string; name: string; mime: string; data: Buffer };

export class LinkReadError extends Error {}

/** The largest answer read: pages beyond this are cut, files beyond it refused. */
export const LINK_MAX_BYTES = 10 * 1024 * 1024;
/** The most text kept from one link, as the source column allows. */
export const LINK_MAX_TEXT = 200_000;
const TIMEOUT_MS = 15_000;
const HOPS = 5;

const FILE_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};
const TEXT_TYPE = /^(text\/|application\/(json|xml|xhtml\+xml|[\w.+-]*\+(json|xml)))/;

const NAMED: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  eacute: 'é',
  egrave: 'è',
};

/** Entities decoded: the common named ones and every numeric one. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED[e] ?? m;
  });
}

/** A web page as readable text: its title, and its main part as lines, headings and list items marked. */
export function pageText(html: string): { title: string; text: string } {
  const title = decodeEntities(
    (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' '),
  ).trim();
  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|head|iframe|form)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  // the main part when the page marks one; otherwise the body without its page furniture
  const main =
    /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(body)?.[1] ??
    /<article\b[^>]*>([\s\S]*?)<\/article\s*>/i.exec(body)?.[1];
  body = main ?? body.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const text = body
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => '\n' + '#'.repeat(Number(n)) + ' ')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(
      /<\/?(p|div|section|article|main|tr|table|ul|ol|dl|dt|dd|blockquote|pre|h[1-6])\b[^>]*>/gi,
      '\n',
    )
    .replace(/<\/t[dh]\s*>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((l) =>
      decodeEntities(l)
        .replace(/[ \t ]+/g, ' ')
        .trim(),
    )
    .filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== ''))
    .join('\n')
    .replace(/^(#{1,6}|-) *$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

async function readCapped(res: Response, max: number): Promise<{ data: Buffer; cut: boolean }> {
  if (!res.body) return { data: Buffer.alloc(0), cut: false };
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    parts.push(Buffer.from(chunk));
    size += chunk.length;
    if (size > max) {
      await res.body.cancel().catch(() => undefined);
      return { data: Buffer.concat(parts).subarray(0, max), cut: true };
    }
  }
  return { data: Buffer.concat(parts), cut: false };
}

const fileNameOf = (url: URL, ext: string, disposition: string): string => {
  const given = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
  let name = given
    ? decodeURIComponent(given)
    : decodeURIComponent(url.pathname.split('/').pop() ?? '');
  name = name.replace(/[\\/]/g, '_').trim().slice(0, 200);
  if (!name) name = url.hostname;
  return name.toLowerCase().endsWith(ext) ? name : name + ext;
};

/** Reads one link: public addresses only, each redirect checked again; text, or a PDF or Word file. */
export async function readLink(address: string, deps: LinkReadDeps = {}): Promise<LinkRead> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new LinkReadError('That is not a web address');
  }
  for (let hop = 0; hop <= HOPS; hop++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      throw new LinkReadError('Only http and https addresses are read');
    if (url.username || url.password)
      throw new LinkReadError('Addresses with a user name or password are not read');
    if (!deps.allowPrivate && !(await isPublicUrl(url.href)))
      throw new LinkReadError(url.hostname + ' is not a public address');
    let res: Response;
    try {
      res = await (deps.fetchImpl ?? fetch)(url.href, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'user-agent': 'Orqiva link reader',
          accept: 'text/html, text/*;q=0.9, application/pdf;q=0.8, */*;q=0.5',
        },
      });
    } catch (e) {
      throw new LinkReadError(
        'Could not reach ' + url.hostname + ': ' + (e instanceof Error ? e.message : String(e)),
      );
    }
    const next = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && next) {
      await res.body?.cancel().catch(() => undefined);
      url = new URL(next, url);
      continue;
    }
    if (res.status >= 400) {
      await res.body?.cancel().catch(() => undefined);
      throw new LinkReadError(url.hostname + ' answered ' + String(res.status));
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    const ext = FILE_TYPES[type];
    if (ext) {
      const { data, cut } = await readCapped(res, LINK_MAX_BYTES);
      if (cut) throw new LinkReadError('The file is larger than 10 MB');
      const name = fileNameOf(url, ext, res.headers.get('content-disposition') ?? '');
      return { kind: 'file', url: url.href, name, mime: type, data };
    }
    if (type && !TEXT_TYPE.test(type))
      throw new LinkReadError(url.hostname + ' answered with ' + type + ', which is not read');
    const { data, cut } = await readCapped(res, LINK_MAX_BYTES);
    const raw = data.toString('utf8').replace(/\u0000/g, '');
    const html =
      type === 'text/html' || type === 'application/xhtml+xml' || (!type && /<html/i.test(raw));
    const page = html ? pageText(raw) : { title: '', text: raw.trim() };
    if (!page.text) throw new LinkReadError('The page has no readable text');
    return {
      kind: 'text',
      url: url.href,
      title: page.title.slice(0, 300),
      text: page.text.slice(0, LINK_MAX_TEXT),
      truncated: cut || page.text.length > LINK_MAX_TEXT,
    };
  }
  throw new LinkReadError('Too many redirects');
}
