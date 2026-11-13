// ── [PCODE-136 | S15 | v0.1.0] Stream test results from a running suite and import JUnit ──
//    Why:  TAP is the one test output most runners can write as they go (vitest --reporter=tap-flat,
//          node --test, Perl, Bats, many more), one line per test, so a result can be sent the moment its
//          line appears. This reader takes lines one at a time, follows TAP 14's indented subtests, reports
//          only real tests (not the suites around them) and reads the YAML block after a failure.

export interface TestResult {
  /** the test's path, "file > suite > test" */
  key: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs?: number;
  message?: string;
}

const POINT = /^(not ok|ok)\b\s*(\d+)?\s*(?:-\s*)?(.*?)\s*(?:#\s*(SKIP|TODO)\b(.*))?$/i;
const SUBTEST = /^#\s*Subtest:\s*(.*)$/;

interface Pending {
  depth: number;
  result: TestResult;
  yaml: string[] | null;
}

/** Reads TAP a line at a time and calls onResult for each finished test. */
export class TapReader {
  /** names of the subtests open at each depth */
  private readonly path: string[] = [];
  /** depths that saw test points inside them since their own last point */
  private readonly hadChildren = new Set<number>();
  private pending: Pending | null = null;

  constructor(private readonly onResult: (r: TestResult) => void) {}

  line(raw: string): void {
    const text = raw.replace(/\r$/, '');
    const indent = /^ */.exec(text)?.[0].length ?? 0;
    const depth = Math.floor(indent / 4);
    const body = text.trim();
    // the YAML block of the last test point
    if (this.pending?.yaml) {
      if (body === '...') {
        this.applyYaml(this.pending);
        this.pending.yaml = null;
        this.flush();
        return;
      }
      this.pending.yaml.push(text.slice((this.pending.depth + 1) * 4 - 2));
      return;
    }
    if (body === '---' && this.pending && depth >= this.pending.depth) {
      this.pending.yaml = [];
      return;
    }
    const sub = SUBTEST.exec(body);
    if (sub) {
      this.flush();
      this.path[depth] = (sub[1] ?? '').trim();
      this.path.length = depth + 1;
      return;
    }
    const m = POINT.exec(body);
    if (!m) return;
    this.flush();
    const directive = (m[4] ?? '').toUpperCase();
    const name = (m[3] ?? '').trim() || 'test ' + (m[2] ?? '?');
    // a point that closes subtests is their suite, not a test
    if (this.hadChildren.has(depth + 1)) {
      this.hadChildren.delete(depth + 1);
      this.hadChildren.add(depth);
      this.path.length = depth;
      return;
    }
    this.hadChildren.add(depth);
    const parents = this.path.slice(0, depth).filter(Boolean);
    const key = [...parents, name].join(' > ');
    const result: TestResult = {
      key,
      status:
        directive === 'SKIP' || directive === 'TODO'
          ? 'skipped'
          : m[1]?.toLowerCase() === 'ok'
            ? 'passed'
            : 'failed',
    };
    this.pending = { depth, result, yaml: null };
  }

  /** Call when the output has ended. */
  end(): void {
    if (this.pending?.yaml) this.applyYaml(this.pending);
    this.flush();
  }

  private flush(): void {
    if (!this.pending) return;
    const p = this.pending;
    this.pending = null;
    this.onResult(p.result);
  }

  private applyYaml(p: Pending): void {
    const yaml = p.yaml ?? [];
    const indentOf = (l: string): number => /^ */.exec(l)?.[0].length ?? 0;
    // a field anywhere in the block (error.message too); a block scalar takes the deeper lines after it
    const field = (name: string): string | undefined => {
      const at = yaml.findIndex((l) => l.trim().startsWith(name + ':'));
      if (at < 0) return undefined;
      const line = yaml[at] ?? '';
      const first = line
        .trim()
        .slice(name.length + 1)
        .trim();
      if (first && first !== '|-' && first !== '|' && first !== '>' && first !== '>-')
        return first.replace(/^['"]|['"]$/g, '');
      const lines: string[] = [];
      for (const l of yaml.slice(at + 1)) {
        if (l.trim() && indentOf(l) <= indentOf(line)) break;
        lines.push(l.trim());
      }
      return lines.join('\n').trim() || undefined;
    };
    const ms = field('duration_ms');
    if (ms !== undefined && Number.isFinite(Number(ms)))
      p.result.durationMs = Math.round(Number(ms));
    const message = field('message') ?? field('error');
    if (message && p.result.status === 'failed') p.result.message = message.slice(0, 20_000);
  }
}

/** All results of a finished TAP text, for tests and imports. */
export function readTap(text: string): TestResult[] {
  const out: TestResult[] = [];
  const r = new TapReader((x) => out.push(x));
  for (const line of text.split('\n')) r.line(line);
  r.end();
  return out;
}
