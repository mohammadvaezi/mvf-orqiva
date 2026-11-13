// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-32 | S06 | v0.1.0] Run Draft plan in the integrated terminal with the planning prompt ──
//    Why:  placeholder filling with Python's {{ }} escapes, the next-workday start date across a weekend, the
//          refusal on a template description, and a command line that names the prompt file and no secret.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALLOWED_TOOLS,
  buildPrompt,
  draftCommandLine,
  draftPlan,
  fillTemplate,
  nextWorkday,
  PLANNING_TERMINAL,
  startDateFor,
} from '../../src/plan/draft';
import { TEMPLATE_MARKER } from '../../src/plan/planService';
import type { Services } from '../../src/services';
import { Store } from '../../src/state/store';
import type { TerminalHost, TerminalLike } from '../../src/util/terminal';
import { Logger, resetLoggerForTests } from '../../src/util/log';
import { recorded, resetRecorded } from '../mocks/vscode';

const KEY = 'plane_api_draft_key_0123456789';
const TEMPLATE =
  'Project: **{name}** (`{identifier}`). Today is {today}. Start {start_date}.\n```json\n{{\n  "version": "0.1.0", "x": {{ "y": 1 }}\n}}\n```\n';

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

describe('draft (pure)', () => {
  it('fills placeholders like Python str.format, incl. {{ }} escapes', () => {
    expect(fillTemplate('a {name} b {{x}} {identifier}', { name: 'N', identifier: 'ID' })).toBe(
      'a N b {x} ID',
    );
    expect(() => fillTemplate('{nope}', {})).toThrow(/unknown placeholder \{nope\}/);
  });

  // ── [PCODE-32 | S06 | v0.1.0] next working day across a weekend ──
  it('starts the plan on the next working day', () => {
    expect(startDateFor(new Date(2026, 8, 23))).toBe('2026-09-24'); // Wed -> Thu
    expect(startDateFor(new Date(2026, 8, 25))).toBe('2026-09-28'); // Fri -> Mon
    expect(startDateFor(new Date(2026, 8, 26))).toBe('2026-09-28'); // Sat -> Mon
    expect(startDateFor(new Date(2026, 8, 27))).toBe('2026-09-28'); // Sun -> Mon
    expect(nextWorkday(new Date(2026, 8, 26)).getDay()).toBe(1);
  });

  it('builds the prompt the engine would', () => {
    const b = buildPrompt({
      name: 'Letterman',
      identifier: 'LTR',
      template: TEMPLATE,
      today: new Date(2026, 8, 25),
    });
    expect(b.startDate).toBe('2026-09-28');
    expect(b.prompt).toBe(
      'Project: **Letterman** (`LTR`). Today is 2026-09-25. Start 2026-09-28.\n```json\n{\n  "version": "0.1.0", "x": { "y": 1 }\n}\n```\n',
    );
  });

  // the engine's real template, when this machine has the engine: every placeholder resolves, the JSON braces survive
  const realTemplate = path.join(
    process.env['PLANE_CLAUDE_HOME'] ?? '',
    'templates',
    'plan_prompt.md',
  );
  it.skipIf(!process.env['PLANE_CLAUDE_HOME'] || !fs.existsSync(realTemplate))(
    "fills the engine's plan_prompt.md without a leftover placeholder",
    () => {
      const b = buildPrompt({
        name: 'Letterman',
        identifier: 'LTR',
        template: fs.readFileSync(realTemplate, 'utf8'),
        today: new Date(2026, 8, 25),
      });
      expect(b.prompt).toContain('**Letterman** (Plane identifier `LTR`)');
      expect(b.prompt).toContain('starting 2026-09-28');
      expect(b.prompt).not.toMatch(/\{(name|identifier|today|start_date)\}/);
      expect(b.prompt).toContain('"version": "0.1.0"');
      expect(b.prompt).not.toContain('{{');
    },
  );

  it('the command line names the prompt file, the tool list and the task, nothing else', () => {
    // [PCODE-61 | S12 | v0.1.0] the quoting now follows the shell; cmd is the double-quoted one
    const line = draftCommandLine('claude', '.plane/state/plan_prompt.txt', 'cmd');
    expect(line).toBe(
      `claude --permission-mode acceptEdits --allowedTools "${ALLOWED_TOOLS}" --append-system-prompt-file .plane/state/plan_prompt.txt "Plan this project: read .plane/description/ and write the planning files as instructed. Ask me if anything is unclear."`,
    );
    expect(line).not.toMatch(/cmd\.exe|powershell/);
  });
});

