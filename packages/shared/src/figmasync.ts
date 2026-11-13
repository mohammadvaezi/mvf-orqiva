// ── [PCODE-297 | S15 | v0.1.0] T30.10 Figma two-way sync: variables and components, tested against recorded Figma answers ──
//    Why:  designers keep tokens as Figma variables, developers as Orqiva tokens; neither should copy by
//          hand. Both sides are read into one shape (name, type, value per mode) and compared with the
//          state of the last sync, three ways: what changed only in Figma waits to be taken, what changed
//          only in Orqiva waits to be sent, and what changed on both sides differently is a conflict a
//          person decides. Sending is one request to Figma's variables API: create, update, delete.
import { parseColor, parsePx } from './designtokens.js';

// ── Figma's REST answers, as far as the sync reads them ──
export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}
export interface FigmaAlias {
  type: 'VARIABLE_ALIAS';
  id: string;
}
export type FigmaValue = FigmaColor | FigmaAlias | number | string | boolean;
export interface FigmaVariable {
  id: string;
  name: string;
  variableCollectionId: string;
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  valuesByMode: Record<string, FigmaValue>;
  description?: string;
  remote?: boolean;
  scopes?: string[];
}
export interface FigmaCollection {
  id: string;
  name: string;
  modes: { modeId: string; name: string }[];
  defaultModeId: string;
  remote?: boolean;
}
export interface FigmaVariablesAnswer {
  meta: {
    variables: Record<string, FigmaVariable>;
    variableCollections: Record<string, FigmaCollection>;
  };
}
export interface FigmaComponent {
  key: string;
  node_id: string;
  name: string;
  description?: string;
  containing_frame?: { containingComponentSet?: { nodeId: string; name: string } | null };
}

// ── one shape for both sides ──
export type SyncType = 'color' | 'dimension' | 'number' | 'fontWeight' | 'fontFamily' | 'duration';
/** A token as both sides can hold it: the value of every mode, normalised so equal means equal. */
export interface SyncToken {
  type: SyncType;
  light: string;
  dark: string;
  themes: Record<string, string>;
  description: string;
}
export type SyncSide = Map<string, SyncToken>;

/** The file key of a Figma link (or the key itself). */
export function figmaFileKey(input: string): string | null {
  const v = input.trim();
  const m = /figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]{10,64})/.exec(v);
  if (m?.[1]) return m[1];
  return /^[A-Za-z0-9]{10,64}$/.test(v) ? v : null;
}

/** The link that opens a node of a file. */
export const figmaNodeUrl = (fileKey: string, nodeId: string): string =>
  'https://www.figma.com/design/' +
  fileKey +
  '/?node-id=' +
  encodeURIComponent(nodeId.replace(':', '-'));

const hex2 = (n: number): string =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0');

/** Figma's 0–1 channels as #rrggbb, or #rrggbbaa when not opaque. */
export function figmaColorToHex(c: FigmaColor): string {
  const a = c.a >= 0.999 ? '' : hex2(c.a * 255);
  return '#' + hex2(c.r * 255) + hex2(c.g * 255) + hex2(c.b * 255) + a;
}
export function hexToFigmaColor(value: string): FigmaColor | null {
  const p = parseColor(value);
  if (!p) return null;
  const r3 = (x: number): number => Math.round(x * 10000) / 10000;
  return { r: r3(p[0] / 255), g: r3(p[1] / 255), b: r3(p[2] / 255), a: r3(p[3]) };
}

/** A value as both sides compare it: colours as lower-case hex, sizes in px, aliases as {name}. */
export function normalValue(type: SyncType, value: string): string {
  const v = value.trim();
  if (/^\{[^}]+\}$/.test(v)) return v;
  if (type === 'color') {
    const c = hexToFigmaColor(v);
    return c ? figmaColorToHex(c) : v.toLowerCase();
  }
  if (type === 'dimension') {
    const n = parsePx(v);
    return n === null ? v : String(Math.round(n * 1000) / 1000) + 'px';
  }
  if (type === 'duration') {
    const n = /^(-?\d*\.?\d+)\s*(ms|s)?$/.exec(v);
    return n ? String(Number(n[1]) * (n[2] === 's' ? 1000 : 1)) + 'ms' : v;
  }
  if (type === 'number' || type === 'fontWeight') {
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : v;
  }
  return v;
}

/** Figma names group with slashes ("Color/Primary 500"); Orqiva's are dotted ("color.primary-500"). */
export function figmaNameToToken(name: string): string | null {
  const parts = name
    .split('/')
    .map((p) =>
      p
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean);
  if (!parts.length || parts.length > 6) return null;
  const n = parts.join('.');
  return /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){0,5}$/.test(n) ? n : null;
}
export const tokenNameToFigma = (name: string): string => name.split('.').join('/');

