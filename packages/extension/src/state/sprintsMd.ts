// ── [PCODE-11 | S02 | v0.1.0] Add the state store with a .plane file watcher and change events ──
// ── [PCODE-18 | S03 | v0.1.0] Show the board offline from sprints.md when Plane is unreachable ──
//    Why:  `.plane/sprints.md` is the engine's mirror of the board; parsing it gives an offline board on
//          activation before any network call (architecture.md: activate() never touches the network).
export interface SprintsMdItem {
  ref: string;
  title: string;
  state: string;
  priority: string;
  done: boolean;
}

export interface SprintsMdSprint {
  name: string;
  code: string;
  date: string;
  goal: string;
  isToday: boolean;
  done: number;
  total: number;
  items: SprintsMdItem[];
}

const HEAD = /^##\s+(.*?)\s+\((\d{4}-\d{2}-\d{2})\)\s+[—-]+\s+(\d+)\/(\d+) done(.*)$/;
const ITEM = /^-\s+\[( |x)\]\s+([A-Z]{2,5}-\d+)\s+(.*?)\s+[—-]\s+(.*?)\s+\(([^)]*)\)\s*$/;

// ── [PCODE-11 | S02 | v0.1.0] sprintCode: "Sprint 03 - Foo" -> S03, like plane_task.sprint_code ──
export function sprintCode(name: string): string {
  const m = /^\D*(\d+)/.exec(name);
  return m?.[1] ? `S${m[1].padStart(2, '0')}` : name.slice(0, 12);
}

// ── [PCODE-11 | S02 | v0.1.0] parseSprintsMd: "## name (date) — d/t done [← today]" + "- [x] REF Title — State (prio)" ──
export function parseSprintsMd(text: string): SprintsMdSprint[] {
  const out: SprintsMdSprint[] = [];
  let cur: SprintsMdSprint | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = HEAD.exec(line);
    if (h?.[1] && h[2]) {
      cur = {
        name: h[1],
        code: sprintCode(h[1]),
        date: h[2],
        goal: '',
        isToday: /today/.test(h[5] ?? ''), // [PCODE-18 | S03 | v0.1.0] both '← today' and '<- today'
        done: Number(h[3]),
        total: Number(h[4]),
        items: [],
      };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const goal = /^_(.*)_$/.exec(line);
    if (goal?.[1] !== undefined && !cur.items.length) {
      cur.goal = goal[1];
      continue;
    }
    const it = ITEM.exec(line);
    if (it?.[2] && it[3] !== undefined && it[4] !== undefined) {
      cur.items.push({
        ref: it[2],
        title: it[3],
        state: it[4],
        priority: it[5] ?? '-',
        done: it[1] === 'x',
      });
    }
  }
  return out;
}