describe('draftPlan', () => {
  let tmp = '';
  const services = (): Services => {
    const store = new Store();
    store.load(tmp);
    return {
      log: new Logger(),
      store,
      root: () => tmp,
      location: () =>
        Promise.resolve({ home: 'C:\\engine', python: ['py'], versions: {}, problems: [] }),
      secrets: { envForEngine: () => Promise.resolve({ PLANE_API_KEY: KEY }) },
    } as unknown as Services;
  };
  beforeEach(() => {
    resetRecorded();
    resetLoggerForTests();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-draft-'));
    fs.mkdirSync(path.join(tmp, '.plane', 'description'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.plane', 'project.json'),
      JSON.stringify({ project_id: 'p', identifier: 'LTR', name: 'Letterman', workspace: 'ws' }),
    );
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('refuses while the description is still the template', async () => {
    fs.writeFileSync(
      path.join(tmp, '.plane', 'description', 'description.md'),
      `# X\n${TEMPLATE_MARKER}.`,
    );
    const host = fakeHost();
    await expect(
      draftPlan({ services: services(), host, template: TEMPLATE, claudeCommand: () => 'claude' }),
    ).rejects.toThrow(/Write the description first/);
    expect(host.created).toHaveLength(0);
    expect(fs.existsSync(path.join(tmp, '.plane', 'state', 'plan_prompt.txt'))).toBe(false);
  });

  // ── [PCODE-32 | S06 | v0.1.0] the prompt file has the right start date; the terminal gets the env, not the text ──
  it('writes the prompt file and opens the planning terminal; closing it settles `closed`', async () => {
    fs.writeFileSync(
      path.join(tmp, '.plane', 'description', 'description.md'),
      '# Letterman\nA mail app.',
    );
    const host = fakeHost();
    let closeIt: () => void = () => undefined;
    const r = await draftPlan({
      services: services(),
      host,
      template: TEMPLATE,
      claudeCommand: () => 'claude',
      now: () => new Date(2026, 8, 25),
      waitForClose: () =>
        new Promise((resolve) => {
          closeIt = resolve;
        }),
    });
    expect(r.created).toBe(true);
    expect(r.startDate).toBe('2026-09-28');
    const t = host.created[0];
    expect(t?.name).toBe(PLANNING_TERMINAL);
    expect(t?.opts.cwd).toBe(tmp);
    expect(t?.opts.env['PLANE_API_KEY']).toBe(KEY);
    expect(t?.opts.env['PLANE_CLAUDE_HOME']).toBe('C:\\engine');
    expect(t?.sent[0]).toContain('--append-system-prompt-file .plane/state/plan_prompt.txt');
    expect(t?.sent.join('\n')).not.toContain(KEY);
    const prompt = fs.readFileSync(r.promptFile, 'utf8');
    expect(prompt).toContain('Start 2026-09-28.');
    expect(prompt).toContain('**Letterman** (`LTR`)');
    expect(prompt).not.toContain(KEY);
    let settled = false;
    void r.closed.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    closeIt();
    await r.closed;
    expect(settled).toBe(true);
    // a second Draft while the terminal lives reveals it and sends nothing new
    const again = await draftPlan({
      services: services(),
      host,
      template: TEMPLATE,
      claudeCommand: () => 'claude',
      waitForClose: () => Promise.resolve(),
    });
    expect(again.created).toBe(false);
    expect(t?.sent).toHaveLength(1);
    expect(t?.shown).toBe(2);
    expect(recorded.errorMessages).toEqual([]);
  });
});