const typeOf = (v: FigmaVariable, name: string): SyncType | null => {
  const scopes = v.scopes ?? [];
  if (v.resolvedType === 'COLOR') return 'color';
  if (v.resolvedType === 'STRING')
    return scopes.includes('FONT_FAMILY') || /^font\.family/.test(name) ? 'fontFamily' : null;
  if (v.resolvedType !== 'FLOAT') return null;
  if (scopes.includes('FONT_WEIGHT') || /^font\.weight/.test(name)) return 'fontWeight';
  if (scopes.includes('OPACITY') || /^(opacity|z|z-index)\./.test(name)) return 'number';
  if (/^(duration|motion\.duration)\./.test(name)) return 'duration';
  return 'dimension';
};

/** How a collection's modes map onto light, dark and themes. */
export function modeRoles(c: FigmaCollection): {
  light: string;
  dark: string | null;
  themes: Record<string, string>;
} {
  const dark = c.modes.find((m) => /^dark\b/i.test(m.name))?.modeId ?? null;
  const light =
    c.modes.find((m) => /^(light|default|mode 1|value|base)\b/i.test(m.name))?.modeId ??
    c.defaultModeId;
  const themes: Record<string, string> = {};
  for (const m of c.modes) {
    if (m.modeId === light || m.modeId === dark) continue;
    const slug = m.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    if (/^[a-z][a-z0-9-]*$/.test(slug) && slug !== 'light' && slug !== 'dark')
      themes[slug] = m.modeId;
  }
  return { light, dark, themes };
}

export interface FigmaIndex {
  /** token name → the variable and its collection */
  ids: Record<string, { variableId: string; collectionId: string }>;
  collections: {
    id: string;
    name: string;
    light: string;
    dark: string | null;
    themes: Record<string, string>;
  }[];
  /** variables read but not synced: the reason, by Figma name */
  skipped: { name: string; reason: string }[];
}

/** Figma's local variables as tokens, and where each lives. Variables of libraries (remote) stay out. */
export function figmaSide(answer: FigmaVariablesAnswer): { tokens: SyncSide; index: FigmaIndex } {
  const tokens: SyncSide = new Map();
  const index: FigmaIndex = { ids: {}, collections: [], skipped: [] };
  const cols = Object.values(answer.meta.variableCollections).filter((c) => !c.remote);
  const roles = new Map(cols.map((c) => [c.id, modeRoles(c)]));
  for (const c of cols)
    index.collections.push({ id: c.id, name: c.name, ...(roles.get(c.id) ?? modeRoles(c)) });
  const vars = Object.values(answer.meta.variables).filter(
    (v) => !v.remote && roles.has(v.variableCollectionId),
  );
  const nameOfId = new Map<string, string>();
  for (const v of vars) {
    const n = figmaNameToToken(v.name);
    if (n) nameOfId.set(v.id, n);
  }
  for (const v of vars) {
    const name = nameOfId.get(v.id);
    if (!name) {
      index.skipped.push({ name: v.name, reason: 'the name cannot be a token name' });
      continue;
    }
    const type = typeOf(v, name);
    if (!type) {
      index.skipped.push({
        name: v.name,
        reason:
          v.resolvedType === 'BOOLEAN'
            ? 'true/false values have no token type'
            : 'text that is no font family',
      });
      continue;
    }
    if (tokens.has(name)) {
      index.skipped.push({
        name: v.name,
        reason: 'another collection has a variable of the same name',
      });
      continue;
    }
    const r = roles.get(v.variableCollectionId);
    if (!r) continue;
    const valueOf = (modeId: string | null): string | null => {
      if (!modeId) return null;
      const x = v.valuesByMode[modeId];
      if (x === undefined) return null;
      if (typeof x === 'object' && 'type' in x) {
        const target = nameOfId.get(x.id);
        return target ? '{' + target + '}' : null;
      }
      if (typeof x === 'object') return figmaColorToHex(x);
      if (typeof x === 'number')
        return type === 'dimension'
          ? String(x) + 'px'
          : type === 'duration'
            ? String(x) + 'ms'
            : String(x);
      return String(x);
    };
    const light = valueOf(r.light);
    if (light === null) {
      index.skipped.push({
        name: v.name,
        reason: 'its value points at a variable of another file',
      });
      continue;
    }
    const themes: Record<string, string> = {};
    for (const [t, m] of Object.entries(r.themes)) {
      const x = valueOf(m);
      if (x !== null) themes[t] = normalValue(type, x);
    }
    tokens.set(name, {
      type,
      light: normalValue(type, light),
      dark: normalValue(type, valueOf(r.dark) ?? light),
      themes,
      description: v.description ?? '',
    });
    index.ids[name] = { variableId: v.id, collectionId: v.variableCollectionId };
  }
  return { tokens, index };
}

