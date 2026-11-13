// ── [PCODE-199 | S15 | v0.1.0] T16.3 Handover pack on the server: checks, team checklist, frozen packs, PDF, client acceptance in the portal ──
//    Why:  what a project needs before it hands over to its client, decided the same way on the server,
//          in the web app and in the terminal: the documents a client relies on (architecture, handover
//          readme, runbooks), the release, the tests and the client's own acceptance, no open serious
//          security findings, and the team's own checklist. "Missing" blocks sending a pack; "warn" is
//          shown but does not block.

export type HandoverState = 'ok' | 'warn' | 'missing';

export interface HandoverCheck {
  key: string;
  label: string;
  state: HandoverState;
  detail: string;
}

export interface HandoverPage {
  id: string;
  title: string;
  status: string;
  version: number;
  needsApproval: boolean;
  stale: boolean;
  generated: boolean;
  clientVisible: boolean;
}

export interface HandoverFacts {
  pages: readonly HandoverPage[];
  /** pages that disagree with the code */
  drift: number;
  release: { version: string; state: string; hasClientNotes: boolean } | null;
  tests: { name: string; passed: number; failed: number } | null;
  /** the latest client acceptance round */
  acceptance: { name: string; accepted: boolean } | null;
  seriousFindings: number;
  openTasks: number;
  items: readonly { id: string; label: string; done: boolean }[];
}

/** The team's checklist a project starts with; the team edits it. */
export const DEFAULT_HANDOVER_ITEMS = [
  'Access and credentials handed over (outside Orqiva, never in a page)',
  'Repository and hosting moved to the client, or access granted',
  'Support contact and hours named',
  'Third-party licences and accounts listed',
];

const isRunbook = (p: HandoverPage): boolean => /^runbook\b/i.test(p.title);
const isArchitecture = (p: HandoverPage): boolean => /^architecture\b/i.test(p.title);
const isReadme = (p: HandoverPage): boolean => /^handover readme\b/i.test(p.title);
const ready = (p: HandoverPage): boolean => p.status === 'published' && !p.needsApproval;
const why = (p: HandoverPage): string =>
  p.needsApproval ? 'waits for a person’s approval' : 'is not published yet';

function pageCheck(
  key: string,
  label: string,
  pages: readonly HandoverPage[],
  match: (p: HandoverPage) => boolean,
  what: string,
): HandoverCheck {
  const found = pages.filter(match);
  const good = found.filter(ready);
  if (good.length)
    return {
      key,
      label,
      state: 'ok',
      detail: good.length === 1 ? (good[0]?.title ?? '') : String(good.length) + ' pages',
    };
  const first = found[0];
  return {
    key,
    label,
    state: 'missing',
    detail: first ? first.title + ' ' + why(first) : 'No ' + what + ' yet',
  };
}

const plural = (n: number, one: string, many: string): string =>
  String(n) + ' ' + (n === 1 ? one : many);

/** Every check, in the order the pack lists them. */
export function handoverChecks(f: HandoverFacts): HandoverCheck[] {
  const out: HandoverCheck[] = [
    pageCheck(
      'architecture',
      'Architecture',
      f.pages,
      isArchitecture,
      'page titled "Architecture"',
    ),
    pageCheck('readme', 'Handover readme', f.pages, isReadme, 'page titled "Handover readme"'),
    pageCheck('runbooks', 'Runbooks', f.pages, isRunbook, 'page titled "Runbook: …"'),
  ];
  const generated = f.pages.filter((p) => p.generated).length;
  out.push({
    key: 'code-docs',
    label: 'Docs built from the code',
    state: generated ? 'ok' : 'warn',
    detail: generated
      ? plural(generated, 'page', 'pages')
      : 'None yet: send a code scan or the OpenAPI document, then rebuild',
  });
  const stale = f.pages.filter((p) => p.stale).length;
  out.push({
    key: 'fresh',
    label: 'Pages reviewed and in line with the code',
    state: stale || f.drift ? 'warn' : 'ok',
    detail:
      stale || f.drift
        ? [
            stale ? plural(stale, 'page', 'pages') + ' past the review date' : '',
            f.drift ? plural(f.drift, 'page disagrees', 'pages disagree') + ' with the code' : '',
          ]
            .filter(Boolean)
            .join(', ')
        : 'Every page is within its review date',
  });
  out.push(
    !f.release
      ? { key: 'release', label: 'Release', state: 'missing', detail: 'No release yet' }
      : f.release.state !== 'released'
        ? {
            key: 'release',
            label: 'Release',
            state: 'missing',
            detail: f.release.version + ' is ' + f.release.state.replace('_', ' '),
          }
        : {
            key: 'release',
            label: 'Release',
            state: f.release.hasClientNotes ? 'ok' : 'warn',
            detail:
              f.release.version +
              (f.release.hasClientNotes ? ' with notes for the client' : ' has no client notes'),
          },
  );
  out.push(
    !f.tests
      ? { key: 'tests', label: 'Tests', state: 'warn', detail: 'No finished test run' }
      : {
          key: 'tests',
          label: 'Tests',
          state: f.tests.failed ? 'missing' : 'ok',
          detail:
            f.tests.name +
            ': ' +
            String(f.tests.passed) +
            ' passed' +
            (f.tests.failed ? ', ' + String(f.tests.failed) + ' failed' : ''),
        },
  );
  out.push(
    !f.acceptance
      ? {
          key: 'acceptance',
          label: 'Client acceptance',
          state: 'warn',
          detail: 'No acceptance round with the client',
        }
      : {
          key: 'acceptance',
          label: 'Client acceptance',
          state: f.acceptance.accepted ? 'ok' : 'missing',
          detail: f.acceptance.name + (f.acceptance.accepted ? ' accepted' : ' not accepted yet'),
        },
  );
  out.push({
    key: 'security',
    label: 'Security',
    state: f.seriousFindings ? 'missing' : 'ok',
    detail: f.seriousFindings
      ? plural(f.seriousFindings, 'open critical or high finding', 'open critical or high findings')
      : 'No open critical or high finding',
  });
  out.push({
    key: 'open-work',
    label: 'Open work',
    state: f.openTasks ? 'warn' : 'ok',
    detail: f.openTasks
      ? plural(f.openTasks, 'task is', 'tasks are') + ' still open'
      : 'Nothing open',
  });
  for (const it of f.items)
    out.push({
      key: 'item:' + it.id,
      label: it.label,
      state: it.done ? 'ok' : 'missing',
      detail: it.done ? 'Done' : 'Not done yet',
    });
  return out;
}

/** A pack can go out when nothing required is missing. */
export const handoverReady = (checks: readonly HandoverCheck[]): boolean =>
  checks.every((c) => c.state !== 'missing');

/** The pages a pack carries: the handover documents, the pages built from the code, and pages shared with the client. */
export function packPages(pages: readonly HandoverPage[]): HandoverPage[] {
  const rank = (p: HandoverPage): number =>
    isReadme(p) ? 0 : isArchitecture(p) ? 1 : isRunbook(p) ? 2 : p.generated ? 3 : 4;
  return pages
    .filter(
      (p) =>
        p.status === 'published' &&
        !p.needsApproval &&
        (isReadme(p) || isArchitecture(p) || isRunbook(p) || p.generated || p.clientVisible),
    )
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}
