// ── [PCODE-308 | S15 | v0.1.0] T31.8a Code map by feature, sprint and version, and its time-lapse ──
//    Why:  the code map seen through the work: which folders a feature, a sprint or a version lives in (from
//          the fingerprints), and the map week by week, coloured by what changed (from the Git history),
//          with the sprint that ran then.

const DAY = 86_400_000;

/** The folder of a path at a depth: "server/src/api/x.ts" at 2 is "server/src"; a top-level file is "(root)". */
export function folderAt(path: string, depth: number): string {
  const dirs = path.split('/').slice(0, -1);
  return dirs.length ? dirs.slice(0, Math.max(1, depth)).join('/') : '(root)';
}

/** How much of each folder's lines a set of files makes up, 0 to 1. */
export function folderShares(
  inGroup: ReadonlySet<string>,
  files: readonly { path: string; lines: number }[],
  depth: number,
): Record<string, number> {
  const all: Record<string, number> = {};
  const mine: Record<string, number> = {};
  for (const f of files) {
    const d = folderAt(f.path, depth);
    const w = Math.max(1, f.lines);
    all[d] = (all[d] ?? 0) + w;
    if (inGroup.has(f.path)) mine[d] = (mine[d] ?? 0) + w;
  }
  const out: Record<string, number> = {};
  for (const [d, n] of Object.entries(all)) out[d] = Math.round(((mine[d] ?? 0) / n) * 100) / 100;
  return out;
}

export interface TimelineFrame {
  /** Monday of the week, YYYY-MM-DD */
  start: string;
  commits: number;
  /** changed files per folder */
  changes: Record<string, number>;
  /** the sprint that ran most of that week, if any */
  sprint: string | null;
}

/** Monday 00:00 UTC of the week a time falls in. */
export function weekStart(t: number): number {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY;
}

/** The last `weeks` weeks up to `now`, oldest first, each with what its commits changed. */
export function timelineFrames(
  commits: readonly { at: string; paths: readonly string[] }[],
  sprints: readonly { name: string; start: string | null; end: string | null }[],
  o: { weeks: number; depth: number; now: number },
): TimelineFrame[] {
  const last = weekStart(o.now);
  const frames: TimelineFrame[] = [];
  for (let k = o.weeks - 1; k >= 0; k--) {
    const start = last - k * 7 * DAY;
    const mid = start + 3.5 * DAY;
    const sprint =
      sprints.find(
        (s) => s.start && s.end && Date.parse(s.start) <= mid && mid <= Date.parse(s.end) + DAY,
      )?.name ?? null;
    frames.push({
      start: new Date(start).toISOString().slice(0, 10),
      commits: 0,
      changes: {},
      sprint,
    });
  }
  const first = last - (o.weeks - 1) * 7 * DAY;
  for (const c of commits) {
    const t = Date.parse(c.at);
    if (!Number.isFinite(t) || t < first) continue;
    const f = frames[Math.floor((weekStart(t) - first) / (7 * DAY))];
    if (!f) continue;
    f.commits += 1;
    for (const p of c.paths) {
      const d = folderAt(p, o.depth);
      f.changes[d] = (f.changes[d] ?? 0) + 1;
    }
  }
  return frames;
}

/** A 0–4 step for colouring: none, a little, … the most of the frame. */
export function intensity(n: number, max: number): number {
  if (!n || !max) return 0;
  return Math.max(1, Math.min(4, Math.ceil((n / max) * 4)));
}
