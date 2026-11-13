// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-77 | S08 | v0.1.0] Rename PlaneCode to ProdEngine (now Orqiva) with settings migration ──
//    Why:  a rename must not lose a setting someone made; it must not overwrite one they already
//          changed under the new name either.
import { describe, expect, it } from 'vitest';
import {
  MIGRATED_KEYS,
  migrateSettings,
  type SettingsAccess,
  type SettingsScope,
} from '../../src/setup/migrate';
import pkg from '../../package.json';

type Values = { globalValue?: unknown; workspaceValue?: unknown };

function fakeSettings(initial: Record<string, Values>): {
  access: SettingsAccess;
  writes: [string, unknown, SettingsScope][];
} {
  const store = { ...initial };
  const writes: [string, unknown, SettingsScope][] = [];
  return {
    writes,
    access: {
      inspect: (key) => store[key],
      update: (key, value, scope) => {
        writes.push([key, value, scope]);
        store[key] = {
          ...store[key],
          [scope === 'global' ? 'globalValue' : 'workspaceValue']: value,
        };
        return Promise.resolve();
      },
    },
  };
}

describe('settings migration', () => {
  it('copies an old value to the new name, per scope', async () => {
    const { access, writes } = fakeSettings({
      'planecode.engineHome': { globalValue: 'C:\\Tools\\engine' },
      'planecode.plane.workspace': { workspaceValue: 'acme' },
    });
    const moved = await migrateSettings(access);
    expect(writes).toEqual([
      ['orqiva.engineHome', 'C:\\Tools\\engine', 'global'],
      ['orqiva.plane.workspace', 'acme', 'workspace'],
    ]);
    expect(moved).toHaveLength(2);
  });

  // [PCODE-192 | S15 | v0.1.0]
  it('takes the ProdEngine value over the older PlaneCode one', async () => {
    const { access, writes } = fakeSettings({
      'planecode.engineHome': { globalValue: 'C:\old' },
      'prodengine.engineHome': { globalValue: 'C:\newer' },
      'prodengine.codeLens.enabled': { workspaceValue: false },
    });
    await migrateSettings(access);
    expect(writes).toEqual([
      ['orqiva.engineHome', 'C:\newer', 'global'],
      ['orqiva.codeLens.enabled', false, 'workspace'],
    ]);
  });

  it('never overwrites a value already set under the new name', async () => {
    const { access, writes } = fakeSettings({
      'planecode.pythonPath': { globalValue: 'python' },
      'orqiva.pythonPath': { globalValue: 'py' },
    });
    expect(await migrateSettings(access)).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('is a no-op on a machine that never had PlaneCode or ProdEngine', async () => {
    const { access, writes } = fakeSettings({});
    await migrateSettings(access);
    expect(writes).toEqual([]);
  });

  // [PCODE-78 | S08 | v0.1.0] settings added after the rename have nothing to migrate from
  it('migrates only settings the extension still registers', () => {
    const registered = Object.keys(
      (pkg.contributes.configuration as { properties: Record<string, unknown> }).properties,
    );
    for (const key of MIGRATED_KEYS) expect(registered, key).toContain(`orqiva.${key}`);
  });
});
