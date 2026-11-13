// ── [PCODE-465 | S15 | v0.1.0] Build with Claude works in every Windows shell: the task prompt goes through a file ──
// ── [PCODE-16 | S03 | v0.1.0] Add the Start development command opening Claude Code in the integrated terminal ──
//    Why:  reuse by name, cwd = root, env carries the key, the sent command text never does.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { startDevelopment, taskPrompt } from '../../src/commands/devCommands';
import type { Services } from '../../src/services';
import {
  commandLine,
  detectShell,
  openOrReuse,
  quoteArg,
  type TerminalHost,
  type TerminalLike,
} from '../../src/util/terminal';
import { ALLOWED_TOOLS, DRAFT_TASK, draftCommandLine } from '../../src/plan/draft';
import { claudePrompt } from '../../src/release/dockerGenerate';

class FakeTerminal implements TerminalLike {
  sent: string[] = [];
  shown = 0;
  exitStatus: unknown = undefined;
  constructor(
    public name: string,
    public opts: { cwd: string; env: Record<string, string> },
  ) {}
  sendText(text: string): void {
    this.sent.push(text);
  }
  show(): void {
    this.shown++;
  }
}

function fakeHost(): TerminalHost & { created: FakeTerminal[] } {
  const created: FakeTerminal[] = [];
  return {
    created,
    get terminals() {
      return created;
    },
    createTerminal(o) {
      const t = new FakeTerminal(o.name, { cwd: o.cwd, env: o.env });
      created.push(t);
      return t;
    },
  };
}

const services = (): Services =>
  ({
    root: () => 'C:\\Broszio Apps\\proj',
    secrets: {
      envForEngine: () =>
        Promise.resolve({
          PLANE_API_KEY: 'plane_api_secret_9',
          PLANE_BASE_URL: 'https://p',
          PLANE_WORKSPACE_SLUG: 'ws',
        }),
    },
    location: () =>
      Promise.resolve({
        home: 'C:\\Tools\\engine',
        python: ['py', '-3'],
        versions: {},
        problems: [],
      }),
  }) as unknown as Services;

describe('startDevelopment', () => {
  // ── [PCODE-16 | S03 | v0.1.0] first click creates and sends `claude`; second click only reveals ──
  it('creates the terminal in the root with the engine env, then reuses it', async () => {
    const host = fakeHost();
    const r1 = await startDevelopment({
      services: services(),
      host,
      claudeCommand: () => 'claude',
    });
    expect(r1?.created).toBe(true);
    const t = host.created[0];
    expect(t?.opts.cwd).toBe('C:\\Broszio Apps\\proj');
    expect(t?.opts.env['PLANE_API_KEY']).toBe('plane_api_secret_9');
    expect(t?.opts.env['PLANE_CLAUDE_HOME']).toBe('C:\\Tools\\engine');
    expect(t?.sent).toEqual(['claude']);
    expect(t?.sent.join(' ')).not.toContain('plane_api');
    const r2 = await startDevelopment({
      services: services(),
      host,
      claudeCommand: () => 'claude',
    });
    expect(r2?.created).toBe(false);
    expect(host.created).toHaveLength(1);
    expect(t?.sent).toEqual(['claude']);
    expect(t?.shown).toBe(2);
  });

  it('opens a fresh terminal when the old one has exited, and does nothing without a root', async () => {
    const host = fakeHost();
    openOrReuse(host, { name: 'Claude Code', cwd: 'C:\\p', env: { A: '1', B: undefined } });
    expect(host.created[0]?.opts.env).toEqual({ A: '1' });
    if (host.created[0]) host.created[0].exitStatus = { code: 0 };
    const again = openOrReuse(host, { name: 'Claude Code', cwd: 'C:\\p', env: {} });
    expect(again.created).toBe(true);
    const none = await startDevelopment({
      services: { ...services(), root: () => null } as unknown as Services,
      host,
    });
    expect(none).toBeUndefined();
  });
});

