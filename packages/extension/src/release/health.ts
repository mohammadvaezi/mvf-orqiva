// ── [PCODE-54 | S10 | v0.1.0] Add the health check with configurable URL and timeout shown in the panel ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  "it started" is not "it works". The check asks every compose service that has a healthcheck and
//          the project's health URL, and after a Run it keeps asking - every five seconds, for at most two
//          minutes, because a stack that is not healthy by then is not going to be.
import * as fs from 'node:fs';
import { projectFile } from '../state/files';
import {
  composePs,
  describeHttpHealth,
  httpHealth,
  inspectHealth,
  type DockerOptions,
  type FetchLike,
} from './docker';

export const DEFAULT_HEALTH_URL = 'http://localhost:8000/health';
export const DEFAULT_TIMEOUT_SECONDS = 10;
export const POLL_INTERVAL_MS = 5000;
export const POLL_LIMIT_MS = 2 * 60 * 1000;

export interface HealthLine {
  name: string;
  state: 'healthy' | 'starting' | 'unhealthy' | 'unknown' | 'none';
  text: string;
}

export interface HealthReport {
  lines: HealthLine[];
  /** every service with a healthcheck is healthy and the URL answered */
  healthy: boolean;
  /** nothing is running at all */
  empty: boolean;
}

// ── [PCODE-54 | S10 | v0.1.0] healthUrl: the setting, or the project's own deploy.json ──
export function healthUrlFrom(setting: string | undefined, deployJson: string | null): string {
  if (deployJson) {
    try {
      const url = (JSON.parse(deployJson) as { healthUrl?: unknown }).healthUrl;
      if (typeof url === 'string' && url.trim()) return url.trim();
    } catch {
      /* a broken deploy.json is not a reason to skip the check */
    }
  }
  const value = (setting ?? '').trim();
  return value || DEFAULT_HEALTH_URL;
}

export function readDeployJson(root: string, io = fs): string | null {
  const file = projectFile(root, ['deploy.json']); // [PCODE-455 | S15 | v0.1.0]
  try {
    return io.existsSync(file) ? io.readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
}

function stateOf(value: string): HealthLine['state'] {
  if (value === 'healthy' || value === 'starting' || value === 'unhealthy' || value === 'none')
    return value;
  return 'unknown';
}

export interface CheckInput {
  composeFile: string | null;
  url: string;
  timeoutSeconds?: number;
  docker: DockerOptions;
  fetchLike?: FetchLike;
}

// ── [PCODE-54 | S10 | v0.1.0] checkHealth: one line per service with a healthcheck, one for the URL ──
export async function checkHealth(input: CheckInput): Promise<HealthReport> {
  const lines: HealthLine[] = [];
  const services = input.composeFile ? await composePs(input.composeFile, input.docker) : [];
  const running = services.filter((s) => /running|restarting/i.test(s.state));
  for (const service of running) {
    const raw = service.health ?? (await inspectHealth(service.name, input.docker));
    const state = stateOf(raw);
    if (state === 'none') continue; // a service without a healthcheck cannot answer
    lines.push({
      name: service.service || service.name,
      state,
      text: `${service.service || service.name}: ${state}`,
    });
  }
  const http = await httpHealth(
    input.url,
    (input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
    input.fetchLike,
  );
  lines.push({
    name: input.url,
    state: http.ok ? 'healthy' : 'unhealthy',
    text: describeHttpHealth(input.url, http),
  });
  const services_ok = lines.filter((l) => l.name !== input.url).every((l) => l.state === 'healthy');
  return { lines, healthy: services_ok && http.ok, empty: running.length === 0 };
}

export interface PollInput extends CheckInput {
  onReport: (report: HealthReport, attempt: number) => void;
  /** injected for tests */
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  intervalMs?: number;
  limitMs?: number;
  stop?: () => boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── [PCODE-54 | S10 | v0.1.0] pollHealth: after a Run, every 5 s until healthy or two minutes have passed ──
export async function pollHealth(input: PollInput): Promise<HealthReport> {
  const now = input.now ?? Date.now;
  const wait = input.wait ?? sleep;
  const interval = input.intervalMs ?? POLL_INTERVAL_MS;
  const limit = input.limitMs ?? POLL_LIMIT_MS;
  const started = now();
  let attempt = 0;
  let report = await checkHealth(input);
  input.onReport(report, ++attempt);
  while (!report.healthy && now() - started < limit && !input.stop?.()) {
    await wait(interval);
    if (input.stop?.()) break;
    report = await checkHealth(input);
    input.onReport(report, ++attempt);
  }
  return report;
}

export function healthSummary(report: HealthReport): string {
  if (report.empty && report.lines.length <= 1) return 'Nothing is running.';
  return report.healthy ? 'Everything is healthy.' : 'Not healthy yet.';
}