/** Orqiva's tokens in the same shape; shadows (no Figma variable holds one) stay out. */
export function orqivaSide(
  tokens: readonly {
    name: string;
    type: string;
    valueLight: string;
    valueDark: string;
    description: string;
    themes?: Record<string, string>;
  }[],
): SyncSide {
  const out: SyncSide = new Map();
  for (const t of tokens) {
    if (!['color', 'dimension', 'number', 'fontWeight', 'fontFamily', 'duration'].includes(t.type))
      continue;
    const type = t.type as SyncType;
    const themes: Record<string, string> = {};
    for (const [k, v] of Object.entries(t.themes ?? {}))
      if (v.trim()) themes[k] = normalValue(type, v);
    out.set(t.name, {
      type,
      light: normalValue(type, t.valueLight),
      dark: normalValue(type, t.valueDark || t.valueLight),
      themes,
      description: t.description,
    });
  }
  return out;
}

/** The same token on both sides: type and every mode; descriptions do not count. */
export function sameToken(a: SyncToken | undefined, b: SyncToken | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.type !== b.type || a.light !== b.light || a.dark !== b.dark) return false;
  const keys = new Set([...Object.keys(a.themes), ...Object.keys(b.themes)]);
  for (const k of keys) if ((a.themes[k] ?? a.light) !== (b.themes[k] ?? b.light)) return false;
  return true;
}

export interface SyncChange {
  name: string;
  kind: 'add' | 'change' | 'remove';
  from: SyncToken | null;
  to: SyncToken | null;
}
export interface SyncConflict {
  name: string;
  base: SyncToken | null;
  orqiva: SyncToken | null;
  figma: SyncToken | null;
}
export interface SyncPlan {
  /** changed in Figma only: take into Orqiva */
  pull: SyncChange[];
  /** changed in Orqiva only: send to Figma */
  push: SyncChange[];
  conflicts: SyncConflict[];
  inSync: number;
}

const change = (
  name: string,
  from: SyncToken | undefined,
  to: SyncToken | undefined,
): SyncChange => ({
  name,
  kind: !from ? 'add' : !to ? 'remove' : 'change',
  from: from ?? null,
  to: to ?? null,
});

/** The three-way comparison. Without a last sync (base empty), a token on one side only is an addition
 *  to the other, and different values on both sides are conflicts. */
export function syncPlan(base: SyncSide, orqiva: SyncSide, figma: SyncSide): SyncPlan {
  const plan: SyncPlan = { pull: [], push: [], conflicts: [], inSync: 0 };
  const names = [...new Set([...orqiva.keys(), ...figma.keys(), ...base.keys()])].sort();
  for (const n of names) {
    const b = base.get(n);
    const o = orqiva.get(n);
    const f = figma.get(n);
    if (sameToken(o, f)) {
      if (o) plan.inSync += 1;
      continue;
    }
    const oChanged = !sameToken(o, b);
    const fChanged = !sameToken(f, b);
    if (fChanged && !oChanged) plan.pull.push(change(n, o, f));
    else if (oChanged && !fChanged) plan.push.push(change(n, f, o));
    else plan.conflicts.push({ name: n, base: b ?? null, orqiva: o ?? null, figma: f ?? null });
  }
  return plan;
}

// ── writing to Figma ──
export interface FigmaPostBody {
  variableCollections?: { action: 'CREATE'; id: string; name: string; initialModeId: string }[];
  variableModes?: {
    action: 'CREATE' | 'UPDATE';
    id: string;
    name: string;
    variableCollectionId: string;
  }[];
  variables?: (
    | {
        action: 'CREATE';
        id: string;
        name: string;
        variableCollectionId: string;
        resolvedType: string;
        description?: string;
      }
    | { action: 'UPDATE'; id: string; description?: string }
    | { action: 'DELETE'; id: string }
  )[];
  variableModeValues?: { variableId: string; modeId: string; value: FigmaValue }[];
}

const FIGMA_TYPE: Record<SyncType, 'COLOR' | 'FLOAT' | 'STRING'> = {
  color: 'COLOR',
  dimension: 'FLOAT',
  number: 'FLOAT',
  fontWeight: 'FLOAT',
  duration: 'FLOAT',
  fontFamily: 'STRING',
};

/** The request that makes Figma hold the given Orqiva tokens (and drop removed ones). New variables go
 *  into the collection of their group (the first part of the name), else the first collection; a file
 *  without collections gets one with a Light and a Dark mode. Aliases point at the variable they name. */
