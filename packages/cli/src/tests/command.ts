// ── [PCODE-317 | S15 | v0.1.0] T32.4a AI triage of test failures and impacted tests first ──
// ── [PCODE-315 | S15 | v0.1.0] T32.3a Cypress and Allure import, defects in the trace, leakage and burndown ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-136 | S15 | v0.1.0] Stream test results from a running suite and import JUnit ──
//    Why:  `orq test run -- <command>` runs the project's suite as it is, shows its output, and sends each
//          result to the linked project the moment its TAP line appears (in small batches, in order), so the
//          run page fills in while the suite is still running. `orq test import <junit.xml>` sends a
//          finished report. The suite's exit code is passed through, so CI fails as before.
import { execFileSync, spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { linked, option, LoopError, type LoopDeps, type LoopResult } from '../loop/commands.js';
import type { Api } from '../loop/api.js';
import { readJunit } from './junit.js';
import { TapReader, type TestResult } from './tap.js';

export const TEST_USAGE =
  '  test run [--name NAME] -- <command>   run a suite that writes TAP and stream each result\n' +
  '  test import <report> [--name NAME]   send a finished report: JUnit XML, Playwright or Cypress\n' +
  '                                        (mochawesome) JSON, or an allure-results folder\n' +
  '  test impacted [--base REF]            the cases covering what changed since REF (main)';

/** Starts a command and hands its output over line by line; resolves to its exit code. */
export type LineRunner = (
  command: string,
  cwd: string,
  onLine: (line: string) => void,
) => Promise<number>;

export const shellLines: LineRunner = (command, cwd, onLine) =>
  new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let rest = '';
    const take = (d: Buffer): void => {
      const text = rest + d.toString('utf8');
      const lines = text.split('\n');
      rest = lines.pop() ?? '';
      for (const l of lines) onLine(l);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', (d: Buffer) => {
      process.stderr.write(d);
    });
    child.on('error', (e) => {
      onLine('# pe: cannot start the command: ' + e.message);
      resolve(127);
    });
    child.on('close', (code) => {
      if (rest) onLine(rest);
      resolve(code ?? 1);
    });
  });

/** Sends results in order, a batch at a time, while more keep coming. */
export class ResultSender {
  private queue: TestResult[] = [];
  private chain: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  sent = 0;
  failedSends = 0;

  constructor(
    private readonly api: Api,
    private readonly path: string,
    private readonly flushMs = 300,
    private readonly batch = 25,
  ) {}

  add(r: TestResult): void {
    this.queue.push(r);
    if (this.queue.length >= this.batch) this.flush();
    else
      this.timer ??= setTimeout(() => {
        this.flush();
      }, this.flushMs);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.queue.length) return;
    const results = this.queue;
    this.queue = [];
    this.chain = this.chain.then(async () => {
      try {
        await this.api.call('POST', this.path, { results });
        this.sent += results.length;
      } catch {
        this.failedSends += results.length;
      }
    });
  }

  async done(): Promise<void> {
    this.flush();
    await this.chain;
  }
}

