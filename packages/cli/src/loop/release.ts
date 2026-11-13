// ── [PCODE-207 | S15 | v0.1.0] T17.5 Releases from the terminal and VS Code: orq release, orq env, orq train ──
//    Why:  release work from the terminal: what the project's releases are and whether their notes are
//          approved, the notes and the changelog (written to a file when asked), the environments with
//          what runs where (promote, approve or decline a waiting promotion, roll back), and the trains
//          (their releases with go/no-go and deploys, ship, roll back).
import { writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { trainStateText } from '@orqiva/shared';
import {
  LoopError,
  linked,
  option,
  positionals,
  type Linked,
  type LoopDeps,
  type LoopResult,
} from './commands.js';

export const RELEASE_USAGE = [
  '  release                    the releases: version, state, train, tasks done, notes approved',
  '  release notes VERSION [--client] [--approve]   the notes, or approve them',
  '  release changelog [VERSION] [--write FILE]   the changelog (of one version), or write it to a file',
  '  env                        the environments: what runs where, a waiting promotion',
  '  env promote ENV [--ref VERSION]   promote what runs before ENV (or a version) to it',
  '  env approve ENV | env decline ENV --note "…"   decide a waiting promotion',
  '  env rollback ENV --reason "…"   redeploy what ran there before',
  '  train [NAME]               the trains, or one with its releases, go/no-go and deploys',
  '  train ship NAME | train rollback NAME --reason "…"',
];

interface ReleaseOut {
  id: string;
  version: string;
  state: string;
  frozen: boolean;
  train: string;
  items: number;
  done: number;
  notesTeam: string;
  notesClient: string;
  notesApprovedBy?: string | null;
}
interface EnvOut {
  id: string;
  key: string;
  name: string;
  approver: { name: string } | null;
  running: { ref: string; at: string | null; by: string | null } | null;
  latest: { status: string; ref: string } | null;
  waiting: { id: string; ref: string; approver: string | null; requestedBy: string | null } | null;
}
interface TrainOut {
  id: string;
  name: string;
  state: string;
  targetDate: string | null;
  releases: {
    projectKey: string;
    version: string;
    state: string;
    environmentName: string | null;
    done: number;
    items: number;
    deploy: { status: string; ref: string } | null;
  }[];
}

const pad = (v: string, n: number): string => (v.length >= n ? v + ' ' : v.padEnd(n));

/** The releases as the terminal lists them. */
export function releaseLines(list: readonly ReleaseOut[]): string[] {
  if (!list.length) return ['No releases yet.'];
  return list.map(
    (r) =>
      pad(r.version, 16) +
      pad(r.state === 'planned' && r.frozen ? 'frozen' : r.state.replace('_', ' '), 12) +
      pad(String(r.done) + '/' + String(r.items) + ' done', 12) +
      (r.notesApprovedBy
        ? 'notes approved by ' + r.notesApprovedBy
        : r.notesClient.trim()
          ? 'notes waiting for approval'
          : 'no notes') +
      (r.train ? ' · train ' + r.train : ''),
  );
}

/** The environments in order, as the terminal lists them. */
export function envLines(envs: readonly EnvOut[]): string[] {
  if (!envs.length) return ['No environments yet.'];
  return envs.flatMap((e) => [
    pad(e.key, 14) +
      pad(e.running?.ref ?? '—', 16) +
      (e.latest?.status === 'failed'
        ? 'last deploy of ' + e.latest.ref + ' failed'
        : e.running
          ? 'running'
          : 'never deployed') +
      (e.approver ? ' · ' + e.approver.name + ' approves' : ''),
    ...(e.waiting
      ? [
          '  waiting: ' +
            e.waiting.ref +
            ' (asked by ' +
            (e.waiting.requestedBy ?? 'someone') +
            ', ' +
            (e.waiting.approver ?? 'an admin') +
            ' decides)',
        ]
      : []),
  ]);
}

/** One train with its releases. */
export function trainLines(
  t: TrainOut,
  check?: { releases: { project: string; ready: boolean; missing: string[] }[] },
): string[] {
  return [
    'Train ' +
      t.name +
      ': ' +
      trainStateText(t.state) +
      (t.targetDate ? ' · ships ' + t.targetDate : ''),
    ...t.releases.map((r) => {
      const c = check?.releases.find((x) => x.project === r.projectKey);
      return (
        '  ' +
        pad(r.projectKey, 8) +
        pad(r.version, 14) +
        pad(r.environmentName ?? 'no environment', 14) +
        (r.deploy
          ? r.deploy.ref + ' ' + r.deploy.status
          : c
            ? c.ready
              ? 'go'
              : 'no-go: ' + c.missing.join('; ')
            : r.state)
      );
    }),
  ];
}

async function releases(argv: readonly string[], deps: LoopDeps, l: Linked): Promise<string[]> {
  const P = l.ws + '/projects/' + l.link.projectId;
  const [, sub, version] = positionals(argv, ['--write']);
  const list = (await l.api.call<{ releases: ReleaseOut[] }>('GET', P + '/releases')).releases;
  if (!sub) return releaseLines(list);
  const find = (v: string | undefined): ReleaseOut => {
    const r = list.find((x) => x.version === v);
    if (!r) throw new LoopError('No release ' + (v ?? '') + ' (orq release lists them)');
    return r;
  };
  if (sub === 'notes') {
    const r = find(version);
    if (argv.includes('--approve')) {
      const ok = await l.api.call<{ approvedBy: string }>(
        'POST',
        l.ws + '/releases/' + r.id + '/notes/approve',
      );
      return ['Notes of ' + r.version + ' approved by ' + ok.approvedBy + '.'];
    }
    const text = argv.includes('--client') ? r.notesClient : r.notesTeam;
    return [text.trim() || 'No notes for ' + r.version + ' yet.'];
  }
  if (sub === 'changelog') {
    const md = version
      ? (
          await l.api.call<{ markdown: string }>(
            'GET',
            l.ws + '/releases/' + find(version).id + '/changelog',
          )
        ).markdown
      : (await l.api.call<{ markdown: string }>('GET', P + '/changelog')).markdown;
    const file = option(argv, '--write');
    if (!file) return [md];
    const path = isAbsolute(file) ? file : join(deps.cwd, file);
    writeFileSync(path, md.endsWith('\n') ? md : md + '\n');
    return ['Changelog written to ' + file + '.'];
  }
  throw new LoopError('orq release [notes VERSION | changelog [VERSION]]');
}

async function envs(argv: readonly string[], l: Linked): Promise<string[]> {
  const P = l.ws + '/projects/' + l.link.projectId;
  const [, sub, key] = positionals(argv, ['--ref', '--note', '--reason']);
  const list = await l.api.call<EnvOut[]>('GET', P + '/pipeline');
  if (!sub) return envLines(list);
  const env = list.find((e) => e.key === key || e.name.toLowerCase() === (key ?? '').toLowerCase());
  if (!env) throw new LoopError('No environment ' + (key ?? '') + ' (orq env lists them)');
  if (sub === 'promote') {
    const ref = option(argv, '--ref');
    const p = await l.api.call<{ status: string; ref: string; approver: string | null }>(
      'POST',
      l.ws + '/environments/' + env.id + '/promote',
      ref ? { ref } : {},
    );
    return [
      p.status === 'requested'
        ? 'Promotion of ' +
          p.ref +
          ' to ' +
          env.name +
          ' requested: ' +
          (p.approver ?? 'an admin') +
          ' approves.'
        : p.ref + ' goes to ' + env.name + ': the runner deploys it.',
    ];
  }
  if (sub === 'approve' || sub === 'decline') {
    if (!env.waiting) throw new LoopError('No promotion waits for ' + env.name);
    const note = option(argv, '--note');
    if (sub === 'decline' && !note?.trim())
      throw new LoopError('Say why: orq env decline ' + env.key + ' --note "…"');
    await l.api.call('POST', l.ws + '/promotions/' + env.waiting.id + '/decision', {
      approve: sub === 'approve',
      ...(note ? { note } : {}),
    });
    return [
      sub === 'approve'
        ? env.waiting.ref + ' to ' + env.name + ' approved: the runner deploys it.'
        : env.waiting.ref + ' to ' + env.name + ' declined.',
    ];
  }
  if (sub === 'rollback') {
    const reason = option(argv, '--reason');
    if (!reason?.trim())
      throw new LoopError('Say why: orq env rollback ' + env.key + ' --reason "…"');
    const r = await l.api.call<{ ref: string; from: string }>(
      'POST',
      l.ws + '/environments/' + env.id + '/rollback',
      { reason },
    );
    return [env.name + ' rolls back from ' + r.from + ' to ' + r.ref + '.'];
  }
  throw new LoopError('orq env [promote|approve|decline|rollback ENV]');
}

async function trains(argv: readonly string[], l: Linked): Promise<string[]> {
  const [, a, b] = positionals(argv, ['--reason']);
  const list = await l.api.call<TrainOut[]>('GET', l.ws + '/trains');
  const named = (n: string | undefined): TrainOut => {
    const t = list.find((x) => x.name.toLowerCase() === (n ?? '').toLowerCase());
    if (!t) throw new LoopError('No train ' + (n ?? '') + ' (orq train lists them)');
    return t;
  };
  if (!a) {
    if (!list.length) return ['No trains yet.'];
    return list.map(
      (t) =>
        pad(t.name, 14) +
        pad(trainStateText(t.state), 34) +
        t.releases.map((r) => r.projectKey + ' ' + r.version).join(', '),
    );
  }
  if (a === 'ship') {
    const t = named(b);
    const after = await l.api.call<TrainOut>('POST', l.ws + '/trains/' + t.id + '/ship');
    return [
      'Train ' + t.name + ' ships: ' + String(after.releases.length) + ' deploys queued.',
      ...trainLines(after).slice(1),
    ];
  }
  if (a === 'rollback') {
    const t = named(b);
    const reason = option(argv, '--reason');
    if (!reason?.trim())
      throw new LoopError('Say why: orq train rollback ' + t.name + ' --reason "…"');
    const after = await l.api.call<TrainOut>('POST', l.ws + '/trains/' + t.id + '/rollback', {
      reason,
    });
    return [
      'Train ' + t.name + ': ' + trainStateText(after.state) + '.',
      ...trainLines(after).slice(1),
    ];
  }
  const t = named(a);
  const open = t.state === 'planned' || t.state === 'frozen';
  const check = open
    ? await l.api.call<{ releases: { project: string; ready: boolean; missing: string[] }[] }>(
        'GET',
        l.ws + '/trains/' + t.id + '/check',
      )
    : undefined;
  return trainLines(t, check);
}

/** orq release, orq env and orq train; null for any other command. */
export async function runRelease(
  argv: readonly string[],
  deps: LoopDeps,
): Promise<LoopResult | null> {
  const [command] = argv;
  if (command !== 'release' && command !== 'env' && command !== 'train') return null;
  const l = linked(deps);
  const out =
    command === 'release'
      ? await releases(argv, deps, l)
      : command === 'env'
        ? await envs(argv, l)
        : await trains(argv, l);
  return { code: 0, out: out.join('\n') };
}
