// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-131 | S15 | v0.1.0] Add environments and the secrets vault ──
//    Why:  the deploy targets Orqiva drives, and the plain settings each needs, in one place for the
//          server's checks, the runner's plans and the web form. Anything secret (tokens, passwords, keys)
//          is never a setting: it is a secret of the environment, sealed on the server.

export const ENVIRONMENT_KINDS = ['compose', 'ssh', 'kubernetes', 'coolify', 'opentofu'] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export interface SettingDef {
  key: string;
  label: string;
  required: boolean;
  hint: string;
}

export const KIND_INFO: Record<EnvironmentKind, { label: string; settings: SettingDef[] }> = {
  compose: {
    label: 'Docker Compose on the runner’s machine',
    settings: [
      {
        key: 'dir',
        label: 'Folder',
        required: true,
        hint: 'where compose.yaml lives on that machine',
      },
      { key: 'file', label: 'Compose file', required: false, hint: 'default compose.yaml' },
    ],
  },
  ssh: {
    label: 'A server over SSH (Docker Compose there)',
    settings: [
      { key: 'host', label: 'Host', required: true, hint: 'name or address the runner can reach' },
      { key: 'user', label: 'User', required: false, hint: 'default: the runner’s SSH user' },
      { key: 'port', label: 'Port', required: false, hint: 'default 22' },
      {
        key: 'dir',
        label: 'Folder on the server',
        required: true,
        hint: 'where compose.yaml lives',
      },
    ],
  },
  kubernetes: {
    label: 'Kubernetes with kubectl',
    settings: [
      {
        key: 'manifest',
        label: 'Manifest',
        required: true,
        hint: 'file or folder in the repository',
      },
      { key: 'namespace', label: 'Namespace', required: false, hint: 'default: the context’s' },
      { key: 'context', label: 'Context', required: false, hint: 'default: the current context' },
    ],
  },
  coolify: {
    label: 'Coolify deploy webhook',
    settings: [
      {
        key: 'url',
        label: 'Webhook URL',
        required: true,
        hint: 'from Coolify; its API token is the secret COOLIFY_TOKEN',
      },
    ],
  },
  opentofu: {
    label: 'OpenTofu (or Terraform)',
    settings: [
      { key: 'dir', label: 'Folder', required: true, hint: 'the configuration in the repository' },
      { key: 'workspace', label: 'Workspace', required: false, hint: 'default: default' },
    ],
  },
};

const SECRETISH = /(password|passwd|secret|token|apikey|api_key|private[_-]?key)/i;

/** What is wrong with an environment's settings for its kind; empty when they can be stored. */
export function settingsProblems(kind: string, settings: unknown): string[] {
  const info = (KIND_INFO as Record<string, (typeof KIND_INFO)[EnvironmentKind] | undefined>)[kind];
  if (!info) return ['kind is one of ' + ENVIRONMENT_KINDS.join(', ')];
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings))
    return ['settings is an object'];
  const s = settings as Record<string, unknown>;
  const known = new Set(info.settings.map((d) => d.key));
  const out: string[] = [];
  for (const [k, v] of Object.entries(s)) {
    if (!known.has(k)) out.push(k + ' is not a setting of ' + kind);
    else if (typeof v !== 'string' || v.length > 500)
      out.push(k + ' is text of at most 500 characters');
    else if (SECRETISH.test(v) && /[:=]/.test(v))
      out.push(k + ' looks like it holds a secret; store it as a secret of the environment');
  }
  for (const d of info.settings)
    if (d.required && !(typeof s[d.key] === 'string' && (s[d.key] as string).trim()))
      out.push(d.label + ' is required');
  return out;
}

/** Secret names as environment variables: FOO_BAR. */
export const SECRET_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
