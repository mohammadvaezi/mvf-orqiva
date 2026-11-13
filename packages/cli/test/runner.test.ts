// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-132 | S15 | v0.1.0] Run deploys through our own runner and stream each step ──
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeStep, envLines, planDeploy, type DeployJob } from '../src/runner/plan.js';
import { redact, runOnce, type RunnerDeps, type Shell } from '../src/runner/runner.js';

const job = (kind: string, settings: Record<string, string>, healthUrl = ''): DeployJob => ({
  id: 'run-1',
  ref: 'main',
  project: 'APP',
  environment: { key: 'staging', name: 'Staging', kind, settings, healthUrl },
  secrets: { DB_PASSWORD: 's3cret-pass', COOLIFY_TOKEN: 'cool-token' },
});

describe('deploy plans', () => {
  it('drive docker compose in the folder, with secrets in the environment only', () => {
    const steps = planDeploy(job('compose', { dir: '/srv/app' }, 'https://staging.example/health'));
    expect(steps.map(describeStep)).toEqual([
      'docker compose -f compose.yaml pull',
      'docker compose -f compose.yaml up -d --remove-orphans',
      'GET https://staging.example/health until it answers 2xx',
    ]);
    expect(steps[0]).toMatchObject({ cwd: '/srv/app', env: { DB_PASSWORD: 's3cret-pass' } });
    expect(JSON.stringify(steps.map(describeStep))).not.toContain('s3cret');
  });

  it('send secrets over SSH on standard input, never on the command line', () => {
    const steps = planDeploy(
      job('ssh', { host: 'staging.example', user: 'deploy', port: '2222', dir: "/srv/o'app" }),
    );
    expect(steps.map(describeStep)).toEqual([
      "ssh -o BatchMode=yes -p 2222 deploy@staging.example umask 077 && cat > '/srv/o'\\''app'/.env.orqiva",
      "ssh -o BatchMode=yes -p 2222 deploy@staging.example cd '/srv/o'\\''app' && docker compose --env-file .env.orqiva pull",
      "ssh -o BatchMode=yes -p 2222 deploy@staging.example cd '/srv/o'\\''app' && docker compose --env-file .env.orqiva up -d --remove-orphans",
    ]);
    expect(steps[0]).toMatchObject({
      stdin: 'DB_PASSWORD=s3cret-pass\nCOOLIFY_TOKEN=cool-token\n',
    });
  });

  it('apply Kubernetes manifests after updating the secret through a pipe', () => {
    const steps = planDeploy(job('kubernetes', { manifest: 'k8s/', namespace: 'app' }));
    expect(steps.map(describeStep)).toEqual([
      'kubectl -n app create secret generic app-staging --from-env-file=/dev/stdin --dry-run=client -o yaml | kubectl -n app apply -f -',
      'kubectl -n app apply -f k8s/',
    ]);
  });

  it('call the Coolify webhook with the token as a header, and run OpenTofu with TF_VAR_ secrets', () => {
    const [hook] = planDeploy(
      job('coolify', { url: 'https://coolify.example/api/v1/deploy?uuid=abc' }),
    );
    expect(hook).toMatchObject({ kind: 'http', headers: { authorization: 'Bearer cool-token' } });
    const tofu = planDeploy(job('opentofu', { dir: 'infra', workspace: 'staging' }));
    expect(tofu.map(describeStep)).toEqual([
      'tofu init -input=false',
      'tofu workspace select -or-create staging',
      'tofu apply -auto-approve -input=false',
    ]);
    expect(tofu[0]).toMatchObject({
      env: { TF_VAR_db_password: 's3cret-pass', DB_PASSWORD: 's3cret-pass' },
    });
    expect(() => planDeploy(job('ssh', { host: 'x' }))).toThrow('has no dir');
    expect(() => planDeploy(job('ftp', {}))).toThrow('cannot deploy ftp');
    expect(envLines({ A: 'x\ny' })).toBe('A=x\\ny\n');
  });
});