export function figmaPushBody(
  changes: readonly SyncChange[],
  index: FigmaIndex,
): { body: FigmaPostBody; skipped: { name: string; reason: string }[] } {
  const body: FigmaPostBody = { variables: [], variableModeValues: [] };
  const skipped: { name: string; reason: string }[] = [];
  const ids: Record<string, { variableId: string; collectionId: string }> = { ...index.ids };
  let cols = index.collections;
  if (!cols.length && changes.some((c) => c.to)) {
    body.variableCollections = [
      { action: 'CREATE', id: 'tmp:collection', name: 'Orqiva tokens', initialModeId: 'tmp:light' },
    ];
    body.variableModes = [
      { action: 'UPDATE', id: 'tmp:light', name: 'Light', variableCollectionId: 'tmp:collection' },
      { action: 'CREATE', id: 'tmp:dark', name: 'Dark', variableCollectionId: 'tmp:collection' },
    ];
    cols = [
      {
        id: 'tmp:collection',
        name: 'Orqiva tokens',
        light: 'tmp:light',
        dark: 'tmp:dark',
        themes: {},
      },
    ];
  }
  const homeOf = (name: string): (typeof cols)[number] | undefined => {
    const group = name.split('.')[0];
    const sibling = Object.entries(ids).find(([n]) => n.split('.')[0] === group);
    return cols.find((c) => c.id === sibling?.[1].collectionId) ?? cols[0];
  };
  // new variables first, so aliases among them can point at each other
  for (const ch of changes) {
    if (!ch.to || ids[ch.name]) continue;
    const home = homeOf(ch.name);
    if (!home) continue;
    const id = 'tmp:' + ch.name;
    body.variables?.push({
      action: 'CREATE',
      id,
      name: tokenNameToFigma(ch.name),
      variableCollectionId: home.id,
      resolvedType: FIGMA_TYPE[ch.to.type],
      ...(ch.to.description ? { description: ch.to.description } : {}),
    });
    ids[ch.name] = { variableId: id, collectionId: home.id };
  }
  const valueFor = (type: SyncType, v: string, name: string): FigmaValue | null => {
    const alias = /^\{([^}]+)\}$/.exec(v)?.[1];
    if (alias) {
      const target = ids[alias];
      if (!target) {
        if (!skipped.some((x) => x.name === name))
          skipped.push({ name, reason: 'it points at ' + alias + ', which Figma does not hold' });
        return null;
      }
      return { type: 'VARIABLE_ALIAS', id: target.variableId };
    }
    if (type === 'color') return hexToFigmaColor(v);
    if (type === 'fontFamily') return v;
    const n = type === 'dimension' ? parsePx(v) : type === 'duration' ? parseFloat(v) : Number(v);
    return n === null || !Number.isFinite(n) ? null : n;
  };
  for (const ch of changes) {
    const at = ids[ch.name];
    if (!ch.to) {
      if (at && !at.variableId.startsWith('tmp:'))
        body.variables?.push({ action: 'DELETE', id: at.variableId });
      continue;
    }
    if (!at) continue;
    const col = cols.find((c) => c.id === at.collectionId);
    if (!col) continue;
    // a description is sent when there is one: an empty one here never wipes Figma's
    if (
      ch.kind === 'change' &&
      ch.to.description &&
      ch.to.description !== (ch.from?.description ?? '')
    )
      body.variables?.push({ action: 'UPDATE', id: at.variableId, description: ch.to.description });
    const modes: [string | null, string][] = [
      [col.light, ch.to.light],
      [col.dark, ch.to.dark],
      ...Object.entries(col.themes).map(([t, m]): [string, string] => [
        m,
        ch.to?.themes[t] ?? ch.to?.light ?? '',
      ]),
    ];
    for (const [modeId, v] of modes) {
      if (!modeId) continue;
      const value = valueFor(ch.to.type, v, ch.name);
      if (value === null) {
        if (!skipped.some((s) => s.name === ch.name))
          skipped.push({ name: ch.name, reason: 'its value ' + v + ' has no Figma form' });
        continue;
      }
      body.variableModeValues?.push({ variableId: at.variableId, modeId, value });
    }
  }
  return { body, skipped };
}

/** Components of Figma by the name a component of the inventory would have: a variant counts as its set. */
export function figmaComponentLinks(
  fileKey: string,
  components: readonly FigmaComponent[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of components) {
    const set = c.containing_frame?.containingComponentSet;
    const name = (set?.name ?? c.name).trim();
    const node = set?.nodeId ?? c.node_id;
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key && !out.has(key)) out.set(key, figmaNodeUrl(fileKey, node));
  }
  return out;
}
export const componentKey = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** A snapshot (the last synced state) kept as JSON. */
export const sideToJson = (s: SyncSide): Record<string, SyncToken> => Object.fromEntries(s);
export const sideFromJson = (j: Record<string, SyncToken> | null | undefined): SyncSide =>
  new Map(Object.entries(j ?? {}));