// ── [PCODE-61 | S12 | v0.1.0] Harden engine spawning for paths with spaces and non-Windows shells ──
//    Why:  the terminal is the one place the extension hands out a command *line* instead of an argv array,
//          so the quoting is ours. Each shell reads a different set of characters, and the sentence we send
//          Claude Code contains most of them.
describe('quoting_per_shell', () => {
  it('reads the shell from its executable, not from the platform', () => {
    expect(detectShell('/bin/bash', 'linux')).toBe('posix');
    expect(detectShell('/bin/zsh', 'darwin')).toBe('posix');
    expect(detectShell('/usr/bin/fish', 'linux')).toBe('posix');
    // a Windows machine is very often on Git Bash or WSL
    expect(detectShell(String.raw`C:\Program Files\Git\bin\bash.exe`, 'win32')).toBe('posix');
    expect(detectShell(String.raw`C:\Windows\System32\cmd.exe`, 'win32')).toBe('cmd');
    expect(
      detectShell(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, 'win32'),
    ).toBe('powershell');
    // and a Mac can perfectly well be on pwsh
    expect(detectShell('/usr/local/bin/pwsh', 'darwin')).toBe('powershell');
    // nothing to go on: the platform decides
    expect(detectShell(undefined, 'win32')).toBe('powershell');
    expect(detectShell('', 'darwin')).toBe('posix');
  });

  it('quotes one argument the way each shell reads it', () => {
    const value = `Task PCODE-61 is active: read $HOME/x "now" & do it`;
    expect(quoteArg(value, 'posix')).toBe(`'Task PCODE-61 is active: read $HOME/x "now" & do it'`);
    expect(quoteArg(value, 'powershell')).toBe(
      `'Task PCODE-61 is active: read $HOME/x "now" & do it'`,
    );
    expect(quoteArg(value, 'cmd')).toBe(`"Task PCODE-61 is active: read $HOME/x ""now"" & do it"`);
  });

  it('escapes the quote character each shell would otherwise end the string on', () => {
    expect(quoteArg("it's", 'posix')).toBe(String.raw`'it'\''s'`);
    expect(quoteArg("it's", 'powershell')).toBe(`'it''s'`);
    expect(quoteArg('say "hi"', 'cmd')).toBe('"say ""hi"""');
    // cmd expands %VAR% even inside double quotes
    expect(quoteArg('100%', 'cmd')).toBe('"100%%"');
  });

  it('leaves a plain word alone and quotes a path with a space', () => {
    for (const shell of ['posix', 'powershell', 'cmd'] as const) {
      expect(commandLine('claude', ['--version'], shell)).toBe('claude --version');
      expect(commandLine('claude', ['.plane/state/plan_prompt.txt'], shell)).toBe(
        'claude .plane/state/plan_prompt.txt',
      );
    }
    expect(commandLine('claude', [String.raw`C:\Prüf Ordner\x.txt`], 'powershell')).toBe(
      String.raw`claude 'C:\Prüf Ordner\x.txt'`,
    );
    expect(commandLine('claude', ['/home/u/Prüf Ordner/x.txt'], 'posix')).toBe(
      `claude '/home/u/Prüf Ordner/x.txt'`,
    );
  });

  it('calls a quoted command through the call operator in PowerShell only', () => {
    const exe = String.raw`C:\Program Files\claude\claude.cmd`;
    expect(commandLine(exe, [], 'powershell')).toBe(
      String.raw`& 'C:\Program Files\claude\claude.cmd'`,
    );
    expect(commandLine(exe, [], 'cmd')).toBe(String.raw`"C:\Program Files\claude\claude.cmd"`);
    expect(commandLine('/opt/my tools/claude', [], 'posix')).toBe(`'/opt/my tools/claude'`);
  });

  // ── [PCODE-61 | S12 | v0.1.0] the two lines the extension actually sends ──
  it('builds the draft line for every shell', () => {
    const posix = draftCommandLine('claude', '.plane/state/plan_prompt.txt', 'posix');
    expect(posix).toContain(`--allowedTools '${ALLOWED_TOOLS}'`);
    expect(posix.endsWith(`'${DRAFT_TASK}'`)).toBe(true);
    expect(posix).toContain('--append-system-prompt-file .plane/state/plan_prompt.txt');

    const ps = draftCommandLine('claude', '.plane/state/plan_prompt.txt', 'powershell');
    expect(ps.endsWith(`'${DRAFT_TASK}'`)).toBe(true);

    const cmd = draftCommandLine('claude', '.plane/state/plan_prompt.txt', 'cmd');
    expect(cmd).toContain(`--allowedTools "${ALLOWED_TOOLS}"`);
    expect(cmd.endsWith(`"${DRAFT_TASK}"`)).toBe(true);
    // whichever shell, the task arrives as one argument
    for (const line of [posix, ps, cmd])
      expect(line.split('claude ')[1]?.length).toBeGreaterThan(0);
  });

  it('builds the docker prompt line for every shell', () => {
    const prompt = claudePrompt('PCODE-61');
    expect(commandLine('claude', [prompt], 'posix')).toBe(`claude '${prompt}'`);
    expect(commandLine('claude', [prompt], 'powershell')).toBe(`claude '${prompt}'`);
    expect(commandLine('claude', [prompt], 'cmd')).toBe(`claude "${prompt}"`);
  });
});

