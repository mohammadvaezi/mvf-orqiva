// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-56 | S11 | v0.1.0] Implement the Coolify adapter: trigger a deploy and poll the deployment status ──
//    Why:  the request shape (and that the token never reaches a log line), the poll until finished, a failed
//          deployment, the timeout, and the sentences 401/404 turn into.
import { describe, expect, it } from 'vitest';
import {
  API,
  deployToCoolify,
  explain,
  poll,
  statusOf,
  trigger,
  type HttpLike,
} from '../../src/deploy/coolify';
import type { DeployTarget } from '../../src/deploy/targets';
import { clearRegisteredSecrets, redact, registerSecret } from '../../src/util/redact';

const TARGET: DeployTarget = {
  name: 'prod',
  kind: 'coolify',
  url: 'https://coolify.example.test/',
  appUuid: 'app-uuid-1',
};
// [PCODE-66 | S13 | v0.1.0] orqiva:allow-secret - an invented token; the point of the test is that it never leaves
const TOKEN = 'coolify_live_token_value';

function http(
  answers: (url: string, method: string) => { status?: number; text?: string },
  calls: { url: string; method: string; headers: Record<string, string> }[] = [],
): HttpLike {
  return (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers });
    const a = answers(url, init.method);
    return Promise.resolve({ status: a.status ?? 200, text: a.text ?? '{}' });
  };
}

const deployAccepted = JSON.stringify({
  deployments: [
    {
      message: 'Deployment request queued.',
      deployment_uuid: 'dep-1',
      resource_uuid: 'app-uuid-1',
    },
  ],
});

describe('coolify adapter', () => {
  it('turns an HTTP answer into a sentence that names the fix', () => {
    expect(explain(401, '')).toBe(
      '401: token rejected — check the Coolify API token of this target.',
    );
    expect(explain(403, '')).toMatch(/token rejected/);
    expect(explain(404, '')).toBe(
      '404: application uuid not found — check the uuid in the target.',
    );
    expect(explain(422, '{"message":"no deployable commit"}')).toMatch(/no deployable commit/);
    expect(explain(429, '')).toMatch(/rate limiting/);
    expect(explain(500, 'boom')).toBe('500: Coolify answered unexpectedly — boom.');
  });

  it('reads the status words Coolify uses', () => {
    expect(statusOf({ status: 'queued' })).toBe('queued');
    expect(statusOf({ status: 'in_progress' })).toBe('in_progress');
    expect(statusOf({ status: 'running' })).toBe('in_progress');
    expect(statusOf({ status: 'finished' })).toBe('finished');
    expect(statusOf({ status: 'success' })).toBe('finished');
    expect(statusOf({ status: 'failed' })).toBe('failed');
    expect(statusOf({ state: 'cancelled-by-user' })).toBe('cancelled');
    expect(statusOf({})).toBe('unknown');
  });

  // ── [PCODE-56 | S11 | v0.1.0] the request: address, bearer header, and no token in the log ──
  it('posts the deploy request and logs the address without the token', async () => {
    clearRegisteredSecrets();
    registerSecret(TOKEN);
    const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
    const lines: string[] = [];
    const handle = await trigger({
      target: TARGET,
      token: TOKEN,
      http: http(() => ({ text: deployAccepted }), calls),
      onLine: (l) => lines.push(l),
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe(
      `https://coolify.example.test/api/${API}/deploy?uuid=app-uuid-1&force=false`,
    );
    expect(calls[0]?.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(handle).toEqual({ uuid: 'dep-1', message: 'Deployment request queued.' });
    expect(lines.join('\n')).not.toContain(TOKEN);
    expect(lines.map((l) => redact(l))).toEqual([
      `> POST https://coolify.example.test/api/${API}/deploy?uuid=app-uuid-1&force=false`,
      'Coolify: Deployment request queued. (dep-1)',
    ]);
    clearRegisteredSecrets();
  });

  it('refuses when the answer names no deployment', async () => {
    await expect(
      trigger({ target: TARGET, token: TOKEN, http: http(() => ({ text: '{"ok":true}' })) }),
    ).rejects.toThrow(/named no deployment/);
    await expect(
      trigger({ target: TARGET, token: TOKEN, http: http(() => ({ status: 401 })) }),
    ).rejects.toThrow(/token rejected/);
    await expect(
      trigger({ target: TARGET, token: TOKEN, http: http(() => ({ status: 404 })) }),
    ).rejects.toThrow(/uuid not found/);
  });

  // ── [PCODE-56 | S11 | v0.1.0] the poll: queued -> in progress -> finished, one line per change ──
  it('polls until the deployment is finished', async () => {
    const states = ['queued', 'in_progress', 'in_progress', 'finished'];
    let i = 0;
    const lines: string[] = [];
    let waited = 0;
    const outcome = await poll(
      { uuid: 'dep-1', message: 'queued' },
      {
        target: TARGET,
        token: TOKEN,
        http: http((url) => {
          expect(url).toBe(`https://coolify.example.test/api/${API}/deployments/dep-1`);
          return { text: JSON.stringify({ status: states[Math.min(i++, states.length - 1)] }) };
        }),
        onLine: (l) => lines.push(l),
        wait: (ms) => {
          waited += ms;
          return Promise.resolve();
        },
      },
    );
    expect(outcome).toMatchObject({ uuid: 'dep-1', status: 'finished' });
    // a repeated status is not repeated in the log
    expect(lines).toEqual(['Coolify: queued', 'Coolify: in_progress', 'Coolify: finished']);
    expect(waited).toBe(15_000);
  });

  it('reports a failed deployment as an error carrying the outcome', async () => {
    await expect(
      deployToCoolify({
        target: TARGET,
        token: TOKEN,
        http: http((url) =>
          url.includes('/deploy?') ? { text: deployAccepted } : { text: '{"status":"failed"}' },
        ),
        wait: () => Promise.resolve(),
      }),
    ).rejects.toThrow(/reported the deployment as failed \(dep-1\)/);
  });

  it('gives up after the limit and can be stopped', async () => {
    let clock = 0;
    await expect(
      poll(
        { uuid: 'dep-1', message: 'queued' },
        {
          target: TARGET,
          token: TOKEN,
          http: http(() => ({ text: '{"status":"in_progress"}' })),
          now: () => clock,
          wait: (ms) => {
            clock += ms;
            return Promise.resolve();
          },
          limitMs: 60_000,
        },
      ),
    ).rejects.toThrow(/did not finish within 1 minutes/);

    let stop = false;
    const stopped = await poll(
      { uuid: 'dep-1', message: 'queued' },
      {
        target: TARGET,
        token: TOKEN,
        http: http(() => {
          stop = true;
          return { text: '{"status":"in_progress"}' };
        }),
        wait: () => Promise.resolve(),
        stop: () => stop,
      },
    );
    expect(stopped.status).toBe('cancelled');
    expect(stopped.detail).toBe('stopped watching');
  });

  it('accepts the flat answer shape too', async () => {
    const handle = await trigger({
      target: TARGET,
      token: TOKEN,
      http: http(() => ({ text: '{"uuid":"dep-9","message":"queued"}' })),
    });
    expect(handle.uuid).toBe('dep-9');
  });
});
