// ── [PCODE-307 | S15 | v0.1.0] T31.7 Environment config diff: variables, secrets, settings, flags and versions side by side ──
//    Why:  two environments side by side: each key is the same, different, or only in one of them. A
//          secret is compared without its value ever leaving the server: only "set" and whether the two
//          values are equal. Keys meant to differ are marked expected; what remains is drift.

export type ConfigArea = 'variable' | 'secret' | 'setting' | 'flag' | 'version';
export type DiffState = 'same' | 'different' | 'only_a' | 'only_b';

export interface ConfigEntry {
  area: ConfigArea;
  name: string;
  /** what is shown; a secret shows "set" */
  shown: string;
  /** what is compared (a secret's keyed hash); equal to shown for everything else */
  compare: string;
}

export interface DiffRow {
  key: string;
  area: ConfigArea;
  name: string;
  a: string | null;
  b: string | null;
  state: DiffState;
  expected: boolean;
}

export const AREA_ORDER: readonly ConfigArea[] = [
  'version',
  'variable',
  'secret',
  'setting',
  'flag',
];

export const keyOf = (area: ConfigArea, name: string): string => area + ':' + name;

/** The settings object as dotted paths to their values: { deploy: { host: 'x' } } → deploy.host = "x". */
export function flattenSettings(v: unknown, prefix = ''): { name: string; value: string }[] {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    return prefix ? [{ name: prefix, value: v === undefined ? 'null' : JSON.stringify(v) }] : [];
  const out: { name: string; value: string }[] = [];
  for (const [k, x] of Object.entries(v as Record<string, unknown>).sort(([p], [q]) =>
    p.localeCompare(q),
  ))
    out.push(...flattenSettings(x, prefix ? prefix + '.' + k : k));
  return out;
}

/** Every key of either environment, in area order then by name. */
export function configDiff(
  a: readonly ConfigEntry[],
  b: readonly ConfigEntry[],
  expected: ReadonlySet<string> = new Set(),
): DiffRow[] {
  const ma = new Map(a.map((e) => [keyOf(e.area, e.name), e]));
  const mb = new Map(b.map((e) => [keyOf(e.area, e.name), e]));
  const keys = [...new Set([...ma.keys(), ...mb.keys()])];
  const rows = keys.map((key): DiffRow => {
    const x = ma.get(key);
    const y = mb.get(key);
    const e = (x ?? y) as ConfigEntry;
    return {
      key,
      area: e.area,
      name: e.name,
      a: x?.shown ?? null,
      b: y?.shown ?? null,
      state: !x ? 'only_b' : !y ? 'only_a' : x.compare === y.compare ? 'same' : 'different',
      expected: expected.has(key),
    };
  });
  return rows.sort(
    (p, q) =>
      AREA_ORDER.indexOf(p.area) - AREA_ORDER.indexOf(q.area) || p.name.localeCompare(q.name),
  );
}

/** The drift in words: differences not marked expected. */
export function driftText(rows: readonly DiffRow[], aName: string, bName: string): string {
  const open = rows.filter((r) => r.state !== 'same' && !r.expected);
  if (!open.length) return 'No drift between ' + aName + ' and ' + bName + '.';
  const n = (s: DiffState): number => open.filter((r) => r.state === s).length;
  const parts = [
    n('only_a') ? String(n('only_a')) + ' only in ' + aName : '',
    n('only_b') ? String(n('only_b')) + ' only in ' + bName : '',
    n('different') ? String(n('different')) + ' different' : '',
  ].filter(Boolean);
  return parts.join(', ') + '.';
}
