// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-103 | S15 | v0.1.0] Build the CLI `orq` and the Claude Code hooks against the new server ──
//    Why:  `orq login` asks for the password on the terminal without showing it; the password only travels
//          to the server once, to get a personal token, and is never stored.
export function readSecret(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) return Promise.resolve('');
  process.stdout.write(prompt);
  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');
  return new Promise((done) => {
    let value = '';
    const finish = (): void => {
      input.setRawMode(false);
      input.pause();
      input.off('data', onData);
      process.stdout.write('\n');
      done(value);
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish();
          return;
        }
        if (ch === '\u0003') {
          value = '';
          finish();
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    input.on('data', onData);
  });
}