export async function runTests(
  argv: readonly string[],
  deps: LoopDeps & { lines?: LineRunner; print?: (line: string) => void },
): Promise<LoopResult> {
  const l = linked(deps);
  const print = deps.print ?? ((line: string) => process.stdout.write(line + '\n'));
  const projectPath = l.ws + '/projects/' + l.link.projectId;
  if (argv[1] === 'run') {
    const dash = argv.indexOf('--');
    const command = dash >= 0 ? argv.slice(dash + 1).join(' ') : '';
    if (!command) return { code: 2, out: 'Usage: orq ' + TEST_USAGE.trim() };
    const run = await l.api.call<{ id: string }>('POST', projectPath + '/test-runs', {
      name: option(argv.slice(0, dash), '--name') ?? command.slice(0, 200),
      source: 'stream',
    });
    const runPath = l.ws + '/test-runs/' + run.id;
    const sender = new ResultSender(l.api, runPath + '/results');
    const counts = { passed: 0, failed: 0, skipped: 0 };
    const reader = new TapReader((r) => {
      counts[r.status] += 1;
      sender.add(r);
    });
    const code = await (deps.lines ?? shellLines)(command, deps.cwd, (line) => {
      print(line);
      reader.line(line);
    });
    reader.end();
    await sender.done();
    await l.api.call('POST', runPath + '/finish');
    const total = counts.passed + counts.failed + counts.skipped;
    return {
      code,
      out:
        'Test run: ' +
        String(counts.passed) +
        ' passed, ' +
        String(counts.failed) +
        ' failed, ' +
        String(counts.skipped) +
        ' skipped' +
        (total === 0
          ? ' (no TAP results seen: does the command write TAP, e.g. vitest --reporter=tap-flat?)'
          : '') +
        (sender.failedSends
          ? '; ' + String(sender.failedSends) + ' results could not be sent'
          : '') +
        '. ' +
        l.link.server +
        '/test-runs/' +
        run.id,
    };
  }
  // [PCODE-317 | S15 | v0.1.0] the cases that cover the files changed since a base, for CI to run first
  if (argv[1] === 'impacted') {
    const baseRef = option(argv, '--base') ?? 'main';
    let paths: string[];
    try {
      paths = execFileSync('git', ['diff', '--name-only', baseRef + '...HEAD'], {
        cwd: deps.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
    } catch (e) {
      throw new LoopError(
        'git diff against ' + baseRef + ' failed: ' + (e instanceof Error ? e.message : String(e)),
      );
    }
    if (!paths.length) return { code: 0, out: 'Nothing changed since ' + baseRef + '.' };
    const r = await l.api.call<{
      changed: number;
      cases: { title: string; score: number; reasons: string[] }[];
    }>('POST', projectPath + '/test-cases/impacted', { paths });
    return { code: 0, out: impactedText(r.cases, r.changed, baseRef) };
  }
  if (argv[1] === 'import') {
    const file = argv[2];
    if (!file || file.startsWith('--')) return { code: 2, out: 'Usage: orq ' + TEST_USAGE.trim() };
    const path = isAbsolute(file) ? file : join(deps.cwd, file);
    // [PCODE-315 | S15 | v0.1.0] JSON reports and Allure's folder go to the server's import, which reads them
    const json = readReport(path);
    if (json) {
      const r = await l.api.call<{
        run: { passed: number; failed: number; skipped: number };
        created: number;
        results: number;
      }>('POST', projectPath + '/test-runs/import', {
        format: json.format,
        ...(option(argv, '--name') ? { name: option(argv, '--name') } : {}),
        report: json.report,
      });
      return {
        code: 0,
        out:
          'Imported ' +
          String(r.results) +
          ' ' +
          json.format +
          ' results: ' +
          String(r.run.passed) +
          ' passed, ' +
          String(r.run.failed) +
          ' failed, ' +
          String(r.run.skipped) +
          ' skipped' +
          (r.created ? '; ' + String(r.created) + ' new cases.' : '.'),
      };
    }
    let results: TestResult[];
    try {
      results = readJunit(readFileSync(path, 'utf8'));
    } catch (e) {
      throw new LoopError(
        'Cannot read ' + path + ': ' + (e instanceof Error ? e.message : String(e)),
      );
    }
    const run = await l.api.call<{ id: string }>('POST', projectPath + '/test-runs', {
      name: option(argv, '--name') ?? file.slice(-200),
      source: 'junit',
    });
    const runPath = l.ws + '/test-runs/' + run.id;
    for (let i = 0; i < results.length; i += 500)
      await l.api.call('POST', runPath + '/results', { results: results.slice(i, i + 500) });
    const end = await l.api.call<{ passed: number; failed: number; skipped: number }>(
      'POST',
      runPath + '/finish',
    );
    return {
      code: 0,
      out:
        'Imported ' +
        String(results.length) +
        ' results: ' +
        String(end.passed) +
        ' passed, ' +
        String(end.failed) +
        ' failed, ' +
        String(end.skipped) +
        ' skipped.',
    };
  }
  return { code: 2, out: 'Usage: orq ' + TEST_USAGE.trim() };
}

// [PCODE-315 | S15 | v0.1.0] a report the server reads: an allure-results folder, Cypress or Playwright JSON
export function readReport(
  path: string,
): { format: 'allure' | 'cypress' | 'playwright'; report: Record<string, unknown> } | null {
  let dir = false;
  try {
    dir = statSync(path).isDirectory();
  } catch (e) {
    throw new LoopError(
      'Cannot read ' + path + ': ' + (e instanceof Error ? e.message : String(e)),
    );
  }
  if (dir) {
    const files = readdirSync(path).filter((f) => f.endsWith('-result.json'));
    if (!files.length) throw new LoopError(path + ' has no Allure -result.json files');
    return {
      format: 'allure',
      report: {
        results: files.map((f) => JSON.parse(readFileSync(join(path, f), 'utf8')) as unknown),
      },
    };
  }
  if (!path.toLowerCase().endsWith('.json')) return null;
  let report: unknown;
  try {
    report = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new LoopError(
      'Cannot read ' + path + ': ' + (e instanceof Error ? e.message : String(e)),
    );
  }
  const o =
    typeof report === 'object' && report !== null ? (report as Record<string, unknown>) : {};
  if (Array.isArray(o['results'])) return { format: 'cypress', report: o };
  if (Array.isArray(o['suites'])) return { format: 'playwright', report: o };
  throw new LoopError(path + ' is neither a Playwright nor a Cypress (mochawesome) JSON report');
}

// [PCODE-317 | S15 | v0.1.0] the impacted cases as lines, the most directly covered first
export function impactedText(
  cases: readonly { title: string; score: number; reasons: string[] }[],
  changed: number,
  baseRef: string,
): string {
  if (!cases.length)
    return 'No case covers the ' + String(changed) + ' files changed since ' + baseRef + '.';
  return [
    String(cases.length) +
      ' case' +
      (cases.length === 1 ? '' : 's') +
      (cases.length === 1 ? ' covers the ' : ' cover the ') +
      String(changed) +
      ' files changed since ' +
      baseRef +
      ':',
    ...cases.map((c) => '  ' + c.title + '  (' + c.reasons.join('; ') + ')'),
  ].join('\n');
}
