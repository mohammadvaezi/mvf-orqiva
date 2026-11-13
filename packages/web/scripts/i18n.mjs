// ── [PCODE-356 | S15 | v0.1.0] T35.5a Translation layer for a German UI, language choice, text extraction ──
//    Why:  the list of every text the web app shows, so none is missed in German: the texts in the
//          screens, the labels and placeholders, the texts made of parts ("Go to " + a page becomes
//          "Go to {x}"), the shared texts the screens show, and the server's messages that reach people.
//          `node scripts/i18n.mjs` writes src/i18n/strings.json; `--check` says which have no German yet.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO = join(ROOT, '..', '..');

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
};

// the web app's screens (not the design previews' mock data), the shared texts, the server's messages
const PREVIEW_LIVE = ['ui.tsx', 'inbox.tsx', 'picons.tsx'];
const webFiles = walk(join(ROOT, 'src')).filter((f) => {
  const rel = relative(join(ROOT, 'src'), f).replace(/\\/g, '/');
  if (rel.startsWith('i18n/')) return false;
  if (rel.startsWith('preview/')) return PREVIEW_LIVE.includes(rel.slice('preview/'.length));
  return true;
});
const sharedFiles = walk(join(REPO, 'packages', 'shared', 'src'));
const serverFiles = walk(join(REPO, 'packages', 'server', 'src'));

/** Whether a string reads like words a person sees. */
export function looksLikeText(s) {
  const t = s.trim();
  if (t.length < 2 || t.length > 400) return false;
  if (!/[A-Za-z]{2}/.test(t)) return false;
  if (/^(GET|POST|PUT|PATCH|DELETE|HEAD)$/.test(t)) return false;
  if (/^[a-z][A-Za-z0-9]*$/.test(t)) return false; // an identifier
  if (/^[a-z0-9_.:-]+$/.test(t) && !/ /.test(t)) return false; // a key, a class, a slug
  if (/^(pv|v2|pe|msg|pk)-/.test(t) || / (pv|v2|pe)-[a-z]/.test(t)) return false; // css classes
  if (/^[./#@]|^https?:|^[a-z]+:\/\//.test(t)) return false; // paths, urls, selectors
  if (/[{}<>=;`$]|\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/.test(t)) return false; // code and SQL
  if (/^\w+\/[\w.+-]+$/.test(t)) return false; // a mime type
  if (/^[A-Z0-9_]+$/.test(t)) return false; // a constant
  return true;
}

const found = new Map(); // text → where it was first seen

const add = (text, file) => {
  const t = text.replace(/\s+/g, ' ').trim();
  if (looksLikeText(t) && !found.has(t)) found.set(t, relative(REPO, file).replace(/\\/g, '/'));
};

/** A text made of literals and other parts: "Go to " + x → "Go to {x}". */
function template(node) {
  const parts = [];
  const flat = (n) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      flat(n.left);
      flat(n.right);
    } else if (ts.isParenthesizedExpression(n)) flat(n.expression);
    else parts.push(n);
  };
  flat(node);
  if (!parts.some((p) => ts.isStringLiteral(p) || ts.isNoSubstitutionTemplateLiteral(p)))
    return null;
  let i = 0;
  const text = parts
    .map((p) => {
      if (ts.isStringLiteral(p) || ts.isNoSubstitutionTemplateLiteral(p)) return p.text;
      i++;
      return i === 1 ? '{x}' : '{x' + String(i) + '}';
    })
    .join('');
  return i > 0 && i <= 3 ? text : null;
}

function scan(file, mode) {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const visit = (node) => {
    if (mode === 'server') {
      // the message of new HttpError(status, code, message)
      if (
        ts.isNewExpression(node) &&
        node.expression.getText(sf) === 'HttpError' &&
        node.arguments?.[2]
      ) {
        const m = node.arguments[2];
        if (ts.isStringLiteral(m)) add(m.text, file);
        else if (ts.isBinaryExpression(m)) {
          const t = template(m);
          if (t) add(t, file);
        }
      }
    } else {
      if (ts.isJsxText(node)) add(node.text, file);
      else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        // not imports, not types, not object keys
        const p = node.parent;
        const skip =
          ts.isImportDeclaration(p) ||
          ts.isExportDeclaration(p) ||
          ts.isLiteralTypeNode(p) ||
          (ts.isPropertyAssignment(p) && p.name === node) ||
          (ts.isElementAccessExpression(p) && p.argumentExpression === node) ||
          (ts.isCallExpression(p) &&
            /^(api|fetch|require|querySelector|querySelectorAll|getItem|setItem|matches|closest|addEventListener|removeEventListener|setAttribute|getAttribute)$/.test(
              p.expression.getText(sf).split('.').pop() ?? '',
            ));
        if (!skip) add(node.text, file);
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        !ts.isBinaryExpression(node.parent)
      ) {
        const t = template(node);
        if (t) add(t, file);
      } else if (ts.isTemplateExpression(node)) {
        let i = 0;
        const t =
          node.head.text +
          node.templateSpans
            .map((sp) => {
              i++;
              return (i === 1 ? '{x}' : '{x' + String(i) + '}') + sp.literal.text;
            })
            .join('');
        if (i <= 3) add(t, file);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

for (const f of webFiles) scan(f, 'web');
for (const f of sharedFiles) scan(f, 'web');
for (const f of serverFiles) scan(f, 'server');

const list = [...found.keys()].sort((a, b) => a.localeCompare(b));
const out = join(ROOT, 'src', 'i18n', 'strings.json');
if (process.argv.includes('--check')) {
  const de = JSON.parse(readFileSync(join(ROOT, 'src', 'i18n', 'de.json'), 'utf8'));
  const missing = list.filter((t) => !(t in de));
  console.log(
    String(list.length) +
      ' texts; ' +
      String(list.length - missing.length) +
      ' in German; ' +
      String(missing.length) +
      ' without',
  );
  for (const m of missing.slice(0, 40)) console.log('  ' + m);
} else {
  writeFileSync(
    out,
    JSON.stringify(Object.fromEntries(list.map((t) => [t, found.get(t)])), null, 1) + '\n',
  );
  console.log(String(list.length) + ' texts written to src/i18n/strings.json');
}
