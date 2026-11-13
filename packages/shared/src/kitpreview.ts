// ── [PCODE-291 | S15 | v0.1.0] T30.5 Live component preview with the project's tokens and themes ──
//    Why:  a component is shown as it is meant to look: its example markup and CSS on a page of its own
//          that carries the project's token variables, in any theme. The page is inert by construction:
//          scripts, frames, forms and event attributes are taken out here, and the server adds a policy
//          and a sandbox on top, so a preview can never act for the person looking at it.

const DROP_ELEMENTS = [
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'meta',
  'link',
  'style',
  'form',
  'template',
  'noscript',
];

/** Example markup with nothing that can run, load or send: no scripts, frames or forms, no on…
 *  attributes, no javascript: or remote addresses. */
export function sanitizePreviewHtml(html: string): string {
  let out = html;
  for (const tag of DROP_ELEMENTS) {
    // a whole element with its content, then any stray opening or closing tag
    out = out.replace(new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?</' + tag + '\\s*>', 'gi'), '');
    out = out.replace(new RegExp('</?' + tag + '\\b[^>]*>', 'gi'), '');
  }
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  // event handlers and inline styles that load things
  out = out.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(
    /\s+(href|src|srcset|action|formaction|xlink:href|poster|background)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
    (_m, attr: string, value: string) => {
      const v = value.replace(/^["']|["']$/g, '').trim();
      // only images inside the page (data:) and plain fragments survive
      return /^(#[\w-]*|data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+)$/i.test(v)
        ? ' ' + attr + '="' + v + '"'
        : '';
    },
  );
  return out;
}

/** CSS that cannot leave the page: no @import, no remote url(), no closing the style element. */
export function sanitizePreviewCss(css: string): string {
  return css
    .replace(/<\/?style[^>]*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)(?!data:image\/)[^)]*\1\s*\)/gi, 'none')
    .replace(/expression\s*\(/gi, '(')
    .trim();
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The preview page: the token CSS, the theme on the root, the component's CSS and markup. */
export function previewDocument(p: {
  title: string;
  tokensCss: string;
  css: string;
  html: string;
  /** light, dark or a theme's name */
  theme: string;
}): string {
  const theme = /^[a-z][a-z0-9-]{0,39}$/.test(p.theme) ? p.theme : 'light';
  return (
    '<!doctype html><html lang="en" data-theme="' +
    theme +
    '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' +
    esc(p.title) +
    '</title><style>' +
    sanitizePreviewCss(p.tokensCss) +
    '\nhtml,body{margin:0}body{padding:16px;font-family:var(--font-family-body,system-ui,sans-serif);' +
    'background:var(--color-bg,Canvas);color:var(--color-text,CanvasText)}\n' +
    sanitizePreviewCss(p.css) +
    '</style></head><body>' +
    sanitizePreviewHtml(p.html) +
    '</body></html>'
  );
}

/** The policy the preview page is sent with: styles and own images only, nothing runs or leaves. */
export const PREVIEW_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox";
