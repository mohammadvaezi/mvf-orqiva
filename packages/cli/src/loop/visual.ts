// ── [PCODE-295 | S15 | v0.1.0] T30.8b Visual regression: baselines, pixel diff, orq visual check, the Visual tab ──
//    Why:  a CI step after the screenshots are taken: `orq visual check shots/*.png` sends each PNG (its
//          file name is the screen's name, unless --name says otherwise) with the commit, prints pass,
//          fail or new per screen with the link to look, and fails the step when a screen changed more
//          than it may. A screen without a baseline does not fail: a member approves its first look.
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { RawBody } from './api.js';
import {
  LoopError,
  linked,
  option,
  positionals,
  type Linked,
  type LoopDeps,
  type LoopResult,
} from './commands.js';

export const VISUAL_USAGE = [
  '  visual check FILE.png… [--name SCREEN] [--commit SHA]   compare screenshots with their baselines',
];

interface Run {
  id: string;
  name: string;
  status: string;
  reason: string;
}

/** The screen name of a screenshot file: its name without .png. */
export function screenOfFile(path: string): string {
  return basename(path).replace(/\.png$/i, '');
}

export function runLine(r: Run): string {
  const mark = r.status === 'pass' ? 'ok  ' : r.status === 'fail' ? 'FAIL' : 'new ';
  return mark + ' ' + r.name + ': ' + r.reason;
}

async function check(argv: readonly string[], deps: LoopDeps, l: Linked): Promise<LoopResult> {
  const files = positionals(argv.slice(2), ['--name', '--commit']);
  if (!files.length)
    throw new LoopError('orq visual check FILE.png… [--name SCREEN] [--commit SHA]');
  const name = option(argv, '--name');
  if (name && files.length > 1) throw new LoopError('--name names one screenshot; give one file');
  let commit = option(argv, '--commit') ?? '';
  if (!commit) {
    const head = await deps.exec('git', ['rev-parse', 'HEAD'], l.root).catch(() => null);
    if (head?.code === 0) commit = head.out.trim();
  }
  const runs: Run[] = [];
  for (const f of files) {
    const path = resolve(deps.cwd, f);
    const data = await readFile(path).catch(() => null);
    if (!data) throw new LoopError('Cannot read ' + f);
    // a screenshot needs no reading in the background
    const up = await l.api.call<{ id: string }>(
      'POST',
      l.ws +
        '/files?name=' +
        encodeURIComponent(basename(path)) +
        '&projectId=' +
        encodeURIComponent(l.link.projectId) +
        '&read=0',
      new RawBody(data, 'image/png'),
      120_000,
    );
    runs.push(
      await l.api.call<Run>(
        'POST',
        l.ws + '/projects/' + l.link.projectId + '/visual/checks',
        { name: name ?? screenOfFile(path), fileId: up.id, ...(commit ? { commit } : {}) },
        120_000,
      ),
    );
  }
  const failed = runs.filter((r) => r.status === 'fail').length;
  const fresh = runs.filter((r) => r.status === 'new').length;
  const where =
    l.link.server.replace(/\/$/, '') + '/projects/' + l.link.projectId + '/uikit?view=visual';
  return {
    code: failed ? 1 : 0,
    out: [
      ...runs.map(runLine),
      '',
      String(runs.length) +
        ' screen(s): ' +
        String(runs.length - failed - fresh) +
        ' as approved, ' +
        String(failed) +
        ' changed, ' +
        String(fresh) +
        ' new' +
        (failed || fresh ? '. Look and approve: ' + where : '.'),
    ].join('\n'),
  };
}

export async function runVisual(
  argv: readonly string[],
  deps: LoopDeps,
): Promise<LoopResult | null> {
  const [command, sub] = argv;
  if (command !== 'visual') return null;
  const l = linked(deps);
  if (sub === 'check') return await check(argv, deps, l);
  throw new LoopError('orq visual check FILE.png… [--name SCREEN] [--commit SHA]');
}
