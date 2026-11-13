// ── [PCODE-319 | S15 | v0.1.0] T32.5a Bug capture on the server: a report with page, device, console, network and actions becomes a bug ──
//    Why:  a bug filed from the browser carries what a developer asks first: where it happened, on what,
//          what the person did just before, what the console said and which requests failed. The report
//          becomes the bug's description in sections, the screenshot inline, the failures first.

export interface BugReport {
  title: string;
  note: string;
  page: { url: string; title: string };
  device: {
    userAgent: string;
    platform: string;
    language: string;
    viewport: { width: number; height: number };
    screen: { width: number; height: number; pixelRatio: number };
    timeZone: string;
  };
  console: { level: 'error' | 'warn' | 'info' | 'log' | 'debug'; text: string; at: string }[];
  network: { method: string; url: string; status: number; ms: number; at: string }[];
  actions: {
    kind: 'click' | 'input' | 'navigate' | 'submit' | 'key';
    target: string;
    at: string;
  }[];
}

/** A browser's name and version from its user agent, the way people say it. */
export function browserOf(ua: string): string {
  const pick = (re: RegExp, name: string): string | null => {
    const m = re.exec(ua);
    return m ? name + ' ' + (m[1] ?? '') : null;
  };
  return (
    pick(/Edg\/(\d+)/, 'Edge') ??
    pick(/OPR\/(\d+)/, 'Opera') ??
    pick(/Firefox\/(\d+)/, 'Firefox') ??
    pick(/Chrome\/(\d+)/, 'Chrome') ??
    pick(/Version\/(\d+)[^ ]* Safari/, 'Safari') ??
    'Unknown browser'
  ).trim();
}

const code = (s: string): string => s.replace(/`/g, "'");
const time = (iso: string): string => (iso.length >= 19 ? iso.slice(11, 19) : iso);

/** The bug's description as Markdown; files are given as links the server made. */
export function bugReportMarkdown(
  r: BugReport,
  files: { screenshot: string | null; recording: string | null },
): string {
  const failed = r.network.filter((n) => n.status === 0 || n.status >= 400);
  const errors = r.console.filter((c) => c.level === 'error' || c.level === 'warn');
  const out: string[] = [];
  if (r.note.trim()) out.push(r.note.trim(), '');
  out.push(
    '## Where',
    '',
    '- Page: ' + (r.page.title ? r.page.title + ' · ' : '') + r.page.url,
    '- Browser: ' +
      browserOf(r.device.userAgent) +
      ' on ' +
      (r.device.platform || 'an unknown system'),
    '- Window: ' +
      String(r.device.viewport.width) +
      '×' +
      String(r.device.viewport.height) +
      ', screen ' +
      String(r.device.screen.width) +
      '×' +
      String(r.device.screen.height) +
      ' at ' +
      String(r.device.screen.pixelRatio) +
      'x',
    '- Language and time zone: ' + r.device.language + ', ' + r.device.timeZone,
    '',
  );
  if (files.screenshot)
    out.push('## Screenshot', '', '![Screenshot](' + files.screenshot + ')', '');
  if (files.recording) out.push('## Recording', '', '[The recording](' + files.recording + ')', '');
  if (r.actions.length) {
    out.push('## What happened before', '');
    r.actions.forEach((a, i) =>
      out.push(String(i + 1) + '. ' + time(a.at) + ' ' + a.kind + ' ' + a.target),
    );
    out.push('');
  }
  if (failed.length || errors.length) {
    out.push('## Failures', '');
    for (const n of failed)
      out.push(
        '- `' +
          code(n.method + ' ' + n.url) +
          '` → ' +
          (n.status ? String(n.status) : 'no answer') +
          ' after ' +
          String(Math.round(n.ms)) +
          ' ms',
      );
    for (const c of errors) out.push('- ' + c.level + ': `' + code(c.text.slice(0, 500)) + '`');
    out.push('');
  }
  if (r.console.length) {
    out.push('## Console', '', '```');
    for (const c of r.console.slice(-50))
      out.push(
        time(c.at) + ' ' + c.level.padEnd(5) + ' ' + c.text.slice(0, 1000).replace(/```/g, "'''"),
      );
    out.push('```', '');
  }
  if (r.network.length) {
    out.push('## Network', '', '| Time | Request | Status | ms |', '| --- | --- | --- | --- |');
    for (const n of r.network.slice(-50))
      out.push(
        '| ' +
          time(n.at) +
          ' | `' +
          code(n.method + ' ' + n.url).replace(/\|/g, '%7C') +
          '` | ' +
          (n.status ? String(n.status) : '—') +
          ' | ' +
          String(Math.round(n.ms)) +
          ' |',
      );
    out.push('');
  }
  out.push('_Captured with the Orqiva browser extension._');
  return out.join('\n');
}
