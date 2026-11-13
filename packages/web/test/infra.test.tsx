// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-134 | S15 | v0.1.0] Show environments, secrets and live deploys in the web app ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeployStatus, runnerCommand, targetText } from '../src/infra.js';
import { appRoute } from '../src/core/nav.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('infrastructure pages', () => {
  it('have their own addresses', () => {
    expect(appRoute('/projects/' + ID + '/environments')).toEqual({
      kind: 'project',
      id: ID,
      view: 'environments',
    });
    expect(appRoute('/deploys/' + ID)).toEqual({ kind: 'deploy', id: ID });
  });

  it('show a target in one line, whatever its kind', () => {
    expect(
      targetText({
        kind: 'ssh',
        settings: { user: 'deploy', host: 'stage.example', dir: '/srv/app' },
      }),
    ).toBe('deploy@stage.example:/srv/app');
    expect(targetText({ kind: 'compose', settings: { dir: '/srv' } })).toBe('/srv/compose.yaml');
    expect(
      targetText({ kind: 'kubernetes', settings: { manifest: 'k8s/', namespace: 'app' } }),
    ).toBe('app · k8s/');
    expect(targetText({ kind: 'opentofu', settings: { dir: 'infra', workspace: 'staging' } })).toBe(
      'infra · staging',
    );
  });

  it('read a deploy’s state and give the runner command', () => {
    expect(renderToString(<DeployStatus status="queued" />)).toContain('Waiting for a runner');
    expect(renderToString(<DeployStatus status="succeeded" />)).toContain('Deployed');
    expect(runnerCommand('https://pe.example', 'pe_runner_x')).toBe(
      'orq runner --server https://pe.example --token pe_runner_x',
    );
  });
});