describe('the runner', () => {
  /** A server that hands out one job and records what the runner reports. */
  function fakeServer(j: DeployJob | null, cancelAt?: number) {
    const reports: { path: string; body: Record<string, unknown> }[] = [];
    let claimed = false;
    const fetchImpl = ((url: string, init?: RequestInit) => {
      const path = url.replace('https://pe.example', '');
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
      if (path === '/api/runner/claim') {
        const run = claimed ? null : j;
        claimed = true;
        return Promise.resolve(new Response(JSON.stringify({ run })));
      }
      if (path.startsWith('/api/runner/')) {
        reports.push({ path, body });
        const steps = reports.filter((r) => r.path.endsWith('/steps')).length;
        return Promise.resolve(
          new Response(JSON.stringify({ cancelled: cancelAt !== undefined && steps >= cancelAt })),
        );
      }
      // the health URL
      return Promise.resolve(new Response('ok', { status: 200 }));
    }) as typeof fetch;
    return { fetchImpl, reports };
  }
  const deps = (fetchImpl: typeof fetch, shell: Shell): RunnerDeps => ({
    server: 'https://pe.example',
    token: 'pe_runner_x',
    cwd: '/repo',
    shell,
    fetchImpl,
    log: () => undefined,
    sleep: () => Promise.resolve(),
    flushMs: 10_000,
  });

  it('reports each step as it starts and ends, with secrets taken out of the output', async () => {
    const server = fakeServer(job('compose', { dir: 'deploy' }, 'https://staging.example/health'));
    const ran: string[] = [];
    const shell: Shell = (cmd, args, opts) => {
      ran.push(cmd + ' ' + args.join(' ') + ' @' + opts.cwd);
      opts.onOutput('using password s3cret-pass\n');
      return Promise.resolve(0);
    };
    expect(await runOnce(deps(server.fetchImpl, shell))).toBe(true);
    expect(ran).toEqual([
      'docker compose -f compose.yaml pull @' + join('/repo', 'deploy'),
      'docker compose -f compose.yaml up -d --remove-orphans @' + join('/repo', 'deploy'),
    ]);
    const steps = server.reports
      .filter((r) => r.path.endsWith('/steps'))
      .map((r) => [r.body['seq'], r.body['status']]);
    expect(steps).toEqual([
      [1, 'running'],
      [1, 'ok'],
      [2, 'running'],
      [2, 'ok'],
      [3, 'running'],
      [3, 'ok'],
    ]);
    expect(JSON.stringify(server.reports)).not.toContain('s3cret-pass');
    expect(JSON.stringify(server.reports)).toContain('using password ••••');
    expect(server.reports.at(-1)).toEqual({
      path: '/api/runner/deploys/run-1/finish',
      body: { status: 'succeeded', error: '' },
    });
    expect(await runOnce(deps(server.fetchImpl, shell))).toBe(false);
  });

  it('stops at a failing step and says which', async () => {
    const server = fakeServer(job('compose', { dir: '/srv' }));
    const shell: Shell = (_c, args) => Promise.resolve(args.includes('up') ? 3 : 0);
    await runOnce(deps(server.fetchImpl, shell));
    expect(server.reports.at(-1)?.body).toEqual({
      status: 'failed',
      error: 'Start the new version failed (exit 3)',
    });
  });

  it('stops when the run was cancelled, and fails a plan it cannot make', async () => {
    const cancelled = fakeServer(job('compose', { dir: '/srv' }), 2);
    const shell: Shell = () => Promise.resolve(0);
    await runOnce(deps(cancelled.fetchImpl, shell));
    expect(cancelled.reports.some((r) => r.path.endsWith('/finish'))).toBe(false);
    const bad = fakeServer(job('ssh', { host: 'x' }));
    await runOnce(deps(bad.fetchImpl, shell));
    expect(bad.reports.at(-1)?.body).toEqual({
      status: 'failed',
      error: 'The ssh environment has no dir',
    });
  });

  it('never lets a secret value through', () => {
    expect(
      redact('a s3cret-pass b cool-token', { A: 's3cret-pass', B: 'cool-token', C: 'x' }),
    ).toBe('a •••• b ••••');
  });
});
