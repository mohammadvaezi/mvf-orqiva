// ── [PCODE-218 | S15 | v0.1.0] T20.1 Public docs site built from the repository (own Markdown renderer, CLI and API reference, link check) ──
//    Why:  the two references are generated, never written by hand, so they cannot drift from the code. The
//          CLI page reads `orq --help` (sections end with a colon; a command is indented two spaces and its
//          description follows after three spaces or on the next, deeper line). The API page reads the
//          OpenAPI document the server builds from its route list: grouped by tag, one folded row per
//          operation with its parameters and body fields.
import { escapeHtml, slugify, type Heading } from './markdown.js';

export interface Section {
  title: string;
  commands: { usage: string; text: string }[];
}

/** The help text of `orq --help` as sections of commands. */
export function parseCliHelp(help: string): Section[] {
  const sections: Section[] = [];
  let current: Section | undefined;
  const start = (title: string): Section => {
    const s: Section = { title, commands: [] };
    sections.push(s);
    return s;
  };
  for (const raw of help.replace(/\r\n/g, '\n').split('\n')) {
    if (raw.startsWith('Usage:')) continue;
    if (raw.trim() === '') {
      if (current?.commands.length) current = undefined;
      continue;
    }
    const header = /^(\S.*):$/.exec(raw);
    if (header) {
      current = start(header[1] === 'Commands' ? 'Server and install' : (header[1] ?? ''));
      continue;
    }
    const indent = /^ */.exec(raw)?.[0].length ?? 0;
    const line = raw.trim();
    const last = current?.commands.at(-1);
    if (indent > 4 && last) {
      // the description on its own, deeper line
      last.text = (last.text ? last.text + ' ' : '') + line;
      continue;
    }
    current ??= start(
      line.startsWith('-') ? 'Options' : sections.length ? 'More commands' : 'Commands',
    );
    const m = /^(.*?\S)\s{3,}(\S.*)$/.exec(line);
    current.commands.push({ usage: m?.[1] ?? line, text: m?.[2] ?? '' });
  }
  return sections.filter((s) => s.commands.length);
}

export function cliPage(help: string): { body: string; headings: Heading[] } {
  const sections = parseCliHelp(help);
  const headings: Heading[] = [{ level: 1, id: 'cli', text: 'Command line (orq)' }];
  const parts = [
    '<h1 id="cli">Command line (<code>orq</code>)</h1>',
    '<p class="lead">Every command of <code>orq</code>, generated from its own help text. ' +
      '<code>orq COMMAND --help</code> prints the details of the install commands.</p>',
  ];
  for (const s of sections) {
    const id = slugify(s.title);
    headings.push({ level: 2, id, text: s.title });
    parts.push('<h2 id="' + id + '">' + escapeHtml(s.title) + '</h2><dl class="cmd">');
    for (const c of s.commands)
      parts.push(
        '<dt>orq ' +
          escapeHtml(c.usage) +
          '</dt><dd>' +
          (c.text ? escapeHtml(c.text) : '&nbsp;') +
          '</dd>',
      );
    parts.push('</dl>');
  }
  return { body: parts.join('\n'), headings };
}

interface Operation {
  method: string;
  path: string;
  summary: string;
  tag: string;
  params: { name: string; in: string; required: boolean }[];
  body: string[];
}

const fieldsOf = (schema: unknown): string[] => {
  const s = schema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  const req = new Set(s?.required ?? []);
  return Object.keys(s?.properties ?? {}).map((k) => k + (req.has(k) ? '' : '?'));
};

/** The operations of an OpenAPI 3.1 document, in path order. */
export function operationsOf(doc: Record<string, unknown>): Operation[] {
  const out: Operation[] = [];
  const paths = (doc['paths'] ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  for (const [path, ops] of Object.entries(paths))
    for (const [method, op] of Object.entries(ops)) {
      const body = (
        (op['requestBody'] as { content?: Record<string, { schema?: unknown }> } | undefined)
          ?.content?.['application/json'] ?? {}
      ).schema;
      out.push({
        method: method.toUpperCase(),
        path,
        summary: typeof op['summary'] === 'string' ? op['summary'] : '',
        tag: ((op['tags'] as string[] | undefined) ?? ['other'])[0] ?? 'other',
        params: (
          (op['parameters'] as { name: string; in: string; required: boolean }[] | undefined) ?? []
        ).map((p) => ({ name: p.name, in: p.in, required: p.required })),
        body: fieldsOf(body),
      });
    }
  return out;
}

export function apiPage(doc: Record<string, unknown>): { body: string; headings: Heading[] } {
  const ops = operationsOf(doc);
  const tags = [...new Set(ops.map((o) => o.tag))].sort((a, b) => a.localeCompare(b));
  const headings: Heading[] = [{ level: 1, id: 'api', text: 'REST API' }];
  const parts = [
    '<h1 id="api">REST API</h1>',
    '<p class="lead">' +
      String(ops.length) +
      ' operations, generated from the server’s route list. A running server describes itself at ' +
      '<code>/openapi.json</code> (OpenAPI 3.1). Requests and answers are JSON; sign in with a session ' +
      'cookie or an API token (<code>Authorization: Bearer orq_…</code>). Errors look like ' +
      '<code>{"error": {"code", "message", "requestId"}}</code>.</p>',
  ];
  for (const tag of tags) {
    const id = 'tag-' + slugify(tag);
    const mine = ops.filter((o) => o.tag === tag);
    headings.push({ level: 2, id, text: tag });
    parts.push(
      '<h2 id="' +
        id +
        '">' +
        escapeHtml(tag) +
        ' <small>(' +
        String(mine.length) +
        ')</small></h2>',
    );
    for (const o of mine) {
      const m = o.method.toLowerCase();
      const params = o.params
        .map(
          (p) =>
            '<code>' +
            escapeHtml(p.name) +
            '</code> (' +
            p.in +
            (p.required ? '' : ', optional') +
            ')',
        )
        .join(', ');
      parts.push(
        '<details class="op"><summary><span class="m m-' +
          m +
          '">' +
          o.method +
          '</span><span class="p">' +
          escapeHtml(o.path) +
          '</span><span class="s">' +
          escapeHtml(o.summary) +
          '</span></summary><div class="b"><p>' +
          escapeHtml(o.summary) +
          '</p>' +
          (params ? '<p>Parameters: ' + params + '</p>' : '') +
          (o.body.length
            ? '<p>Body: ' +
              o.body.map((f) => '<code>' + escapeHtml(f) + '</code>').join(' ') +
              '</p>'
            : '') +
          '</div></details>',
      );
    }
  }
  return { body: parts.join('\n'), headings };
}
