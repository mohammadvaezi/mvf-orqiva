// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-12 | S02 | v0.1.0] Add a read-only Plane REST client with SecretStorage key and 20 req/min throttle ──
//    Why:  the Plane API key lives in VS Code SecretStorage only (criticals #1); this wrapper is the single
//          place it is read, and every value it hands out is registered with redact() first.
import type * as vscode from 'vscode';
import { forgetSecret, registerSecret } from '../util/redact';

export const SECRET_PLANE_API_KEY = 'orqiva.plane.apiKey';

export interface PlaneConnection {
  baseUrl: string;
  workspace: string;
}

export interface SecretsLike {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

// ── [PCODE-12 | S02 | v0.1.0] PlaneSecrets: get/set/delete the key; envForEngine() for spawned scripts ──
export class PlaneSecrets {
  constructor(
    private readonly storage: SecretsLike,
    private readonly connection: () => PlaneConnection,
  ) {}

  async getApiKey(): Promise<string | undefined> {
    const key = await this.storage.get(SECRET_PLANE_API_KEY);
    registerSecret(key);
    return key;
  }

  async setApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    registerSecret(trimmed);
    await this.storage.store(SECRET_PLANE_API_KEY, trimmed);
  }

  async deleteApiKey(): Promise<void> {
    const old = await this.storage.get(SECRET_PLANE_API_KEY);
    await this.storage.delete(SECRET_PLANE_API_KEY);
    forgetSecret(old);
  }

  async hasApiKey(): Promise<boolean> {
    return Boolean(await this.getApiKey());
  }

  /** Environment for the engine: the key plus the connection, so both sides agree on the instance. */
  async envForEngine(): Promise<NodeJS.ProcessEnv> {
    const conn = this.connection();
    const env: NodeJS.ProcessEnv = {
      PLANE_BASE_URL: conn.baseUrl,
      PLANE_WORKSPACE_SLUG: conn.workspace,
    };
    const key = await this.getApiKey();
    if (key) env['PLANE_API_KEY'] = key;
    return env;
  }
}

/** Build from a real ExtensionContext; kept tiny so the class stays testable with the mock. */
export function secretsFromContext(
  context: Pick<vscode.ExtensionContext, 'secrets'>,
  connection: () => PlaneConnection,
): PlaneSecrets {
  return new PlaneSecrets(context.secrets, connection);
}
