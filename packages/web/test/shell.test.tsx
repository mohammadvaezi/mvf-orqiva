// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-90 | S15 | v0.1.0] Build the web app shell with login and the ported design system ──
// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
//    Why:  the screens render to real HTML (react-dom/server, no browser needed); the theme defines every
//          colour for light and dark; server errors land on the right fields.
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { api, fieldErrors } from '../src/core/api.js';
import { LoginScreen, SignupScreen, validateLogin, validateSignup } from '../src/screens.js';
import { appTitle } from '../src/title.js';
import { AppShell } from '../src/shell.js';

const nothing = (): Promise<null> => Promise.resolve(null);
const noop = (): void => undefined;

describe('screens', () => {
  it('sign-in: email, password, one primary action, a way to sign up', () => {
    const html = renderToString(<LoginScreen onLogin={nothing} onGoSignup={noop} />);
    expect(html).toContain('for="email"');
    expect(html).toContain('current-password');
    expect(html).toContain('>Sign in</button>');
    expect(html).toContain('Create an account');
    expect(html).not.toContain('company account');
  });

  it('sign-in offers company login only when the server has it', () => {
    expect(renderToString(<LoginScreen onLogin={nothing} onGoSignup={noop} sso />)).toContain(
      'href="/auth/oidc/start"',
    );
  });

  it('sign-up asks for name, work email, password and workspace', () => {
    const html = renderToString(<SignupScreen onSignup={nothing} onGoLogin={noop} />);
    for (const id of ['name', 'email', 'password', 'workspaceName'])
      expect(html).toContain('id="' + id + '"');
    expect(html).toContain('>Create account</button>');
  });

  // [PCODE-113 | S15 | v0.1.0] the shell: top bar, sidebar with the open project's pages, content
  const shell = (role: string, extra: Partial<Parameters<typeof AppShell>[0]> = {}): string =>
    renderToString(
      <AppShell
        me={{ user: { id: 'u', email: 'ada@example.com', name: 'Ada Lovelace' }, workspaces: [] }}
        workspaceName="Analytical Engines"
        role={role}
        route={{ kind: 'project', id: 'p1', view: 'board' }}
        projects={[
          { id: 'p1', key: 'APP', name: 'The App' },
          { id: 'p2', key: 'OPS', name: 'Operations' },
        ]}
        currentProjectId="p1"
        online={false}
        pending={2}
        people={[]}
        theme="dark"
        onTheme={noop}
        onLogout={noop}
        onSearch={noop}
        onNewTask={noop}
        go={noop}
        {...extra}
      >
        <p>page</p>
      </AppShell>,
    );

  it('shell: workspace, search, connection state, account menu, navigation and the page', () => {
    const html = shell('member');
    expect(html).toContain('Analytical Engines');
    expect(html).toContain('Search tasks, projects and commands');
    expect(html).toContain('Offline · 2 waiting');
    expect(html).toContain('aria-label="Account: Ada Lovelace"');
    for (const label of ['Home', 'My work', 'Activity', 'Settings', 'New task'])
      expect(html).toContain('>' + label + '</span>');
    expect(html).toContain('<p>page</p>');
    expect(html).toContain('href="#pe-content"');
  });

  it('shell: the open project shows its pages with the current one marked; guests get no New task', () => {
    const html = shell('member');
    expect(html).toMatch(
      /href="\/projects\/p1\/board" class="pe-nav-item pe-nav-item--nested" aria-current="page"/,
    );
    expect(html).toContain('href="/projects/p1/git"');
    expect(html).toContain('href="/projects/p2"');
    expect(shell('guest')).not.toContain('New task');
  });

  it('titles the window with product and version', () => {
    expect(appTitle()).toBe('Orqiva 0.1.0');
  });
});

describe('form checks', () => {
  it('ask for what is missing before anything is sent', () => {
    expect(validateLogin('', '')).toEqual({
      email: 'Enter your email address.',
      password: 'Enter your password.',
    });
    expect(
      Object.keys(validateSignup({ name: '', email: 'x', password: 'short', workspaceName: '' })),
    ).toEqual(['name', 'email', 'password', 'workspaceName']);
    expect(
      validateSignup({
        name: 'Ada',
        email: 'ada@example.com',
        password: 'long enough pw',
        workspaceName: 'AE',
      }),
    ).toEqual({});
  });
});

describe('api client', () => {
  const reply =
    (status: number, body: unknown): typeof fetch =>
    () =>
      Promise.resolve(new Response(JSON.stringify(body), { status }));

  it('returns data on success and the server error shape on failure', async () => {
    expect(await api('GET', '/x', undefined, reply(200, { a: 1 }))).toEqual({
      ok: true,
      data: { a: 1 },
    });
    const r = await api(
      'POST',
      '/x',
      {},
      reply(400, {
        error: {
          code: 'invalid_request',
          message: 'bad',
          details: [{ path: 'body.email', message: 'must be a valid email' }],
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(fieldErrors(r.error)).toEqual({ email: 'Must be a valid email.' });
  });

  it('reports a network failure in words a person can act on', async () => {
    const r = await api('GET', '/x', undefined, () =>
      Promise.reject(new TypeError('fetch failed')),
    );
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: 'network',
        message: expect.stringContaining('Cannot reach the server') as unknown,
      },
    });
  });
});

describe('theme', () => {
  const css = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
  const block = (selector: string): string => {
    const at = css.indexOf(selector + ' {');
    return css.slice(at, css.indexOf('}', at));
  };
  const tokens = (text: string): string[] =>
    [...text.matchAll(/(--pe-[a-z0-9-]+):/g)].map((m) => m[1] ?? '').sort();

  it('defines every colour of the light theme again for dark, in both dark selectors', () => {
    // [PCODE-113 | S15 | v0.1.0] layout sizes (top bar, sidebar, rail) are not colours
    const light = tokens(block(':root')).filter(
      (t) => !/space|radius|font|state|topbar|sidebar|rail/.test(t),
    );
    expect(light.length).toBeGreaterThan(10);
    expect(tokens(block(":root[data-theme='dark']"))).toEqual(light);
    expect(tokens(block(":root:not([data-theme='light'])"))).toEqual(light);
  });

  it('uses tokens, not raw colours, outside the token blocks', () => {
    const rules = css.slice(css.indexOf('*,'));
    expect(rules.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
  });
});
