// ── [PCODE-54 | S10 | v0.1.0] Add the health check with configurable URL and timeout shown in the panel ──
//    Why:  one line per service that can answer plus one for the URL, the aggregation of the two, the URL
//          the project or the setting chose, and a poll that stops at healthy or after two minutes.
import { EventEmitter } from 'node:events';
import type { spawn as nodeSpawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  checkHealth,
  DEFAULT_HEALTH_URL,
  healthSummary,
  healthUrlFrom,
  pollHealth,
} from '../../src/release/health';

function fakeDocker(ps: string, inspect = 'healthy'): typeof nodeSpawn {
  return ((_cmd: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      killed: boolean;
      exitCode: number | null;
      kill(): boolean;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.exitCode = null;
    child.kill = () => true;
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(args[0] === 'inspect' ? `${inspect}\n` : ps));
      child.exitCode = 0;
      child.emit('close', 0);
    }, 1);
    return child;
  }) as unknown as typeof nodeSpawn;
}

const PS_HEALTHY =
  '{"Name":"p-api-1","Service":"api","State":"running","Health":"healthy"}\n{"Name":"p-db-1","Service":"db","State":"running","Health":"healthy"}';
const PS_STARTING =
  '{"Name":"p-api-1","Service":"api","State":"running","Health":"starting"}\n{"Name":"p-web-1","Service":"web","State":"running","Health":""}';

describe('health', () => {
  it('takes the URL from deploy.json, then the setting, then the default', () => {
    expect(healthUrlFrom(undefined, null)).toBe(DEFAULT_HEALTH_URL);
    expect(healthUrlFrom('http://localhost:3000/up', null)).toBe('http://localhost:3000/up');
    expect(
      healthUrlFrom('http://localhost:3000/up', '{"healthUrl":"https://staging/health"}'),
    ).toBe('https://staging/health');
    expect(healthUrlFrom('http://localhost:3000/up', '{oops')).toBe('http://localhost:3000/up');
    expect(healthUrlFrom('   ', '{}')).toBe(DEFAULT_HEALTH_URL);
  });

  // ── [PCODE-54 | S10 | v0.1.0] one line per service with a healthcheck, one for the URL ──
  it('reports every service that can answer, plus the URL', async () => {
    const report = await checkHealth({
      composeFile: 'docker-compose.yml',
      url: 'http://localhost:8000/health',
      docker: { cwd: 'C:\\p', spawn: fakeDocker(PS_HEALTHY) },
      fetchLike: () => Promise.resolve({ status: 200 }),
    });
    expect(report.lines.map((l) => l.text.replace(/\d+ ms/, 'N ms'))).toEqual([
      'api: healthy',
      'db: healthy',
      'http://localhost:8000/health: 200 in N ms',
    ]);
    expect(report.healthy).toBe(true);
    expect(report.empty).toBe(false);
    expect(healthSummary(report)).toBe('Everything is healthy.');
  });

  it('a starting service or a failing URL is not healthy; a service without a healthcheck is skipped', async () => {
    const starting = await checkHealth({
      composeFile: 'docker-compose.yml',
      url: 'http://localhost:8000/health',
      docker: { cwd: 'C:\\p', spawn: fakeDocker(PS_STARTING, 'none') },
      fetchLike: () => Promise.resolve({ status: 200 }),
    });
    // web has no Health field and `docker inspect` says it has no healthcheck: no line for it
    expect(starting.lines.map((l) => l.name)).toEqual(['api', 'http://localhost:8000/health']);
    expect(starting.lines[0]?.state).toBe('starting');
    expect(starting.healthy).toBe(false);
    expect(healthSummary(starting)).toBe('Not healthy yet.');

    const badUrl = await checkHealth({
      composeFile: 'docker-compose.yml',
      url: 'http://localhost:8000/health',
      docker: { cwd: 'C:\\p', spawn: fakeDocker(PS_HEALTHY) },
      fetchLike: () => Promise.resolve({ status: 502 }),
    });
    expect(badUrl.healthy).toBe(false);
    expect(badUrl.lines.at(-1)?.text).toMatch(/: 502 in \d+ ms$/);
  });

  it('says so when nothing runs', async () => {
    const report = await checkHealth({
      composeFile: null,
      url: 'http://localhost:8000/health',
      docker: { cwd: 'C:\\p', spawn: fakeDocker('[]') },
      fetchLike: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    expect(report.empty).toBe(true);
    expect(report.lines).toHaveLength(1);
    expect(healthSummary(report)).toBe('Nothing is running.');
  });

  // ── [PCODE-54 | S10 | v0.1.0] the poll: until healthy, or two minutes ──
  it('polls until healthy', async () => {
    let status = 503;
    const reports: number[] = [];
    let waited = 0;
    const r = await pollHealth({
      composeFile: 'docker-compose.yml',
      url: 'http://x/health',
      docker: { cwd: 'C:\\p', spawn: fakeDocker(PS_HEALTHY) },
      fetchLike: () => {
        // the stack needs two checks to come up
        status = reports.length >= 2 ? 200 : 503;
        return Promise.resolve({ status });
      },
      onReport: (_report, attempt) => reports.push(attempt),
      wait: (ms) => {
        waited += ms;
        return Promise.resolve();
      },
    });
    expect(reports).toEqual([1, 2, 3]);
    expect(r.healthy).toBe(true);
    expect(waited).toBe(10_000); // two waits of five seconds
  });

  it('gives up after two minutes and can be stopped early', async () => {
    let clock = 0;
    let attempts = 0;
    const never = await pollHealth({
      composeFile: 'docker-compose.yml',
      url: 'http://x/health',
      docker: { cwd: 'C:\\p', spawn: fakeDocker(PS_HEALTHY) },
      fetchLike: () => Promise.resolve({ status: 503 }),
      onReport: () => attempts++,
      now: () => clock,
      wait: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
    });
    expect(never.healthy).toBe(false);
    // the first check at 0 s, then one every 5 s while the clock is still under two minutes
    expect(attempts).toBe(25);
    expect(clock).toBe(120_000);

    let stop = false;
    let stopped = 0;
    await pollHealth({
      composeFile: 'docker-compose.yml',
      url: 'http://x/health',
      docker: { cwd: 'C:\\p', spawn: fakeDocker(PS_HEALTHY) },
      fetchLike: () => Promise.resolve({ status: 503 }),
      onReport: () => {
        stopped++;
        stop = stopped >= 2;
      },
      stop: () => stop,
      wait: () => Promise.resolve(),
    });
    expect(stopped).toBe(2); // the panel was closed after the second report
  });
});
