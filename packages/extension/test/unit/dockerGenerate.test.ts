// ── [PCODE-52 | S10 | v0.1.0] Generate Dockerfile and compose through a Plane task run by Claude Code ──
//    Why:  creates_task_first - the engine is called in the order new -> start and only then is the terminal
//          opened; an active task refuses the whole thing; the description carries the acceptance lines.
import { beforeEach, describe, expect, it } from 'vitest';
import { EngineCommands } from '../../src/engine/commands';
import {
  claudePrompt,
  generateDockerFiles,
  TASK_TITLE,
  taskDescription,
} from '../../src/release/dockerGenerate';
import type { Services } from '../../src/services';
import { Store } from '../../src/state/store';
import type { ActiveTask } from '../../src/state/types';
import { Logger, resetLoggerForTests } from '../../src/util/log';
import type { TerminalHost, TerminalLike } from '../../src/util/terminal';
import { recorded, resetRecorded } from '../mocks/vscode';

const ACTIVE: ActiveTask = {
  task: 'FIX-2',
  issue_id: 'i',
  title: 'Something else',
  sprint: 'S01',
  sprint_name: 'Sprint 01',
  version: '0.1.0',
  session_id: 's',
  host: 'h',
  started_at: '2026-01-01T00:00:00',
  files: [],
  url: 'https://plane.example.test/i/2/',
};

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

function fakeHost(existing: FakeTerminal[] = []): TerminalHost & { created: FakeTerminal[] } {
  const created = [...existing];
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

function services(opts: { active?: ActiveTask | null; calls?: string[][] } = {}): Services {
  const store = new Store();
  store.state.root = 'C:\\proj';
  store.state.link = {
    project_id: 'p1',
    identifier: 'FIX',
    name: 'Letterman',
    workspace: 'ws',
    version: '0.1.0',
  };
  store.state.active = opts.active ?? null;
  const calls = opts.calls ?? [];
  return {
    store,
    log: new Logger(),
    root: () => 'C:\\proj',
    secrets: { envForEngine: () => Promise.resolve({ PLANE_API_KEY: 'k' }) },
    location: () =>
      Promise.resolve({ home: 'C:\\engine', python: ['py'], versions: {}, problems: [] }),
    engine: new EngineCommands((_script, args) => {
      calls.push(args);
      if (args[0] === 'new')
        return Promise.resolve({
          code: 0,
          stdout:
            'Created FIX-9 Add Dockerfile in Sprint 10 - Docker -> https://plane.example.test/i/9/\n',
          stderr: '',
        });
      return Promise.resolve({
        code: 0,
        stdout:
          'Active: FIX-9 Add Dockerfile  [Backlog -> In Progress]\n' +
          'Fingerprint for every file/block you write: [FIX-9 | S10 | v0.1.0] Add Dockerfile\n',
        stderr: '',
      });
    }),
  } as unknown as Services;
}

const io = (written: { text: string }) => ({
  mkdirSync: () => undefined,
  writeFileSync: (_p: string, d: string) => {
    written.text = d;
  },
  unlinkSync: () => undefined,
});

describe('dockerGenerate', () => {
  beforeEach(() => {
    resetRecorded();
    resetLoggerForTests();
  });

  it('describes the task with its acceptance and prompts Claude with the ref', () => {
    const text = taskDescription('Letterman', 'letterman:0.1.0');
    expect(text).toContain('.plane/architecture.md');
    expect(text).toContain('- [ ] `docker build -t letterman:0.1.0 .` succeeds');
    expect(text).toContain('- [ ] `docker compose up -d` brings every service to healthy');
    expect(text).toContain('- [ ] both files carry the fingerprint of this task');
    expect(claudePrompt('FIX-9')).toBe(
      'Task FIX-9 is active: read .plane/architecture.md and write Dockerfile and docker-compose.yml with fingerprints, then run plane done FIX-9',
    );
  });

  // ── [PCODE-52 | S10 | v0.1.0] creates_task_first ──
  it('calls new, then start, and only then opens Claude Code', async () => {
    const calls: string[][] = [];
    const written = { text: '' };
    const host = fakeHost();
    const r = await generateDockerFiles({
      services: services({ calls }),
      image: 'letterman:0.1.0',
      host,
      claudeCommand: () => 'claude',
      shell: 'cmd', // [PCODE-61 | S12 | v0.1.0] the line is quoted for the shell that will read it
      io: io(written),
    });
    expect(calls[0]?.slice(0, 2)).toEqual(['new', TASK_TITLE]);
    expect(calls[0]).toContain('--sprint');
    expect(calls[0]).toContain('today');
    expect(calls[0]).toContain('chore');
    expect(calls[1]).toEqual(['start', 'FIX-9']);
    expect(calls).toHaveLength(2);
    expect(written.text).toContain('- [ ] both files carry the fingerprint of this task');
    expect(r.ref).toBe('FIX-9');
    const terminal = host.created[0];
    expect(terminal?.name).toBe('Claude Code');
    expect(terminal?.opts.cwd).toBe('C:\\proj');
    expect(terminal?.opts.env['PLANE_CLAUDE_HOME']).toBe('C:\\engine');
    expect(terminal?.sent[0]).toBe(`claude "${claudePrompt('FIX-9')}"`);
    expect(terminal?.shown).toBe(1);
  });

  it('hands the sentence to a session that is already open', async () => {
    const live = new FakeTerminal('Claude Code', { cwd: 'C:\\proj', env: {} });
    const host = fakeHost([live]);
    await generateDockerFiles({
      services: services(),
      image: 'x:1',
      host,
      claudeCommand: () => 'claude',
      io: io({ text: '' }),
    });
    expect(host.created).toHaveLength(1); // reused, not duplicated
    expect(live.sent[0]).toBe(claudePrompt('FIX-9')); // no second `claude` process
  });

  // ── [PCODE-52 | S10 | v0.1.0] one active task at a time ──
  it('refuses while another task is active, before touching the engine', async () => {
    const calls: string[][] = [];
    const host = fakeHost();
    await expect(
      generateDockerFiles({
        services: services({ active: ACTIVE, calls }),
        image: 'x:1',
        host,
        io: io({ text: '' }),
      }),
    ).rejects.toThrow(/Finish or park FIX-2 first/);
    expect(calls).toEqual([]);
    expect(host.created).toHaveLength(0);
  });

  it('refuses in Restricted Mode', async () => {
    recorded.workspaceTrusted = false;
    const calls: string[][] = [];
    await expect(
      generateDockerFiles({
        services: services({ calls }),
        image: 'x:1',
        host: fakeHost(),
        io: io({ text: '' }),
      }),
    ).rejects.toThrow(/Restricted Mode/);
    expect(calls).toEqual([]);
    recorded.workspaceTrusted = true;
  });
});
