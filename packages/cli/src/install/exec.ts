// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-91 | S15 | v0.1.0] Package the server as a Docker Compose install started by `orq install` ──
//    Why:  runs a program with an argument list, never through a shell, so a path with spaces or quotes
//          cannot change the command. Output is collected for error messages.
import { spawn } from 'node:child_process';
import type { Exec } from './install.js';

export const spawnExec: Exec = (cmd, args, cwd) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', (err) => {
      resolve({ code: 127, out: err.message });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, out });
    });
  });
