// ── [PCODE-353 | S15 | v0.1.0] T35.4a System health page with backup, restore and upgrade wizards ──
//    Why:  sizes and durations read like people say them; the backup wizard sees only its new, checked backup.
import { describe, expect, it } from 'vitest';
import { bytesText, newBackup, sinceText } from '../src/v2/system.js';

describe('system page', () => {
  it('says sizes and durations', () => {
    expect(bytesText(512)).toBe('512 B');
    expect(bytesText(1536)).toBe('1,5 KB');
    expect(bytesText(820 * 1024 * 1024)).toBe('820 MB');
    const now = Date.UTC(2026, 9, 15, 12);
    expect(sinceText(new Date(now - 8 * 60_000).toISOString(), now)).toBe('8 min');
    expect(sinceText(new Date(now - (5 * 60 + 12) * 60_000).toISOString(), now)).toBe('5 h 12 min');
    expect(sinceText(new Date(now - (3 * 1440 + 4 * 60) * 60_000).toISOString(), now)).toBe(
      '3 days 4 h',
    );
  });
  it('waits for a new, checked backup', () => {
    const since = Date.UTC(2026, 9, 15, 12);
    const b = (min: number, checked: boolean) => ({
      name: 'orqiva-x.dump',
      bytes: 1,
      at: new Date(since + min * 60_000).toISOString(),
      checked,
      withFiles: true,
    });
    expect(newBackup([b(-5, true)], since)).toBeNull();
    expect(newBackup([b(1, false)], since)).toBeNull();
    expect(newBackup([b(1, true)], since)?.name).toBe('orqiva-x.dump');
    expect(newBackup(null, since)).toBeNull();
  });
});
