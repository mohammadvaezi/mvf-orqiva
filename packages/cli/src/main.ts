#!/usr/bin/env node
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-84 | S08 | v0.1.0] Set up the platform monorepo with npm workspaces, own build scripts and CI ──
// ── [PCODE-103 | S15 | v0.1.0] Build the CLI `orq` and the Claude Code hooks against the new server ──
// [PCODE-192 | S15 | v0.1.0] PRODENGINE_* variables first become ORQIVA_*
import './legacyenv.js';
import { readStdin } from './loop/hooks.js';
import { readSecret } from './loop/secret.js';
import { run } from './run.js';

// [PCODE-91 | S15 | v0.1.0] commands may run for minutes (install), so the runner is async
// [PCODE-103 | S15 | v0.1.0] a hook reads its JSON from stdin and prints only what Claude Code reads
const result = await run(process.argv.slice(2), { stdin: readStdin, loop: { readSecret } });
if (result.out) (result.code === 0 ? process.stdout : process.stderr).write(result.out + '\n');
process.exitCode = result.code;
