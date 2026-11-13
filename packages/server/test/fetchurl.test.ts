// ── [PCODE-247 | S15 | v0.1.0] T25.2 Agent scopes enforced: files, branches, network, trace redaction ──
//    Why:  the one tool that reaches outside: only hosts in the network scope, https only, public addresses
//          only, every redirect checked again, text only, the size cut.
import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { htmlText, runTool, type ToolContext } from '../src/agents/tools.js';

const ctx = (fetchImpl: typeof fetch, network: string[] = ['docs.example.com']): ToolContext => ({
  c: {} as PoolClient,
  access: {
    user: { id: 'u', name: 'U', email: 'u@example.test' },
    workspaceId: 'w',
    role: 'member',
  },
  actor: { kind: 'agent', id: 'a', name: 'Coder' },
  scope: { network },
  agentName: 'Coder',
  fetchImpl,
  isPublic: (url) => Promise.resolve(!url.includes('internal')),
});
const page = (
  body: string,
  type = 'text/html',
  status = 200,
  headers: Record<string, string> = {},
) => new Response(body, { status, headers: { 'content-type': type, ...headers } });

describe('fetch_url', () => {
  it('reads a page on a host in the scope, as text', async () => {
    const seen: string[] = [];
    const r = await runTool(
      'fetch_url',
      { url: 'https://docs.example.com/api' },
      ctx((url) => {
        seen.push(url instanceof Request ? url.url : url.toString());
        return Promise.resolve(
          page('<html><style>x{}</style><h1>Bookings</h1><p>Use &lt;GET&gt; /v2</p></html>'),
        );
      }),
    );
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.content)).toMatchObject({
      status: 200,
      contentType: 'text/html',
      text: 'Bookings\nUse <GET> /v2',
      truncated: false,
    });
    expect(seen).toEqual(['https://docs.example.com/api']);
  });

  it('refuses hosts outside the scope, plain http, private addresses and non-text', async () => {
    const never = (): Promise<Response> => Promise.reject(new Error('must not be called'));
    const refused = async (url: string, c = ctx(never)) =>
      (await runTool('fetch_url', { url }, c)).content;
    expect(await refused('https://evil.example.org/')).toBe(
      "Refused: evil.example.org is outside Coder's network scope (docs.example.com)",
    );
    expect(await refused('https://docs.example.com/', ctx(never, []))).toBe(
      'Refused: Coder may reach no host: its network scope is empty',
    );
    expect(await refused('http://docs.example.com/')).toBe('Only https addresses are read');
    expect(await refused('not a url')).toBe('That is not a web address');
    expect(await refused('https://x.internal/', ctx(never, ['*.internal']))).toBe(
      'Refused: x.internal is not a public address',
    );
    expect(
      await refused(
        'https://docs.example.com/logo.png',
        ctx(() => Promise.resolve(page('PNG', 'image/png'))),
      ),
    ).toBe('docs.example.com answered with image/png, not text');
  });

  it('checks every redirect against the scope again', async () => {
    const r = await runTool(
      'fetch_url',
      { url: 'https://docs.example.com/old' },
      ctx(() =>
        Promise.resolve(page('', 'text/plain', 302, { location: 'https://evil.example.org/new' })),
      ),
    );
    expect(r).toEqual({
      ok: false,
      content: "Refused: evil.example.org is outside Coder's network scope (docs.example.com)",
    });
  });

  it('cuts a large answer', async () => {
    const r = await runTool(
      'fetch_url',
      { url: 'https://docs.example.com/big.json' },
      ctx(() => Promise.resolve(page('x'.repeat(1_200_000), 'application/json'))),
    );
    const out = JSON.parse(r.content) as { text: string; truncated: boolean };
    expect(out.text.length).toBe(20_000);
    expect(out.truncated).toBe(true);
  });

  it('turns HTML into readable lines', () => {
    expect(htmlText('<script>a()</script><p>One<br>Two</p><div>&amp; three</div>')).toBe(
      'One\nTwo\n& three',
    );
  });
});
