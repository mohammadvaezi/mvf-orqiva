// ── [PCODE-234 | S15 | v0.1.0] T23.1 Messaging core on the server: channels, direct messages, threads, mentions, live delivery ──
import { describe, expect, it } from 'vitest';
import { channelName, dmKey, messagePreview, taskRefsIn } from '../src/index.js';

describe('conversation rules', () => {
  it('turns a typed channel name into one that works in a link', () => {
    expect(channelName('Release Planning!')).toBe('release-planning');
    expect(channelName('#app.backend')).toBe('app-backend');
    expect(channelName('  -- ')).toBeNull();
    expect(channelName('a'.repeat(100))).toHaveLength(80);
  });

  it('keys a direct conversation by its people, in any order', () => {
    expect(dmKey(['b', 'a', 'b'])).toBe('a,b');
    expect(dmKey(['a', 'b'])).toBe(dmKey(['b', 'a']));
  });

  it('finds task references and shortens previews', () => {
    expect(taskRefsIn('See APP-12 and OPS-3, again APP-12; not x-APP-9 or app-1')).toEqual([
      'APP-12',
      'OPS-3',
    ]);
    expect(messagePreview('a  b\nc')).toBe('a b c');
    expect(messagePreview('x'.repeat(200), 10)).toBe('xxxxxxxxx…');
  });
});
