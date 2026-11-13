// ── [PCODE-324 | S15 | v0.1.0] T32.8a Fix pull requests for findings: dependency upgrades and AI fixes ──
//    Why:  the change a fix pull request makes. A dependency moves to its fixed version where it is
//          declared (keeping the range's ^ or ~), or, when it only comes in through another package, by an
//          npm override; a Python pin is raised in place. An AI fix is the whole corrected file the agent
//          answers with, taken only when it is a file and not an empty or a truncated one.

export interface FileChange {
  path: string;
  text: string;
  /** what changed, in a sentence for the pull request */
  summary: string;
}

/** The manifest a lockfile belongs to: package-lock.json → package.json beside it. */
export function manifestOf(file: string): { path: string; kind: 'npm' | 'pip' } | null {
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
  const name = file.slice(dir.length);
  if (name === 'package-lock.json' || name === 'npm-shrinkwrap.json' || name === 'package.json')
    return { path: dir + 'package.json', kind: 'npm' };
  if (/^requirements.*\.txt$/.test(name)) return { path: file, kind: 'pip' };
  return null;
}

const indentOf = (text: string): string | number => {
  const m = /\n([ \t]+)"/.exec(text);
  return m?.[1] ?? 2;
};

/** package.json with the package at its fixed version: its own range raised, or an override added. */
export function bumpPackageJson(text: string, pkg: string, fixed: string): FileChange | null {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
  let summary = '';
  for (const s of sections) {
    const deps = json[s];
    if (typeof deps !== 'object' || deps === null) continue;
    const d = deps as Record<string, unknown>;
    const now = d[pkg];
    if (typeof now !== 'string') continue;
    const prefix = /^[\^~]/.exec(now)?.[0] ?? '';
    const next = prefix + fixed;
    if (now === next) return null;
    d[pkg] = next;
    summary = pkg + ' ' + now + ' → ' + next + ' in ' + s;
  }
  if (!summary) {
    // only through another package: an override pins it everywhere
    const o =
      typeof json['overrides'] === 'object' && json['overrides'] !== null
        ? (json['overrides'] as Record<string, unknown>)
        : {};
    if (o[pkg] === fixed) return null;
    json['overrides'] = { ...o, [pkg]: fixed };
    summary =
      pkg + ' pinned to ' + fixed + ' by an npm override (it comes in through another package)';
  }
  const out = JSON.stringify(json, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : '');
  return { path: 'package.json', text: out, summary };
}

const pyName = (s: string): string => s.toLowerCase().replace(/[-_.]+/g, '-');

/** requirements.txt with the package's pin raised to the fixed version. */
export function bumpRequirements(text: string, pkg: string, fixed: string): FileChange | null {
  let summary = '';
  const lines = text.split('\n').map((line) => {
    const m = /^(\s*)([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*==\s*([^\s;#]+)(.*)$/.exec(line);
    if (!m || pyName(m[2] ?? '') !== pyName(pkg) || m[4] === fixed) return line;
    summary = (m[2] ?? pkg) + ' ' + (m[4] ?? '') + ' → ' + fixed;
    return (m[1] ?? '') + (m[2] ?? '') + (m[3] ?? '') + '==' + fixed + (m[5] ?? '');
  });
  return summary ? { path: '', text: lines.join('\n'), summary } : null;
}

/** The corrected file in the agent's answer: the one fenced block, not empty, not much shorter. */
export function fixedFileOf(answer: string, before: string): string | null {
  const m = /```[\w+-]*\n([\s\S]*?)\n```/.exec(answer);
  const body = m?.[1];
  if (!body?.trim()) return null;
  // a reply that drops most of the file was cut off or misunderstood
  if (body.length < before.length * 0.6) return null;
  const text = before.endsWith('\n') && !body.endsWith('\n') ? body + '\n' : body;
  return text === before ? null : text;
}

/** The agent's words outside the code block: its explanation for the pull request. */
export const fixNoteOf = (answer: string): string =>
  answer
    .replace(/```[\s\S]*?```/g, '')
    .trim()
    .slice(0, 3000);
