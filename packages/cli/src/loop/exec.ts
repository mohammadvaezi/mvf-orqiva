// ── [PCODE-436 | S15 | v0.1.0] T37 low: Untangle the three folder import cycles ──
//    Why:  how the CLI runs a program, shared by the loop and the installer; it lives here so the loop
//          never has to import the installer (which already imports the loop).

export interface ExecResult {
  code: number;
  out: string;
}

export type Exec = (cmd: string, args: string[], cwd: string) => Promise<ExecResult>;
