// ── [PCODE-33 | S06 | v0.1.0] Validate plan.json with plane_plan.py check and show errors before Publish ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the engine names an error's place as "sprint N[ item M]: …"; the panel turns that into a click that
//          opens plan.json at the sprint's name or the item's title (a plain text search, no JSON AST), and a
//          debounced re-check keeps validity visible while the file is being edited.

export interface CheckError {
  raw: string;
  sprint: number | null;
  item: number | null;
  message: string;
}

// ── [PCODE-33 | S06 | v0.1.0] parseCheckError: "sprint 2 item 3: no acceptance checks" -> {2, 3, "no acceptance checks"} ──
export function parseCheckError(line: string): CheckError {
  const m = /^sprint (\d+)(?: item (\d+))?:\s*(.*)$/.exec(line.trim());
  if (!m) return { raw: line, sprint: null, item: null, message: line.trim() };
  return {
    raw: line,
    sprint: Number(m[1]),
    item: m[2] === undefined ? null : Number(m[2]),
    message: m[3] ?? '',
  };
}

export function describeLocation(e: CheckError): string {
  if (e.sprint === null) return '';
  return e.item === null
    ? `Sprint ${String(e.sprint)}`
    : `Sprint ${String(e.sprint)}, item ${String(e.item)}`;
}

interface LoosePlan {
  sprints?: { name?: unknown; items?: { title?: unknown }[] }[];
}

// ── [PCODE-33 | S06 | v0.1.0] locateInPlan: the 1-based line of the named sprint (or item title) in plan.json ──
export function locateInPlan(planText: string, e: CheckError): number | null {
  if (e.sprint === null) return null;
  let plan: LoosePlan;
  try {
    plan = JSON.parse(planText) as LoosePlan;
  } catch {
    return null;
  }
  const sprint = plan.sprints?.[e.sprint - 1];
  if (!sprint) return null;
  const needle =
    e.item === null
      ? typeof sprint.name === 'string'
        ? sprint.name
        : null
      : typeof sprint.items?.[e.item - 1]?.title === 'string'
        ? (sprint.items[e.item - 1]?.title as string)
        : null;
  if (!needle) return null;
  const lines = planText.split(/\r?\n/);
  const escaped = JSON.stringify(needle).slice(1, -1); // as it appears in the file
  const idx = lines.findIndex((l) => l.includes(escaped));
  return idx === -1 ? null : idx + 1;
}

// ── [PCODE-33 | S06 | v0.1.0] Debounce: many change events, one re-check after `ms` of quiet ──
export class Debounce {
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private readonly ms: number,
    private readonly fn: () => void,
  ) {}
  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fn();
    }, this.ms);
  }
  get pending(): boolean {
    return this.timer !== null;
  }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
