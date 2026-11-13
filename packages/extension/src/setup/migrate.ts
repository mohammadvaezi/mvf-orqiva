// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-77 | S08 | v0.1.0] Rename PlaneCode to ProdEngine (now Orqiva) with settings migration ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the extension was PlaneCode, then ProdEngine; its settings were planecode.*, then
//          prodengine.*. Someone who set an engine folder or a Plane address there must not find it
//          gone after a rename, so each one is copied to orqiva.* - once, only where the new one is
//          still unset, never overwriting; the newer name wins over the older one. The old keys
//          are left alone: VS Code refuses writes to a setting no extension registers. The Plane key
//          cannot move: SecretStorage belongs to the extension ID, so it is asked for once again.

// [PCODE-192 | S15 | v0.1.0] two earlier names, the newer first
export const OLD_PREFIXES = ['prodengine', 'planecode'] as const;
export const NEW_PREFIX = 'orqiva';

/** every setting the extension registers, without the prefix */
export const MIGRATED_KEYS = [
  'engineHome',
  'pythonPath',
  'plane.baseUrl',
  'plane.workspace',
  'claudeCommand',
  'codeLens.enabled',
  'docs.outputFolder',
  'docs.postToPlane',
  'docker.healthUrl',
  'docker.healthTimeoutSeconds',
] as const;

export type SettingsScope = 'global' | 'workspace';

/** the slice of `WorkspaceConfiguration` the migration needs, so it runs under vitest */
export interface SettingsAccess {
  inspect(key: string): { globalValue?: unknown; workspaceValue?: unknown } | undefined;
  update(key: string, value: unknown, scope: SettingsScope): PromiseLike<void>;
}

// ── [PCODE-77 | S08 | v0.1.0] migrateSettings: old value copied where the new one is unset ──
export async function migrateSettings(access: SettingsAccess): Promise<string[]> {
  const moved: string[] = [];
  for (const key of MIGRATED_KEYS) {
    const now = access.inspect(`${NEW_PREFIX}.${key}`);
    for (const scope of ['global', 'workspace'] as const) {
      const field = scope === 'global' ? 'globalValue' : 'workspaceValue';
      if (now?.[field] !== undefined) continue;
      // [PCODE-192 | S15 | v0.1.0] the newest earlier name that holds a value
      const oldValue = OLD_PREFIXES.map((p) => access.inspect(`${p}.${key}`)?.[field]).find(
        (v) => v !== undefined,
      );
      if (oldValue === undefined) continue;
      await access.update(`${NEW_PREFIX}.${key}`, oldValue, scope);
      moved.push(`${NEW_PREFIX}.${key} (${scope})`);
    }
  }
  return moved;
}
