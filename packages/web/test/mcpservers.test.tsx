// ── [PCODE-334 | S15 | v0.1.0] T33.4c MCP servers per agent: registry, our own MCP client, tools in runs under the agent's rules ──
//    Why:  a server's last test reads in a few words: untested, its error, or its tools and how many agents may use.
import { describe, expect, it } from 'vitest';
import { serverState } from '../src/mcpservers.js';

describe('MCP server state', () => {
  it('says how the last test went', () => {
    const base = { toolCount: null, allowedTools: [], lastError: '', lastOkAt: null };
    expect(serverState(base)).toBe('not tested yet');
    expect(serverState({ ...base, lastError: 'The server refused the key' })).toBe(
      'The server refused the key',
    );
    expect(serverState({ ...base, toolCount: 12 })).toBe('12 tools, all open to agents');
    expect(serverState({ ...base, toolCount: 12, allowedTools: ['a', 'b', 'c'] })).toBe(
      '12 tools, 3 open to agents',
    );
  });
});