// ── [PCODE-78 | S08 | v0.1.0] Build with Claude: the task as the first prompt, in a terminal of its own ──
describe('startDevelopment with a task prompt', () => {
  // [PCODE-465 | S15 | v0.1.0] the prompt through a file: cmd.exe never sees its quotes and pipes
  it('starts Claude in a terminal named after the task, with the prompt in a file', async () => {
    const host = fakeHost();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-prompt-'));
    fs.mkdirSync(path.join(tmp, '.orqiva'));
    fs.writeFileSync(path.join(tmp, '.orqiva', 'project.json'), '{}');
    const text = taskPrompt(
      'PCODE-7',
      "Fix the user's  login\n page",
      'node "C:/Orqiva/bin/orq.mjs"',
      '[PCODE-7 | S01 | v0.1.0] Fix the login',
    );
    await startDevelopment({
      services: { ...services(), root: () => tmp } as Services,
      host,
      claudeCommand: () => 'claude',
      prompt: { text, terminal: 'Claude Code · PCODE-7' },
      shell: 'powershell',
    });
    const t = host.created[0];
    expect(t?.name).toBe('Claude Code · PCODE-7');
    expect(t?.sent).toEqual([
      `claude ${quoteArg('Read .orqiva/state/prompts/PCODE-7.md and do what it says.', 'powershell')}`,
    ]);
    expect(t?.sent.join('')).not.toMatch(/["|&%]/);
    expect(
      fs.readFileSync(path.join(tmp, '.orqiva', 'state', 'prompts', 'PCODE-7.md'), 'utf8'),
    ).toBe(text + '\n');
    fs.rmSync(tmp, { recursive: true, force: true });
    expect(text).toContain("Fix the user's login page");
    expect(text).not.toContain('\n');
    expect(t?.sent.join(' ')).not.toContain('plane_api');
  });

  it('never types the prompt into a terminal that was already open', async () => {
    const host = fakeHost();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-prompt-'));
    const deps = {
      services: { ...services(), root: () => tmp } as Services,
      host,
      claudeCommand: () => 'claude',
      prompt: { text: taskPrompt('PCODE-7', 'x'), terminal: 'Claude Code · PCODE-7' },
      shell: 'posix' as const,
    };
    await startDevelopment(deps);
    const again = await startDevelopment(deps);
    expect(again?.created).toBe(false);
    expect(host.created[0]?.sent).toHaveLength(1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
