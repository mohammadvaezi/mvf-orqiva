// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-53 | S10 | v0.1.0] Stream build and container logs into the Orqiva Docker output channel ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  `compose logs -f` can run for hours. The channel keeps everything (that is what an output channel
//          is for, and each line is timestamped there); the panel keeps the last 2000 lines and nothing more,
//          so an afternoon of logs cannot grow the extension host. Both sinks see redacted, ANSI-free text.
import { redact } from '../util/redact';

export const PANEL_LINES = 2000;

const ANSI = /[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-PR-TZcf-nqry=><]/g;

/** docker build prints colours and cursor moves; the panel is plain text */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '').replace(/\r/g, '');
}

export function channelLine(line: string, now: Date = new Date()): string {
  return `[${now.toISOString()}] ${line}`;
}

// ── [PCODE-53 | S10 | v0.1.0] LogBuffer: a ring of the last N lines, cleaned once on the way in ──
export class LogBuffer {
  private buffer: string[] = [];
  /** how many lines were ever pushed, so the panel can say what it dropped */
  total = 0;

  constructor(private readonly capacity = PANEL_LINES) {}

  /** cleans (ANSI, secrets), stores and returns the line as both sinks should show it */
  push(raw: string): string {
    const line = redact(stripAnsi(raw));
    this.total += 1;
    this.buffer.push(line);
    if (this.buffer.length > this.capacity)
      this.buffer.splice(0, this.buffer.length - this.capacity);
    return line;
  }

  get lines(): readonly string[] {
    return this.buffer;
  }

  get length(): number {
    return this.buffer.length;
  }

  get dropped(): number {
    return Math.max(0, this.total - this.buffer.length);
  }

  tail(n: number): string[] {
    return this.buffer.slice(-n);
  }

  clear(): void {
    this.buffer = [];
    this.total = 0;
  }
}
