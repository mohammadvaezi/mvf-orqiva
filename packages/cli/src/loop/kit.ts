// ── [PCODE-290 | S15 | v0.1.0] T30.4 UI kit in the code: component usage, a lint for non-token values, the agent rule ──
//    Why:  the kit meets the repository from the terminal. `orq kit scan` reads every UI file Git tracks,
//          counts each component's uses and finds colours and sizes written by hand, and sends both;
//          `orq kit check` lists those values in the files changed now (or the ones named), with the
//          token to use; `orq kit rule` prints what agents are told. `orq done` uses the same check to
//          warn about a task's files.
import {
  componentUses,
  isUiFile,
  lintKit,
  tokenIndex,
  type DesignToken,
  type KitFinding,
  type TokenIndex,
} from '@orqiva/shared';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  LoopError,
  linked,
  positionals,
  type Linked,
  type LoopDeps,
  type LoopResult,
} from './commands.js';

export const KIT_USAGE = [
  '  kit scan                   count component uses and find raw colours and sizes; send them',
  '  kit check [FILE…] [--strict]   raw colours and sizes in the changed (or named) files',
  '  kit rule                   the UI kit rule agents get',
];

interface TokensAnswer {
  tokens: (DesignToken & { themeValues?: Record<string, string> })[];
  themes: { name: string; base: string }[];
}

/** The project's tokens as an index of values to token names. */
export async function kitIndex(l: Linked): Promise<{ index: TokenIndex; count: number }> {
  const r = await l.api.call<TokensAnswer>(
    'GET',
    l.ws + '/projects/' + l.link.projectId + '/tokens',
  );
  const tokens = r.tokens.map((t) => ({ ...t, themes: t.themeValues ?? {} }));
  return {
    index: tokenIndex(
      tokens,
      r.themes.map((x) => ({ name: x.name, base: x.base === 'dark' ? 'dark' : 'light' })),
    ),
    count: tokens.length,
  };
}

/** Raw values in the given files of the repository (UI files only). */
export async function lintFiles(
  root: string,
  paths: readonly string[],
  index: TokenIndex,
): Promise<KitFinding[]> {
  const out: KitFinding[] = [];
  for (const p of paths) {
    if (!isUiFile(p)) continue;
    const buf = await readFile(join(root, p)).catch(() => null);
    if (!buf || buf.length > 1_000_000 || buf.includes(0)) continue;
    out.push(...lintKit(p, buf.toString('utf8'), index));
  }
  return out;
}

export const findingLine = (f: KitFinding): string =>
  '  ' +
  f.path +
  ':' +
  String(f.line) +
  '  ' +
  (f.kind === 'colour' ? 'colour ' : 'size ') +
  f.value +
  (f.token ? ' → use ' + f.token : ' (no token has this value)');

async function scan(deps: LoopDeps, l: Linked): Promise<string[]> {
  const listed = await deps.exec('git', ['ls-files', '-z'], l.root);
  if (listed.code !== 0)
    throw new LoopError('orq kit scan reads the files Git tracks; this is not a Git repository');
  const paths = listed.out.split('\u0000').filter(isUiFile);
  const P = l.ws + '/projects/' + l.link.projectId;
  const { index } = await kitIndex(l);
  const comps = await l.api.call<{ name: string; codePath: string }[]>('GET', P + '/components');
  const names = comps.map((c) => c.name);
  const home = new Map(comps.map((c) => [c.name, c.codePath]));
  const usage = new Map<string, { count: number; files: { path: string; count: number }[] }>();
  const findings: KitFinding[] = [];
  for (const p of paths) {
    const buf = await readFile(join(l.root, p)).catch(() => null);
    if (!buf || buf.length > 1_000_000 || buf.includes(0)) continue;
    const text = buf.toString('utf8');
    for (const [name, n] of componentUses(text, names)) {
      if (home.get(name) === p) continue; // its own file is not a use
      const u = usage.get(name) ?? { count: 0, files: [] };
      u.count += n;
      u.files.push({ path: p, count: n });
      usage.set(name, u);
    }
    findings.push(...lintKit(p, text, index));
  }
  const sent = findings.slice(0, 5000);
  await l.api.call('POST', P + '/kit-scan', {
    files: paths.length,
    usage: [...usage.entries()].map(([name, u]) => ({
      name,
      count: u.count,
      files: u.files.sort((a, b) => b.count - a.count).slice(0, 10),
    })),
    findings: sent,
  });
  const used = [...usage.entries()].sort((a, b) => b[1].count - a[1].count);
  const unused = names.filter((n) => !usage.has(n));
  const withToken = findings.filter((f) => f.token).length;
  return [
    'Kit scan: ' + String(paths.length) + ' UI files.',
    'Components: ' +
      (used.length
        ? used
            .slice(0, 8)
            .map(([n, u]) => n + ' ' + String(u.count))
            .join(', ')
        : 'none used') +
      (unused.length ? '; not used: ' + unused.slice(0, 8).join(', ') : '') +
      '.',
    'Raw values: ' +
      String(findings.length) +
      (findings.length
        ? ' (' +
          String(withToken) +
          ' have a token with the same value). orq kit check FILE shows them.'
        : '.') +
      (findings.length > sent.length ? ' Only the first 5000 were sent.' : ''),
  ];
}

/** The files changed against HEAD, and new files Git does not ignore. */
export async function changedFiles(deps: LoopDeps, root: string): Promise<string[]> {
  const diff = await deps.exec('git', ['diff', '--name-only', 'HEAD'], root);
  const fresh = await deps.exec('git', ['ls-files', '--others', '--exclude-standard'], root);
  return [
    ...new Set(
      [diff.out, fresh.out]
        .join('\n')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
}

async function check(argv: readonly string[], deps: LoopDeps, l: Linked): Promise<LoopResult> {
  const named = positionals(argv.slice(2), []);
  const files = named.length ? named : await changedFiles(deps, l.root);
  const { index, count } = await kitIndex(l);
  const found = await lintFiles(l.root, files, index);
  const ui = files.filter(isUiFile).length;
  if (!found.length)
    return {
      code: 0,
      out:
        'No raw colours or sizes in ' +
        String(ui) +
        (ui === 1 ? ' UI file' : ' UI files') +
        (count ? '.' : ' (the project has no tokens yet).'),
    };
  return {
    code: argv.includes('--strict') ? 1 : 0,
    out: [
      String(found.length) + ' raw value(s) in ' + String(ui) + ' UI file(s):',
      ...found.slice(0, 200).map(findingLine),
      ...(found.length > 200 ? ['  …'] : []),
    ].join('\n'),
  };
}

export async function runKit(argv: readonly string[], deps: LoopDeps): Promise<LoopResult | null> {
  const [command, sub] = argv;
  if (command !== 'kit') return null;
  const l = linked(deps);
  if (sub === 'scan') return { code: 0, out: (await scan(deps, l)).join('\n') };
  if (sub === 'check') return await check(argv, deps, l);
  if (sub === 'rule') {
    const r = await l.api.call<{ rule: string }>(
      'GET',
      l.ws + '/projects/' + l.link.projectId + '/kit-rule',
    );
    return { code: 0, out: r.rule || 'The project has no tokens or components yet.' };
  }
  throw new LoopError('orq kit scan | check [FILE…] [--strict] | rule');
}
