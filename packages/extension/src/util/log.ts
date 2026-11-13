// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-2 | S01 | v0.1.0] Add the output channel logger with secret redaction ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/f53f2b89-534f-4247-aa0f-9daaee1ed961/
//    Why:  one OutputChannel "Orqiva" for the whole extension; every line passes redact() first.
import * as vscode from 'vscode';
import { redact } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// ── [PCODE-2 | S01 | v0.1.0] Logger: timestamped, levelled, redacted lines on one channel ──
export class Logger implements vscode.Disposable {
  private readonly channel: vscode.OutputChannel;
  private minimum: LogLevel = 'info';

  constructor(name = 'Orqiva') {
    this.channel = vscode.window.createOutputChannel(name);
  }

  setLevel(level: LogLevel): void {
    this.minimum = level;
  }

  debug(message: string, ...details: unknown[]): void {
    this.write('debug', message, details);
  }

  info(message: string, ...details: unknown[]): void {
    this.write('info', message, details);
  }

  warn(message: string, ...details: unknown[]): void {
    this.write('warn', message, details);
  }

  error(message: string, ...details: unknown[]): void {
    this.write('error', message, details);
  }

  /** Used by the "Open output" button of error notifications. */
  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }

  // ── [PCODE-2 | S01 | v0.1.0] write: the single choke point - formats, redacts, appends ──
  private write(level: LogLevel, message: string, details: unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minimum]) return;
    const extra = details.length ? ' ' + details.map(formatDetail).join(' ') : '';
    const line = `[${new Date().toISOString()}] [${level.toUpperCase().padEnd(5)}] ${message}${extra}`;
    this.channel.appendLine(redact(line));
  }
}

function formatDetail(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

let shared: Logger | undefined;

// ── [PCODE-2 | S01 | v0.1.0] getLogger: lazy shared instance; activate() owns disposal ──
export function getLogger(): Logger {
  shared ??= new Logger();
  return shared;
}

export function resetLoggerForTests(): void {
  shared?.dispose();
  shared = undefined;
}
