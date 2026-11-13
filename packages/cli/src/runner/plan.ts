// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-132 | S15 | v0.1.0] Run deploys through our own runner and stream each step ──
//    Why:  what a deploy does on each kind of target, as a plan of plain steps, so it can be read, tested
//          and shown before anything runs. The tools are the customer's own (docker, ssh, kubectl, tofu);
//          we only call them. Secrets travel in a step's environment or on its standard input, never in a
//          command line, so they do not show in process lists or in the step's output.

export interface DeployJob {
  id: string;
  ref: string;
  project: string;
  environment: {
    key: string;
    name: string;
    kind: string;
    settings: Record<string, unknown>;
    healthUrl: string;
  };
  secrets: Record<string, string>;
}

export type Step =
  | {
      kind: 'run';
      name: string;
      cmd: string;
      args: string[];
      /** relative to the runner's working folder (the repository) unless absolute */
      cwd?: string;
      env?: Record<string, string>;
      stdin?: string;
      /** a second command that reads the first one's output */
      pipe?: { cmd: string; args: string[] };
    }
  | {
      kind: 'http';
      name: string;
      url: string;
      method: 'POST' | 'GET';
      headers: Record<string, string>;
    }
  | { kind: 'health'; name: string; url: string; timeoutMs: number };

export class PlanError extends Error {}

const str = (settings: Record<string, unknown>, key: string): string => {
  const v = settings[key];
  return typeof v === 'string' ? v.trim() : '';
};
const need = (settings: Record<string, unknown>, key: string, kind: string): string => {
  const v = str(settings, key);
  if (!v) throw new PlanError('The ' + kind + ' environment has no ' + key);
  return v;
};

/** KEY=value lines, one per secret, for an env file on standard input. */
export const envLines = (secrets: Record<string, string>): string =>
  Object.entries(secrets)
    .map(([k, v]) => k + '=' + v.replace(/\n/g, '\\n'))
    .join('\n') + (Object.keys(secrets).length ? '\n' : '');

/** The steps of a deploy of this job's environment. */
export function planDeploy(job: DeployJob): Step[] {
  const e = job.environment;
  const s = e.settings;
  const steps: Step[] = [];
  switch (e.kind) {
    case 'compose': {
      const dir = need(s, 'dir', 'compose');
      const file = str(s, 'file') || 'compose.yaml';
      steps.push(
        {
          kind: 'run',
          name: 'Pull images',
          cmd: 'docker',
          args: ['compose', '-f', file, 'pull'],
          cwd: dir,
          env: job.secrets,
        },
        {
          kind: 'run',
          name: 'Start the new version',
          cmd: 'docker',
          args: ['compose', '-f', file, 'up', '-d', '--remove-orphans'],
          cwd: dir,
          env: job.secrets,
        },
      );
      break;
    }
    case 'ssh': {
      const host = need(s, 'host', 'ssh');
      const dir = need(s, 'dir', 'ssh');
      const target = (str(s, 'user') ? str(s, 'user') + '@' : '') + host;
      const port = str(s, 'port') ? ['-p', str(s, 'port')] : [];
      const ssh = ['-o', 'BatchMode=yes', ...port, target];
      const quoted = "'" + dir.replace(/'/g, "'\\''") + "'";
      steps.push(
        {
          kind: 'run',
          name: 'Send the secrets',
          cmd: 'ssh',
          args: [...ssh, 'umask 077 && cat > ' + quoted + '/.env.orqiva'],
          stdin: envLines(job.secrets),
        },
        {
          kind: 'run',
          name: 'Pull images',
          cmd: 'ssh',
          args: [...ssh, 'cd ' + quoted + ' && docker compose --env-file .env.orqiva pull'],
        },
        {
          kind: 'run',
          name: 'Start the new version',
          cmd: 'ssh',
          args: [
            ...ssh,
            'cd ' + quoted + ' && docker compose --env-file .env.orqiva up -d --remove-orphans',
          ],
        },
      );
      break;
    }
    case 'kubernetes': {
      const manifest = need(s, 'manifest', 'kubernetes');
      const ctx = [
        ...(str(s, 'context') ? ['--context', str(s, 'context')] : []),
        ...(str(s, 'namespace') ? ['-n', str(s, 'namespace')] : []),
      ];
      if (Object.keys(job.secrets).length)
        steps.push({
          kind: 'run',
          name: 'Update the secret',
          cmd: 'kubectl',
          args: [
            ...ctx,
            'create',
            'secret',
            'generic',
            job.project.toLowerCase() + '-' + e.key,
            '--from-env-file=/dev/stdin',
            '--dry-run=client',
            '-o',
            'yaml',
          ],
          stdin: envLines(job.secrets),
          pipe: { cmd: 'kubectl', args: [...ctx, 'apply', '-f', '-'] },
        });
      steps.push({
        kind: 'run',
        name: 'Apply the manifests',
        cmd: 'kubectl',
        args: [...ctx, 'apply', '-f', manifest],
      });
      break;
    }
    case 'coolify': {
      const url = need(s, 'url', 'coolify');
      const token = job.secrets['COOLIFY_TOKEN'];
      if (!token) throw new PlanError('Add the secret COOLIFY_TOKEN to ' + e.name);
      steps.push({
        kind: 'http',
        name: 'Ask Coolify to deploy',
        url,
        method: 'GET',
        headers: { authorization: 'Bearer ' + token },
      });
      break;
    }
    case 'opentofu': {
      const dir = need(s, 'dir', 'opentofu');
      // secrets reach the configuration as TF_VAR_name (lower case) and as themselves
      const env = Object.fromEntries(
        Object.entries(job.secrets).flatMap(([k, v]) => [
          [k, v],
          ['TF_VAR_' + k.toLowerCase(), v],
        ]),
      );
      steps.push({
        kind: 'run',
        name: 'Initialise',
        cmd: 'tofu',
        args: ['init', '-input=false'],
        cwd: dir,
        env,
      });
      if (str(s, 'workspace'))
        steps.push({
          kind: 'run',
          name: 'Select the workspace',
          cmd: 'tofu',
          args: ['workspace', 'select', '-or-create', str(s, 'workspace')],
          cwd: dir,
          env,
        });
      steps.push({
        kind: 'run',
        name: 'Apply',
        cmd: 'tofu',
        args: ['apply', '-auto-approve', '-input=false'],
        cwd: dir,
        env,
      });
      break;
    }
    default:
      throw new PlanError('This runner cannot deploy ' + e.kind + ' environments');
  }
  if (e.healthUrl)
    steps.push({ kind: 'health', name: 'Health check', url: e.healthUrl, timeoutMs: 120_000 });
  return steps;
}

/** How a step reads in the deploy log; never with a secret in it. */
export function describeStep(step: Step): string {
  if (step.kind === 'run')
    return [
      step.cmd,
      ...step.args,
      ...(step.pipe ? ['|', step.pipe.cmd, ...step.pipe.args] : []),
    ].join(' ');
  if (step.kind === 'http')
    return step.method + ' ' + step.url.replace(/([?&](token|key)=)[^&]+/gi, '$1…');
  return 'GET ' + step.url + ' until it answers 2xx';
}
