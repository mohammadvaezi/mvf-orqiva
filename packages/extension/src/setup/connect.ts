// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-27 | S05 | v0.1.0] Build the setup panel: environment checks, Plane connection and key storage ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  connecting = test the key against Plane, then store address + workspace in settings and the key in
//          SecretStorage (criticals #1). A wrong key stores nothing. Pure: settings writer, secrets and the
//          client factory are injected.
import { OrqivaError } from '../util/errors';

export interface ConnectInput {
  baseUrl: string;
  workspace: string;
  apiKey: string;
}

export interface ConnectDeps {
  writeSetting: (key: 'plane.baseUrl' | 'plane.workspace', value: string) => Promise<void>;
  storeKey: (key: string) => Promise<void>;
  /** a throw-away client for the candidate credentials; only getProjects is used */
  testClient: (c: { baseUrl: string; workspace: string; apiKey: string }) => {
    getProjects(): Promise<{ identifier: string }[]>;
  };
}

export interface ConnectResult {
  ok: true;
  projects: string[];
}

export function normalizeUrl(u: string): string {
  const t = u.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

// ── [PCODE-27 | S05 | v0.1.0] connectPlane: test first, store only on success; errors name the next step ──
export async function connectPlane(deps: ConnectDeps, input: ConnectInput): Promise<ConnectResult> {
  const baseUrl = normalizeUrl(input.baseUrl);
  const workspace = input.workspace.trim().replace(/^\/+|\/+$/g, '');
  const apiKey = input.apiKey.trim();
  if (!baseUrl || !workspace)
    throw new OrqivaError('Fill in the tracker address and the workspace slug.', 'user');
  if (!apiKey)
    throw new OrqivaError(
      'Paste an API key from the tracker: Profile > Personal Access Tokens.',
      'user',
    );
  let projects: { identifier: string }[];
  try {
    projects = await deps.testClient({ baseUrl, workspace, apiKey }).getProjects();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /\((\d{3})\)/.exec(msg)?.[1];
    if (status === '401' || status === '403')
      throw new OrqivaError(
        `Connection failed. ${status} Unauthorized. Check the key in the tracker: Profile > Personal Access Tokens.`,
        'config',
      );
    if (status === '404')
      throw new OrqivaError(
        `Connection failed. 404 Not Found. Check the workspace slug "${workspace}" and the address ${baseUrl}.`,
        'config',
      );
    throw new OrqivaError(
      `Connection failed. ${msg}. Check the address and your network.`,
      'network',
    );
  }
  await deps.writeSetting('plane.baseUrl', baseUrl);
  await deps.writeSetting('plane.workspace', workspace);
  await deps.storeKey(apiKey);
  return { ok: true, projects: projects.map((p) => p.identifier) };
}
